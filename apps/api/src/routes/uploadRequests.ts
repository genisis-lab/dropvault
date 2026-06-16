import { Hono } from "hono"
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { hashSecret, verifySecret } from "../lib/hash"
import { notifyUser } from "../lib/notifications"
import { checkRateLimit, clientIp } from "../lib/rateLimit"
import { requireAuth } from "../middleware/auth"
import { adminRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

type CreateUploadRequestBody = {
  title?: string
  instructions?: string
  password?: string | null
  folderId?: string | null
  maxFileSize?: number | null
  totalMaxBytes?: number | null
  allowedTypes?: string
  uploadLimit?: number | null
  requireEmail?: boolean
  expiresInDays?: number | null
  status?: string
  moderationMode?: string
  thankYouMessage?: string | null
  closeAfterFirstUpload?: boolean
}
type UploadFileLike = { name: string; size: number; type: string; stream: () => ReadableStream }

const uploadRequests = new Hono<{ Bindings: Bindings; Variables: Variables }>()
function safeRequest(r: any, appUrl: string) { const { password, ...rest } = r; return { ...rest, status: r.status ?? "open", moderationMode: r.moderationMode ?? "auto", closeAfterFirstUpload: !!r.closeAfterFirstUpload, hasPassword: !!password, url: `${appUrl}/request/${r.token}` } }
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
function uploadFilesFrom(form: FormData): UploadFileLike[] {
  const out: UploadFileLike[] = []
  const seen = new Set<unknown>()
  for (const value of [...form.getAll("files"), ...form.getAll("file")]) {
    if (seen.has(value)) continue
    seen.add(value)
    if (isUploadFileLike(value)) out.push(value)
  }
  return out
}
async function workspacePolicy(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const map = new Map(rows.map((r) => [r.key, r.value] as const))
  return {
    maxUploadBytes: Number(map.get("maxUploadBytes") || 0),
    allowedTypes: String(map.get("allowedTypes") || ""),
    defaultQuotaBytes: Number(map.get("defaultQuotaBytes") || 1073741824),
  }
}
async function totalUploadedBytes(db: ReturnType<typeof getDb>, requestId: string): Promise<number> {
  const rows = await db.select().from(schema.publicUploads).where(eq(schema.publicUploads.requestId, requestId)).all().catch(() => [])
  return rows.reduce((s, r) => s + (r.sizeBytes ?? 0), 0)
}
async function ownerQuotaAvailable(c: any, db: ReturnType<typeof getDb>, ownerId: string, incomingBytes: number, policy: { defaultQuotaBytes: number }) {
  const owner = await db.select().from(schema.user).where(eq(schema.user.id, ownerId)).get().catch(() => null)
  const role = await adminRole(c.env, db, owner?.email ?? "")
  const quota = role != null ? null : (owner?.quotaBytes ?? policy.defaultQuotaBytes)
  if (quota == null || quota <= 0) return true
  const owned = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, ownerId), isNull(schema.files.deletedAt))).all()
  const used = owned.reduce((s, f) => s + (f.status === "ready" ? f.sizeBytes || 0 : 0), 0)
  return used + incomingBytes <= quota
}
async function createPublicFile(c: any, db: ReturnType<typeof getDb>, row: any, file: UploadFileLike, now: number, status: string, uploaderEmail: string | null, uploaderName: string | null) {
  const id = crypto.randomUUID()
  const r2Key = `${row.ownerId}/${id}`
  const contentType = file.type || "application/octet-stream"
  await c.env.FILES.put(r2Key, file.stream(), contentType ? { httpMetadata: { contentType } } : undefined)
  await db.insert(schema.files).values({ id, ownerId: row.ownerId, filename: file.name.slice(0, 255), r2Key, sizeBytes: file.size, contentType, status, folderId: row.folderId ?? null, versionGroupId: id, createdAt: now, expiresAt: now + 7 * DAY_SECONDS }).run()
  await db.insert(schema.publicUploads).values({ id: crypto.randomUUID(), requestId: row.id, fileId: id, uploaderEmail, uploaderName, status: status === "ready" ? "approved" : "pending", filename: file.name.slice(0, 255), sizeBytes: file.size, contentType, reviewedBy: status === "ready" ? "auto" : null, reviewedAt: status === "ready" ? now : null, createdAt: now }).run()
  return id
}

uploadRequests.get("/", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.ownerId, c.get("userId"))).orderBy(desc(schema.uploadRequests.createdAt)).all()
  const uploads = await db.select().from(schema.publicUploads).all().catch(() => [])
  const countByRequest = new Map<string, number>()
  const pendingByRequest = new Map<string, number>()
  const bytesByRequest = new Map<string, number>()
  for (const u of uploads) {
    countByRequest.set(u.requestId, (countByRequest.get(u.requestId) ?? 0) + 1)
    if ((u.status ?? "approved") === "pending") pendingByRequest.set(u.requestId, (pendingByRequest.get(u.requestId) ?? 0) + 1)
    bytesByRequest.set(u.requestId, (bytesByRequest.get(u.requestId) ?? 0) + (u.sizeBytes ?? 0))
  }
  return c.json({ requests: rows.map((r) => ({ ...safeRequest(r, c.env.PUBLIC_APP_URL), submissionCount: countByRequest.get(r.id) ?? 0, pendingCount: pendingByRequest.get(r.id) ?? 0, totalUploadedBytes: bytesByRequest.get(r.id) ?? 0 })) })
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
  const status = ["open", "closed"].includes(String(body.status)) ? String(body.status) : "open"
  const moderationMode = String(body.moderationMode) === "manual" ? "manual" : "auto"
  await db.insert(schema.uploadRequests).values({ id, ownerId: userId, folderId, token, title: (body.title || "Upload files").trim().slice(0, 120), instructions: body.instructions?.slice(0, 1000) ?? null, password: body.password ? await hashSecret(String(body.password)) : null, maxFileSize: body.maxFileSize && body.maxFileSize > 0 ? Math.floor(body.maxFileSize) : null, totalMaxBytes: body.totalMaxBytes && body.totalMaxBytes > 0 ? Math.floor(body.totalMaxBytes) : null, allowedTypes: body.allowedTypes?.slice(0, 500) ?? null, uploadLimit: body.uploadLimit && body.uploadLimit > 0 ? Math.floor(body.uploadLimit) : null, requireEmail: !!body.requireEmail, status, moderationMode, thankYouMessage: body.thankYouMessage?.slice(0, 1000) ?? null, closeAfterFirstUpload: !!body.closeAfterFirstUpload, expiresAt, createdAt }).run()
  const row = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.id, id)).get()
  return c.json({ request: safeRequest(row, c.env.PUBLIC_APP_URL) })
})
uploadRequests.patch("/:id", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param("id")
  const row = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const body = await c.req.json<CreateUploadRequestBody>().catch(() => ({} as CreateUploadRequestBody))
  const update: Record<string, unknown> = {}
  if (typeof body.title === "string") update.title = body.title.trim().slice(0, 120) || row.title
  if ("instructions" in body) update.instructions = body.instructions?.slice(0, 1000) ?? null
  if ("status" in body && ["open", "closed"].includes(String(body.status))) update.status = String(body.status)
  if ("moderationMode" in body) update.moderationMode = String(body.moderationMode) === "manual" ? "manual" : "auto"
  if ("thankYouMessage" in body) update.thankYouMessage = body.thankYouMessage?.slice(0, 1000) ?? null
  if ("closeAfterFirstUpload" in body) update.closeAfterFirstUpload = !!body.closeAfterFirstUpload
  await db.update(schema.uploadRequests).set(update).where(eq(schema.uploadRequests.id, id)).run()
  const next = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.id, id)).get()
  return c.json({ request: safeRequest(next, c.env.PUBLIC_APP_URL) })
})
uploadRequests.post("/:id/close", requireAuth, async (c) => { const db = getDb(c.env.DB); const id = c.req.param("id"); await db.update(schema.uploadRequests).set({ status: "closed" }).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).run(); return c.json({ ok: true }) })
uploadRequests.post("/:id/reopen", requireAuth, async (c) => { const db = getDb(c.env.DB); const id = c.req.param("id"); await db.update(schema.uploadRequests).set({ status: "open", revokedAt: null }).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).run(); return c.json({ ok: true }) })
uploadRequests.get("/:id/submissions", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param("id")
  const row = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const uploads = await db.select().from(schema.publicUploads).where(eq(schema.publicUploads.requestId, id)).orderBy(desc(schema.publicUploads.createdAt)).all().catch(() => [])
  return c.json({ uploads })
})
uploadRequests.post("/:id/submissions/:uploadId/approve", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const req = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, c.req.param("id")), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!req) return c.json({ error: "not found" }, 404)
  const upload = await db.select().from(schema.publicUploads).where(eq(schema.publicUploads.id, c.req.param("uploadId"))).get().catch(() => null)
  if (!upload || upload.requestId !== req.id || !upload.fileId) return c.json({ error: "submission not found" }, 404)
  await db.update(schema.publicUploads).set({ status: "approved", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds() }).where(eq(schema.publicUploads.id, upload.id)).run()
  await db.update(schema.files).set({ status: "ready" }).where(eq(schema.files.id, upload.fileId)).run()
  return c.json({ ok: true })
})
uploadRequests.post("/:id/submissions/:uploadId/reject", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const req = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, c.req.param("id")), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!req) return c.json({ error: "not found" }, 404)
  const upload = await db.select().from(schema.publicUploads).where(eq(schema.publicUploads.id, c.req.param("uploadId"))).get().catch(() => null)
  if (!upload || upload.requestId !== req.id) return c.json({ error: "submission not found" }, 404)
  if (upload.fileId) {
    const file = await db.select().from(schema.files).where(eq(schema.files.id, upload.fileId)).get().catch(() => null)
    if (file) { try { await c.env.FILES.delete(file.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, file.id)).run().catch(() => {}) }
  }
  await db.update(schema.publicUploads).set({ status: "rejected", reviewedBy: c.get("userEmail"), reviewedAt: nowSeconds(), fileId: null }).where(eq(schema.publicUploads.id, upload.id)).run()
  return c.json({ ok: true })
})
uploadRequests.delete("/:id", requireAuth, async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param("id")
  const row = await db.select().from(schema.uploadRequests).where(and(eq(schema.uploadRequests.id, id), eq(schema.uploadRequests.ownerId, c.get("userId")))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.uploadRequests).set({ revokedAt: nowSeconds(), status: "closed" }).where(eq(schema.uploadRequests.id, id)).run()
  return c.json({ ok: true })
})
uploadRequests.get("/public/:token", async (c) => {
  const db = getDb(c.env.DB)
  const token = c.req.param("token")
  const row = await db.select().from(schema.uploadRequests).where(eq(schema.uploadRequests.token, token)).get()
  if (!row || row.revokedAt) return c.json({ error: "not found" }, 404)
  if ((row.status ?? "open") !== "open") return c.json({ error: "request is closed" }, 410)
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
  if ((row.status ?? "open") !== "open") return c.json({ error: "request is closed" }, 410)
  if (row.expiresAt && row.expiresAt <= now) return c.json({ error: "expired" }, 410)
  if (row.uploadLimit && row.uploadCount >= row.uploadLimit) return c.json({ error: "upload limit reached" }, 410)
  const form = await c.req.formData()
  const password = String(form.get("password") || "")
  if (row.password) {
    const rl = await checkRateLimit(db, `upw:${token}:${clientIp(c)}`, 20, 600)
    if (!rl.allowed) return c.json({ error: "too many attempts, please wait a few minutes and try again" }, 429)
    if (!(await verifySecret(password, row.password))) return c.json({ error: "password required" }, 401)
  }
  const uploaderEmail = String(form.get("email") || "").trim().slice(0, 255) || null
  const uploaderName = String(form.get("name") || "").trim().slice(0, 120) || null
  if (row.requireEmail && !uploaderEmail) return c.json({ error: "email required" }, 400)
  const files = uploadFilesFrom(form)
  if (!files.length) return c.json({ error: "file required" }, 400)
  const incomingBytes = files.reduce((s, file) => s + file.size, 0)
  if (row.maxFileSize && files.some((file) => file.size > row.maxFileSize!)) return c.json({ error: "one or more files exceed request limit" }, 413)
  if (row.totalMaxBytes && (await totalUploadedBytes(db, row.id)) + incomingBytes > row.totalMaxBytes) return c.json({ error: "request total upload limit reached" }, 413)
  const policy = await workspacePolicy(db)
  if (policy.maxUploadBytes > 0 && files.some((file) => file.size > policy.maxUploadBytes)) return c.json({ error: "one or more files exceed the workspace upload limit" }, 413)
  for (const file of files) {
    const contentType = file.type || "application/octet-stream"
    if (!allowed(contentType, row.allowedTypes) || !allowed(contentType, policy.allowedTypes)) return c.json({ error: "one or more file types are not allowed" }, 415)
  }
  const suspension = await db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, row.ownerId)).get().catch(() => null)
  if (suspension) return c.json({ error: "uploads are currently unavailable" }, 403)
  if (!(await ownerQuotaAvailable(c, db, row.ownerId, incomingBytes, policy))) return c.json({ error: "the owner's storage is full" }, 413)
  if (row.uploadLimit != null) {
    const res: any = await db.update(schema.uploadRequests)
      .set({ uploadCount: sql`${schema.uploadRequests.uploadCount} + ${files.length}` })
      .where(and(eq(schema.uploadRequests.id, row.id), lt(schema.uploadRequests.uploadCount, row.uploadLimit - files.length + 1)))
      .run()
    const changed = Number(res?.meta?.changes ?? res?.rowsAffected ?? res?.changes ?? 0)
    if (!changed) return c.json({ error: "upload limit reached" }, 410)
  }
  const status = row.moderationMode === "manual" ? "pending" : "ready"
  const fileIds: string[] = []
  for (const file of files) fileIds.push(await createPublicFile(c, db, row, file, now, status, uploaderEmail, uploaderName))
  if (row.uploadLimit == null) await db.update(schema.uploadRequests).set({ uploadCount: sql`${schema.uploadRequests.uploadCount} + ${files.length}` }).where(eq(schema.uploadRequests.id, row.id)).run()
  if (row.closeAfterFirstUpload) await db.update(schema.uploadRequests).set({ status: "closed" }).where(eq(schema.uploadRequests.id, row.id)).run()
  await notifyUser(db, { userId: row.ownerId, type: "public_upload", title: `${files.length} file${files.length === 1 ? "" : "s"} uploaded`, message: `${uploaderEmail ?? uploaderName ?? "Someone"} uploaded to ${row.title}`, targetType: "upload_request", targetId: row.id })
  return c.json({ ok: true, fileIds, pending: status === "pending", message: row.thankYouMessage ?? null })
})
export default uploadRequests
