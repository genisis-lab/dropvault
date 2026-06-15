import { Hono } from "hono"
import { desc, eq, inArray } from "drizzle-orm"
import { getDb, schema } from "../db"
import { clampExtension, DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import { adminEmailSet, effectiveAdminSet, isAdminEmailDb, requireAdmin } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Everything here needs a valid session.
admin.use("*", requireAuth)

// Any authenticated user may check whether THEY are an admin. Not gated by
// requireAdmin, so non-admins get { isAdmin: false } rather than a 403.
admin.get("/access", async (c) => {
  const db = getDb(c.env.DB)
  return c.json({ isAdmin: await isAdminEmailDb(c.env, db, c.get("userEmail")) })
})

// Everything below is admin-only.
admin.use("*", requireAdmin)

// Group a MIME type into a coarse category for the storage breakdown.
function categoryOf(type: string | null): string {
  if (!type) return "other"
  if (type.startsWith("image/")) return "images"
  if (type.startsWith("video/")) return "videos"
  if (type.startsWith("audio/")) return "audio"
  if (type.includes("pdf")) return "pdf"
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return "archives"
  return "other"
}

// UTC YYYY-MM-DD bucket key for an epoch-second timestamp.
function dayKey(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

// Append an entry to the audit log. Never throws (best-effort).
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

// Shape a file row for the admin UI (includes the share token so admins can open the link).
function fileRow(f: schema.FileRow, emailById: Map<string, string>, nameById: Map<string, string>) {
  return {
    id: f.id,
    filename: f.filename,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    status: f.status,
    shared: !!f.shareToken,
    shareToken: f.shareToken ?? null,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    ownerId: f.ownerId,
    ownerEmail: emailById.get(f.ownerId) ?? null,
    ownerName: nameById.get(f.ownerId) ?? null,
  }
}

// Workspace-wide totals, storage breakdown by type, top users, daily growth,
// open-flag and admin counts.
admin.get("/stats", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, folders, openFlags] = await Promise.all([
    db.select().from(schema.user).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.folders).all(),
    db.select().from(schema.fileFlags).where(eq(schema.fileFlags.status, "open")).all(),
  ])
  const now = nowSeconds()
  const readyFiles = files.filter((f) => f.status === "ready")

  const typeMap = new Map<string, { count: number; bytes: number }>()
  for (const f of readyFiles) {
    const k = categoryOf(f.contentType)
    const e = typeMap.get(k) ?? { count: 0, bytes: 0 }
    e.count += 1
    e.bytes += f.sizeBytes || 0
    typeMap.set(k, e)
  }
  const typeBreakdown = Array.from(typeMap, ([category, v]) => ({ category, count: v.count, bytes: v.bytes })).sort(
    (a, b) => b.bytes - a.bytes,
  )

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
  }))
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 5)

  // Daily growth for the last 30 days (users joined, files uploaded, bytes added).
  const DAYS = 30
  const keys: string[] = []
  const growthMap = new Map<string, { users: number; files: number; bytes: number }>()
  for (let i = DAYS - 1; i >= 0; i--) {
    const k = dayKey(now - i * 86400)
    keys.push(k)
    growthMap.set(k, { users: 0, files: 0, bytes: 0 })
  }
  for (const u of users) {
    const e = growthMap.get(dayKey(Math.floor(u.createdAt.getTime() / 1000)))
    if (e) e.users += 1
  }
  for (const f of files) {
    const e = growthMap.get(dayKey(f.createdAt))
    if (e) {
      e.files += 1
      if (f.status === "ready") e.bytes += f.sizeBytes || 0
    }
  }
  const growth = keys.map((k) => {
    const e = growthMap.get(k) ?? { users: 0, files: 0, bytes: 0 }
    return { date: k, users: e.users, files: e.files, bytes: e.bytes }
  })

  const adminSet = await effectiveAdminSet(c.env, db)

  return c.json({
    userCount: users.length,
    fileCount: files.length,
    readyFileCount: readyFiles.length,
    folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    sharedFileCount: files.filter((f) => f.shareToken).length,
    sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS).length,
    flagCount: openFlags.length,
    adminCount: adminSet.size,
    typeBreakdown,
    topUsers,
    growth,
  })
})

// All users, each with their live file count, storage footprint, and quota.
admin.get("/users", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files] = await Promise.all([
    db.select().from(schema.user).orderBy(desc(schema.user.createdAt)).all(),
    db.select().from(schema.files).all(),
  ])
  const adminSet = await effectiveAdminSet(c.env, db)
  const countByUser = new Map<string, number>()
  const bytesByUser = new Map<string, number>()
  for (const f of files) {
    countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1)
    if (f.status === "ready") {
      bytesByUser.set(f.ownerId, (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0))
    }
  }
  const rows = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    createdAt: Math.floor(u.createdAt.getTime() / 1000),
    fileCount: countByUser.get(u.id) ?? 0,
    totalBytes: bytesByUser.get(u.id) ?? 0,
    quotaBytes: u.quotaBytes ?? null,
    isAdmin: adminSet.has(u.email.toLowerCase()),
  }))
  return c.json({ users: rows })
})

// One user with their files (drill-down).
admin.get("/users/:id", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const u = await db.select().from(schema.user).where(eq(schema.user.id, id)).get()
  if (!u) return c.json({ error: "not found" }, 404)
  const [files, allUsers] = await Promise.all([
    db.select().from(schema.files).where(eq(schema.files.ownerId, id)).orderBy(desc(schema.files.createdAt)).all(),
    db.select().from(schema.user).all(),
  ])
  const emailById = new Map(allUsers.map((x) => [x.id, x.email] as const))
  const nameById = new Map(allUsers.map((x) => [x.id, x.name] as const))
  const adminSet = await effectiveAdminSet(c.env, db)
  const ready = files.filter((f) => f.status === "ready")
  return c.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: Math.floor(u.createdAt.getTime() / 1000),
      fileCount: files.length,
      totalBytes: ready.reduce((s, f) => s + (f.sizeBytes || 0), 0),
      quotaBytes: u.quotaBytes ?? null,
      isAdmin: adminSet.has(u.email.toLowerCase()),
    },
    files: files.map((f) => fileRow(f, emailById, nameById)),
  })
})

// Set or clear a user's storage quota (bytes). Pass bytes=null to clear.
admin.post("/users/:id/quota", async (c) => {
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

// All files across every user, newest first.
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

// --- Admin write actions on ANY file (not just the caller's own) -----------

// Revoke a file's public share link and clear its link options.
admin.post("/files/:id/revoke", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db
    .update(schema.files)
    .set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null })
    .where(eq(schema.files.id, id))
    .run()
  await logAction(c, db, "file.revoke", "file", id, row.filename)
  return c.json({ ok: true })
})

// Extend a file's expiry by N days (clamped to the max lifetime).
admin.post("/files/:id/extend", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ days?: number }>().catch(() => ({} as { days?: number }))
  const days = Math.max(Number(body.days) || 0, 0)
  if (days <= 0) return c.json({ error: "days must be positive" }, 400)
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const base = Math.max(row.expiresAt, nowSeconds())
  const expiresAt = clampExtension(c.env, row.createdAt, base + Math.round(days * DAY_SECONDS))
  await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.extend", "file", id, `${row.filename} +${days}d`)
  return c.json({ ok: true, expiresAt })
})

// Force-expire a file now (set expiry to now; the sweep reclaims the bytes).
admin.post("/files/:id/expire", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const expiresAt = nowSeconds()
  await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.expire", "file", id, row.filename)
  return c.json({ ok: true, expiresAt })
})

// Delete any file now (removes the R2 object and the DB row).
admin.delete("/files/:id", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.id, id)).get()
  if (!row) return c.json({ error: "not found" }, 404)
  try {
    await c.env.FILES.delete(row.r2Key)
  } catch {}
  await db.delete(schema.files).where(eq(schema.files.id, id)).run()
  await logAction(c, db, "file.delete", "file", id, row.filename)
  return c.json({ ok: true })
})

// Bulk action over many files at once: revoke | delete | expire | extend.
admin.post("/files/bulk", async (c) => {
  const body = await c.req
    .json<{ action?: string; ids?: string[]; days?: number }>()
    .catch(() => ({} as { action?: string; ids?: string[]; days?: number }))
  const action = String(body.action ?? "")
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : []
  if (ids.length === 0) return c.json({ error: "no ids" }, 400)
  if (!["revoke", "delete", "expire", "extend"].includes(action)) return c.json({ error: "bad action" }, 400)
  const days = Math.max(Number(body.days) || 0, 0)
  if (action === "extend" && days <= 0) return c.json({ error: "days must be positive" }, 400)

  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.files).where(inArray(schema.files.id, ids)).all()
  const now = nowSeconds()
  for (const row of rows) {
    if (action === "revoke") {
      await db
        .update(schema.files)
        .set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null })
        .where(eq(schema.files.id, row.id))
        .run()
    } else if (action === "expire") {
      await db.update(schema.files).set({ expiresAt: now }).where(eq(schema.files.id, row.id)).run()
    } else if (action === "extend") {
      const base = Math.max(row.expiresAt, now)
      const expiresAt = clampExtension(c.env, row.createdAt, base + Math.round(days * DAY_SECONDS))
      await db.update(schema.files).set({ expiresAt }).where(eq(schema.files.id, row.id)).run()
    } else if (action === "delete") {
      try {
        await c.env.FILES.delete(row.r2Key)
      } catch {}
      await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    }
  }
  await logAction(c, db, `file.bulk.${action}`, "file", null, `${rows.length} files${action === "extend" ? ` +${days}d` : ""}`)
  return c.json({ ok: true, count: rows.length })
})

// --- Abuse flags -----------------------------------------------------------

// List flags (optionally filtered by status), enriched with file + owner info.
admin.get("/flags", async (c) => {
  const status = c.req.query("status")
  const db = getDb(c.env.DB)
  const [flags, files, users] = await Promise.all([
    db.select().from(schema.fileFlags).orderBy(desc(schema.fileFlags.createdAt)).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.user).all(),
  ])
  const fileById = new Map(files.map((f) => [f.id, f] as const))
  const emailById = new Map(users.map((u) => [u.id, u.email] as const))
  const filtered = status ? flags.filter((f) => f.status === status) : flags
  const rows = filtered.map((fl) => {
    const file = fl.fileId ? fileById.get(fl.fileId) : undefined
    return {
      id: fl.id,
      fileId: fl.fileId,
      token: fl.token,
      reason: fl.reason,
      reporterEmail: fl.reporterEmail,
      status: fl.status,
      createdAt: fl.createdAt,
      resolvedAt: fl.resolvedAt,
      filename: file?.filename ?? null,
      ownerEmail: file ? emailById.get(file.ownerId) ?? null : null,
      fileExists: !!file,
    }
  })
  return c.json({ flags: rows })
})

// Resolve a flag (mark reviewed).
admin.post("/flags/:id/resolve", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.update(schema.fileFlags).set({ status: "resolved", resolvedAt: nowSeconds() }).where(eq(schema.fileFlags.id, id)).run()
  await logAction(c, db, "flag.resolve", "flag", id, null)
  return c.json({ ok: true })
})

// Dismiss/delete a flag.
admin.delete("/flags/:id", async (c) => {
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  await db.delete(schema.fileFlags).where(eq(schema.fileFlags.id, id)).run()
  await logAction(c, db, "flag.delete", "flag", id, null)
  return c.json({ ok: true })
})

// --- Admin allowlist management --------------------------------------------

// List effective admins. Env-allowlisted ones are read-only (source: env).
admin.get("/admins", async (c) => {
  const db = getDb(c.env.DB)
  const envSet = adminEmailSet(c.env)
  const dbRows = await db.select().from(schema.adminEmails).all()
  const admins = [
    ...Array.from(envSet, (email) => ({ email, source: "env", addedBy: null as string | null, createdAt: null as number | null })),
    ...dbRows
      .filter((r) => !envSet.has(r.email.toLowerCase()))
      .map((r) => ({ email: r.email, source: "db", addedBy: r.addedBy ?? null, createdAt: r.createdAt as number | null })),
  ]
  return c.json({ admins })
})

// Grant admin to an email (DB-managed).
admin.post("/admins", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }))
  const email = String(body.email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid email" }, 400)
  const db = getDb(c.env.DB)
  if (adminEmailSet(c.env).has(email)) return c.json({ error: "already configured via ADMIN_EMAILS" }, 400)
  await db.insert(schema.adminEmails).values({ email, addedBy: c.get("userEmail") ?? null, createdAt: nowSeconds() }).onConflictDoNothing().run()
  await logAction(c, db, "admin.add", "admin", email, null)
  return c.json({ ok: true })
})

// Revoke a DB-managed admin. Env-allowlisted admins cannot be removed here.
admin.delete("/admins/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase()
  if (adminEmailSet(c.env).has(email)) return c.json({ error: "managed via ADMIN_EMAILS config" }, 400)
  const db = getDb(c.env.DB)
  await db.delete(schema.adminEmails).where(eq(schema.adminEmails.email, email)).run()
  await logAction(c, db, "admin.remove", "admin", email, null)
  return c.json({ ok: true })
})

// --- Audit log -------------------------------------------------------------

admin.get("/audit", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500)
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(limit).all()
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
      createdAt: r.createdAt,
    })),
  })
})

export default admin
