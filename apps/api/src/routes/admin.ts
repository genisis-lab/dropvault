import { Hono } from "hono"
import { and, desc, eq, inArray } from "drizzle-orm"
import { getDb, schema } from "../db"
import type { FileRow } from "../db/schema"
import { clampExtension, DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import { adminEmailSet, adminRole, effectiveAdmins, hasRole, normalizeAdminRole, requireAdmin, type AdminRole } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

type SettingsKey =
  | "defaultExpiryDays"
  | "maxExpiryDays"
  | "maxUploadBytes"
  | "allowedTypes"
  | "defaultQuotaBytes"
  | "requirePasswordForShares"
  | "publicSharingEnabled"
  | "signupMode"
  | "trashRetentionDays"
  | "notifyEmail"
  | "notifyWebhookUrl"
  | "notifyOnFlag"
  | "notifyOnSignup"
  | "notifyOnLimitRequest"
  | "rolePermissions"
type SettingsBody = Partial<Record<SettingsKey, string | number | boolean | null>>
type BulkUserBody = { action?: string; ids?: unknown[]; quotaBytes?: number | null }
type BulkFileBody = { action?: string; ids?: unknown[]; days?: number }

// Capabilities whose minimum required role the owner can reconfigure. Settings
// and admin management always stay owner-only and are intentionally not here.
type Capability = "manageUsers" | "manageFiles" | "manageFlags"
const defaultCapabilityRole: Record<Capability, AdminRole> = { manageUsers: "admin", manageFiles: "admin", manageFlags: "moderator" }
const VALID_ROLES = ["owner", "admin", "moderator", "viewer"]

const MAX_PENDING_LIMIT_REQUESTS = 2
const PENDING_APPROVAL_REASON = "Awaiting admin approval"

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()
const settingsKeys: SettingsKey[] = ["defaultExpiryDays", "maxExpiryDays", "maxUploadBytes", "allowedTypes", "defaultQuotaBytes", "requirePasswordForShares", "publicSharingEnabled", "signupMode", "trashRetentionDays", "notifyEmail", "notifyWebhookUrl", "notifyOnFlag", "notifyOnSignup", "notifyOnLimitRequest", "rolePermissions"]

admin.use("*", requireAuth)
admin.get("/access", async (c) => {
  const db = getDb(c.env.DB)
  const role = await adminRole(c.env, db, c.get("userEmail"))
  return c.json({ isAdmin: role != null, role })
})
admin.post("/limit-requests", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ requestedBytes?: number; reason?: string }>().catch(() => ({} as { requestedBytes?: number; reason?: string }))
  if (!body.requestedBytes || body.requestedBytes < 1073741824) return c.json({ error: "requestedBytes must be at least 1GB" }, 400)
  const db = getDb(c.env.DB)
  const pending = await db.select().from(schema.uploadLimitRequests).where(and(eq(schema.uploadLimitRequests.userId, userId), eq(schema.uploadLimitRequests.status, "pending"))).all().catch(() => [])
  if (pending.length >= MAX_PENDING_LIMIT_REQUESTS) return c.json({ error: `You already have ${MAX_PENDING_LIMIT_REQUESTS} pending upload limit requests. Please wait for an admin to review them.` }, 429)
  const id = crypto.randomUUID()
  await db.insert(schema.uploadLimitRequests).values({
    id,
    userId,
    requestedBytes: Math.floor(body.requestedBytes),
    reason: body.reason?.slice(0, 500) ?? null,
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    createdAt: nowSeconds(),
  }).run()
  await logAction(c, db, "limit_request.create", "user", userId, `${body.requestedBytes} bytes`)
  await notify(c, db, `Upload limit request: ${c.get("userEmail") ?? userId} asked for ${body.requestedBytes} bytes`, "notifyOnLimitRequest", "limit_request")
  return c.json({ ok: true, id })
})
admin.get("/limit-requests/mine", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.uploadLimitRequests).where(eq(schema.uploadLimitRequests.userId, userId)).orderBy(desc(schema.uploadLimitRequests.createdAt)).all().catch(() => [])
  return c.json({ requests: rows })
})
admin.use("*", requireAdmin)

async function forbidUnless(c: any, minimum: AdminRole) {
  const db = getDb(c.env.DB)
  if (!(await hasRole(c.env, db, c.get("userEmail"), minimum))) return c.json({ error: "forbidden" }, 403)
  return null
}
// Owner-configurable capability gate. Reads the minimum role for the capability
// from app_settings.rolePermissions (JSON like {\"manageFiles\":\"moderator\"}),
// falling back to a sensible default.
async function capabilityRole(db: ReturnType<typeof getDb>, cap: Capability): Promise<AdminRole> {
  const settings = await settingsMap(db)
  const def = defaultCapabilityRole[cap]
  try {
    const parsed = settings.rolePermissions ? JSON.parse(settings.rolePermissions) : {}
    const v = String(parsed?.[cap] ?? "").toLowerCase()
    if (VALID_ROLES.includes(v)) return v as AdminRole
  } catch {}
  return def
}
async function forbidUnlessCan(c: any, cap: Capability) {
  const db = getDb(c.env.DB)
  const min = await capabilityRole(db, cap)
  if (!(await hasRole(c.env, db, c.get("userEmail"), min))) return c.json({ error: "forbidden" }, 403)
  return null
}
function idsFrom(input: unknown[] | undefined): string[] {
  return Array.isArray(input) ? input.filter((x: unknown): x is string => typeof x === "string") : []
}
function categoryOf(type: string | null): string {
  if (!type) return "other"
  if (type.startsWith("image/")) return "images"
  if (type.startsWith("video/")) return "videos"
  if (type.startsWith("audio/")) return "audio"
  if (type.includes("pdf")) return "pdf"
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return "archives"
  if (type.includes("text") || type.includes("csv") || type.includes("json")) return "docs"
  return "other"
}
function dayKey(sec: number): string { return new Date(sec * 1000).toISOString().slice(0, 10) }
function parseTags(raw: string | null): string[] {
  try { const value = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value.filter((x: unknown): x is string => typeof x === "string") : [] } catch { return [] }
}
async function logAction(c: any, db: ReturnType<typeof getDb>, action: string, targetType: string | null, targetId: string | null, detail: string | null) {
  try {
    await db.insert(schema.auditLog).values({ id: crypto.randomUUID(), actorId: c.get("userId") ?? null, actorEmail: c.get("userEmail") ?? null, action, targetType, targetId, detail, createdAt: nowSeconds() }).run()
  } catch {}
}
// Best-effort notification webhook. Fires only when the matching toggle is on
// and a valid webhook URL is configured. Never blocks the response.
async function notify(c: any, db: ReturnType<typeof getDb>, message: string, toggleKey: SettingsKey, event: string) {
  try {
    const settings = await settingsMap(db)
    if (settings[toggleKey] !== "true") return
    const url = settings.notifyWebhookUrl
    if (!url || !/^https?:\/\//.test(url)) return
    const p = fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, message, at: nowSeconds() }) }).then(() => {}).catch(() => {})
    try { c.executionCtx?.waitUntil(p) } catch { await p }
  } catch {}
}
function fileRow(f: FileRow, emailById: Map<string, string>, nameById: Map<string, string>) {
  return { id: f.id, filename: f.filename, sizeBytes: f.sizeBytes, contentType: f.contentType, status: f.status, shared: !!f.shareToken, shareToken: f.shareToken ?? null, folderId: f.folderId ?? null, favorite: !!f.favorite, tags: parseTags(f.tags ?? null), deletedAt: f.deletedAt ?? null, versionGroupId: f.versionGroupId ?? null, createdAt: f.createdAt, expiresAt: f.expiresAt, ownerId: f.ownerId, ownerEmail: emailById.get(f.ownerId) ?? null, ownerName: nameById.get(f.ownerId) ?? null }
}
async function settingsMap(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const out: Record<SettingsKey, string> = { defaultExpiryDays: "7", maxExpiryDays: "30", maxUploadBytes: "1073741824", allowedTypes: "", defaultQuotaBytes: "1073741824", requirePasswordForShares: "false", publicSharingEnabled: "true", signupMode: "open", trashRetentionDays: "30", notifyEmail: "", notifyWebhookUrl: "", notifyOnFlag: "true", notifyOnSignup: "false", notifyOnLimitRequest: "true", rolePermissions: "" }
  for (const row of rows) if (settingsKeys.includes(row.key as SettingsKey)) out[row.key as SettingsKey] = row.value
  return out
}

admin.get("/stats", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, folders, openFlags, suspensions] = await Promise.all([
    db.select().from(schema.user).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.folders).all(),
    db.select().from(schema.fileFlags).where(eq(schema.fileFlags.status, "open")).all().catch(() => []),
    db.select().from(schema.userSuspensions).all().catch(() => []),
  ])
  const now = nowSeconds()
  const readyFiles = files.filter((f) => f.status === "ready" && !f.deletedAt)
  const pendingFiles = files.filter((f) => f.status === "pending")
  const deletedFiles = files.filter((f) => !!f.deletedAt)
  const typeMap = new Map<string, { count: number; bytes: number }>()
  const bytesByUser = new Map<string, number>()
  const countByUser = new Map<string, number>()
  for (const f of readyFiles) {
    const cat = categoryOf(f.contentType)
    const typeEntry = typeMap.get(cat) ?? { count: 0, bytes: 0 }
    typeEntry.count += 1; typeEntry.bytes += f.sizeBytes || 0; typeMap.set(cat, typeEntry)
    bytesByUser.set(f.ownerId, (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0))
    countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1)
  }
  const nameById = new Map(users.map((u) => [u.id, u.name] as const))
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  const topUsers = Array.from(bytesByUser, ([id, bytes]) => ({ id, name: nameById.get(id) ?? "Unknown", email: emailById.get(id) ?? null, totalBytes: bytes, fileCount: countByUser.get(id) ?? 0 })).sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 5)
  const growthMap = new Map<string, { users: number; files: number; bytes: number }>()
  const keys: string[] = []
  for (let i = 29; i >= 0; i--) { const key = dayKey(now - i * 86400); keys.push(key); growthMap.set(key, { users: 0, files: 0, bytes: 0 }) }
  for (const u of users) { const entry = growthMap.get(dayKey(Math.floor(u.createdAt.getTime() / 1000))); if (entry) entry.users += 1 }
  for (const f of files) { const entry = growthMap.get(dayKey(f.createdAt)); if (entry) { entry.files += 1; if (f.status === "ready") entry.bytes += f.sizeBytes || 0 } }
  const admins = await effectiveAdmins(c.env, db)
  const usersNearQuota = users.filter((u) => u.quotaBytes != null && u.quotaBytes > 0 && ((bytesByUser.get(u.id) ?? 0) / u.quotaBytes) >= 0.85).length
  const unprotectedLinks = readyFiles.filter((f) => f.shareToken && !f.sharePassword).length
  const unlimitedLinks = readyFiles.filter((f) => f.shareToken && f.shareDownloadLimit == null).length
  const inactiveCutoff = now - 30 * DAY_SECONDS
  const pendingApprovalCount = suspensions.filter((s) => s.reason === PENDING_APPROVAL_REASON).length
  return c.json({
    userCount: users.length, fileCount: files.length, readyFileCount: readyFiles.length, pendingFileCount: pendingFiles.length, deletedFileCount: deletedFiles.length, folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0), sharedFileCount: readyFiles.filter((f) => f.shareToken).length, sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS).length, flagCount: openFlags.length, adminCount: admins.size, suspendedUserCount: suspensions.length, pendingApprovalCount,
    typeBreakdown: Array.from(typeMap, ([category, v]) => ({ category, count: v.count, bytes: v.bytes })).sort((a, b) => b.bytes - a.bytes), topUsers,
    growth: keys.map((key) => ({ date: key, ...(growthMap.get(key) ?? { users: 0, files: 0, bytes: 0 }) })),
    alerts: [
      { id: "flags", label: "Open abuse reports", count: openFlags.length, level: openFlags.length ? "high" : "ok" },
      { id: "approval", label: "Users awaiting approval", count: pendingApprovalCount, level: pendingApprovalCount ? "medium" : "ok" },
      { id: "quota", label: "Users near quota", count: usersNearQuota, level: usersNearQuota ? "medium" : "ok" },
      { id: "unprotected", label: "Public links without passwords", count: unprotectedLinks, level: unprotectedLinks ? "medium" : "ok" },
      { id: "unlimited", label: "Public links with unlimited downloads", count: unlimitedLinks, level: unlimitedLinks ? "low" : "ok" },
      { id: "pending", label: "Stuck/pending uploads", count: pendingFiles.filter((f) => f.createdAt < now - 3600).length, level: "low" },
      { id: "large", label: "Large files", count: readyFiles.filter((f) => f.sizeBytes > 100 * 1024 * 1024).length, level: "low" },
      { id: "inactive", label: "Inactive users (30d+ no files)", count: users.filter((u) => !files.some((f) => f.ownerId === u.id && f.createdAt > inactiveCutoff)).length, level: "low" },
    ],
  })
})

admin.get("/users", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, admins, suspensions] = await Promise.all([db.select().from(schema.user).orderBy(desc(schema.user.createdAt)).all(), db.select().from(schema.files).all(), effectiveAdmins(c.env, db), db.select().from(schema.userSuspensions).all().catch(() => [])])
  const suspended = new Set(suspensions.map((s) => s.userId))
  const reasonByUser = new Map(suspensions.map((s) => [s.userId, s.reason] as const))
  const countByUser = new Map<string, number>(); const bytesByUser = new Map<string, number>()
  for (const f of files.filter((x) => !x.deletedAt)) { countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1); if (f.status === "ready") bytesByUser.set(f.ownerId, (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0)) }
  const settings = await settingsMap(db)
  const defaultQuota = Number(settings.defaultQuotaBytes) || 1073741824
  return c.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, image: u.image, createdAt: Math.floor(u.createdAt.getTime() / 1000), fileCount: countByUser.get(u.id) ?? 0, totalBytes: bytesByUser.get(u.id) ?? 0, quotaBytes: u.quotaBytes ?? defaultQuota, isAdmin: admins.has(u.email.toLowerCase()), role: admins.get(u.email.toLowerCase()) ?? null, suspended: suspended.has(u.id), pendingApproval: reasonByUser.get(u.id) === PENDING_APPROVAL_REASON })) })
})
admin.get("/users/:id", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get()
  if (!u) return c.json({ error: "not found" }, 404)
  const [files, allUsers, admins, suspension, activity] = await Promise.all([db.select().from(schema.files).where(eq(schema.files.ownerId, id)).orderBy(desc(schema.files.createdAt)).all(), db.select().from(schema.user).all(), effectiveAdmins(c.env, db), db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).get().catch(() => null), db.select().from(schema.activityLog).where(eq(schema.activityLog.userId, id)).orderBy(desc(schema.activityLog.createdAt)).limit(50).all().catch(() => [])])
  const emailById = new Map(allUsers.map((x) => [x.id, x.email] as const)); const nameById = new Map(allUsers.map((x) => [x.id, x.name] as const)); const ready = files.filter((f) => f.status === "ready" && !f.deletedAt)
  const settings = await settingsMap(db)
  const defaultQuota = Number(settings.defaultQuotaBytes) || 1073741824
  return c.json({ user: { id: u.id, name: u.name, email: u.email, image: u.image, createdAt: Math.floor(u.createdAt.getTime() / 1000), fileCount: files.filter((f) => !f.deletedAt).length, totalBytes: ready.reduce((s, f) => s + (f.sizeBytes || 0), 0), quotaBytes: u.quotaBytes ?? defaultQuota, isAdmin: admins.has(u.email.toLowerCase()), role: admins.get(u.email.toLowerCase()) ?? null, suspended: !!suspension, suspensionReason: suspension?.reason ?? null, pendingApproval: suspension?.reason === PENDING_APPROVAL_REASON }, files: files.map((f) => fileRow(f, emailById, nameById)), activity })
})
admin.post("/users/:id/quota", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers"); if (denied) return denied
  const id = c.req.param("id"); const body = await c.req.json<{ bytes?: number | null }>().catch(() => ({} as { bytes?: number | null })); const db = getDb(c.env.DB); const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get(); if (!u) return c.json({ error: "not found" }, 404)
  const targetRole = await adminRole(c.env, db, u.email); if (targetRole != null) return c.json({ error: "Admins and the owner have unlimited storage and can't be assigned a limit." }, 400)
  const bytes = body.bytes == null ? null : Math.max(0, Math.floor(Number(body.bytes)))
  await db.update(schema.user).set({ quotaBytes: bytes }).where(eq(schema.user.id, id)).run(); await logAction(c, db, "user.quota", "user", id, bytes == null ? "cleared quota" : `quota=${bytes} bytes`); return c.json({ ok: true, quotaBytes: bytes })
})
admin.post("/users/:id/suspend", async (c) => { const denied = await forbidUnlessCan(c, "manageUsers"); if (denied) return denied; const id = c.req.param("id"); const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string })); const db = getDb(c.env.DB); if (id === c.get("userId")) return c.json({ error: "You can't suspend your own account." }, 400); const target = await db.select().from(schema.user).where(eq(schema.user.id, id)).get(); if (!target) return c.json({ error: "not found" }, 404); const targetRole = await adminRole(c.env, db, target.email); if (targetRole === "owner") return c.json({ error: "The owner account is root and can't be suspended." }, 403); await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run().catch(() => {}); await db.insert(schema.userSuspensions).values({ userId: id, reason: body.reason?.slice(0, 500) ?? null, createdBy: c.get("userEmail"), createdAt: nowSeconds() }).run(); await db.delete(schema.session).where(eq(schema.session.userId, id)).run().catch(() => {}); await logAction(c, db, "user.suspend", "user", id, body.reason ?? null); return c.json({ ok: true }) })
admin.post("/users/:id/unsuspend", async (c) => { const denied = await forbidUnlessCan(c, "manageUsers"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run(); await logAction(c, db, "user.unsuspend", "user", id, null); return c.json({ ok: true }) })
admin.post("/users/:id/approve", async (c) => { const denied = await forbidUnlessCan(c, "manageUsers"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); const suspension = await db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).get().catch(() => null); if (!suspension) return c.json({ error: "not found" }, 404); await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run(); await logAction(c, db, "user.approve", "user", id, null); return c.json({ ok: true }) })
admin.post("/users/bulk", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers"); if (denied) return denied
  const body = await c.req.json<BulkUserBody>().catch(() => ({} as BulkUserBody)); const ids = idsFrom(body.ids); const db = getDb(c.env.DB); if (!ids.length) return c.json({ error: "no ids" }, 400)
  if (body.action === "setQuota") { const bytes = body.quotaBytes == null ? null : Math.max(0, Math.floor(Number(body.quotaBytes))); const admins = await effectiveAdmins(c.env, db); const targets = await db.select().from(schema.user).where(inArray(schema.user.id, ids)).all(); for (const u of targets) { if (admins.has(u.email.toLowerCase())) continue; await db.update(schema.user).set({ quotaBytes: bytes }).where(eq(schema.user.id, u.id)).run() } }
  else if (body.action === "revokeLinks") { for (const id of ids) await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.ownerId, id)).run() }
  else if (body.action === "expireFiles") { for (const id of ids) await db.update(schema.files).set({ expiresAt: nowSeconds() }).where(eq(schema.files.ownerId, id)).run() }
  else if (body.action === "approve") { for (const id of ids) await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run().catch(() => {}) }
  else return c.json({ error: "bad action" }, 400)
  await logAction(c, db, `user.bulk.${body.action}`, "user", null, `${ids.length} users`); return c.json({ ok: true, count: ids.length })
})

admin.get("/files", async (c) => { const db = getDb(c.env.DB); const [files, users] = await Promise.all([db.select().from(schema.files).orderBy(desc(schema.files.createdAt)).all(), db.select().from(schema.user).all()]); const emailById = new Map(users.map((u) => [u.id, u.email] as const)); const nameById = new Map(users.map((u) => [u.id, u.name] as const)); return c.json({ files: files.map((f) => fileRow(f, emailById, nameById)) }) })
admin.get("/activity", async (c) => { const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500); const db = getDb(c.env.DB); const rows = await db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.createdAt)).limit(limit).all().catch(() => []); return c.json({ entries: rows }) })
admin.post("/files/:id/revoke", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get(); if (!row) return c.json({ error: "not found" }, 404); await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.revoke", "file", id, row.filename); return c.json({ ok: true }) })
admin.post("/files/:id/extend", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const body = await c.req.json<{ days?: number }>().catch(() => ({} as { days?: number })); const days = Math.max(Number(body.days) || 0, 0); if (days <= 0) return c.json({ error: "days must be positive" }, 400); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get(); if (!row) return c.json({ error: "not found" }, 404); const expiresAt = clampExtension(c.env, row.createdAt, Math.max(row.expiresAt, nowSeconds()) + Math.round(days * DAY_SECONDS)); await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.extend", "file", id, `${row.filename} +${days}d`); return c.json({ ok: true, expiresAt }) })
admin.post("/files/:id/expire", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get(); if (!row) return c.json({ error: "not found" }, 404); const expiresAt = nowSeconds(); await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.expire", "file", id, row.filename); return c.json({ ok: true, expiresAt }) })
admin.delete("/files/:id", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get(); if (!row) return c.json({ error: "not found" }, 404); await db.update(schema.files).set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null }).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.trash", "file", id, row.filename); return c.json({ ok: true }) })
admin.post("/files/:id/delete-permanent", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get(); if (!row) return c.json({ error: "not found" }, 404); try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.delete", "file", id, row.filename); return c.json({ ok: true }) })
admin.post("/files/:id/restore", async (c) => { const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, id)).run(); await logAction(c, db, "file.restore", "file", id, null); return c.json({ ok: true }) })
admin.post("/files/bulk", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles"); if (denied) return denied
  const body = await c.req.json<BulkFileBody>().catch(() => ({} as BulkFileBody)); const action = String(body.action ?? ""); const ids = idsFrom(body.ids); if (!ids.length) return c.json({ error: "no ids" }, 400); if (!["revoke", "delete", "expire", "extend", "restore", "permanentDelete"].includes(action)) return c.json({ error: "bad action" }, 400)
  const db = getDb(c.env.DB); const rows = await db.select().from(schema.files).where(inArray(schema.files.id, ids)).all(); const now = nowSeconds()
  for (const row of rows) {
    if (action === "revoke") await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "expire") await db.update(schema.files).set({ expiresAt: now }).where(eq(schema.files.id, row.id)).run()
    else if (action === "extend") await db.update(schema.files).set({ expiresAt: clampExtension(c.env, row.createdAt, Math.max(row.expiresAt, now) + Math.round((body.days || 7) * DAY_SECONDS)) }).where(eq(schema.files.id, row.id)).run()
    else if (action === "delete") await db.update(schema.files).set({ deletedAt: now, shareToken: null, sharePassword: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "restore") await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "permanentDelete") { try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, row.id)).run() }
  }
  await logAction(c, db, `file.bulk.${action}`, "file", null, `${rows.length} files`); return c.json({ ok: true, count: rows.length })
})

admin.get("/flags", async (c) => { const status = c.req.query("status"); const db = getDb(c.env.DB); const [flags, files, users] = await Promise.all([db.select().from(schema.fileFlags).orderBy(desc(schema.fileFlags.createdAt)).all().catch(() => []), db.select().from(schema.files).all(), db.select().from(schema.user).all()]); const fileById = new Map(files.map((f) => [f.id, f] as const)); const emailById = new Map(users.map((u) => [u.id, u.email] as const)); const filtered = status ? flags.filter((f) => f.status === status) : flags; return c.json({ flags: filtered.map((fl) => { const file = fl.fileId ? fileById.get(fl.fileId) : undefined; return { id: fl.id, fileId: fl.fileId, token: fl.token, reason: fl.reason, reporterEmail: fl.reporterEmail, status: fl.status, adminNote: fl.adminNote ?? null, createdAt: fl.createdAt, resolvedAt: fl.resolvedAt, filename: file?.filename ?? null, ownerEmail: file ? (emailById.get(file.ownerId) ?? null) : null, fileExists: !!file } }) }) })
admin.post("/flags/:id", async (c) => { const denied = await forbidUnlessCan(c, "manageFlags"); if (denied) return denied; const id = c.req.param("id"); const body = await c.req.json<{ status?: string; note?: string; action?: string }>().catch(() => ({} as { status?: string; note?: string; action?: string })); const db = getDb(c.env.DB); const flag = await db.select().from(schema.fileFlags).where(eq(schema.fileFlags.id, id)).get(); if (!flag) return c.json({ error: "not found" }, 404); if (body.action === "revoke" && flag.fileId) await db.update(schema.files).set({ shareToken: null, sharePassword: null }).where(eq(schema.files.id, flag.fileId)).run(); if (body.action === "expire" && flag.fileId) await db.update(schema.files).set({ expiresAt: nowSeconds() }).where(eq(schema.files.id, flag.fileId)).run(); if (body.action === "delete" && flag.fileId) await db.update(schema.files).set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null }).where(eq(schema.files.id, flag.fileId)).run(); const nextStatus = ["open", "investigating", "resolved", "dismissed"].includes(String(body.status)) ? String(body.status) : flag.status; await db.update(schema.fileFlags).set({ status: nextStatus, adminNote: body.note?.slice(0, 2000) ?? flag.adminNote ?? null, resolvedAt: ["resolved", "dismissed"].includes(nextStatus) ? nowSeconds() : null }).where(eq(schema.fileFlags.id, id)).run(); await logAction(c, db, "flag.update", "flag", id, `${nextStatus}${body.action ? " / " + body.action : ""}`); return c.json({ ok: true }) })
admin.post("/flags/:id/resolve", async (c) => { const denied = await forbidUnlessCan(c, "manageFlags"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); await db.update(schema.fileFlags).set({ status: "resolved", resolvedAt: nowSeconds() }).where(eq(schema.fileFlags.id, id)).run(); await logAction(c, db, "flag.resolve", "flag", id, null); return c.json({ ok: true }) })
admin.delete("/flags/:id", async (c) => { const denied = await forbidUnlessCan(c, "manageFlags"); if (denied) return denied; const id = c.req.param("id"); const db = getDb(c.env.DB); await db.delete(schema.fileFlags).where(eq(schema.fileFlags.id, id)).run(); await logAction(c, db, "flag.delete", "flag", id, null); return c.json({ ok: true }) })

admin.get("/admins", async (c) => { const db = getDb(c.env.DB); const envSet = adminEmailSet(c.env); const dbRows = await db.select().from(schema.adminEmails).all(); const admins = [...Array.from(envSet, (email) => ({ email, role: "owner" as const, source: "env" as const, addedBy: null as string | null, createdAt: null as number | null })), ...dbRows.filter((r) => !envSet.has(r.email.toLowerCase())).map((r) => ({ email: r.email, role: normalizeAdminRole(r.role), source: "db" as const, addedBy: r.addedBy ?? null, createdAt: r.createdAt as number | null }))]; return c.json({ admins }) })
admin.post("/admins", async (c) => { const denied = await forbidUnless(c, "owner"); if (denied) return denied; const body = await c.req.json<{ email?: string; role?: AdminRole }>().catch(() => ({} as { email?: string; role?: AdminRole })); const email = String(body.email ?? "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid email" }, 400); const role = normalizeAdminRole(body.role); const db = getDb(c.env.DB); if (adminEmailSet(c.env).has(email)) return c.json({ error: "already configured via ADMIN_EMAILS" }, 400); await db.delete(schema.adminEmails).where(eq(schema.adminEmails.email, email)).run().catch(() => {}); await db.insert(schema.adminEmails).values({ email, role, addedBy: c.get("userEmail") ?? null, createdAt: nowSeconds() }).run(); await logAction(c, db, "admin.add", "admin", email, role); return c.json({ ok: true }) })
admin.delete("/admins/:email", async (c) => { const denied = await forbidUnless(c, "owner"); if (denied) return denied; const email = decodeURIComponent(c.req.param("email")).toLowerCase(); if (adminEmailSet(c.env).has(email)) return c.json({ error: "managed via ADMIN_EMAILS config" }, 400); const db = getDb(c.env.DB); await db.delete(schema.adminEmails).where(eq(schema.adminEmails.email, email)).run(); await logAction(c, db, "admin.remove", "admin", email, null); return c.json({ ok: true }) })
admin.get("/settings", async (c) => { const db = getDb(c.env.DB); return c.json({ settings: await settingsMap(db) }) })
admin.post("/settings", async (c) => { const denied = await forbidUnless(c, "owner"); if (denied) return denied; const body = await c.req.json<SettingsBody>().catch(() => ({} as SettingsBody)); const db = getDb(c.env.DB); for (const key of settingsKeys) { if (!(key in body)) continue; let value = String(body[key] ?? ""); if (key === "signupMode") value = value === "approval" ? "approval" : "open"; await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run().catch(() => {}); await db.insert(schema.appSettings).values({ key, value, updatedBy: c.get("userEmail"), updatedAt: nowSeconds() }).run() } await logAction(c, db, "settings.update", "settings", null, settingsKeys.filter((key) => key in body).join(", ")); return c.json({ ok: true, settings: await settingsMap(db) }) })
admin.get("/audit", async (c) => { const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500); const actor = c.req.query("actor")?.toLowerCase(); const action = c.req.query("action"); const targetType = c.req.query("targetType"); const db = getDb(c.env.DB); let rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(limit).all(); if (actor) rows = rows.filter((r) => (r.actorEmail ?? "").toLowerCase().includes(actor)); if (action) rows = rows.filter((r) => r.action === action); if (targetType) rows = rows.filter((r) => r.targetType === targetType); return c.json({ entries: rows.map((r) => ({ id: r.id, actorEmail: r.actorEmail, action: r.action, targetType: r.targetType, targetId: r.targetId, detail: r.detail, createdAt: r.createdAt })) }) })

admin.get("/limit-requests", async (c) => {
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.uploadLimitRequests).orderBy(desc(schema.uploadLimitRequests.createdAt)).all().catch(() => [])
  const users = await db.select().from(schema.user).all()
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  return c.json({ requests: rows.map((r) => ({ ...r, userEmail: emailById.get(r.userId) ?? null })) })
})
admin.post("/limit-requests/:id/approve", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers")
  if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const req = await db.select().from(schema.uploadLimitRequests).where(eq(schema.uploadLimitRequests.id, id)).get()
  if (!req || req.status !== "pending") return c.json({ error: "not found or already handled" }, 404)
  await db.update(schema.uploadLimitRequests).set({ status: "approved", approvedBy: c.get("userEmail"), approvedAt: nowSeconds() }).where(eq(schema.uploadLimitRequests.id, id)).run()
  await db.update(schema.user).set({ quotaBytes: req.requestedBytes }).where(eq(schema.user.id, req.userId)).run()
  await logAction(c, db, "limit_request.approve", "user", req.userId, `${req.requestedBytes} bytes`)
  return c.json({ ok: true })
})
admin.post("/limit-requests/:id/reject", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers")
  if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.update(schema.uploadLimitRequests).set({ status: "rejected", approvedBy: c.get("userEmail"), approvedAt: nowSeconds() }).where(eq(schema.uploadLimitRequests.id, id)).run()
  await logAction(c, db, "limit_request.reject", "user", id, null)
  return c.json({ ok: true })
})

export default admin
