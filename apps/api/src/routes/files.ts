import { Hono } from "hono"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { getDb, schema } from "../db"
import { computeExpiresAt, clampExtension, isExpired, nowSeconds, DAY_SECONDS } from "../lib/expiry"
import { hashSecret } from "../lib/hash"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

type ShareBody = { password?: string | null; downloadLimit?: number | null; expiresInDays?: number | null }

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>()
files.use("*", requireAuth)

function normalizeUploadSize(value: unknown): number | null {
  const n = Math.floor(Number(value))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
function isInlineSafeContentType(type: string | null): boolean { return !!type && (type.startsWith("image/") || type.includes("pdf")) }
function addInlineSecurityHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; sandbox")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "no-referrer")
}
async function settings(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const map = new Map(rows.map((r) => [r.key, r.value] as const))
  return {
    maxUploadBytes: Number(map.get("maxUploadBytes") || 0),
    allowedTypes: (map.get("allowedTypes") || "").split(",").map((x) => x.trim()).filter(Boolean),
    requirePasswordForShares: map.get("requirePasswordForShares") === "true",
    publicSharingEnabled: map.get("publicSharingEnabled") !== "false",
  }
}
function typeAllowed(type: string | null, allowed: string[]): boolean {
  if (!allowed.length) return true
  const t = (type || "").toLowerCase()
  return allowed.some((a) => {
    const v = a.toLowerCase()
    return v.endsWith("/*") ? t.startsWith(v.slice(0, -1)) : t === v || t.includes(v)
  })
}
async function logActivity(c: any, db: ReturnType<typeof getDb>, action: string, targetId: string, detail: string | null) {
  try {
    await db.insert(schema.activityLog).values({ id: crypto.randomUUID(), userId: c.get("userId") ?? null, actorEmail: c.get("userEmail") ?? null, action, targetType: "file", targetId, detail, ip: c.req.header("CF-Connecting-IP") ?? null, userAgent: c.req.header("User-Agent") ?? null, createdAt: nowSeconds() }).run()
  } catch {}
}
function parseTags(raw: string | null): string[] {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === "string") : [] } catch { return [] }
}
function serializeTags(input: unknown): string | null {
  if (!Array.isArray(input)) return null
  const tags = input.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
  return JSON.stringify(Array.from(new Set(tags)).map((x) => x.slice(0, 40)))
}
function safeFile(row: any) { const { sharePassword, tags, ...r } = row; return { ...r, tags: parseTags(tags ?? null), shareHasPassword: !!sharePassword } }

files.post("/presign", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number; folderId?: string | null }>()
  if (!body?.filename) return c.json({ error: "filename required" }, 400)
  const sizeBytes = normalizeUploadSize(body.sizeBytes)
  if (sizeBytes == null) return c.json({ error: "valid file size required" }, 400)
  const db = getDb(c.env.DB)
  const policy = await settings(db)
  if (policy.maxUploadBytes > 0 && sizeBytes > policy.maxUploadBytes) return c.json({ error: "file exceeds workspace upload limit" }, 413)
  const contentType = body.contentType ? String(body.contentType).slice(0, 255) : null
  if (!typeAllowed(contentType, policy.allowedTypes)) return c.json({ error: "file type is not allowed" }, 415)
  const suspension = await db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, userId)).get().catch(() => null)
  if (suspension) return c.json({ error: "account suspended" }, 403)
  let folderId: string | null = null
  if (body.folderId) {
    const folder = await db.select().from(schema.folders).where(and(eq(schema.folders.id, body.folderId), eq(schema.folders.ownerId, userId))).get()
    if (!folder) return c.json({ error: "folder not found" }, 404)
    folderId = body.folderId
  }
  const account = await db.select().from(schema.user).where(eq(schema.user.id, userId)).get()
  if (account?.quotaBytes != null) {
    const owned = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, userId), isNull(schema.files.deletedAt))).all()
    const used = owned.reduce((s, f) => s + (f.status === "ready" ? f.sizeBytes || 0 : 0), 0)
    if (used + sizeBytes > account.quotaBytes) return c.json({ error: "storage quota exceeded" }, 413)
  }
  const id = crypto.randomUUID()
  const r2Key = `${userId}/${id}`
  const createdAt = nowSeconds()
  const expiresAt = computeExpiresAt(c.env, createdAt, body.expiryDays)
  await db.insert(schema.files).values({ id, ownerId: userId, filename: body.filename.trim().slice(0, 255), r2Key, sizeBytes, contentType, status: "pending", folderId, versionGroupId: id, createdAt, expiresAt }).run()
  await logActivity(c, db, "file.presign", id, body.filename)
  return c.json({ id, uploadUrl: `/api/files/${id}/upload`, expiresAt })
})

async function loadPendingOwned(c: any, id: string) {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId), isNull(schema.files.deletedAt))).get()
  return { db, row }
}
async function markReady(c: any, db: ReturnType<typeof getDb>, row: any, id: string) {
  const account = await db.select().from(schema.user).where(eq(schema.user.id, row.ownerId)).get()
  if (account?.quotaBytes != null) {
    const owned = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, row.ownerId), isNull(schema.files.deletedAt))).all()
    const used = owned.reduce((s, f) => s + ((f.status === "ready" || f.id === id) ? f.sizeBytes || 0 : 0), 0)
    if (used > account.quotaBytes) { try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, id)).run(); return c.json({ error: "storage quota exceeded" }, 413) }
  }
  await db.update(schema.files).set({ status: "ready" }).where(eq(schema.files.id, id)).run()
  await db.insert(schema.fileVersions).values({ id: crypto.randomUUID(), fileId: id, versionGroupId: row.versionGroupId ?? id, versionNumber: 1, r2Key: row.r2Key, sizeBytes: row.sizeBytes, createdAt: nowSeconds() }).run().catch(() => {})
  await logActivity(c, db, "file.upload", id, row.filename)
  return c.json({ ok: true })
}

files.put("/:id/upload", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  if (isExpired(row.expiresAt)) { await db.delete(schema.files).where(eq(schema.files.id, id)).run(); return c.json({ error: "expired" }, 410) }
  const body = c.req.raw.body
  if (!body) return c.json({ error: "empty upload" }, 400)
  await c.env.FILES.put(row.r2Key, body, row.contentType ? { httpMetadata: { contentType: row.contentType } } : undefined)
  const object = await c.env.FILES.head(row.r2Key)
  if (!object || object.size !== row.sizeBytes) { try { await c.env.FILES.delete(row.r2Key) } catch {}; return c.json({ error: "upload size mismatch" }, 409) }
  return c.json({ ok: true })
})
files.post("/:id/multipart/start", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  if (isExpired(row.expiresAt)) { await db.delete(schema.files).where(eq(schema.files.id, id)).run(); return c.json({ error: "expired" }, 410) }
  const mpu = await c.env.FILES.createMultipartUpload(row.r2Key, row.contentType ? { httpMetadata: { contentType: row.contentType } } : undefined)
  return c.json({ uploadId: mpu.uploadId, key: row.r2Key })
})
files.put("/:id/multipart/part", async (c) => {
  const id = c.req.param("id")
  const uploadId = c.req.query("uploadId")
  const partNumber = Number(c.req.query("partNumber"))
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) return c.json({ error: "uploadId and a positive partNumber are required" }, 400)
  const { row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  const body = c.req.raw.body
  if (!body) return c.json({ error: "empty part" }, 400)
  const uploaded = await c.env.FILES.resumeMultipartUpload(row.r2Key, uploadId).uploadPart(partNumber, body)
  return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
})
files.post("/:id/multipart/complete", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  if (row.status !== "pending") return c.json({ error: "upload already completed" }, 409)
  const body = await c.req.json<{ uploadId?: string; parts?: { partNumber: number; etag: string }[] }>()
  if (!body?.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) return c.json({ error: "uploadId and parts are required" }, 400)
  const parts = body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })).sort((a, b) => a.partNumber - b.partNumber)
  let object
  try { object = await c.env.FILES.resumeMultipartUpload(row.r2Key, body.uploadId).complete(parts) } catch (e) { return c.json({ error: `multipart complete failed: ${(e as Error)?.message ?? "unknown"}` }, 400) }
  if (object.size !== row.sizeBytes) { try { await c.env.FILES.delete(row.r2Key) } catch {}; return c.json({ error: "upload size mismatch" }, 409) }
  return markReady(c, db, row, id)
})
files.post("/:id/multipart/abort", async (c) => {
  const id = c.req.param("id")
  const uploadId = c.req.query("uploadId")
  if (!uploadId) return c.json({ error: "uploadId required" }, 400)
  const { row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  try { await c.env.FILES.resumeMultipartUpload(row.r2Key, uploadId).abort() } catch {}
  return c.json({ ok: true })
})
files.post("/:id/complete", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadPendingOwned(c, id)
  if (!row) return c.json({ error: "not found" }, 404)
  const object = await c.env.FILES.head(row.r2Key)
  if (!object) return c.json({ error: "upload missing" }, 409)
  if (object.size !== row.sizeBytes) { try { await c.env.FILES.delete(row.r2Key) } catch {}; return c.json({ error: "upload size mismatch" }, 409) }
  return markReady(c, db, row, id)
})

files.get("/", async (c) => {
  const userId = c.get("userId")
  const includeTrash = c.req.query("trash") === "true"
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds()), includeTrash ? gt(schema.files.deletedAt, 0) : isNull(schema.files.deletedAt))).orderBy(desc(schema.files.createdAt)).all()
  return c.json({ files: rows.map(safeFile) })
})
async function loadReadyOwned(c: any, id: string) {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId), isNull(schema.files.deletedAt))).get()
  return { db, row }
}
files.get("/:id/download", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadReadyOwned(c, id)
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)
  if (isExpired(row.expiresAt)) { try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, id)).run(); return c.json({ error: "expired" }, 410) }
  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)
  await logActivity(c, db, "file.download", id, row.filename)
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("Content-Length", String(object.size)); headers.set("Content-Disposition", `attachment; filename=\"${row.filename.replace(/[\"\\]/g, "_")}\"`); headers.set("X-Content-Type-Options", "nosniff")
  return new Response(object.body, { headers })
})
files.get("/:id/inline", async (c) => {
  const id = c.req.param("id")
  const { db, row } = await loadReadyOwned(c, id)
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)
  if (!isInlineSafeContentType(row.contentType)) return c.json({ error: "inline preview not allowed" }, 415)
  if (isExpired(row.expiresAt)) { try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, id)).run(); return c.json({ error: "expired" }, 410) }
  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("Content-Length", String(object.size)); headers.set("Content-Disposition", `inline; filename=\"${row.filename.replace(/[\"\\]/g, "_")}\"`); headers.set("Cache-Control", "private, max-age=60"); addInlineSecurityHeaders(headers)
  return new Response(object.body, { headers })
})
files.post("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<ShareBody>().catch(() => ({} as ShareBody))
  const db = getDb(c.env.DB)
  const policy = await settings(db)
  if (!policy.publicSharingEnabled) return c.json({ error: "public sharing is disabled" }, 403)
  if (policy.requirePasswordForShares && !body.password) return c.json({ error: "password required by workspace policy" }, 400)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId), isNull(schema.files.deletedAt))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "")
  const update: Record<string, unknown> = { shareToken: token }
  const hasOptions = "password" in body || "downloadLimit" in body || "expiresInDays" in body
  if (hasOptions) { update.sharePassword = body.password ? await hashSecret(String(body.password)) : null; update.shareDownloadLimit = typeof body.downloadLimit === "number" && body.downloadLimit > 0 ? Math.floor(body.downloadLimit) : null; update.shareExpiresAt = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? nowSeconds() + Math.round(body.expiresInDays * DAY_SECONDS) : null; update.shareDownloadCount = 0 }
  await db.update(schema.files).set(update).where(eq(schema.files.id, id)).run()
  await logActivity(c, db, "file.share", id, row.filename)
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/${token}`, hasPassword: hasOptions ? !!body.password : !!row.sharePassword, downloadLimit: hasOptions ? (update.shareDownloadLimit as number | null) : row.shareDownloadLimit ?? null, shareExpiresAt: hasOptions ? (update.shareExpiresAt as number | null) : row.shareExpiresAt ?? null })
})
files.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, id)).run()
  await logActivity(c, db, "file.revoke", id, row.filename)
  return c.json({ ok: true })
})
files.get("/:id/versions", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const versions = await db.select().from(schema.fileVersions).where(eq(schema.fileVersions.versionGroupId, row.versionGroupId ?? row.id)).orderBy(desc(schema.fileVersions.versionNumber)).all().catch(() => [])
  return c.json({ versions })
})
files.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ extendDays?: number; expiryDays?: number; folderId?: string | null; filename?: string; favorite?: boolean; tags?: string[] }>()
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const update: Record<string, unknown> = {}
  const addDays = Math.max(body.extendDays ?? body.expiryDays ?? 0, 0)
  if (addDays > 0) update.expiresAt = clampExtension(c.env, row.createdAt, Math.max(row.expiresAt, nowSeconds()) + Math.round(addDays * DAY_SECONDS))
  if ("folderId" in body) { const fid = body.folderId; if (fid) { const folder = await db.select().from(schema.folders).where(and(eq(schema.folders.id, fid), eq(schema.folders.ownerId, userId))).get(); if (!folder) return c.json({ error: "folder not found" }, 404); update.folderId = fid } else update.folderId = null }
  if (typeof body.filename === "string") { const name = body.filename.trim(); if (!name) return c.json({ error: "filename cannot be empty" }, 400); update.filename = name.slice(0, 255) }
  if (typeof body.favorite === "boolean") update.favorite = body.favorite
  if (Array.isArray(body.tags)) update.tags = serializeTags(body.tags)
  if (Object.keys(update).length === 0) return c.json({ error: "nothing to update" }, 400)
  await db.update(schema.files).set(update).where(eq(schema.files.id, id)).run()
  await logActivity(c, db, "file.update", id, row.filename)
  const next = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  return c.json({ ok: true, file: next ? safeFile(next) : null, expiresAt: next?.expiresAt, folderId: next?.folderId ?? null, filename: next?.filename })
})
files.post("/:id/restore", async (c) => { const userId = c.get("userId"); const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get(); if (!row) return c.json({ error: "not found" }, 404); await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, id)).run(); await logActivity(c, db, "file.restore", id, row.filename); return c.json({ ok: true }) })
files.delete("/:id/permanent", async (c) => { const userId = c.get("userId"); const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get(); if (!row) return c.json({ error: "not found" }, 404); try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, id)).run(); await logActivity(c, db, "file.deletePermanent", id, row.filename); return c.json({ ok: true }) })
files.delete("/:id", async (c) => { const userId = c.get("userId"); const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId))).get(); if (!row) return c.json({ error: "not found" }, 404); await db.update(schema.files).set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, id)).run(); await logActivity(c, db, "file.trash", id, row.filename); return c.json({ ok: true }) })

export default files
