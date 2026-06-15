import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { hashSecret, verifySecret } from "../lib/hash"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

type CreateUploadRequestBody = { title?: string; instructions?: string; password?: string | null; folderId?: string | null; maxFileSize?: number | null; allowedTypes?: string; uploadLimit?: number | null; requireEmail?: boolean; expiresInDays?: number | null }
type UploadFileLike = { name: string; size: number; type: string; stream: () => ReadableStream }

const uploadRequests = new Hono<{ Bindings: Bindings; Variables: Variables }>()
function safeRequest(r: any, appUrl: string) { const { password, ...rest } = r; return { ...rest, hasPassword: !!password, url: `${appUrl}/request/${r.token}` } }
function allowed(type: string, allowedTypes: string | null): boolean {
  const values = (allowedTypes || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (!values.length) return true
  const t = type.toLowerCase()
  return values.some((a) => a.endsWith("/*") ? t.startsWith(a.slice(0, -1)) : t === a || t.includes(a))
}
function isUploadFileLike(value: unknown): value is UploadFileLike {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.name === "string" && typeof v.size === "number" && typeof v.stream === "function"
}

uploadRequests.get("/", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.ownerId, c.get("userId"))).orderBy(desc(schema.uploadRequests.createdAt)).all()
  return c.json({ requests: rows.map((r) => safeRequest(r, c.env.PUBLIC_APP_URL)) })
})
uploadRequests.post("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<CreateUploadRequestBody>().catch(() => ({} as CreateUploadRequestBody))
  const db = getDb(c.env.DB)
  let folderId: string | null = null
  if (body.folderId) {
    const folder = await db.select().from(schema.folders).where(and(eq(schema.folders.id, body.folderId), eq(schema.folders.ownerId, userId))).get()
    if (!folder) return c.json({ error: "folder not found" }, 404)
    folderId = body.folderId
  }
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, "")
  const createdAt = nowSeconds()
  const expiresInDays = Number(body.expiresInDays ?? 0)
  const expiresAt = expiresInDays > 0 ? createdAt + Math.round(expiresInDays * DAY_SECONDS) : null
  await db.insert(schema.uploadRequests).values({ id, ownerId: userId, folderId, token, title: (body.title || "Upload files").trim().slice(0, 120), instructions: body.instructions?.slice(0, 1000) ?? null, password: body.password ? await hashSecret(String(body.password)) : null, maxFileSize: body.maxFileSize && body.maxFileSize > 0 ? Math.floor(body.maxFileSize) : null, allowedTypes: body.allowedTypes?.slice(0, 500) ?? null, uploadLimit: body.uploadLimit && body.uploadLimit > 0 ? Math.floor(body.uploadLimit) : null, requireEmail: !!body.requireEmail, expiresAt, createdAt }).run()
  const row = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.id, id)).get()
  return c.json({ request: safeRequest(row, c.env.PUBLIC_APP_URL) })
})
uploadRequests.delete("/:id", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param("id")
  const row = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.uploadRequests).set({ revokedAt: nowSeconds() }).where(eq(schema.uploadRequests.id, id)).run()
  return c.json({ ok: true })
})
uploadRequests.get("/public/:token", async (c) => {
  const db = getDb(c.env.DB)
  const token = c.req.param("token")
  const row = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.token, token)).get()
  if (!row || row.revokedAt) return c.json({ error: "not found" }, 404)
  if (row.expiresAt && row.expiresAt <= nowSeconds()) return c.json({ error: "expired" }, 410)
  if (row.uploadLimit && row.uploadCount >= row.uploadLimit) return c.json({ error: "upload limit reached" }, 410)
  return c.json({ request: safeRequest(row, c.env.PUBLIC_APP_URL) })
})
uploadRequests.post("/public/:token", async (c) => {
  const db = getDb(c.env.DB)
  const token = c.req.param("token")
  const row = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.token, token)).get()
  if (!row || row.revokedAt) return c.json({ error: "not found" }, 404)
  const now = nowSeconds()
  if (row.expiresAt && row.expiresAt <= now) return c.json({ error: "expired" }, 410)
  if (row.uploadLimit && row.uploadCount >= row.uploadLimit) return c.json({ error: "upload limit reached" }, 410)
  const form = await c.req.formData()
  const password = String(form.get("password") || "")
  if (row.password) { if (!(await verifySecret(password, row.password))) return c.json({ error: "password required" }, 401) }
  const uploaderEmail = String(form.get("email") || "").trim().slice(0, 255) || null
  const uploaderName = String(form.get("name") || "").trim().slice(0, 120) || null
  if (row.requireEmail && !uploaderEmail) return c.json({ error: "email required" }, 400)
  const formFile = form.get("file") as unknown
  if (!isUploadFileLike(formFile)) return c.json({ error: "file required" }, 400)
  const file = formFile
  if (row.maxFileSize && file.size > row.maxFileSize) return c.json({ error: "file exceeds request limit" }, 413)
  const contentType = file.type || "application/octet-stream"
  if (!allowed(contentType, row.allowedTypes)) return c.json({ error: "file type is not allowed" }, 415)
  const id = crypto.randomUUID()
  const r2Key = `${row.ownerId}/${id}`
  await c.env.FILES.put(r2Key, file.stream(), contentType ? { httpMetadata: { contentType } } : undefined)
  await db.insert(schema.files).values({ id, ownerId: row.ownerId, filename: file.name.slice(0, 255), r2Key, sizeBytes: file.size, contentType, status: "ready", folderId: row.folderId ?? null, versionGroupId: id, createdAt: now, expiresAt: now + 7 * DAY_SECONDS }).run()
  await db.insert(schema.publicUploads).values({ id: crypto.randomUUID(), requestId: row.id, fileId: id, uploaderEmail, uploaderName, createdAt: now }).run()
  await db.update(schema.uploadRequests).set({ uploadCount: row.uploadCount + 1 }).where(eq(schema.uploadRequests.id, row.id)).run()
  return c.json({ ok: true, fileId: id })
})
export default uploadRequests
