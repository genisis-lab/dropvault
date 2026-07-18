import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { nowSeconds } from "../lib/expiry";
import { notifyAdmins, notifyUser } from "../lib/notifications";
import { requireAuth } from "../middleware/auth";
import { adminRole, requireAdminRole } from "../middleware/admin";
import type { Bindings, Variables } from "../types";

const keepForever = new Hono<{ Bindings: Bindings; Variables: Variables }>();
keepForever.use("*", requireAuth);

let schemaReady = false;

async function ignoreDuplicateOrExists(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    const message = String((err as Error)?.message ?? err).toLowerCase();
    if (
      !message.includes("duplicate column") &&
      !message.includes("already exists")
    )
      throw err;
  }
}

async function ensureKeepForeverSchema(env: Bindings) {
  if (schemaReady) return;
  // Quote "user" because it can behave like a reserved identifier in raw D1 SQL.
  await ignoreDuplicateOrExists(
    env.DB.prepare(
      'ALTER TABLE "user" ADD COLUMN keep_files_forever integer DEFAULT false',
    ).run(),
  );
  await ignoreDuplicateOrExists(
    env.DB.prepare(
      "ALTER TABLE files ADD COLUMN keep_forever integer DEFAULT false",
    ).run(),
  );
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS keep_forever_requests (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    reason text,
    status text NOT NULL DEFAULT 'pending',
    reviewed_by text,
    reviewed_at integer,
    created_at integer NOT NULL
  )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_keep_forever_requests_user ON keep_forever_requests(user_id, created_at)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_keep_forever_requests_status ON keep_forever_requests(status, created_at)",
  ).run();
  schemaReady = true;
}

function roleGetsForever(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "moderator";
}

type RawKeepForeverRequest = {
  id: string;
  user_id: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
};

function requestFromRaw(row: RawKeepForeverRequest) {
  return {
    id: row.id,
    userId: row.user_id,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

async function userHasDirectGrant(
  env: Bindings,
  userId: string,
): Promise<boolean> {
  await ensureKeepForeverSchema(env);
  const row = await env.DB.prepare(
    'SELECT keep_files_forever AS keepFilesForever FROM "user" WHERE id = ?',
  )
    .bind(userId)
    .first<{ keepFilesForever?: number | boolean | null }>()
    .catch(() => null);
  return !!row?.keepFilesForever;
}

async function rawRequests(env: Bindings, userId: string, limit = 10) {
  await ensureKeepForeverSchema(env);
  const result = await env.DB.prepare(
    "SELECT id, user_id, reason, status, reviewed_by, reviewed_at, created_at FROM keep_forever_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(userId, limit)
    .all<RawKeepForeverRequest>()
    .catch(() => ({ results: [] as RawKeepForeverRequest[] }));
  return (result.results ?? []).map(requestFromRaw);
}

async function statusFor(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string | null | undefined,
) {
  await ensureKeepForeverSchema(env);
  const role = await adminRole(env, db, email);
  const directGrant = await userHasDirectGrant(env, userId);
  const canKeepFilesForever = roleGetsForever(role) || directGrant;
  const requests = await rawRequests(env, userId, 10);
  const pending = requests.find((r) => r.status === "pending") ?? null;
  return {
    canKeepFilesForever,
    keepFilesForever: directGrant,
    role,
    pendingRequest: pending,
    requests,
  };
}

keepForever.get("/status", async (c) => {
  const db = getDb(c.env.DB);
  return c.json(
    await statusFor(c.env, db, c.get("userId"), c.get("userEmail")),
  );
});

keepForever.post("/request", async (c) => {
  const userId = c.get("userId");
  const email = c.get("userEmail");
  const body = await c.req
    .json<{ reason?: string }>()
    .catch(() => ({}) as { reason?: string });
  const db = getDb(c.env.DB);
  const status = await statusFor(c.env, db, userId, email);
  if (status.canKeepFilesForever)
    return c.json(
      { error: "Your account can already keep files forever." },
      400,
    );
  if (status.pendingRequest)
    return c.json(
      { error: "You already have a pending keep-forever request." },
      429,
    );
  const id = crypto.randomUUID();
  const reason = body.reason?.trim().slice(0, 1000) || null;
  await c.env.DB.prepare(
    "INSERT INTO keep_forever_requests (id, user_id, reason, status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, 'pending', NULL, NULL, ?)",
  )
    .bind(id, userId, reason, nowSeconds())
    .run();
  await notifyAdmins(c.env, db, {
    type: "keep_forever_request",
    title: "New keep-forever request",
    message: `${email ?? userId} requested permission to keep files forever.${reason ? " Reason: " + reason : ""}`,
    targetType: "keep_forever_request",
    targetId: id,
  });
  return c.json({ ok: true, id });
});

keepForever.get("/requests", requireAdminRole("admin"), async (c) => {
  await ensureKeepForeverSchema(c.env);
  const status = c.req.query("status");
  const db = getDb(c.env.DB);
  const [raw, users] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, user_id, reason, status, reviewed_by, reviewed_at, created_at FROM keep_forever_requests ORDER BY created_at DESC",
    )
      .all<RawKeepForeverRequest>()
      .catch(() => ({ results: [] as RawKeepForeverRequest[] })),
    db
      .select()
      .from(schema.user)
      .all()
      .catch(() => []),
  ]);
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const rows = (raw.results ?? []).map(requestFromRaw);
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return c.json({
    requests: filtered.map((r) => {
      const u = userById.get(r.userId);
      return {
        ...r,
        userEmail: u?.email ?? null,
        userName: u?.name ?? null,
        userCanKeepForever: !!u?.keepFilesForever,
      };
    }),
  });
});

keepForever.post(
  "/requests/:id/approve",
  requireAdminRole("admin"),
  async (c) => {
    await ensureKeepForeverSchema(c.env);
    const id = c.req.param("id");
    const db = getDb(c.env.DB);
    const req = await db
      .select()
      .from(schema.keepForeverRequests)
      .where(eq(schema.keepForeverRequests.id, id))
      .get();
    if (!req || req.status !== "pending")
      return c.json({ error: "not found or already handled" }, 404);
    await db
      .update(schema.keepForeverRequests)
      .set({
        status: "approved",
        reviewedBy: c.get("userEmail"),
        reviewedAt: nowSeconds(),
      })
      .where(eq(schema.keepForeverRequests.id, id))
      .run();
    await c.env.DB.prepare(
      'UPDATE "user" SET keep_files_forever = 1 WHERE id = ?',
    )
      .bind(req.userId)
      .run();
    await notifyUser(db, {
      userId: req.userId,
      type: "keep_forever_request",
      title: "Keep-forever permission approved",
      message: "Your account can now keep uploaded files forever.",
      targetType: "keep_forever_request",
      targetId: req.id,
    });
    return c.json({ ok: true });
  },
);

keepForever.post(
  "/requests/:id/reject",
  requireAdminRole("admin"),
  async (c) => {
    await ensureKeepForeverSchema(c.env);
    const id = c.req.param("id");
    const db = getDb(c.env.DB);
    const req = await db
      .select()
      .from(schema.keepForeverRequests)
      .where(eq(schema.keepForeverRequests.id, id))
      .get();
    if (!req || req.status !== "pending")
      return c.json({ error: "not found or already handled" }, 404);
    await db
      .update(schema.keepForeverRequests)
      .set({
        status: "rejected",
        reviewedBy: c.get("userEmail"),
        reviewedAt: nowSeconds(),
      })
      .where(eq(schema.keepForeverRequests.id, id))
      .run();
    await notifyUser(db, {
      userId: req.userId,
      type: "keep_forever_request",
      title: "Keep-forever request rejected",
      message: "Your request to keep files forever was reviewed and rejected.",
      targetType: "keep_forever_request",
      targetId: req.id,
    });
    return c.json({ ok: true });
  },
);

keepForever.post("/users/:id", requireAdminRole("moderator"), async (c) => {
  await ensureKeepForeverSchema(c.env);
  const id = c.req.param("id");
  const body = await c.req
    .json<{ allowed?: boolean }>()
    .catch(() => ({}) as { allowed?: boolean });
  const db = getDb(c.env.DB);
  const u = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .get();
  if (!u) return c.json({ error: "not found" }, 404);
  const allowed = !!body.allowed;
  await c.env.DB.prepare(
    'UPDATE "user" SET keep_files_forever = ? WHERE id = ?',
  )
    .bind(allowed ? 1 : 0, id)
    .run();
  await notifyUser(db, {
    userId: id,
    type: "keep_forever_permission",
    title: allowed
      ? "Keep-forever permission enabled"
      : "Keep-forever permission removed",
    message: allowed
      ? "An admin enabled permission for your account to keep files forever."
      : "An admin removed keep-forever permission from your account.",
    targetType: "user",
    targetId: id,
  });
  return c.json({ ok: true, keepFilesForever: allowed });
});

export default keepForever;
