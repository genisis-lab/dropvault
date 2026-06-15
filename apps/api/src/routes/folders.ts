import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { sha256Hex } from "../lib/hash"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const folders = new Hono<{ Bindings: Bindings; Variables: Variables }>()

folders.use("*", requireAuth)

// List the current user's folders, each with a live (ready + non-expired) file count.
// The share password hash is stripped; only a boolean is exposed to the client.
folders.get("/", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.folders)
    .where(eq(schema.folders.ownerId, userId))
    .orderBy(desc(schema.folders.createdAt))
    .all()

  const now = nowSeconds()
  const live = await db.select().from(schema.files)
    .where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, now)))
    .all()
  const counts = new Map<string, number>()
  for (const f of live) {
    if (f.folderId) counts.set(f.folderId, (counts.get(f.folderId) ?? 0) + 1)
  }

  const safe = rows.map(({ sharePassword, ...r }) => ({
    ...r,
    fileCount: counts.get(r.id) ?? 0,
    shareHasPassword: !!sharePassword,
  }))
  return c.json({ folders: safe })
})

// Create a folder.
folders.post("/", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const name = (body?.name ?? "").trim() || "Untitled folder"
  const id = crypto.randomUUID()
  const db = getDb(c.env.DB)
  await db.insert(schema.folders).values({ id, ownerId: userId, name, createdAt: nowSeconds() }).run()
  return c.json({ id, name })
})

// Rename a folder.
folders.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const name = (body?.name ?? "").trim()
  if (!name) return c.json({ error: "name required" }, 400)
  await db.update(schema.folders).set({ name }).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true, name })
})

// Create (or update) a public share link for a folder.
//   Body (all optional): { password, downloadLimit, expiresInDays }.
//     - password: non-empty string sets a password (stored hashed); null/"" clears it.
//     - downloadLimit: positive integer caps total downloads; null = unlimited.
//     - expiresInDays: positive number sets a link-specific expiry; null = no expiry.
//   When any option key is present we treat it as a full (re)configure and reset
//   the download counter. A bare call with no options just ensures a token exists.
folders.post("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req
    .json<{ password?: string | null; downloadLimit?: number | null; expiresInDays?: number | null }>()
    .catch(() => ({} as { password?: string | null; downloadLimit?: number | null; expiresInDays?: number | null }))
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)

  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "")
  const update: Record<string, unknown> = { shareToken: token }

  const hasOptions = body != null && ("password" in body || "downloadLimit" in body || "expiresInDays" in body)
  if (hasOptions) {
    update.sharePassword = body.password ? await sha256Hex(String(body.password)) : null
    update.shareDownloadLimit =
      typeof body.downloadLimit === "number" && body.downloadLimit > 0 ? Math.floor(body.downloadLimit) : null
    update.shareExpiresAt =
      typeof body.expiresInDays === "number" && body.expiresInDays > 0
        ? nowSeconds() + Math.round(body.expiresInDays * DAY_SECONDS)
        : null
    update.shareDownloadCount = 0
  }

  await db.update(schema.folders).set(update).where(eq(schema.folders.id, id)).run()

  const hasPassword = hasOptions ? !!body.password : !!row.sharePassword
  const downloadLimit = hasOptions ? (update.shareDownloadLimit as number | null) : row.shareDownloadLimit ?? null
  const shareExpiresAt = hasOptions ? (update.shareExpiresAt as number | null) : row.shareExpiresAt ?? null
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/folder/${token}`, hasPassword, downloadLimit, shareExpiresAt })
})

// Revoke a folder's public share link and clear its link options.
folders.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.folders)
    .set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null })
    .where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true })
})

// Delete a folder. Files inside move back to the root (folder_id = NULL); they are NOT deleted.
folders.delete("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ folderId: null }).where(and(eq(schema.files.folderId, id), eq(schema.files.ownerId, userId))).run()
  await db.delete(schema.folders).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true })
})

export default folders
