import { Hono } from "hono"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const notifications = new Hono<{ Bindings: Bindings; Variables: Variables }>()
notifications.use("*", requireAuth)

notifications.get("/", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 100)
  const unreadOnly = c.req.query("unread") === "true"
  const db = getDb(c.env.DB)
  const where = unreadOnly ? and(eq(schema.notifications.userId, c.get("userId")), isNull(schema.notifications.readAt)) : eq(schema.notifications.userId, c.get("userId"))
  const rows = await db.select().from(schema.notifications).where(where).orderBy(desc(schema.notifications.createdAt)).limit(limit).all().catch(() => [])
  const unread = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, c.get("userId")), isNull(schema.notifications.readAt))).all().catch(() => [])
  return c.json({ notifications: rows, unreadCount: unread.length })
})

notifications.post("/:id/read", async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param("id")
  await db.update(schema.notifications).set({ readAt: nowSeconds() }).where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, c.get("userId")))).run()
  return c.json({ ok: true })
})

notifications.post("/read", async (c) => {
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({} as { ids?: string[] }))
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : []
  const db = getDb(c.env.DB)
  if (ids.length) {
    await db.update(schema.notifications).set({ readAt: nowSeconds() }).where(and(eq(schema.notifications.userId, c.get("userId")), inArray(schema.notifications.id, ids))).run()
  } else {
    await db.update(schema.notifications).set({ readAt: nowSeconds() }).where(eq(schema.notifications.userId, c.get("userId"))).run()
  }
  return c.json({ ok: true })
})

notifications.delete("/:id", async (c) => {
  const db = getDb(c.env.DB)
  await db.delete(schema.notifications).where(and(eq(schema.notifications.id, c.req.param("id")), eq(schema.notifications.userId, c.get("userId")))).run()
  return c.json({ ok: true })
})

export default notifications
