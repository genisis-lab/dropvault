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

// Look up a pending, non-expired file owned by the caller. Shared by the upload
// routes so they all enforce the same ownership + lifecycle checks.
async function loadPendingOwned(c: any, id: string) {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  return { db, row }
}

// 2) Upload the bytes to R2 through the Worker binding (single request).
files.put("/:id/upload", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
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

// 2a) Multipart: begin a multipart upload. Returns the uploadId the client must
//     echo back on every part and on complete/abort. Used for large files that
//     would otherwise exceed the single-request body limit (~100MB).
files.post("/:id/multipart/start", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  if (isExpired(row.expiresAt)) {
    await db.delete(schema.files).where(eq(schema.files.id, id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const options = row.contentType ? { httpMetadata: { contentType: row.contentType } } : undefined
  const mpu = await c.env.FILES.createMultipartUpload(row.r2Key, options)
  return c.json({ uploadId: mpu.uploadId, key: row.r2Key })
})

// 2b) Multipart: upload one part. partNumber is 1-based. Each part except the
//     last must be the same (>=5MiB) size; the client guarantees this. Returns
//     the part's etag, which the client collects for the complete call.
files.put("/:id/multipart/part", async (c) => {
  const id = c.req.param("id")
  const uploadId = c.req.query("uploadId")
  const partNumber = Number(c.req.query("partNumber"))
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return c.json({ error: "uploadId and a positive partNumber are required" }, 400)
  }
  const { row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)

  const body = c.req.raw.body
  if (!body) return c.json({ error: "empty part" }, 400)

  const mpu = c.env.FILES.resumeMultipartUpload(row.r2Key, uploadId)
  const uploaded = await mpu.uploadPart(partNumber, body)
  return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
})

// 2c) Multipart: finish the upload by assembling the parts, then mark ready.
files.post("/:id/multipart/complete", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)

  const body = await c.req.json<{ uploadId?: string; parts?: { partNumber: number; etag: string }[] }>()
  if (!body?.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
    return c.json({ error: "uploadId and parts are required" }, 400)
  }

  const parts = body.parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    .sort((a, b) => a.partNumber - b.partNumber)

  const mpu = c.env.FILES.resumeMultipartUpload(row.r2Key, body.uploadId)
  let object
  try {
    object = await mpu.complete(parts)
  } catch (e) {
    return c.json({ error: `multipart complete failed: ${(e as Error)?.message ?? "unknown"}` }, 400)
  }

  if (row.sizeBytes > 0 && object.size !== row.sizeBytes) {
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    return c.json({ error: "upload size mismatch" }, 409)
  }

  await db.update(schema.files).set({ status: "ready" }).where(eq(schema.files.id, id)).run()
  return c.json({ ok: true })
})

// 2d) Multipart: abort an in-flight upload (cleanup on client failure).
files.post("/:id/multipart/abort", async (c) => {
  const id = c.req.param("id")
  const uploadId = c.req.query("uploadId")
  if (!uploadId) return c.json({ error: "uploadId required" }, 400)
  const { row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  try {
    const mpu = c.env.FILES.resumeMultipartUpload(row.r2Key, uploadId)
    await mpu.abort()
  } catch {}
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

// 8) Update a file: rename, extend expiry, and/or move it between folders.
//    - "filename" (string) renames the file (trimmed, non-empty).
//    - "extendDays" is ADDED to the current expiry (or to now, if already past due),
//      so extending always gains time. Total lifetime is capped at MAX_EXPIRY_DAYS.
//    - "folderId" (string) moves the file into that folder; null moves it to the root.
files.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ extendDays?: number; expiryDays?: number; folderId?: string | null; filename?: string }>()
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  const update: { expiresAt?: number; folderId?: string | null; filename?: string } = {}

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

  if (typeof body.filename === "string") {
    const name = body.filename.trim()
    if (!name) return c.json({ error: "filename cannot be empty" }, 400)
    update.filename = name.slice(0, 255)
  }

  if (Object.keys(update).length === 0) return c.json({ error: "nothing to update" }, 400)
  await db.update(schema.files).set(update).where(eq(schema.files.id, id)).run()
  const next = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  return c.json({ ok: true, expiresAt: next?.expiresAt, folderId: next?.folderId ?? null, filename: next?.filename })
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
