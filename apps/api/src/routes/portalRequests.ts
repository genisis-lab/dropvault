import { Hono } from "hono"
import { getDb } from "../db"
import { nowSeconds } from "../lib/expiry"
import { notifyUser } from "../lib/notifications"
import { requireAuth } from "../middleware/auth"
import { requireAdmin, hasRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

type PortalRequestRow = {
  id: string
  user_id: string
  requested_brand: string | null
  reason: string | null
  status: string
  reviewed_by: string | null
  reviewed_at: number | null
  created_at: number
}
type PortalRequestOut = {
  id: string
  userId: string
  requestedBrand: string | null
  reason: string | null
  status: string
  reviewedBy: string | null
  reviewedAt: number | null
  createdAt: number
}
function mapRow(r: PortalRequestRow): PortalRequestOut {
  return { id: r.id, userId: r.user_id, requestedBrand: r.requested_brand, reason: r.reason, status: r.status, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, createdAt: r.created_at }
}

const portalRequests = new Hono<{ Bindings: Bindings; Variables: Variables }>()
portalRequests.use("*", requireAuth)

portalRequests.get("/mine", async (c) => {
  const userId = c.get("userId")
  const requests = await c.env.DB.prepare("SELECT * FROM branded_portal_requests WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<PortalRequestRow>().then((r) => r.results ?? []).catch(() => [])
  const user = await c.env.DB.prepare("SELECT branded_portal_approved FROM user WHERE id = ?").bind(userId).first<{ branded_portal_approved: number | null }>().catch(() => null)
  return c.json({ approved: !!user?.branded_portal_approved, requests: requests.map(mapRow) })
})

portalRequests.post("/", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ requestedBrand?: string; reason?: string }>().catch(() => ({} as { requestedBrand?: string; reason?: string }))
  const open = await c.env.DB.prepare("SELECT id FROM branded_portal_requests WHERE user_id = ? AND status = 'pending' LIMIT 1").bind(userId).first<{ id: string }>().catch(() => null)
  if (open) return c.json({ error: "You already have a pending branded portal request." }, 409)
  const id = crypto.randomUUID()
  await c.env.DB.prepare("INSERT INTO branded_portal_requests (id, user_id, requested_brand, reason, status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)")
    .bind(id, userId, body.requestedBrand?.trim().slice(0, 120) || null, body.reason?.trim().slice(0, 1000) || null, nowSeconds())
    .run()
  return c.json({ ok: true, id })
})

portalRequests.use("/admin/*", requireAdmin)
portalRequests.get("/admin", async (c) => {
  const status = c.req.query("status")
  const rows = await c.env.DB.prepare(status && status !== "all" ? "SELECT * FROM branded_portal_requests WHERE status = ? ORDER BY created_at DESC" : "SELECT * FROM branded_portal_requests ORDER BY created_at DESC")
    .bind(...(status && status !== "all" ? [status] : []))
    .all<PortalRequestRow>()
    .then((r) => r.results ?? [])
    .catch(() => [])
  const users = await c.env.DB.prepare("SELECT id, email, name, branded_portal_approved FROM user").all<{ id: string; email: string; name: string; branded_portal_approved: number | null }>().then((r) => r.results ?? []).catch(() => [])
  const userById = new Map(users.map((u) => [u.id, u] as const))
  return c.json({ requests: rows.map((r) => ({ ...mapRow(r), userEmail: userById.get(r.user_id)?.email ?? null, userName: userById.get(r.user_id)?.name ?? null, approved: !!userById.get(r.user_id)?.branded_portal_approved })) })
})

portalRequests.post("/admin/:id/approve", async (c) => {
  const db = getDb(c.env.DB)
  if (!(await hasRole(c.env, db, c.get("userEmail"), "admin"))) return c.json({ error: "forbidden" }, 403)
  const id = c.req.param("id")
  const req = await c.env.DB.prepare("SELECT * FROM branded_portal_requests WHERE id = ?").bind(id).first<PortalRequestRow>().catch(() => null)
  if (!req) return c.json({ error: "not found" }, 404)
  const now = nowSeconds()
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE branded_portal_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(c.get("userEmail"), now, id),
    c.env.DB.prepare("UPDATE user SET branded_portal_approved = 1 WHERE id = ?").bind(req.user_id),
  ])
  await notifyUser(db, { userId: req.user_id, type: "branded_portal", title: "Branded portal request approved", message: "Your account is approved for the future branded portal feature.", targetType: "branded_portal_request", targetId: id }).catch(() => {})
  return c.json({ ok: true })
})

portalRequests.post("/admin/:id/reject", async (c) => {
  const db = getDb(c.env.DB)
  if (!(await hasRole(c.env, db, c.get("userEmail"), "admin"))) return c.json({ error: "forbidden" }, 403)
  const id = c.req.param("id")
  const req = await c.env.DB.prepare("SELECT * FROM branded_portal_requests WHERE id = ?").bind(id).first<PortalRequestRow>().catch(() => null)
  if (!req) return c.json({ error: "not found" }, 404)
  await c.env.DB.prepare("UPDATE branded_portal_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(c.get("userEmail"), nowSeconds(), id).run()
  await notifyUser(db, { userId: req.user_id, type: "branded_portal", title: "Branded portal request reviewed", message: "Your branded portal request was not approved right now.", targetType: "branded_portal_request", targetId: id }).catch(() => {})
  return c.json({ ok: true })
})

export default portalRequests
