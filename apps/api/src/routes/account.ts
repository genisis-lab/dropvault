import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { createAuth } from "../auth"
import { getDb, schema } from "../db"
import { clientIp } from "../lib/rateLimit"
import { adminRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

// Lightweight account endpoint that intentionally does NOT use requireAuth, so a
// suspended user can still learn that they are suspended (requireAuth blocks
// everything else with a 403).
const account = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function recordSessionIp(c: any, db: ReturnType<typeof getDb>, session: any) {
  const sessionId = String(session?.session?.id ?? "")
  if (!sessionId) return
  const ip = clientIp(c)
  if (ip === "unknown") return
  await db
    .update(schema.session)
    .set({ ipAddress: ip, userAgent: c.req.header("User-Agent") ?? null })
    .where(eq(schema.session.id, sessionId))
    .run()
    .catch(() => {})
}

account.get("/me", async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "unauthorized" }, 401)
  const db = getDb(c.env.DB)
  await recordSessionIp(c, db, session)
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, session.user.id))
    .get()
    .catch(() => null)
  // Admins and the owner have unlimited storage (no quota). Everyone else gets
  // their per-user quota, falling back to the workspace default.
  const role = await adminRole(c.env, db, session.user.email)
  let quotaBytes: number | null = null
  if (role == null) {
    const u = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id)).get().catch(() => null)
    const setting = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "defaultQuotaBytes")).get().catch(() => null)
    const defaultQuota = Number(setting?.value) || 1073741824
    quotaBytes = u?.quotaBytes ?? defaultQuota
  }
  return c.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    suspended: !!suspension,
    suspensionReason: suspension?.reason ?? null,
    quotaBytes,
    isAdmin: role != null,
  })
})

export default account
