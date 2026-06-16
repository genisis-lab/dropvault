import { Hono } from "hono"
import { desc, eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "../lib/expiry"
import { notifyAdmins, notifyUser } from "../lib/notifications"
import { requireAuth } from "../middleware/auth"
import { adminRole, requireAdminRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

const keepForever = new Hono<{ Bindings: Bindings; Variables: Variables }>()
keepForever.use("*", requireAuth)

function roleGetsForever(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "moderator"
}

async function statusFor(env: Bindings, db: ReturnType<typeof getDb>, userId: string, email: string | null | undefined) {
  const role = await adminRole(env, db, email)
  const user = await db.select().from(schema.user).where(eq(schema.user.id, userId)).get().catch(() => null)
  const canKeepFilesForever = roleGetsForever(role) || !!user?.keepFilesForever
  const requests = await db.select().from(schema.keepForeverRequests).where(eq(schema.keepForeverRequests.userId, userId)).orderBy(desc(schema.keepForeverRequests.createdAt)).limit(10).all().catch(() => [])
  const pending = requests.find((r) => r.status === "pending") ?? null
  return { canKeepFilesForever, keepFilesForever: !!user?.keepFilesForever, role, pendingRequest: pending, requests }
}

keepForever.get("/status", async (c) => {
  const db = getDb(c.env.DB)
  return c.json(await statusFor(c.env, db, c.get("userId"), c.get("userEmail")))
})

keepForever.post("/request", async (c) => {
  const userId = c.get("userId")
  const email = c.get("userEmail")
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }))
  const db = getDb(c.env.DB)
  const status = await statusFor(c.env, db, userId, email)
  if (status.canKeepFilesForever) return c.json({ error: "Your account can already keep files forever." }, 400)
  if (status.pendingRequest) return c.json({ error: "You already have a pending keep-forever request." }, 429)
  const id = crypto.randomUUID()
  const reason = body.reason?.trim().slice(0, 1000) || null
  await db.insert(schema.keepForeverRequests).values({ id, userId, reason, status: "pending", reviewedBy: null, reviewedAt: null, createdAt: nowSeconds() }).run()
  await notifyAdmins(c.env, db, { type: "keep_forever_request", title: "New keep-forever request", message: `${email ?? userId} requested permission to keep files forever.${reason ? " Reason: " + reason : ""}`, targetType: "keep_forever_request", targetId: id })
  return c.json({ ok: true, id })
})

keepForever.get("/requests", requireAdminRole("admin"), async (c) => {
  const status = c.req.query("status")
  const db = getDb(c.env.DB)
  const [rows, users] = await Promise.all([
    db.select().from(schema.keepForeverRequests).orderBy(desc(schema.keepForeverRequests.createdAt)).all().catch(() => []),
    db.select().from(schema.user).all().catch(() => []),
  ])
  const userById = new Map(users.map((u) => [u.id, u] as const))
  const filtered = status ? rows.filter((r) => r.status === status) : rows
  return c.json({ requests: filtered.map((r) => { const u = userById.get(r.userId); return { ...r, userEmail: u?.email ?? null, userName: u?.name ?? null, userCanKeepForever: !!u?.keepFilesForever } }) })
})

keepForever.post("/requests/:id/approve", requireAdminRole("admin"), async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const req = await db.select().from(schema.keepForeverRequests).where(eq(schema.keepForeverRequests.id, id)).get()
  if (!req || req.status !== "pending") return c.json({ error: "not found or already handled" }, 404)
  await db.update(schema.keepForeverRequests).set({ status: "approved", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds() }).where(eq(schema.keepForeverRequests.id, id)).run()
  await db.update(schema.user).set({ keepFilesForever: true }).where(eq(schema.user.id, req.userId)).run()
  await notifyUser(db, { userId: req.userId, type: "keep_forever_request", title: "Keep-forever permission approved", message: "Your account can now keep uploaded files forever.", targetType: "keep_forever_request", targetId: req.id })
  return c.json({ ok: true })
})

keepForever.post("/requests/:id/reject", requireAdminRole("admin"), async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const req = await db.select().from(schema.keepForeverRequests).where(eq(schema.keepForeverRequests.id, id)).get()
  if (!req || req.status !== "pending") return c.json({ error: "not found or already handled" }, 404)
  await db.update(schema.keepForeverRequests).set({ status: "rejected", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds() }).where(eq(schema.keepForeverRequests.id, id)).run()
  await notifyUser(db, { userId: req.userId, type: "keep_forever_request", title: "Keep-forever request rejected", message: "Your request to keep files forever was reviewed and rejected.", targetType: "keep_forever_request", targetId: req.id })
  return c.json({ ok: true })
})

keepForever.post("/users/:id", requireAdminRole("moderator"), async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ allowed?: boolean }>().catch(() => ({} as { allowed?: boolean }))
  const db = getDb(c.env.DB)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get()
  if (!u) return c.json({ error: "not found" }, 404)
  const allowed = !!body.allowed
  await db.update(schema.user).set({ keepFilesForever: allowed }).where(eq(schema.user.id, id)).run()
  await notifyUser(db, { userId: id, type: "keep_forever_permission", title: allowed ? "Keep-forever permission enabled" : "Keep-forever permission removed", message: allowed ? "An admin enabled permission for your account to keep files forever." : "An admin removed keep-forever permission from your account.", targetType: "user", targetId: id })
  return c.json({ ok: true, keepFilesForever: allowed })
})

export default keepForever
