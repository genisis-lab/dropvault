import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { computeExpiresAt, clampExtension, isExpired, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>()

files.use("*", requireAuth)

// 1) Ask for an upload URL. Creates a pending row.
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

  const uploadUrl = new URL(`/api/files/${id}/upload`, c.req.url).toString()
  return c.json({ id, uploadUrl, expiresAt })
})

// 2) Upload the bytes to R2 through the Worker binding.
files.put("/:id/upload", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  if (isExpired(row.expiresAt)) {
    await db.delete(schema.files).where(eq(schema.files.id, id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const body = c.req.raw.body
  if (!body) return c.json({ error: "empty upload" }, 400)

  const options = row.contentType ? { httpMetadata: { contentType: row.contentType } } : undefined
  await c.env.FILES.put(row.r2Key, body, options)
  return c.json({ ok: true })
})

// 3) Confirm upload finished -> mark ready.
files.post("/:id/complete", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const object = await c.env.FILES.head(row.r2Key)
  if (!object) return c.json({ error: "upload missing" }, 409)
  if (row.sizeBytes > 0 && object.size !== row.sizeBytes) {
    return c.json({ error: "upload size mismatch" }, 409)
  }
  await db.update(schema.files).set({ status: "ready" }).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true })
})

// 4) List the current user's live (non-expired) files.
files.get("/", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files)
    .where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds())))
    .orderBy(desc(schema.files.createdAt))
    .all()
  return c.json({ files: rows })
})

// 5) Download: enforce on-access expiry, then stream from R2.
files.get("/:id/download", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    // Never serve an expired file. Clean it up opportunistically.
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("Content-Length", String(object.size))
  headers.set("Content-Disposition", `attachment; filename="${row.filename.replace(/["\\]/g, "_")}"`)
  return new Response(object.body, { headers })
})

// 6) Extend expiry (clamped so total lifetime <= MAX_EXPIRY_DAYS).
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

// 7) Delete now.
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
