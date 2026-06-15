import { Hono } from "hono"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { sha256Hex } from "../lib/hash"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

type ShareBody = { password?: string | null; downloadLimit?: number | null; expiresInDays?: number | null }
const folders = new Hono<{ Bindings: Bindings; Variables: Variables }>()
folders.use("*", requireAuth)

async function sharePolicy(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const map = new Map(rows.map((r) => [r.key, r.value] as const))
  return { requirePassword: map.get("requirePasswordForShares") === "true", enabled: map.get("publicSharingEnabled") !== "false" }
}

folders.get("/", async (c) => {
  const userId = c.get("userId")
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.folders).where(eq(schema.folders.ownerId, userId)).orderBy(desc(schema.folders.createdAt)).all()
  const live = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds()), isNull(schema.files.deletedAt))).all()
  const counts = new Map<string, number>()
  for (const f of live) if (f.folderId) counts.set(f.folderId, (counts.get(f.folderId) ?? 0) + 1)
  return c.json({ folders: rows.map(({ sharePassword, ...r }) => ({ ...r, fileCount: counts.get(r.id) ?? 0, shareHasPassword: !!sharePassword })) })
})
folders.post("/", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const name = (body?.name ?? "").trim() || "Untitled folder"
  const id = crypto.randomUUID()
  const db = getDb(c.env.DB)
  await db.insert(schema.folders).values({ id, ownerId: userId, name, createdAt: nowSeconds() }).run()
  return c.json({ id, name })
})
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
folders.post("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<ShareBody>().catch(() => ({} as ShareBody))
  const db = getDb(c.env.DB)
  const policy = await sharePolicy(db)
  if (!policy.enabled) return c.json({ error: "public sharing is disabled" }, 403)
  if (policy.requirePassword && !body.password) return c.json({ error: "password required by workspace policy" }, 400)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "")
  const update: Record<string, unknown> = { shareToken: token }
  const hasOptions = "password" in body || "downloadLimit" in body || "expiresInDays" in body
  if (hasOptions) { update.sharePassword = body.password ? await sha256Hex(String(body.password)) : null; update.shareDownloadLimit = typeof body.downloadLimit === "number" && body.downloadLimit > 0 ? Math.floor(body.downloadLimit) : null; update.shareExpiresAt = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? nowSeconds() + Math.round(body.expiresInDays * DAY_SECONDS) : null; update.shareDownloadCount = 0 }
  await db.update(schema.folders).set(update).where(eq(schema.folders.id, id)).run()
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/folder/${token}`, hasPassword: hasOptions ? !!body.password : !!row.sharePassword, downloadLimit: hasOptions ? (update.shareDownloadLimit as number | null) : row.shareDownloadLimit ?? null, shareExpiresAt: hasOptions ? (update.shareExpiresAt as number | null) : row.shareExpiresAt ?? null })
})
folders.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.folders).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null }).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true })
})
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
