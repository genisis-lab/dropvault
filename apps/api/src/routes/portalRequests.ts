import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "../lib/expiry"
import { notifyUser } from "../lib/notifications"
import { requireAuth } from "../middleware/auth"
import { requireAdmin, hasRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

const portalRequests = new Hono<{ Bindings: Bindings; Variables: Variables }>()
portalRequests.use("*", requireAuth)

portalRequests.get("/mine", async (c) => {
  const db = getDb(c.env.DB)
  const requests = await db.select().from(schema.brandedPortalRequests).where(eq(schema.brandedPortalRequests.userId, c.get("userId"))).orderBy(desc(schema.brandedPortalRequests.createdAt)).all().catch(() => [])
  const user = await db.select().from(schema.user).where(eq(schema.user.id, c.get("userId"))).get().catch(() => null)
  return c.json({ approved: !!user?.brandedPortalApproved, requests })
})

portalRequests.post("/", async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get("userId")
  const body = await c.req.json<{ requestedBrand?: string; reason?: string }>().catch(() => ({} as { requestedBrand?: string; reason?: string }))
  const open = await db.select().from(schema.brandedPortalRequests).where(and(eq(schema.brandedPortalRequests.userId, userId), eq(schema.brandedPortalRequests.status, "pending"))).get().catch(() => null)
  if (open) return c.json({ error: "You already have a pending branded portal request." }, 409)
  const id = crypto.randomUUID()
  await db.insert(schema.brandedPortalRequests).values({ id, userId, requestedBrand: body.requestedBrand?.trim().slice(0, 120) || null, reason: body.reason?.trim().slice(0, 1000) || null, status: "pending", reviewedBy: null, reviewedAt: null, createdAt: nowSeconds() }).run()
  return c.json({ ok: true, id })
})

portalRequests.use("/admin/*", requireAdmin)
portalRequests.get("/admin", async (c) => {
  const db = getDb(c.env.DB)
  const status = c.req.query("status")
  const all = await db.select().from(schema.brandedPortalRequests).orderBy(desc(schema.brandedPortalRequests.createdAt)).all().catch(() => [])
  const users = await db.select().from(schema.user).all().catch(() => [])
  const userById = new Map(users.map((u) => [u.id, u] as const))
  const rows = status && status !== "all" ? all.filter((r) => r.status === status) : all
  return c.json({ requests: rows.map((r) => ({ ...r, userEmail: userById.get(r.userId)?.email ?? null, userName: userById.get(r.userId)?.name ?? null, approved: !!userById.get(r.userId)?.brandedPortalApproved })) })
})

portalRequests.post("/admin/:id/approve", async (c) => {
  const db = getDb(c.env.DB)
  if (!(await hasRole(c.env, db, c.get("userEmail"), "admin"))) return c.json({ error: "forbidden" }, 403)
  const id = c.req.param("id")
  const req = await db.select().from(schema.brandedPortalRequests).where(eq(schema.brandedPortalRequests.id, id)).get().catch(() => null)
  if (!req) return c.json({ error: "not found" }, 404)
  await db.update(schema.brandedPortalRequests).set({ status: "approved", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds() }).where(eq(schema.brandedPortalRequests.id, id)).run()
  await db.update(schema.user).set({ brandedPortalApproved: true }).where(eq(schema.user.id, req.userId)).run()
  await notifyUser(db, { userId: req.userId, type: "branded_portal", title: "Branded portal request approved", message: "Your account is approved for the future branded portal feature.", targetType: "branded_portal_request", targetId: id }).catch(() => {})
  return c.json({ ok: true })
})

portalRequests.post("/admin/:id/reject", async (c) => {
  const db = getDb(c.env.DB)
  if (!(await hasRole(c.env, db, c.get("userEmail"), "admin"))) return c.json({ error: "forbidden" }, 403)
  const id = c.req.param("id")
  const req = await db.select().from(schema.brandedPortalRequests).where(eq(schema.brandedPortalRequests.id, id)).get().catch(() => null)
  if (!req) return c.json({ error: "not found" }, 404)
  await db.update(schema.brandedPortalRequests).set({ status: "rejected", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds() }).where(eq(schema.brandedPortalRequests.id, id)).run()
  await notifyUser(db, { userId: req.userId, type: "branded_portal", title: "Branded portal request reviewed", message: "Your branded portal request was not approved right now.", targetType: "branded_portal_request", targetId: id }).catch(() => {})
  return c.json({ ok: true })
})

export default portalRequests
