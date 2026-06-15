import { Hono } from "hono"
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { hashSecret, verifySecret } from "../lib/hash"
import { checkRateLimit, clientIp } from "../lib/rateLimit"
import { requireAuth } from "../middleware/auth"
import { adminRole } from "../middleware/admin"
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
// Workspace-wide upload policy, read from app_settings. Public uploads land in
// the owner's account, so they must respect the same global limits an
// authenticated upload would.
async function workspacePolicy(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const map = new Map(rows.map((r) => [r.key, r.value] as const))
  return {
    maxUploadBytes: Number(map.get("maxUploadBytes") || 0),
    allowedTypes: String(map.get("allowedTypes") || ""),
    defaultQuotaBytes: Number(map.get("defaultQuotaBytes") || 1073741824),
  }
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
  // The public endpoint is unauthenticated, so rate-limit password attempts per
  // token+IP to stop brute-forcing a protected request's password.
  if (row.password) {
    const rl = await checkRateLimit(db, `upw:${token}:${clientIp(c)}`, 20, 600)
    if (!rl.allowed) return c.json({ error: "too many attempts, please wait a few minutes and try again" }, 429)
    if (!(await verifySecret(password, row.password))) return c.json({ error: "password required" }, 401)
  }
  const uploaderEmail = String(form.get("email") || "").trim().slice(0, 255) || null
  const uploaderName = String(form.get("name") || "").trim().slice(0, 120) || null
  if (row.requireEmail && !uploaderEmail) return c.json({ error: "email required" }, 400)
  const formFile = form.get("file") as unknown
  if (!isUploadFileLike(formFile)) return c.json({ error: "file required" }, 400)
  const file = formFile
  if (row.maxFileSize && file.size > row.maxFileSize) return c.json({ error: "file exceeds request limit" }, 413)
  const contentType = file.type || "application/octet-stream"
  if (!allowed(contentType, row.allowedTypes)) return c.json({ error: "file type is not allowed" }, 415)

  // Public uploads write into the OWNER's account, so they must also respect the
  // workspace upload policy, the owner's account status, and the owner's storage
  // quota. Without this, an upload link is an unauthenticated way to bypass all
  // of those limits.
  const policy = await workspacePolicy(db)
  if (policy.maxUploadBytes > 0 && file.size > policy.maxUploadBytes) return c.json({ error: "file exceeds the workspace upload limit" }, 413)
  if (!allowed(contentType, policy.allowedTypes)) return c.json({ error: "file type is not allowed" }, 415)
  const suspension = await db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, row.ownerId)).get().catch(() => null)
  if (suspension) return c.json({ error: "uploads are currently unavailable" }, 403)
  const owner = await db.select().from(schema.user).where(eq(schema.user.id, row.ownerId)).get().catch(() => null)
  const role = await adminRole(c.env, db, owner?.email ?? "")
  const quota = role != null ? null : (owner?.quotaBytes ?? policy.defaultQuotaBytes)
  if (quota != null && quota > 0) {
    const owned = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, row.ownerId), isNull(schema.files.deletedAt))).all()
    const used = owned.reduce((s, f) => s + (f.status === "ready" ? f.sizeBytes || 0 : 0), 0)
    if (used + file.size > quota) return c.json({ error: "the owner's storage is full" }, 413)
  }

  // Atomically claim a slot when the request enforces an upload limit so
  // concurrent uploads can't race past it (the early check above is just a fast
  // path). For unlimited requests we increment the counter at the end instead.
  if (row.uploadLimit != null) {
    const res: any = await db.update(schema.uploadRequests)
      .set({ uploadCount: sql`${schema.uploadRequests.uploadCount} + 1` })
      .where(and(eq(schema.uploadRequests.id, row.id), lt(schema.uploadRequests.uploadCount, row.uploadLimit)))
      .run()
    const changed = Number(res?.meta?.changes ?? res?.rowsAffected ?? res?.changes ?? 0)
    if (!changed) return c.json({ error: "upload limit reached" }, 410)
  }

  const id = crypto.randomUUID()
  const r2Key = `${row.ownerId}/${id}`
  await c.env.FILES.put(r2Key, file.stream(), contentType ? { httpMetadata: { contentType } } : undefined)
  await db.insert(schema.files).values({ id, ownerId: row.ownerId, filename: file.name.slice(0, 255), r2Key, sizeBytes: file.size, contentType, status: "ready", folderId: row.folderId ?? null, versionGroupId: id, createdAt: now, expiresAt: now + 7 * DAY_SECONDS }).run()
  await db.insert(schema.publicUploads).values({ id: crypto.randomUUID(), requestId: row.id, fileId: id, uploaderEmail, uploaderName, createdAt: now }).run()
  if (row.uploadLimit == null) {
    await db.update(schema.uploadRequests).set({ uploadCount: sql`${schema.uploadRequests.uploadCount} + 1` }).where(eq(schema.uploadRequests.id, row.id)).run()
  }
  return c.json({ ok: true, fileId: id })
})
export default uploadRequests
