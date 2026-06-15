import { Hono } from "hono"
import { desc, eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { clampExtension, DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import { isAdminEmail, requireAdmin } from "../middleware/admin"
import type { Bindings, Variables } from "../types"

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Everything here needs a valid session.
admin.use("*", requireAuth)

// Any authenticated user may check whether THEY are an admin. This is what the
// web app uses to decide whether to show the admin UI, so it must NOT be gated
// by requireAdmin (non-admins get { isAdmin: false } rather than a 403).
admin.get("/access", (c) => c.json({ isAdmin: isAdminEmail(c.env, c.get("userEmail")) }))

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

// Workspace-wide totals for the admin overview, plus a storage breakdown by
// file type and the top users by storage footprint.
admin.get("/stats", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, folders] = await Promise.all([
    db.select().from(schema.user).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.folders).all(),
  ])
  const now = nowSeconds()
  const readyFiles = files.filter((f) => f.status === "ready")

  // Storage grouped by coarse file category (ready files only).
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

  // Top users by storage footprint.
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

  return c.json({
    userCount: users.length,
    fileCount: files.length,
    readyFileCount: readyFiles.length,
    folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    sharedFileCount: files.filter((f) => f.shareToken).length,
    sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS).length,
    typeBreakdown,
    topUsers,
  })
})

// All users, each with their live file count and storage footprint.
admin.get("/users", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files] = await Promise.all([
    db.select().from(schema.user).orderBy(desc(schema.user.createdAt)).all(),
    db.select().from(schema.files).all(),
  ])
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
    isAdmin: isAdminEmail(c.env, u.email),
  }))
  return c.json({ users: rows })
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
  const rows = files.map((f) => ({
    id: f.id,
    filename: f.filename,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    status: f.status,
    shared: !!f.shareToken,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    ownerId: f.ownerId,
    ownerEmail: emailById.get(f.ownerId) ?? null,
    ownerName: nameById.get(f.ownerId) ?? null,
  }))
  return c.json({ files: rows })
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
  return c.json({ ok: true })
})

export default admin
