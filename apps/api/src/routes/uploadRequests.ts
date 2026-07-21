import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { DAY_SECONDS, nowSeconds } from "../lib/expiry";
import {
  hashSecret,
  sha256Hex,
  sha256StreamHex,
  timingSafeEqualHex,
  verifySecret,
} from "../lib/hash";
import { notifyUser } from "../lib/notifications";
import { checkRateLimit, clientIp } from "../lib/rateLimit";
import {
  completeReservation,
  releaseReservation,
  reserveUpload,
} from "../lib/quota";
import { requireAuth } from "../middleware/auth";
import { adminRole } from "../middleware/admin";
import type { Bindings, Variables } from "../types";
import { scanFile } from "../lib/scanner";

type CreateUploadRequestBody = {
  title?: string;
  instructions?: string;
  password?: string | null;
  folderId?: string | null;
  maxFileSize?: number | null;
  totalMaxBytes?: number | null;
  allowedTypes?: string;
  uploadLimit?: number | null;
  requireEmail?: boolean;
  expiresInDays?: number | null;
  status?: string;
  moderationMode?: string;
  thankYouMessage?: string | null;
  closeAfterFirstUpload?: boolean;
};
type UploadFileLike = {
  name: string;
  size: number;
  type: string;
  stream: () => ReadableStream;
};

const uploadRequests = new Hono<{ Bindings: Bindings; Variables: Variables }>();
function safeRequest(r: any, appUrl: string) {
  const { password, ...rest } = r;
  return {
    ...rest,
    status: r.status ?? "open",
    moderationMode: r.moderationMode ?? "auto",
    closeAfterFirstUpload: !!r.closeAfterFirstUpload,
    hasPassword: !!password,
    url: `${appUrl}/request/${r.token}`,
  };
}
function allowed(type: string, allowedTypes: string | null): boolean {
  const values = (allowedTypes || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) return true;
  const t = type.toLowerCase();
  return values.some((a) =>
    a.endsWith("/*") ? t.startsWith(a.slice(0, -1)) : t === a,
  );
}
function isUploadFileLike(value: unknown): value is UploadFileLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.size === "number" &&
    typeof v.stream === "function"
  );
}
function uploadFilesFrom(form: FormData): UploadFileLike[] {
  const out: UploadFileLike[] = [];
  const seen = new Set<unknown>();
  for (const value of [...form.getAll("files"), ...form.getAll("file")]) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (isUploadFileLike(value)) out.push(value);
  }
  return out;
}
async function workspacePolicy(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .all()
    .catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value] as const));
  return {
    maxUploadBytes: Number(map.get("maxUploadBytes") || 0),
    allowedTypes: String(map.get("allowedTypes") || ""),
    defaultQuotaBytes: Number(map.get("defaultQuotaBytes") || 1073741824),
  };
}
async function ownerQuota(
  c: any,
  db: ReturnType<typeof getDb>,
  ownerId: string,
  policy: { defaultQuotaBytes: number },
): Promise<number | null> {
  const owner = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, ownerId))
    .get()
    .catch(() => null);
  const role = await adminRole(c.env, db, owner?.email ?? "");
  const quota =
    role === "owner" || role === "admin"
      ? null
      : (owner?.quotaBytes ?? policy.defaultQuotaBytes);
  return quota == null || quota <= 0 ? null : quota;
}
async function createPublicFile(
  c: any,
  db: ReturnType<typeof getDb>,
  row: any,
  file: UploadFileLike,
  now: number,
  status: string,
  uploaderEmail: string | null,
  uploaderName: string | null,
  contentHash: string,
) {
  const id = crypto.randomUUID();
  const r2Key = `${row.ownerId}/${id}`;
  const contentType = file.type || "application/octet-stream";
  await db
    .insert(schema.files)
    .values({
      id,
      ownerId: row.ownerId,
      filename: file.name.slice(0, 255),
      r2Key,
      sizeBytes: file.size,
      contentType,
      contentHash,
      checksum: contentHash,
      checksumAlgorithm: "sha-256",
      status: "pending",
      folderId: row.folderId ?? null,
      versionGroupId: id,
      createdAt: now,
      expiresAt: now + 7 * DAY_SECONDS,
    })
    .run();
  const policy = await workspacePolicy(db);
  const reserved = await reserveUpload(c.env.DB, {
    userId: row.ownerId,
    fileId: id,
    bytes: file.size,
    quotaBytes: await ownerQuota(c, db, row.ownerId, policy),
  });
  if (!reserved.reserved) {
    await db
      .delete(schema.files)
      .where(eq(schema.files.id, id))
      .run()
      .catch(() => {});
    throw new Error("the owner's storage is full");
  }
  try {
    await c.env.FILES.put(r2Key, file.stream(), {
      httpMetadata: contentType ? { contentType } : undefined,
      sha256: contentHash,
    });
    const object = await c.env.FILES.head(r2Key);
    if (!object || object.size !== file.size)
      throw new Error("uploaded object size mismatch");
    const storedStatus = c.env.SCANNER ? "quarantined" : status;
    await db
      .update(schema.files)
      .set({
        status: storedStatus,
        scanStatus: c.env.SCANNER ? "pending" : "not_required",
      })
      .where(eq(schema.files.id, id))
      .run();
    if (c.env.SCANNER)
      c.executionCtx.waitUntil(
        scanFile(c.env, id, status === "ready" ? "ready" : "quarantined"),
      );
    await completeReservation(c.env.DB, id);
    await db
      .insert(schema.fileVersions)
      .values({
        id: crypto.randomUUID(),
        fileId: id,
        versionGroupId: id,
        versionNumber: 1,
        r2Key,
        sizeBytes: file.size,
        contentType,
        filename: file.name.slice(0, 255),
        createdAt: now,
      })
      .run();
    await db
      .insert(schema.publicUploads)
      .values({
        id: crypto.randomUUID(),
        requestId: row.id,
        fileId: id,
        uploaderEmail,
        uploaderName,
        status: status === "ready" ? "approved" : "pending",
        filename: file.name.slice(0, 255),
        sizeBytes: file.size,
        contentType,
        reviewedBy: status === "ready" ? "auto" : null,
        reviewedAt: status === "ready" ? now : null,
        createdAt: now,
      })
      .run();
    return id;
  } catch (error) {
    await c.env.FILES.delete(r2Key).catch(() => {});
    await releaseReservation(c.env.DB, id).catch(() => {});
    await db
      .delete(schema.files)
      .where(eq(schema.files.id, id))
      .run()
      .catch(() => {});
    throw error;
  }
}

async function validTurnstile(c: any, token: string): Promise<boolean> {
  if (!c.env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData();
  form.set("secret", c.env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const ip = clientIp(c);
  if (ip !== "unknown") form.set("remoteip", ip);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const result: { success?: boolean; hostname?: string } = await response
    .json<{ success?: boolean; hostname?: string }>()
    .catch(() => ({}) as { success?: boolean; hostname?: string });
  let expectedHostname = "";
  try {
    expectedHostname = new URL(c.env.PUBLIC_APP_URL).hostname.toLowerCase();
  } catch {}
  return (
    result.success === true &&
    !!expectedHostname &&
    String(result.hostname ?? "").toLowerCase() === expectedHostname
  );
}

uploadRequests.get("/", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.ownerId, c.get("userId")))
    .orderBy(desc(schema.uploadRequests.createdAt))
    .all();
  const uploads = await db
    .select()
    .from(schema.publicUploads)
    .all()
    .catch(() => []);
  const countByRequest = new Map<string, number>();
  const pendingByRequest = new Map<string, number>();
  const bytesByRequest = new Map<string, number>();
  for (const u of uploads) {
    countByRequest.set(u.requestId, (countByRequest.get(u.requestId) ?? 0) + 1);
    if ((u.status ?? "approved") === "pending")
      pendingByRequest.set(
        u.requestId,
        (pendingByRequest.get(u.requestId) ?? 0) + 1,
      );
    bytesByRequest.set(
      u.requestId,
      (bytesByRequest.get(u.requestId) ?? 0) + (u.sizeBytes ?? 0),
    );
  }
  return c.json({
    requests: rows.map((r) => ({
      ...safeRequest(r, c.env.PUBLIC_APP_URL),
      submissionCount: countByRequest.get(r.id) ?? 0,
      pendingCount: pendingByRequest.get(r.id) ?? 0,
      totalUploadedBytes: bytesByRequest.get(r.id) ?? 0,
    })),
  });
});
uploadRequests.post("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<CreateUploadRequestBody>()
    .catch(() => ({}) as CreateUploadRequestBody);
  const db = getDb(c.env.DB);
  let folderId: string | null = null;
  if (body.folderId) {
    const folder = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, body.folderId),
          eq(schema.folders.ownerId, userId),
        ),
      )
      .get();
    if (!folder) return c.json({ error: "folder not found" }, 404);
    folderId = body.folderId;
  }
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, "");
  const createdAt = nowSeconds();
  const expiresInDays = Number(body.expiresInDays ?? 0);
  const expiresAt =
    expiresInDays > 0
      ? createdAt + Math.round(expiresInDays * DAY_SECONDS)
      : null;
  const status = ["open", "closed"].includes(String(body.status))
    ? String(body.status)
    : "open";
  const moderationMode =
    String(body.moderationMode) === "manual" ? "manual" : "auto";
  await db
    .insert(schema.uploadRequests)
    .values({
      id,
      ownerId: userId,
      folderId,
      token,
      title: (body.title || "Upload files").trim().slice(0, 120),
      instructions: body.instructions?.slice(0, 1000) ?? null,
      password: body.password ? await hashSecret(String(body.password)) : null,
      maxFileSize:
        body.maxFileSize && body.maxFileSize > 0
          ? Math.floor(body.maxFileSize)
          : null,
      totalMaxBytes:
        body.totalMaxBytes && body.totalMaxBytes > 0
          ? Math.floor(body.totalMaxBytes)
          : null,
      allowedTypes: body.allowedTypes?.slice(0, 500) ?? null,
      uploadLimit:
        body.uploadLimit && body.uploadLimit > 0
          ? Math.floor(body.uploadLimit)
          : null,
      requireEmail: !!body.requireEmail,
      status,
      moderationMode,
      thankYouMessage: body.thankYouMessage?.slice(0, 1000) ?? null,
      closeAfterFirstUpload: !!body.closeAfterFirstUpload,
      expiresAt,
      createdAt,
    })
    .run();
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.id, id))
    .get();
  return c.json({ request: safeRequest(row, c.env.PUBLIC_APP_URL) });
});
uploadRequests.patch("/:id", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(
      and(
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.ownerId, c.get("userId")),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const body = await c.req
    .json<CreateUploadRequestBody>()
    .catch(() => ({}) as CreateUploadRequestBody);
  const update: Record<string, unknown> = {};
  if (typeof body.title === "string")
    update.title = body.title.trim().slice(0, 120) || row.title;
  if ("instructions" in body)
    update.instructions = body.instructions?.slice(0, 1000) ?? null;
  if ("status" in body && ["open", "closed"].includes(String(body.status)))
    update.status = String(body.status);
  if ("moderationMode" in body)
    update.moderationMode =
      String(body.moderationMode) === "manual" ? "manual" : "auto";
  if ("thankYouMessage" in body)
    update.thankYouMessage = body.thankYouMessage?.slice(0, 1000) ?? null;
  if ("closeAfterFirstUpload" in body)
    update.closeAfterFirstUpload = !!body.closeAfterFirstUpload;
  await db
    .update(schema.uploadRequests)
    .set(update)
    .where(eq(schema.uploadRequests.id, id))
    .run();
  const next = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.id, id))
    .get();
  return c.json({ request: safeRequest(next, c.env.PUBLIC_APP_URL) });
});
uploadRequests.post("/:id/close", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  await db
    .update(schema.uploadRequests)
    .set({ status: "closed" })
    .where(
      and(
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.ownerId, c.get("userId")),
      ),
    )
    .run();
  return c.json({ ok: true });
});
uploadRequests.post("/:id/reopen", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  await db
    .update(schema.uploadRequests)
    .set({ status: "open", revokedAt: null })
    .where(
      and(
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.ownerId, c.get("userId")),
      ),
    )
    .run();
  return c.json({ ok: true });
});
uploadRequests.get("/:id/submissions", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(
      and(
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.ownerId, c.get("userId")),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const uploads = await db
    .select()
    .from(schema.publicUploads)
    .where(eq(schema.publicUploads.requestId, id))
    .orderBy(desc(schema.publicUploads.createdAt))
    .all()
    .catch(() => []);
  return c.json({ uploads });
});
uploadRequests.post(
  "/:id/submissions/:uploadId/approve",
  requireAuth,
  async (c) => {
    const db = getDb(c.env.DB);
    const req = await db
      .select()
      .from(schema.uploadRequests)
      .where(
        and(
          eq(schema.uploadRequests.id, c.req.param("id")),
          eq(schema.uploadRequests.ownerId, c.get("userId")),
        ),
      )
      .get();
    if (!req) return c.json({ error: "not found" }, 404);
    const upload = await db
      .select()
      .from(schema.publicUploads)
      .where(eq(schema.publicUploads.id, c.req.param("uploadId")))
      .get()
      .catch(() => null);
    if (!upload || upload.requestId !== req.id || !upload.fileId)
      return c.json({ error: "submission not found" }, 404);
    await db
      .update(schema.publicUploads)
      .set({
        status: "approved",
        reviewedBy: c.get("userEmail"),
        reviewedAt: nowSeconds(),
      })
      .where(eq(schema.publicUploads.id, upload.id))
      .run();
    await db
      .update(schema.files)
      .set({ status: "ready" })
      .where(eq(schema.files.id, upload.fileId))
      .run();
    return c.json({ ok: true });
  },
);
uploadRequests.post(
  "/:id/submissions/:uploadId/reject",
  requireAuth,
  async (c) => {
    const db = getDb(c.env.DB);
    const req = await db
      .select()
      .from(schema.uploadRequests)
      .where(
        and(
          eq(schema.uploadRequests.id, c.req.param("id")),
          eq(schema.uploadRequests.ownerId, c.get("userId")),
        ),
      )
      .get();
    if (!req) return c.json({ error: "not found" }, 404);
    const upload = await db
      .select()
      .from(schema.publicUploads)
      .where(eq(schema.publicUploads.id, c.req.param("uploadId")))
      .get()
      .catch(() => null);
    if (!upload || upload.requestId !== req.id)
      return c.json({ error: "submission not found" }, 404);
    if (upload.fileId) {
      const file = await db
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, upload.fileId))
        .get()
        .catch(() => null);
      if (file) {
        try {
          await c.env.FILES.delete(file.r2Key);
        } catch {}
        await db
          .delete(schema.files)
          .where(eq(schema.files.id, file.id))
          .run()
          .catch(() => {});
      }
    }
    await db
      .update(schema.publicUploads)
      .set({
        status: "rejected",
        reviewedBy: c.get("userEmail"),
        reviewedAt: nowSeconds(),
        fileId: null,
      })
      .where(eq(schema.publicUploads.id, upload.id))
      .run();
    if (upload.status !== "rejected")
      await c.env.DB.prepare(
        "UPDATE upload_requests SET reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
      )
        .bind(upload.sizeBytes ?? 0, req.id)
        .run();
    return c.json({ ok: true });
  },
);
uploadRequests.delete("/:id", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(
      and(
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.ownerId, c.get("userId")),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.uploadRequests)
    .set({ revokedAt: nowSeconds(), status: "closed" })
    .where(eq(schema.uploadRequests.id, id))
    .run();
  return c.json({ ok: true });
});
uploadRequests.get("/public/:token", async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param("token");
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.token, token))
    .get();
  if (!row || row.revokedAt) return c.json({ error: "not found" }, 404);
  if ((row.status ?? "open") !== "open")
    return c.json({ error: "request is closed" }, 410);
  if (row.expiresAt && row.expiresAt <= nowSeconds())
    return c.json({ error: "expired" }, 410);
  if (row.uploadLimit && row.uploadCount >= row.uploadLimit)
    return c.json({ error: "upload limit reached" }, 410);
  const brand = await db
    .select()
    .from(schema.portalBrands)
    .where(eq(schema.portalBrands.userId, row.ownerId))
    .get()
    .catch(() => null);
  return c.json({
    request: { ...safeRequest(row, c.env.PUBLIC_APP_URL), brand },
  });
});

async function publicSession(
  c: any,
  db: ReturnType<typeof getDb>,
  includeCompleted = false,
) {
  const session = await db
    .select()
    .from(schema.uploadSessions)
    .where(eq(schema.uploadSessions.id, c.req.param("sessionId")))
    .get()
    .catch(() => null);
  if (
    !session ||
    (session.status !== "active" &&
      !(includeCompleted && session.status === "completed")) ||
    session.expiresAt <= nowSeconds() ||
    !session.accessTokenHash
  )
    return null;
  const supplied = c.req.header("X-Upload-Token") || "";
  if (
    !supplied ||
    !(await timingSafeEqualHex(
      await sha256Hex(supplied),
      session.accessTokenHash,
    ))
  )
    return null;
  const request = session.requestId
    ? await db
        .select()
        .from(schema.uploadRequests)
        .where(eq(schema.uploadRequests.id, session.requestId))
        .get()
        .catch(() => null)
    : null;
  if (!request || request.token !== c.req.param("token") || request.revokedAt)
    return null;
  const file = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, session.fileId))
    .get()
    .catch(() => null);
  return file ? { session, request, file } : null;
}

uploadRequests.post("/public/:token/multipart/start", async (c) => {
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.token, c.req.param("token")))
    .get();
  if (
    !row ||
    row.revokedAt ||
    row.status !== "open" ||
    (row.expiresAt && row.expiresAt <= nowSeconds())
  )
    return c.json({ error: "request unavailable" }, 410);
  const body = await c.req
    .json<{
      filename?: string;
      sizeBytes?: number;
      contentType?: string;
      email?: string;
      name?: string;
      password?: string;
      turnstileToken?: string;
      contentHash?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          filename?: string;
          sizeBytes?: number;
          contentType?: string;
          email?: string;
          name?: string;
          password?: string;
          turnstileToken?: string;
          contentHash?: string;
        },
    );
  if (!(await validTurnstile(c, String(body.turnstileToken || ""))))
    return c.json({ error: "verification required" }, 403);
  const rate = await checkRateLimit(
    c.env.DB,
    `upload:${row.token}:${clientIp(c)}`,
    20,
    3600,
  );
  if (!rate.allowed)
    return c.json({ error: "too many uploads, please try again later" }, 429);
  if (
    row.password &&
    !(await verifySecret(String(body.password || ""), row.password))
  )
    return c.json({ error: "password required" }, 401);
  const filename = String(body.filename || "")
    .trim()
    .slice(0, 255);
  const sizeBytes = Math.floor(Number(body.sizeBytes));
  const contentType = String(
    body.contentType || "application/octet-stream",
  ).slice(0, 255);
  const uploaderEmail =
    String(body.email || "")
      .trim()
      .slice(0, 255) || null;
  const uploaderName =
    String(body.name || "")
      .trim()
      .slice(0, 120) || null;
  if (!filename || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
    return c.json({ error: "valid file metadata required" }, 400);
  const contentHash = String(body.contentHash || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHash))
    return c.json({ error: "valid SHA-256 contentHash required" }, 400);
  const banned = await db
    .select()
    .from(schema.bannedFileHashes)
    .where(eq(schema.bannedFileHashes.hash, contentHash))
    .get()
    .catch(() => null);
  if (banned)
    return c.json(
      { error: "This file is blocked by workspace security policy." },
      451,
    );
  if (row.requireEmail && !uploaderEmail)
    return c.json({ error: "email required" }, 400);
  const policy = await workspacePolicy(db);
  if (
    (row.maxFileSize && sizeBytes > row.maxFileSize) ||
    (policy.maxUploadBytes > 0 && sizeBytes > policy.maxUploadBytes)
  )
    return c.json({ error: "file exceeds upload limit" }, 413);
  if (
    !allowed(contentType, row.allowedTypes) ||
    !allowed(contentType, policy.allowedTypes)
  )
    return c.json({ error: "file type is not allowed" }, 415);
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, row.ownerId))
    .get()
    .catch(() => null);
  if (suspension)
    return c.json({ error: "uploads are currently unavailable" }, 403);
  const claim = await c.env.DB.prepare(
    `UPDATE upload_requests SET upload_count = upload_count + 1, reserved_bytes = reserved_bytes + ? WHERE id = ? AND status = 'open' AND revoked_at IS NULL AND (upload_limit IS NULL OR upload_count + 1 <= upload_limit) AND (total_max_bytes IS NULL OR reserved_bytes + ? <= total_max_bytes)`,
  )
    .bind(sizeBytes, row.id, sizeBytes)
    .run();
  if (Number(claim.meta?.changes ?? 0) !== 1)
    return c.json({ error: "upload request limit reached" }, 410);
  const fileId = crypto.randomUUID();
  const r2Key = `${row.ownerId}/${fileId}`;
  const now = nowSeconds();
  await db
    .insert(schema.files)
    .values({
      id: fileId,
      ownerId: row.ownerId,
      filename,
      r2Key,
      sizeBytes,
      contentType,
      contentHash,
      checksum: contentHash,
      checksumAlgorithm: "sha-256",
      status: "pending",
      folderId: row.folderId ?? null,
      versionGroupId: fileId,
      createdAt: now,
      expiresAt: now + 7 * DAY_SECONDS,
      scanStatus: row.moderationMode === "manual" ? "pending" : "not_required",
    })
    .run();
  const reservation = await reserveUpload(c.env.DB, {
    userId: row.ownerId,
    fileId,
    bytes: sizeBytes,
    quotaBytes: await ownerQuota(c, db, row.ownerId, policy),
  });
  if (!reservation.reserved) {
    await db.delete(schema.files).where(eq(schema.files.id, fileId)).run();
    await c.env.DB.prepare(
      "UPDATE upload_requests SET upload_count = MAX(0, upload_count - 1), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
    )
      .bind(sizeBytes, row.id)
      .run();
    return c.json({ error: "the owner's storage is full" }, 413);
  }
  try {
    const multipart = await c.env.FILES.createMultipartUpload(r2Key, {
      httpMetadata: { contentType },
    });
    const accessToken =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const sessionId = crypto.randomUUID();
    await db
      .insert(schema.uploadSessions)
      .values({
        id: sessionId,
        fileId,
        userId: row.ownerId,
        uploadId: multipart.uploadId,
        requestId: row.id,
        accessTokenHash: await sha256Hex(accessToken),
        uploaderEmail,
        uploaderName,
        parts: "[]",
        status: "active",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 86400,
      })
      .run();
    return c.json({
      sessionId,
      accessToken,
      fileId,
      partSize: 32 * 1024 * 1024,
      expiresAt: now + 86400,
    });
  } catch (error) {
    await releaseReservation(c.env.DB, fileId).catch(() => {});
    await db
      .delete(schema.files)
      .where(eq(schema.files.id, fileId))
      .run()
      .catch(() => {});
    await c.env.DB.prepare(
      "UPDATE upload_requests SET upload_count = MAX(0, upload_count - 1), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
    )
      .bind(sizeBytes, row.id)
      .run()
      .catch(() => {});
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "could not start upload",
      },
      500,
    );
  }
});

uploadRequests.get("/public/:token/multipart/:sessionId/status", async (c) => {
  const db = getDb(c.env.DB);
  const loaded = await publicSession(c, db, true);
  if (!loaded) return c.json({ error: "upload session unavailable" }, 404);
  return c.json({
    parts: JSON.parse(loaded.session.parts || "[]"),
    expiresAt: loaded.session.expiresAt,
    completed: loaded.session.status === "completed",
    fileId: loaded.file.id,
    pending: loaded.file.status === "quarantined",
    message: loaded.request.thankYouMessage ?? null,
  });
});

uploadRequests.put("/public/:token/multipart/:sessionId/part", async (c) => {
  const db = getDb(c.env.DB);
  const loaded = await publicSession(c, db);
  if (!loaded) return c.json({ error: "upload session unavailable" }, 404);
  const partNumber = Math.floor(Number(c.req.query("partNumber")));
  const length = Math.floor(Number(c.req.header("Content-Length")));
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > 10000 ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > 100 * 1024 * 1024
  )
    return c.json({ error: "invalid part" }, 400);
  const multipart = c.env.FILES.resumeMultipartUpload(
    loaded.file.r2Key,
    loaded.session.uploadId,
  );
  const partBody = c.req.raw.body;
  if (!partBody) return c.json({ error: "empty part" }, 400);
  const part = await multipart.uploadPart(partNumber, partBody);
  const previous = JSON.parse(loaded.session.parts || "[]") as Array<{
    partNumber: number;
    etag: string;
  }>;
  const parts = [
    ...previous.filter((item) => item.partNumber !== partNumber),
    { partNumber: part.partNumber, etag: part.etag },
  ].sort((a, b) => a.partNumber - b.partNumber);
  await db
    .update(schema.uploadSessions)
    .set({ parts: JSON.stringify(parts), updatedAt: nowSeconds() })
    .where(eq(schema.uploadSessions.id, loaded.session.id))
    .run();
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

uploadRequests.post(
  "/public/:token/multipart/:sessionId/complete",
  async (c) => {
    const db = getDb(c.env.DB);
    const loaded = await publicSession(c, db, true);
    if (!loaded) return c.json({ error: "upload session unavailable" }, 404);
    if (loaded.session.status === "completed")
      return c.json({
        ok: true,
        fileId: loaded.file.id,
        pending: loaded.file.status === "quarantined",
        message: loaded.request.thankYouMessage ?? null,
      });
    const parts = (
      JSON.parse(loaded.session.parts || "[]") as Array<{
        partNumber: number;
        etag: string;
      }>
    ).sort((a, b) => a.partNumber - b.partNumber);
    if (!parts.length) return c.json({ error: "no uploaded parts" }, 400);
    try {
      let object = await c.env.FILES.head(loaded.file.r2Key);
      // R2 may have committed the multipart object even if a later database
      // write or the response failed. In that case, continue finalization
      // instead of trying to complete the same multipart upload twice.
      if (!object) {
        await c.env.FILES.resumeMultipartUpload(
          loaded.file.r2Key,
          loaded.session.uploadId,
        ).complete(parts);
        object = await c.env.FILES.head(loaded.file.r2Key);
      }
      if (!object || object.size !== loaded.file.sizeBytes) {
        await c.env.FILES.delete(loaded.file.r2Key).catch(() => {});
        await releaseReservation(c.env.DB, loaded.file.id).catch(() => {});
        await db
          .delete(schema.files)
          .where(eq(schema.files.id, loaded.file.id))
          .run()
          .catch(() => {});
        await c.env.DB.prepare(
          "UPDATE upload_requests SET upload_count = MAX(0, upload_count - 1), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
        )
          .bind(loaded.file.sizeBytes, loaded.request.id)
          .run()
          .catch(() => {});
        return c.json({ error: "uploaded object size mismatch" }, 409);
      }
      const stored = await c.env.FILES.get(loaded.file.r2Key);
      if (!stored) return c.json({ error: "uploaded object missing" }, 409);
      const actualHash = await sha256StreamHex(stored.body);
      const claimedHash = String(loaded.file.contentHash ?? "").toLowerCase();
      const banned = await db
        .select()
        .from(schema.bannedFileHashes)
        .where(eq(schema.bannedFileHashes.hash, actualHash))
        .get()
        .catch(() => null);
      if (actualHash !== claimedHash || banned) {
        await c.env.FILES.delete(loaded.file.r2Key).catch(() => {});
        await releaseReservation(c.env.DB, loaded.file.id).catch(() => {});
        await db
          .delete(schema.files)
          .where(eq(schema.files.id, loaded.file.id))
          .run()
          .catch(() => {});
        await c.env.DB.prepare(
          "UPDATE upload_requests SET upload_count = MAX(0, upload_count - 1), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
        )
          .bind(loaded.file.sizeBytes, loaded.request.id)
          .run()
          .catch(() => {});
        return c.json(
          {
            error: banned
              ? "This file is blocked by workspace security policy."
              : "upload integrity check failed; retry the file",
          },
          banned ? 451 : 409,
        );
      }
      const status =
        loaded.request.moderationMode === "manual" ? "quarantined" : "ready";
      const now = nowSeconds();
      await db
        .update(schema.files)
        .set({
          status: c.env.SCANNER ? "quarantined" : status,
          scanStatus: c.env.SCANNER ? "pending" : "not_required",
        })
        .where(eq(schema.files.id, loaded.file.id))
        .run();
      await completeReservation(c.env.DB, loaded.file.id);
      await db
        .insert(schema.fileVersions)
        .values({
          id: crypto.randomUUID(),
          fileId: loaded.file.id,
          versionGroupId: loaded.file.id,
          versionNumber: 1,
          r2Key: loaded.file.r2Key,
          sizeBytes: loaded.file.sizeBytes,
          contentType: loaded.file.contentType,
          filename: loaded.file.filename,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      const existingPublicUpload = await db
        .select({ id: schema.publicUploads.id })
        .from(schema.publicUploads)
        .where(eq(schema.publicUploads.fileId, loaded.file.id))
        .get()
        .catch(() => null);
      if (!existingPublicUpload)
        await db
          .insert(schema.publicUploads)
          .values({
            id: crypto.randomUUID(),
            requestId: loaded.request.id,
            fileId: loaded.file.id,
            uploaderEmail: loaded.session.uploaderEmail,
            uploaderName: loaded.session.uploaderName,
            status: status === "ready" ? "approved" : "pending",
            filename: loaded.file.filename,
            sizeBytes: loaded.file.sizeBytes,
            contentType: loaded.file.contentType,
            reviewedBy: status === "ready" ? "auto" : null,
            reviewedAt: status === "ready" ? now : null,
            createdAt: now,
          })
          .run();
      if (c.env.SCANNER)
        c.executionCtx.waitUntil(
          scanFile(
            c.env,
            loaded.file.id,
            status === "ready" ? "ready" : "quarantined",
          ),
        );
      if (loaded.request.closeAfterFirstUpload)
        await db
          .update(schema.uploadRequests)
          .set({ status: "closed" })
          .where(eq(schema.uploadRequests.id, loaded.request.id))
          .run();
      await notifyUser(db, {
        userId: loaded.request.ownerId,
        type: "public_upload",
        title: `${loaded.file.filename} uploaded`,
        message: `${loaded.session.uploaderEmail ?? loaded.session.uploaderName ?? "Someone"} uploaded to ${loaded.request.title}`,
        targetType: "upload_request",
        targetId: loaded.request.id,
      });
      await db
        .update(schema.uploadSessions)
        .set({ status: "completed", updatedAt: now })
        .where(eq(schema.uploadSessions.id, loaded.session.id))
        .run();
      return c.json({
        ok: true,
        fileId: loaded.file.id,
        pending: status === "quarantined",
        message: loaded.request.thankYouMessage ?? null,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "could not complete upload",
        },
        500,
      );
    }
  },
);

uploadRequests.post("/public/:token/multipart/:sessionId/abort", async (c) => {
  const db = getDb(c.env.DB);
  const loaded = await publicSession(c, db);
  if (!loaded) return c.json({ error: "upload session unavailable" }, 404);
  await c.env.FILES.resumeMultipartUpload(
    loaded.file.r2Key,
    loaded.session.uploadId,
  )
    .abort()
    .catch(() => {});
  await releaseReservation(c.env.DB, loaded.file.id).catch(() => {});
  await db
    .delete(schema.files)
    .where(eq(schema.files.id, loaded.file.id))
    .run();
  await c.env.DB.prepare(
    "UPDATE upload_requests SET upload_count = MAX(0, upload_count - 1), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
  )
    .bind(loaded.file.sizeBytes, loaded.request.id)
    .run();
  return c.json({ ok: true });
});

uploadRequests.post("/public/:token", async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param("token");
  const row = await db
    .select()
    .from(schema.uploadRequests)
    .where(eq(schema.uploadRequests.token, token))
    .get();
  if (!row || row.revokedAt) return c.json({ error: "not found" }, 404);
  const now = nowSeconds();
  if ((row.status ?? "open") !== "open")
    return c.json({ error: "request is closed" }, 410);
  if (row.expiresAt && row.expiresAt <= now)
    return c.json({ error: "expired" }, 410);
  if (row.uploadLimit && row.uploadCount >= row.uploadLimit)
    return c.json({ error: "upload limit reached" }, 410);
  const requestLength = Number(c.req.header("Content-Length"));
  const maxDirectRequestBytes = 34 * 1024 * 1024;
  if (!Number.isSafeInteger(requestLength) || requestLength <= 0)
    return c.json({ error: "valid Content-Length is required" }, 411);
  if (requestLength > maxDirectRequestBytes)
    return c.json(
      { error: "direct upload request is too large; use resumable upload" },
      413,
    );
  const uploadRate = await checkRateLimit(
    c.env.DB,
    `upload:${token}:${clientIp(c)}`,
    20,
    3600,
  );
  if (!uploadRate.allowed)
    return c.json({ error: "too many uploads, please try again later" }, 429);
  const form = await c.req.formData();
  if (
    !(await validTurnstile(c, String(form.get("cf-turnstile-response") || "")))
  )
    return c.json({ error: "verification required" }, 403);
  const password = String(form.get("password") || "");
  if (row.password) {
    const rl = await checkRateLimit(
      c.env.DB,
      `upw:${token}:${clientIp(c)}`,
      20,
      600,
    );
    if (!rl.allowed)
      return c.json(
        { error: "too many attempts, please wait a few minutes and try again" },
        429,
      );
    if (!(await verifySecret(password, row.password)))
      return c.json({ error: "password required" }, 401);
  }
  const uploaderEmail =
    String(form.get("email") || "")
      .trim()
      .slice(0, 255) || null;
  const uploaderName =
    String(form.get("name") || "")
      .trim()
      .slice(0, 120) || null;
  if (row.requireEmail && !uploaderEmail)
    return c.json({ error: "email required" }, 400);
  const files = uploadFilesFrom(form);
  if (!files.length) return c.json({ error: "file required" }, 400);
  if (files.length > 20)
    return c.json(
      { error: "a maximum of 20 files is allowed per submission" },
      413,
    );
  let contentHashes: string[] = [];
  try {
    const parsed = JSON.parse(String(form.get("contentHashes") || "[]"));
    if (Array.isArray(parsed))
      contentHashes = parsed.map((value) => String(value).trim().toLowerCase());
  } catch {}
  if (
    contentHashes.length !== files.length ||
    contentHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
  )
    return c.json({ error: "a SHA-256 hash is required for every file" }, 400);
  const blocked = await db
    .select({ hash: schema.bannedFileHashes.hash })
    .from(schema.bannedFileHashes)
    .where(inArray(schema.bannedFileHashes.hash, contentHashes))
    .get()
    .catch(() => null);
  if (blocked)
    return c.json(
      { error: "One or more files are blocked by workspace security policy." },
      451,
    );
  const incomingBytes = files.reduce((s, file) => s + file.size, 0);
  if (row.maxFileSize && files.some((file) => file.size > row.maxFileSize!))
    return c.json({ error: "one or more files exceed request limit" }, 413);
  const policy = await workspacePolicy(db);
  if (
    policy.maxUploadBytes > 0 &&
    files.some((file) => file.size > policy.maxUploadBytes)
  )
    return c.json(
      { error: "one or more files exceed the workspace upload limit" },
      413,
    );
  for (const file of files) {
    const contentType = file.type || "application/octet-stream";
    if (
      !allowed(contentType, row.allowedTypes) ||
      !allowed(contentType, policy.allowedTypes)
    )
      return c.json({ error: "one or more file types are not allowed" }, 415);
  }
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, row.ownerId))
    .get()
    .catch(() => null);
  if (suspension)
    return c.json({ error: "uploads are currently unavailable" }, 403);
  const claim = await c.env.DB.prepare(
    `
    UPDATE upload_requests SET upload_count = upload_count + ?, reserved_bytes = reserved_bytes + ?
    WHERE id = ? AND status = 'open' AND revoked_at IS NULL
      AND (upload_limit IS NULL OR upload_count + ? <= upload_limit)
      AND (total_max_bytes IS NULL OR reserved_bytes + ? <= total_max_bytes)
  `,
  )
    .bind(files.length, incomingBytes, row.id, files.length, incomingBytes)
    .run();
  if (Number(claim.meta?.changes ?? 0) !== 1)
    return c.json({ error: "upload request limit reached" }, 410);
  const status = row.moderationMode === "manual" ? "quarantined" : "ready";
  const fileIds: string[] = [];
  try {
    for (const [index, file] of files.entries())
      fileIds.push(
        await createPublicFile(
          c,
          db,
          row,
          file,
          now,
          status,
          uploaderEmail,
          uploaderName,
          contentHashes[index],
        ),
      );
  } catch (error) {
    for (const fileId of fileIds) {
      const created = await db
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, fileId))
        .get()
        .catch(() => null);
      if (created) await c.env.FILES.delete(created.r2Key).catch(() => {});
      await db
        .delete(schema.files)
        .where(eq(schema.files.id, fileId))
        .run()
        .catch(() => {});
    }
    await c.env.DB.prepare(
      "UPDATE upload_requests SET upload_count = MAX(0, upload_count - ?), reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = ?",
    )
      .bind(files.length, incomingBytes, row.id)
      .run()
      .catch(() => {});
    return c.json(
      { error: error instanceof Error ? error.message : "upload failed" },
      500,
    );
  }
  if (row.closeAfterFirstUpload)
    await db
      .update(schema.uploadRequests)
      .set({ status: "closed" })
      .where(eq(schema.uploadRequests.id, row.id))
      .run();
  await notifyUser(db, {
    userId: row.ownerId,
    type: "public_upload",
    title: `${files.length} file${files.length === 1 ? "" : "s"} uploaded`,
    message: `${uploaderEmail ?? uploaderName ?? "Someone"} uploaded to ${row.title}`,
    targetType: "upload_request",
    targetId: row.id,
  });
  return c.json({
    ok: true,
    fileIds,
    pending: status === "quarantined",
    message: row.thankYouMessage ?? null,
  });
});
export default uploadRequests;
