import { Hono } from "hono"
import { desc, eq } from "drizzle-orm"
import { createAuth } from "../auth"
import { getDb, schema } from "../db"
import { adminRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

// Lightweight account endpoint that intentionally does NOT use requireAuth, so a
// suspended user can still learn that they are suspended (requireAuth blocks
// everything else with a 403).
const account = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function roleGetsForever(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "moderator"
}

account.get("/me", async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "unauthorized" }, 401)
  const db = getDb(c.env.DB)
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, session.user.id))
    .get()
    .catch(() => null)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).get().catch(() => null)
  // Admins and the owner have unlimited storage (no quota). Everyone else gets
  // their per-user quota, falling back to the workspace default.
  const role = await adminRole(c.env, db, session.user.email)
  let quotaBytes: number | null = null
  if (role == null) {
    const setting = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "defaultQuotaBytes")).get().catch(() => null)
    const defaultQuota = Number(setting?.value) || 1073741824
    quotaBytes = u?.quotaBytes ?? defaultQuota
  }
  const canKeepFilesForever = roleGetsForever(role) || !!u?.keepFilesForever
  return c.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    suspended: !!suspension,
    suspensionReason: suspension?.reason ?? null,
    quotaBytes,
    isAdmin: role != null,
    adminRole: role,
    keepFilesForever: !!u?.keepFilesForever,
    canKeepFilesForever,
  })
})

// A signed-in user's own activity trail. Scoped strictly to their userId and
// deliberately omits IP / user-agent (those stay admin-only via /api/admin).
account.get("/activity", async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "unauthorized" }, 401)
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200)
  const db = getDb(c.env.DB)
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.userId, session.user.id))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(limit)
    .all()
    .catch(() => [])
  return c.json({ entries: rows.map((r) => ({ id: r.id, action: r.action, targetType: r.targetType, targetId: r.targetId, detail: r.detail, createdAt: r.createdAt })) })
})

export default account
