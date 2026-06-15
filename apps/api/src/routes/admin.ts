import { Hono } from "hono"
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import { getDb, schema } from "../db"
import { clampExtension, DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import {
  adminEmailSet,
  adminRole,
  effectiveAdmins,
  hasRole,
  isAdminEmailDb,
  normalizeAdminRole,
  requireAdmin,
  type AdminRole,
} from "../middleware/admin"
import type { Bindings, Variables } from "../types"

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()
const ROLE_RANK: Record<AdminRole, number> = { viewer: 1, moderator: 2, admin: 3, owner: 4 }

admin.use("*", requireAuth)

admin.get("/access", async (c) => {
  const db = getDb(c.env.DB)
  const role = await adminRole(c.env, db, c.get("userEmail"))
  return c.json({ isAdmin: role != null, role })
})

admin.use("*", requireAdmin)

async function needRole(c: any, minimum: AdminRole) {
  const db = getDb(c.env.DB)
  return hasRole(c.env, db, c.get("userEmail"), minimum)
}

async function forbidUnless(c: any, minimum: AdminRole) {
  if (!(await needRole(c, minimum))) return c.json({ error: "forbidden" }, 403)
  return null
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

function dayKey(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

async function logAction(
  c: any,
  db: ReturnType<typeof getDb>,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: string | null,
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: c.get("userId") ?? null,
      actorEmail: c.get("userEmail") ?? null,
      action,
      targetType,
      targetId,
      detail,
      createdAt: nowSeconds(),
    }).run()
  } catch {}
}

async function logActivity(
  c: any,
  db: ReturnType<typeof getDb>,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: string | null,
  userId?: string | null,
): Promise<void> {
  try {
    await db.insert(schema.activityLog).values({
      id: crypto.randomUUID(),
      userId: userId ?? null,
      actorEmail: c.get("userEmail") ?? null,
      action,
      targetType,
      targetId,
      detail,
      ip: c.req.header("CF-Connecting-IP") ?? null,
      userAgent: c.req.header("User-Agent") ?? null,
      createdAt: nowSeconds(),
    }).run()
  } catch {}
}

function parseTags(raw: string | null): string[] {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

function fileRow(f: schema.FileRow, emailById: Map<string, string>, nameById: Map<string, string>) {
  return {
    id: f.id,
    filename: f.filename,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    status: f.status,
    shared: !!f.shareToken,
    shareToken: f.shareToken ?? null,
    folderId: f.folderId ?? null,
    favorite: !!f.favorite,
    tags: parseTags(f.tags ?? null),
    deletedAt: f.deletedAt ?? null,
    versionGroupId: f.versionGroupId ?? null,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    ownerId: f.ownerId,
    ownerEmail: emailById.get(f.ownerId) ?? null,
    ownerName: nameById.get(f.ownerId) ?? null,
  }
}

async function settingsMap(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const out: Record<string, string> = {
    defaultExpiryDays: "7",
    maxExpiryDays: "30",
    maxUploadBytes: "0",
    allowedTypes: "",
    defaultQuotaBytes: "0",
    requirePasswordForShares: "false",
    publicSharingEnabled: "true",
  }
  for (const r of rows) out[r.key] = r.value
  return out
}

admin.get("/stats", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, folders, openFlags, suspensions] = await Promise.all([
    db.select().from(schema.user).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.folders).all(),
    db.select().from(schema.fileFlags).where(eq(schema.fileFlags.status, "open")).all(),
    db.select().from(schema.userSuspensions).all().catch(() => []),
  ])
  const now = nowSeconds()
  const readyFiles = files.filter((f) => f.status === "ready" && !f.deletedAt)
  const pendingFiles = files.filter((f) => f.status === "pending")
  const deletedFiles = files.filter((f) => !!f.deletedAt)

  const typeMap = new Map<string, { count: number; bytes: number }>()
  for (const f of readyFiles) {
    const k = categoryOf(f.contentType)
    const e = typeMap.get(k) ?? { count: 0, bytes: 0 }
    e.count += 1
    e.bytes += f.sizeBytes || 0
    typeMap.set(k, e)
  }
  const typeBreakdown = Array.from(typeMap, ([category, v]) => ({ category, count: v.count, bytes: v.bytes })).sort((a, b) => b.bytes - a.bytes)

  const bytesByUser = new Map<string, number>()
  const countByUser = new Map<string, number>()
  for (const f of readyFiles) {
    bytesByUser.set(f.ownerId, (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0))
    countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1)
  }
  const nameById = new Map(users.map((u) => [u.id, u.name] as const))
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  const topUsers = Array.from(bytesByUser, ([id, bytes]) => ({
    id,
    name: nameById.get(id) ?? "Unknown",
    email: emailById.get(id) ?? null,
    totalBytes: bytes,
    fileCount: countByUser.get(id) ?? 0,
  })).sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 5)

  const keys: string[] = []
  const growthMap = new Map<string, { users: number; files: number; bytes: number }>()
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * 86400)
    keys.push(k)
    growthMap.set(k, { users: 0, files: 0, bytes: 0 })
  }
  for (const u of users) growthMap.get(dayKey(Math.floor(u.createdAt.getTime() / 1000)))?.users++
  for (const f of files) {
    const e = growthMap.get(dayKey(f.createdAt))
    if (e) {
      e.files += 1
      if (f.status === "ready") e.bytes += f.sizeBytes || 0
    }
  }
  const growth = keys.map((k) => ({ date: k, ...(growthMap.get(k) ?? { users: 0, files: 0, bytes: 0 }) }))
  const admins = await effectiveAdmins(c.env, db)

  const unlimitedLinks = readyFiles.filter((f) => f.shareToken && f.shareDownloadLimit == null).length
  const unprotectedLinks = readyFiles.filter((f) => f.shareToken && !f.sharePassword).length
  const largeFiles = readyFiles.filter((f) => f.sizeBytes > 100 * 1024 * 1024).length
  const inactiveCutoff = now - 30 * DAY_SECONDS
  const usersNearQuota = users.filter((u) => {
    if (u.quotaBytes == null || u.quotaBytes <= 0) return false
    return (bytesByUser.get(u.id) ?? 0) / u.quotaBytes >= 0.85
  }).length

  return c.json({
    userCount: users.length,
    fileCount: files.length,
    readyFileCount: readyFiles.length,
    pendingFileCount: pendingFiles.length,
    deletedFileCount: deletedFiles.length,
    folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    sharedFileCount: readyFiles.filter((f) => f.shareToken).length,
    sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS).length,
    flagCount: openFlags.length,
    adminCount: admins.size,
    suspendedUserCount: suspensions.length,
    typeBreakdown,
    topUsers,
    growth,
    alerts: [
      { id: "flags", label: "Open abuse reports", count: openFlags.length, level: openFlags.length ? "high" : "ok" },
      { id: "quota", label: "Users near quota", count: usersNearQuota, level: usersNearQuota ? "medium" : "ok" },
      { id: "unprotected", label: "Public links without passwords", count: unprotectedLinks, level: unprotectedLinks ? "medium" : "ok" },
      { id: "unlimited", label: "Public links with unlimited downloads", count: unlimitedLinks, level: unlimitedLinks ? "low" : "ok" },
      { id: "pending", label: "Stuck/pending uploads", count: pendingFiles.filter((f) => f.createdAt < now - 3600).length, level: "low" },
      { id: "large", label: "Large files", count: largeFiles, level: "low" },
      { id: "inactive", label: "Inactive users (30d+ no files)", count: users.filter((u) => !files.some((f) => f.ownerId === u.id && f.createdAt > inactiveCutoff)).length, level: "low" },
    ],
  })
})

admin.get("/users", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, admins, suspensions] = await Promise.all([
    db.select().from(schema.user).orderBy(desc(schema.user.createdAt)).all(),
    db.select().from(schema.files).all(),
    effectiveAdmins(c.env, db),
    db.select().from(schema.userSuspensions).all().catch(() => []),
  ])
  const suspended = new Set(suspensions.map((s) => s.userId))
  const countByUser = new Map<string, number>()
  const bytesByUser = new Map<string, number>()
  for (const f of files.filter((x) => !x.deletedAt)) {
    countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1)
    if (f.status === "ready") bytesByUser.set(f.ownerId, (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0))
  }
  return c.json({ users: users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    createdAt: Math.floor(u.createdAt.getTime() / 1000),
    fileCount: countByUser.get(u.id) ?? 0,
    totalBytes: bytesByUser.get(u.id) ?? 0,
    quotaBytes: u.quotaBytes ?? null,
    isAdmin: admins.has(u.email.toLowerCase()),
    role: admins.get(u.email.toLowerCase()) ?? null,
    suspended: suspended.has(u.id),
  })) })
})

admin.get("/users/:id", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get()
  if (!u) return c.json({ error: "not found" }, 404)
  const [files, allUsers, admins, suspension, activity] = await Promise.all([
    db.select().from(schema.files).where(eq(schema.files.ownerId, id)).orderBy(desc(schema.files.createdAt)).all(),
    db.select().from(schema.user).all(),
    effectiveAdmins(c.env, db),
    db.select().from(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).get().catch(() => null),
    db.select().from(schema.activityLog).where(eq(schema.activityLog.userId, id)).orderBy(desc(schema.activityLog.createdAt)).limit(50).all().catch(() => []),
  ])
  const emailById = new Map(allUsers.map((x) => [x.id, x.email] as const))
  const nameById = new Map(allUsers.map((x) => [x.id, x.name] as const))
  const ready = files.filter((f) => f.status === "ready" && !f.deletedAt)
  return c.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: Math.floor(u.createdAt.getTime() / 1000),
      fileCount: files.filter((f) => !f.deletedAt).length,
      totalBytes: ready.reduce((s, f) => s + (f.sizeBytes || 0), 0),
      quotaBytes: u.quotaBytes ?? null,
      isAdmin: admins.has(u.email.toLowerCase()),
      role: admins.get(u.email.toLowerCase()) ?? null,
      suspended: !!suspension,
      suspensionReason: suspension?.reason ?? null,
    },
    files: files.map((f) => fileRow(f, emailById, nameById)),
    activity,
  })
})

admin.post("/users/:id/quota", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const body = await c.req.json<{ bytes?: number | null }>().catch(() => ({} as { bytes?: number | null }))
  const db = getDb(c.env.DB)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get()
  if (!u) return c.json({ error: "not found" }, 404)
  let bytes: number | null = null
  if (body.bytes != null) {
    const n = Math.floor(Number(body.bytes))
    if (!Number.isFinite(n) || n < 0) return c.json({ error: "bytes must be >= 0" }, 400)
    bytes = n
  }
  await db.update(schema.user).set({ quotaBytes: bytes }).where(eq(schema.user.id, id)).run()
  await logAction(c, db, "user.quota", "user", id, bytes == null ? "cleared quota" : `quota=${bytes} bytes`)
  return c.json({ ok: true, quotaBytes: bytes })
})

admin.post("/users/:id/suspend", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }))
  const db = getDb(c.env.DB)
  await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run().catch(() => {})
  await db.insert(schema.userSuspensions).values({ userId: id, reason: body.reason?.slice(0, 500) ?? null, createdBy: c.get("userEmail"), createdAt: nowSeconds() }).run()
  await logAction(c, db, "user.suspend", "user", id, body.reason ?? null)
  return c.json({ ok: true })
})

admin.post("/users/:id/unsuspend", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.delete(schema.userSuspensions).where(eq(schema.userSuspensions.userId, id)).run()
  await logAction(c, db, "user.unsuspend", "user", id, null)
  return c.json({ ok: true })
})

admin.post("/users/bulk", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const body = await c.req.json<{ action?: string; ids?: string[]; quotaBytes?: number | null }>().catch(() => ({} as any))
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : []
  const db = getDb(c.env.DB)
  if (!ids.length) return c.json({ error: "no ids" }, 400)
  if (body.action === "setQuota") {
    const bytes = body.quotaBytes == null ? null : Math.max(0, Math.floor(Number(body.quotaBytes)))
    for (const id of ids) await db.update(schema.user).set({ quotaBytes: bytes }).where(eq(schema.user.id, id)).run()
  } else if (body.action === "revokeLinks") {
    for (const id of ids) await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.ownerId, id)).run()
  } else if (body.action === "expireFiles") {
    for (const id of ids) await db.update(schema.files).set({ expiresAt: nowSeconds() }).where(eq(schema.files.ownerId, id)).run()
  } else {
    return c.json({ error: "bad action" }, 400)
  }
  await logAction(c, db, `user.bulk.${body.action}`, "user", null, `${ids.length} users`)
  return c.json({ ok: true, count: ids.length })
})

admin.get("/files", async (c) => {
  const db = getDb(c.env.DB)
  const [files, users] = await Promise.all([
    db.select().from(schema.files).orderBy(desc(schema.files.createdAt)).all(),
    db.select().from(schema.user).all(),
  ])
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  const nameById = new Map(users.map((u) => [u.id, u.name] as const))
  return c.json({ files: files.map((f) => fileRow(f, emailById, nameById)) })
})

admin.get("/activity", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500)
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.createdAt)).limit(limit).all().catch(() => [])
  return c.json({ entries: rows })
})

admin.post("/files/:id/revoke", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.revoke", "file", id, row.filename)
  return c.json({ ok: true })
})

admin.post("/files/:id/extend", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const body = await c.req.json<{ days?: number }>().catch(() => ({} as { days?: number }))
  const days = Math.max(Number(body.days) || 0, 0)
  if (days <= 0) return c.json({ error: "days must be positive" }, 400)
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const expiresAt = clampExtension(c.env, row.createdAt, Math.max(row.expiresAt, nowSeconds()) + Math.round(days * DAY_SECONDS))
  await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.extend", "file", id, `${row.filename} +${days}d`)
  return c.json({ ok: true, expiresAt })
})

admin.post("/files/:id/expire", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const expiresAt = nowSeconds()
  await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.expire", "file", id, row.filename)
  return c.json({ ok: true, expiresAt })
})

admin.delete("/files/:id", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.trash", "file", id, row.filename)
  return c.json({ ok: true })
})

admin.post("/files/:id/delete-permanent", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  try { await c.env.FILES.delete(row.r2Key) } catch {}
  await db.delete(schema.files).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.delete", "file", id, row.filename)
  return c.json({ ok: true })
})

admin.post("/files/:id/restore", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.restore", "file", id, null)
  return c.json({ ok: true })
})

admin.post("/files/bulk", async (c) => {
  const denied = await forbidUnless(c, "admin"); if (denied) return denied
  const body = await c.req.json<{ action?: string; ids?: string[]; days?: number }>().catch(() => ({} as any))
  const action = String(body.action ?? "")
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : []
  if (!ids.length) return c.json({ error: "no ids" }, 400)
  if (!["revoke", "delete", "expire", "extend", "restore", "permanentDelete"].includes(action)) return c.json({ error: "bad action" }, 400)
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files).where(inArray(schema.files.id, ids)).all()
  const now = nowSeconds()
  for (const row of rows) {
    if (action === "revoke") await db.update(schema.files).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "expire") await db.update(schema.files).set({ expiresAt: now }).where(eq(schema.files.id, row.id)).run()
    else if (action === "extend") await db.update(schema.files).set({ expiresAt: clampExtension(c.env, row.createdAt, Math.max(row.expiresAt, now) + Math.round((body.days || 7) * DAY_SECONDS)) }).where(eq(schema.files.id, row.id)).run()
    else if (action === "delete") await db.update(schema.files).set({ deletedAt: now, shareToken: null, sharePassword: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "restore") await db.update(schema.files).set({ deletedAt: null }).where(eq(schema.files.id, row.id)).run()
    else if (action === "permanentDelete") { try { await c.env.FILES.delete(row.r2Key) } catch {}; await db.delete(schema.files).where(eq(schema.files.id, row.id)).run() }
  }
  await logAction(c, db, `file.bulk.${action}`, "file", null, `${rows.length} files`)
  return c.json({ ok: true, count: rows.length })
})

admin.get("/flags", async (c) => {
  const status = c.req.query("status")
  const db = getDb(c.env.DB)
  const [flags, files, users] = await Promise.all([db.select().from(schema.fileFlags).orderBy(desc(schema.fileFlags.createdAt)).all(), db.select().from(schema.files).all(), db.select().from(schema.user).all()])
  const fileById = new Map(files.map((f) => [f.id, f] as const))
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  const filtered = status ? flags.filter((f) => f.status === status) : flags
  return c.json({ flags: filtered.map((fl) => {
    const file = fl.fileId ? fileById.get(fl.fileId) : undefined
    return { id: fl.id, fileId: fl.fileId, token: fl.token, reason: fl.reason, reporterEmail: fl.reporterEmail, status: fl.status, adminNote: fl.adminNote ?? null, createdAt: fl.createdAt, resolvedAt: fl.resolvedAt, filename: file?.filename ?? null, ownerEmail: file ? emailById.get(file.ownerId) ?? null : null, fileExists: !!file }
  }) })
})

admin.post("/flags/:id", async (c) => {
  const denied = await forbidUnless(c, "moderator"); if (denied) return denied
  const id = c.req.param("id")
  const body = await c.req.json<{ status?: string; note?: string; action?: string }>().catch(() => ({} as any))
  const db = getDb(c.env.DB)
  const flag = await db.select().from(schema.fileFlags).where(eq(schema.fileFlags.id, id)).get()
  if (!flag) return c.json({ error: "not found" }, 404)
  if (body.action === "revoke" && flag.fileId) await db.update(schema.files).set({ shareToken: null, sharePassword: null }).where(eq(schema.files.id, flag.fileId)).run()
  if (body.action === "expire" && flag.fileId) await db.update(schema.files).set({ expiresAt: nowSeconds() }).where(eq(schema.files.id, flag.fileId)).run()
  if (body.action === "delete" && flag.fileId) await db.update(schema.files).set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null }).where(eq(schema.files.id, flag.fileId)).run()
  const status = ["open", "investigating", "resolved", "dismissed"].includes(String(body.status)) ? String(body.status) : flag.status
  await db.update(schema.fileFlags).set({ status, adminNote: body.note?.slice(0, 2000) ?? flag.adminNote ?? null, resolvedAt: ["resolved", "dismissed"].includes(status) ? nowSeconds() : null }).where(eq(schema.fileFlags.id, id)).run()
  await logAction(c, db, "flag.update", "flag", id, `${status}${body.action ? " / " + body.action : ""}`)
  return c.json({ ok: true })
})

admin.post("/flags/:id/resolve", async (c) => {
  const denied = await forbidUnless(c, "moderator"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.update(schema.fileFlags).set({ status: "resolved", resolvedAt: nowSeconds() }).where(eq(schema.fileFlags.id, id)).run()
  await logAction(c, db, "flag.resolve", "flag", id, null)
  return c.json({ ok: true })
})

admin.delete("/flags/:id", async (c) => {
  const denied = await forbidUnless(c, "moderator"); if (denied) return denied
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.delete(schema.fileFlags).where(eq(schema.fileFlags.id, id)).run()
  await logAction(c, db, "flag.delete", "flag", id, null)
  return c.json({ ok: true })
})

admin.get("/admins", async (c) => {
  const db = getDb(c.env.DB)
  const envSet = adminEmailSet(c.env)
  const dbRows = await db.select().from(schema.adminEmails).all()
  const admins = [
    ...Array.from(envSet, (email) => ({ email, role: "owner", source: "env", addedBy: null as string | null, createdAt: null as number | null })),
    ...dbRows.filter((r) => !envSet.has(r.email.toLowerCase())).map((r) => ({ email: r.email, role: normalizeAdminRole(r.role), source: "db", addedBy: r.addedBy ?? null, createdAt: r.createdAt as number | null })),
  ]
  return c.json({ admins })
})

admin.post("/admins", async (c) => {
  const denied = await forbidUnless(c, "owner"); if (denied) return denied
  const body = await c.req.json<{ email?: string; role?: AdminRole }>().catch(() => ({} as any))
  const email = String(body.email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid email" }, 400)
  const role = normalizeAdminRole(body.role)
  const db = getDb(c.env.DB)
  if (adminEmailSet(c.env).has(email)) return c.json({ error: "already configured via ADMIN_EMAILS" }, 400)
  await db.delete(schema.adminEmails).where(eq(schema.adminEmails.email, email)).run().catch(() => {})
  await db.insert(schema.adminEmails).values({ email, role, addedBy: c.get("userEmail") ?? null, createdAt: nowSeconds() }).run()
  await logAction(c, db, "admin.add", "admin", email, role)
  return c.json({ ok: true })
})

admin.delete("/admins/:email", async (c) => {
  const denied = await forbidUnless(c, "owner"); if (denied) return denied
  const email = decodeURIComponent(c.req.param("email")).toLowerCase()
  if (adminEmailSet(c.env).has(email)) return c.json({ error: "managed via ADMIN_EMAILS config" }, 400)
  const db = getDb(c.env.DB)
  await db.delete(schema.adminEmails).where(eq(schema.adminEmails.email, email)).run()
  await logAction(c, db, "admin.remove", "admin", email, null)
  return c.json({ ok: true })
})

admin.get("/settings", async (c) => {
  const db = getDb(c.env.DB)
  return c.json({ settings: await settingsMap(db) })
})

admin.post("/settings", async (c) => {
  const denied = await forbidUnless(c, "owner"); if (denied) return denied
  const body = await c.req.json<Record<string, string | number | boolean | null>>().catch(() => ({}))
  const db = getDb(c.env.DB)
  const allowed = ["defaultExpiryDays", "maxExpiryDays", "maxUploadBytes", "allowedTypes", "defaultQuotaBytes", "requirePasswordForShares", "publicSharingEnabled"]
  for (const key of allowed) {
    if (!(key in body)) continue
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run().catch(() => {})
    await db.insert(schema.appSettings).values({ key, value: String(body[key] ?? ""), updatedBy: c.get("userEmail"), updatedAt: nowSeconds() }).run()
  }
  await logAction(c, db, "settings.update", "settings", null, allowed.filter((k) => k in body).join(", "))
  return c.json({ ok: true, settings: await settingsMap(db) })
})

admin.get("/audit", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500)
  const actor = c.req.query("actor")?.toLowerCase()
  const action = c.req.query("action")
  const targetType = c.req.query("targetType")
  const db = getDb(c.env.DB)
  let rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(limit).all()
  if (actor) rows = rows.filter((r) => (r.actorEmail ?? "").toLowerCase().includes(actor))
  if (action) rows = rows.filter((r) => r.action === action)
  if (targetType) rows = rows.filter((r) => r.targetType === targetType)
  return c.json({ entries: rows.map((r) => ({ id: r.id, actorEmail: r.actorEmail, action: r.action, targetType: r.targetType, targetId: r.targetId, detail: r.detail, createdAt: r.createdAt })) })
})

export default admin
