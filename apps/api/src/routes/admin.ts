import { Hono } from "hono"
import { desc } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
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

// Workspace-wide totals for the admin overview.
admin.get("/stats", async (c) => {
  const db = getDb(c.env.DB)
  const [users, files, folders] = await Promise.all([
    db.select().from(schema.user).all(),
    db.select().from(schema.files).all(),
    db.select().from(schema.folders).all(),
  ])
  const now = nowSeconds()
  const readyFiles = files.filter((f) => f.status === "ready")
  return c.json({
    userCount: users.length,
    fileCount: files.length,
    readyFileCount: readyFiles.length,
    folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    sharedFileCount: files.filter((f) => f.shareToken).length,
    sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS).length,
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

// All files across every user (read-only), newest first.
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

export default admin
