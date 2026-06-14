import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { computeExpiresAt, clampExtension, isExpired, nowSeconds, DAY_SECONDS } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>()

files.use("*", requireAuth)

// 1) Ask for an upload URL. Creates a pending row (optionally inside a folder).
files.post("/presign", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number; folderId?: string | null }>()
  if (!body?.filename) return c.json({ error: "filename required" }, 400)

  const db = getDb(c.env.DB)

  // If a folder was requested, make sure it belongs to this user.
  let folderId: string | null = null
  if (body.folderId) {
    const folder = await db.select().from(schema.folders).where(and(eq(schema.folders.id, body.folderId), eq(schema.folders.ownerId, userId))).get()
    if (!folder) return c.json({ error: "folder not found" }, 404)
    folderId = body.folderId
  }

  const id = crypto.randomUUID()
  const r2Key = `${userId}/${id}`
  const createdAt = nowSeconds()
  const expiresAt = computeExpiresAt(c.env, createdAt, body.expiryDays)

  await db.insert(schema.files).values({
    id,
    ownerId: userId,
    filename: body.filename,
    r2Key,
    sizeBytes: body.sizeBytes ?? 0,
    contentType: body.contentType ?? null,
    status: "pending",
    folderId,
    createdAt,
    expiresAt,
  }).run()

  // Return a SAME-ORIGIN relative path. The browser uploads to its own origin
  // (the Pages proxy forwards it to this Worker), so the session cookie is sent.
  const uploadUrl = `/api/files/${id}/upload`
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

// 4) List the current user's live (non-expired) files. Includes folderId so the
//    client can group them; pass ?folderId=<id> to scope to one folder, or
//    ?folderId=root for only top-level files.
files.get("/", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files)
    .where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds())))
    .orderBy(desc(schema.files.createdAt))
    .all()
  return c.json({ files: rows })
})

// 5) Download (owner): enforce on-access expiry, then stream from R2.
files.get("/:id/download", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
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

// 6) Create (or return existing) a public share link for a file.
files.post("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "")
  if (!row.shareToken) {
    await db.update(schema.files).set({ shareToken: token }).where(eq(schema.files.id, id)).run()
  }
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/${token}` })
})

// 7) Revoke a file's public share link.
files.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ shareToken: null }).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true })
})

// 8) Update a file: extend expiry and/or move it between folders.
//    - "extendDays" is ADDED to the current expiry (or to now, if already past due),
//      so extending always gains time. Total lifetime is capped at MAX_EXPIRY_DAYS.
//    - "folderId" (string) moves the file into that folder; null moves it to the root.
files.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ extendDays?: number; expiryDays?: number; folderId?: string | null }>()
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  const update: { expiresAt?: number; folderId?: string | null } = {}

  const addDays = Math.max(body.extendDays ?? body.expiryDays ?? 0, 0)
  if (addDays > 0) {
    const base = Math.max(row.expiresAt, nowSeconds())
    update.expiresAt = clampExtension(c.env, row.createdAt, base + Math.round(addDays * DAY_SECONDS))
  }

  if ("folderId" in body) {
    const fid = body.folderId
    if (fid) {
      const folder = await db.select().from(schema.folders).where(and(eq(schema.folders.id, fid), eq(schema.folders.ownerId, userId))).get()
      if (!folder) return c.json({ error: "folder not found" }, 404)
      update.folderId = fid
    } else {
      update.folderId = null
    }
  }

  if (Object.keys(update).length === 0) return c.json({ error: "nothing to update" }, 400)
  await db.update(schema.files).set(update).where(eq(schema.files.id, id)).run()
  const next = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  return c.json({ ok: true, expiresAt: next?.expiresAt, folderId: next?.folderId ?? null })
})

// 9) Delete now.
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
