import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

const folders = new Hono<{ Bindings: Bindings; Variables: Variables }>()

folders.use("*", requireAuth)

// List the current user's folders, each with a live (ready + non-expired) file count.
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

  return c.json({ folders: rows.map((r) => ({ ...r, fileCount: counts.get(r.id) ?? 0 })) })
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

// Create (or return existing) a public share link for a folder.
folders.post("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "")
  if (!row.shareToken) {
    await db.update(schema.folders).set({ shareToken: token }).where(eq(schema.folders.id, id)).run()
  }
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/folder/${token}` })
})

// Revoke a folder's public share link.
folders.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.folders).set({ shareToken: null }).where(eq(schema.folders.id, id)).run()
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
