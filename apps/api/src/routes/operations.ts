import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { adminRole } from "../middleware/admin";
import { checkRateLimit } from "../lib/rateLimit";
import { getDb } from "../db";
import {
  clientPlatform,
  normalizeThresholds,
  operationThresholds,
  refreshOperationalAlerts,
} from "../lib/operations";
import type { Bindings, Variables } from "../types";

const operations = new Hono<{ Bindings: Bindings; Variables: Variables }>();
operations.use("*", requireAuth);
operations.post("/upload-event", async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return c.json({ error: "Invalid diagnostic event" }, 400);
  const outcomes = ["success", "failed", "cancelled", "thumbnail-failed"];
  if (
    typeof body.attemptId !== "string" ||
    !/^[\w-]{1,80}$/.test(body.attemptId) ||
    !outcomes.includes(String(body.outcome)) ||
    !["preparing", "uploading", "finishing"].includes(String(body.stage))
  )
    return c.json({ error: "Invalid diagnostic event" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const rate = await checkRateLimit(
    c.env.DB,
    `diagnostics:${c.get("userId")}`,
    1000,
    3600,
  );
  if (!rate.allowed)
    return c.json({ error: "Diagnostic rate limit reached" }, 429);
  let fileId: string | null = null;
  if (typeof body.fileId === "string") {
    const file = await c.env.DB.prepare(
      "SELECT id FROM files WHERE id=? AND owner_id=?",
    )
      .bind(body.fileId, c.get("userId"))
      .first<{ id: string }>();
    fileId = file?.id ?? null;
  }
  const platform = clientPlatform(c.req.header("User-Agent") ?? "");
  const category = [
    "preview",
    "quota-or-size",
    "network",
    "access",
    "other",
    "cancelled",
  ].includes(String(body.category))
    ? String(body.category)
    : "none";
  const bounded = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.floor(Math.max(0, Math.min(max, v)))
      : 0;
  const id = `${c.get("userId")}:${body.attemptId}:${body.outcome === "thumbnail-failed" ? "preview" : "result"}`;
  await c.env.DB.prepare(
    `INSERT INTO upload_diagnostics(id,user_id,file_id,outcome,stage,category,size_bytes,duration_ms,browser,os,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET file_id=excluded.file_id,outcome=excluded.outcome,stage=excluded.stage,category=excluded.category,duration_ms=excluded.duration_ms,created_at=excluded.created_at`,
  )
    .bind(
      id,
      c.get("userId"),
      fileId,
      String(body.outcome),
      String(body.stage),
      category,
      bounded(body.sizeBytes, Number.MAX_SAFE_INTEGER),
      bounded(body.durationMs, 7 * 86400000),
      platform.browser,
      platform.os,
      now,
    )
    .run();
  return c.json({ ok: true });
});
operations.use("*", async (c, next) => {
  const role = await adminRole(c.env, getDb(c.env.DB), c.get("userEmail"));
  if (!role || !["owner", "admin", "auditor"].includes(role))
    return c.json({ error: "forbidden" }, 403);
  if (c.req.method !== "GET" && role !== "owner")
    return c.json({ error: "Owner required" }, 403);
  await next();
});
operations.get("/health", async (c) => {
  const [runs, pending, multipart, previews, thresholds, alerts] =
    await Promise.all([
      c.env.DB.prepare("SELECT * FROM operation_runs ORDER BY name").all(),
      c.env.DB.prepare(
        "SELECT COUNT(*) n FROM files WHERE status='pending' AND created_at<?",
      )
        .bind(Math.floor(Date.now() / 1000) - 86400)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) n FROM upload_sessions WHERE status='active' AND expires_at<?",
      )
        .bind(Math.floor(Date.now() / 1000))
        .first<{ n: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) n FROM upload_diagnostics WHERE outcome='thumbnail-failed' AND created_at>?",
      )
        .bind(Math.floor(Date.now() / 1000) - 86400)
        .first<{ n: number }>(),
      operationThresholds(c.env),
      c.env.DB.prepare(
        "SELECT * FROM operational_alerts ORDER BY status, last_seen_at DESC",
      ).all(),
    ]);
  let storageReachable = true;
  try {
    await c.env.FILES.head("__healthcheck__");
  } catch {
    storageReachable = false;
  }
  return c.json({
    runs: runs.results,
    stuckUploads: pending?.n ?? 0,
    abandonedMultipart: multipart?.n ?? 0,
    thumbnailFailures: previews?.n ?? 0,
    storageReachable,
    thresholds,
    alerts: alerts.results,
  });
});
operations.get("/diagnostics", async (c) => {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const rows = await c.env.DB.prepare(
    `SELECT outcome,stage,category,browser,os, CASE WHEN size_bytes<10485760 THEN 'Under 10 MiB' WHEN size_bytes<104857600 THEN '10–100 MiB' ELSE '100 MiB+' END size_band,COUNT(*) count,ROUND(AVG(duration_ms)) duration_ms FROM upload_diagnostics WHERE created_at>? GROUP BY outcome,stage,category,browser,os,size_band ORDER BY count DESC LIMIT 200`,
  )
    .bind(since)
    .all();
  const totals = await c.env.DB.prepare(
    "SELECT outcome,COUNT(*) count FROM upload_diagnostics WHERE created_at>? GROUP BY outcome",
  )
    .bind(since)
    .all();
  return c.json({ rows: rows.results, totals: totals.results, since });
});
operations.post("/thresholds", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object")
    return c.json({ error: "Invalid thresholds" }, 400);
  const thresholds = normalizeThresholds(body),
    now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    "INSERT INTO app_settings(key,value,updated_at) VALUES('operationThresholds',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  )
    .bind(JSON.stringify(thresholds), now)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO audit_log(id,actor_email,action,target_type,target_id,detail,created_at) VALUES(?,?,'operations.thresholds','settings','operationThresholds',?,?)",
  )
    .bind(
      crypto.randomUUID(),
      c.get("userEmail"),
      JSON.stringify(thresholds),
      now,
    )
    .run();
  await refreshOperationalAlerts(c.env);
  return c.json({ ok: true, thresholds });
});
operations.post("/alerts/:id/acknowledge", async (c) => {
  await c.env.DB.prepare(
    "UPDATE operational_alerts SET acknowledged_at=?,acknowledged_by=? WHERE id=? AND status='open'",
  )
    .bind(Math.floor(Date.now() / 1000), c.get("userEmail"), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});
// Read-only, bounded pages in both directions. Never interpret a failed DB query as absence.
operations.get("/reconciliation", async (c) => {
  const rate = await checkRateLimit(
    c.env.DB,
    `reconcile:${c.get("userId")}`,
    60,
    3600,
  );
  if (!rate.allowed) return c.json({ error: "Scan rate limit reached" }, 429);
  const direction =
    c.req.query("direction") === "missing" ? "missing" : "orphans";
  const cursor = c.req.query("cursor") || undefined;
  const cutoff = Date.now() - 86400000;
  if (direction === "missing") {
    const rows = await c.env.DB.prepare(
      `SELECT id,r2_key key,'file' kind FROM files WHERE status='ready' AND (? IS NULL OR r2_key>?) UNION ALL SELECT id,r2_key key,'version' kind FROM file_versions WHERE (? IS NULL OR r2_key>?) ORDER BY key LIMIT 26`,
    )
      .bind(cursor ?? null, cursor ?? null, cursor ?? null, cursor ?? null)
      .all<{ id: string; key: string; kind: string }>();
    const page = rows.results.slice(0, 25),
      missing = [];
    for (const row of page)
      if (!(await c.env.FILES.head(row.key))) missing.push(row);
    return c.json({
      direction,
      scanned: page.length,
      items: missing,
      nextCursor: rows.results.length > 25 ? page.at(-1)?.key : null,
      graceHours: 24,
    });
  }
  const listing = await c.env.FILES.list({ limit: 25, cursor });
  const items = [];
  let skippedRecent = 0;
  for (const object of listing.objects) {
    if (!object.uploaded || object.uploaded.getTime() > cutoff) {
      skippedRecent++;
      continue;
    }
    const base = object.key.endsWith("/thumb")
      ? object.key.slice(0, -6)
      : object.key;
    const live = await c.env.DB.prepare(
      "SELECT id FROM files WHERE r2_key=? UNION ALL SELECT id FROM file_versions WHERE r2_key=? LIMIT 1",
    )
      .bind(base, base)
      .first();
    if (!live)
      items.push({
        key: object.key,
        sizeBytes: object.size,
        uploadedAt: Math.floor(object.uploaded.getTime() / 1000),
      });
  }
  return c.json({
    direction,
    scanned: listing.objects.length,
    items,
    skippedRecent,
    nextCursor: listing.truncated ? listing.cursor : null,
    graceHours: 24,
  });
});
operations.post("/reconciliation/cleanup", async (c) => {
  const body = await c.req.json<{ keys?: unknown[]; confirmation?: string }>();
  if (
    body.confirmation !== "DELETE REVIEWED ORPHANS" ||
    !Array.isArray(body.keys) ||
    !body.keys.length ||
    body.keys.length > 25 ||
    body.keys.some((k) => typeof k !== "string" || k.length > 1024)
  )
    return c.json(
      { error: "Review up to 25 objects and confirm DELETE REVIEWED ORPHANS" },
      400,
    );
  let deleted = 0,
    skipped = 0;
  for (const key of new Set(body.keys as string[])) {
    const object = await c.env.FILES.head(key);
    if (
      !object ||
      !object.uploaded ||
      object.uploaded.getTime() > Date.now() - 86400000
    ) {
      skipped++;
      continue;
    }
    const base = key.endsWith("/thumb") ? key.slice(0, -6) : key;
    const live = await c.env.DB.prepare(
      "SELECT id FROM files WHERE r2_key=? UNION ALL SELECT id FROM file_versions WHERE r2_key=? LIMIT 1",
    )
      .bind(base, base)
      .first();
    if (live) {
      skipped++;
      continue;
    }
    await c.env.DB.prepare(
      "INSERT INTO audit_log(id,actor_email,action,target_type,target_id,detail,created_at) VALUES(?,?,'storage.orphan.cleanup','object',?,'Owner reviewed; references and 24-hour grace rechecked',?)",
    )
      .bind(
        crypto.randomUUID(),
        c.get("userEmail"),
        key,
        Math.floor(Date.now() / 1000),
      )
      .run();
    await c.env.FILES.delete(key);
    deleted++;
  }
  return c.json({ ok: true, deleted, skipped });
});
export default operations;
