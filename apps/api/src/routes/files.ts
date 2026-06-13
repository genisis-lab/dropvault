import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { presignPut, presignGet } from "../lib/r2"
import { computeExpiresAt, clampExtension, isExpired, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>()

files.use("*", requireAuth)

// 1) Ask for a presigned PUT URL. Creates a pending row.
files.post("/presign", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number }>()
  if (!body?.filename) return c.json({ error: "filename required" }, 400)

  const id = crypto.randomUUID()
  const r2Key = `${userId}/${id}`
  const createdAt = nowSeconds()
  const expiresAt = computeExpiresAt(c.env, createdAt, body.expiryDays)

  const db = getDb(c.env.DB)
  await db.insert(schema.files).values({
    id,
    ownerId: userId,
    filename: body.filename,
    r2Key,
    sizeBytes: body.sizeBytes ?? 0,
    contentType: body.contentType ?? null,
    status: "pending",
    createdAt,
    expiresAt,
  }).run()

  const uploadUrl = await presignPut(c.env, r2Key, body.contentType)
  return c.json({ id, uploadUrl, expiresAt })
})

// 2) Confirm upload finished -> mark ready.
files.post("/:id/complete", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ status: "ready" }).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true })
})

// 3) List the current user's live (non-expired) files.
files.get("/", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files)
    .where(and(eq(schema.files.ownerId, userId), gt(schema.files.expiresAt, nowSeconds())))
    .orderBy(desc(schema.files.createdAt))
    .all()
  return c.json({ files: rows })
})

// 4) Download: enforce on-access expiry, then redirect to a presigned GET URL.
files.get("/:id/download", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    // Never serve an expired file. Clean it up opportunistically.
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const url = await presignGet(c.env, row.r2Key, row.filename)
  return c.redirect(url, 302)
})

// 5) Extend expiry (clamped so total lifetime <= MAX_EXPIRY_DAYS).
files.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ expiryDays: number }>()
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  const requested = computeExpiresAt(c.env, row.createdAt, body.expiryDays)
  const expiresAt = clampExtension(c.env, row.createdAt, requested)
  await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true, expiresAt })
})

// 6) Delete now.
files.delete("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  try { await c.env.FILES.delete(row.r2Key) } catch {}
  await db.delete(schema.files).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true })
})

export default files
