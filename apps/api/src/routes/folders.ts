import { Hono } from "hono"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { getDb, schema } from "../db"
import { DAY_SECONDS, nowSeconds } from "../lib/expiry"
import { hashSecret } from "../lib/hash"
import { makeZip, zipResponse } from "../lib/zip"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

type ShareBody = {
  password?: string | null
  downloadLimit?: number | null
  expiresInDays?: number | null
  accessMode?: "download" | "preview" | "disabled"
  oneTime?: boolean
  allowlist?: string[] | string | null
  ipAllowlist?: string[] | string | null
  countryAllowlist?: string[] | string | null
}
const folders = new Hono<{ Bindings: Bindings; Variables: Variables }>()
folders.use("*", requireAuth)

async function sharePolicy(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(schema.appSettings).all().catch(() => [])
  const map = new Map(rows.map((r) => [r.key, r.value] as const))
  return { requirePassword: map.get("requirePasswordForShares") === "true", enabled: map.get("publicSharingEnabled") !== "false" }
}
function serializeList(input: unknown): string | null {
  if (input == null) return null
  const arr = Array.isArray(input) ? input : String(input).split(/[\n,]/)
  const values = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 100)
  return values.length ? JSON.stringify(Array.from(new Set(values))) : null
}
function accessMode(input: unknown): string { return ["download", "preview", "disabled"].includes(String(input)) ? String(input) : "download" }
async function childFolderIds(db: ReturnType<typeof getDb>, ownerId: string, rootId: string): Promise<string[]> {
  const all = await db.select().from(schema.folders).where(eq(schema.folders.ownerId, ownerId)).all()
  const out = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const f of all) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); changed = true }
  }
  return Array.from(out)
}

folders.get("/", async (c) => {
  const userId = c.get("userId")
  const parentId = c.req.query("parentId") ?? undefined
  const db = getDb(c.env.DB)
  const rows = await db.select().from(schema.folders).where(eq(schema.folders.ownerId, userId)).orderBy(desc(schema.folders.createdAt)).all()
  const live = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds()), isNull(schema.files.deletedAt))).all()
  const counts = new Map<string, number>()
  for (const f of live) if (f.folderId) counts.set(f.folderId, (counts.get(f.folderId) ?? 0) + 1)
  const filtered = parentId === undefined ? rows : rows.filter((r) => (r.parentId ?? "") === (parentId || ""))
  return c.json({ folders: filtered.map(({ sharePassword, ...r }) => ({ ...r, fileCount: counts.get(r.id) ?? 0, shareHasPassword: !!sharePassword })) })
})
folders.post("/", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json<{ name?: string; parentId?: string | null; color?: string | null }>().catch(() => ({} as { name?: string; parentId?: string | null; color?: string | null }))
  const name = (body?.name ?? "").trim() || "Untitled folder"
  const db = getDb(c.env.DB)
  let parentId: string | null = null
  if (body.parentId) {
    const parent = await db.select().from(schema.folders).where(and(eq(schema.folders.id, body.parentId), eq(schema.folders.ownerId, userId))).get()
    if (!parent) return c.json({ error: "parent folder not found" }, 404)
    parentId = body.parentId
  }
  const id = crypto.randomUUID()
  await db.insert(schema.folders).values({ id, ownerId: userId, name, parentId, color: body.color?.slice(0, 40) ?? null, createdAt: nowSeconds() }).run()
  return c.json({ id, name, parentId })
})
folders.patch("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json<{ name?: string; parentId?: string | null; color?: string | null }>().catch(() => ({} as { name?: string; parentId?: string | null; color?: string | null }))
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const update: Record<string, unknown> = {}
  if (typeof body.name === "string") {
    const name = body.name.trim()
    if (!name) return c.json({ error: "name required" }, 400)
    update.name = name
  }
  if ("parentId" in body) {
    if (body.parentId === id) return c.json({ error: "folder cannot contain itself" }, 400)
    if (body.parentId) {
      const descendants = await childFolderIds(db, userId, id)
      if (descendants.includes(body.parentId)) return c.json({ error: "folder cannot move inside itself" }, 400)
      const parent = await db.select().from(schema.folders).where(and(eq(schema.folders.id, body.parentId), eq(schema.folders.ownerId, userId))).get()
      if (!parent) return c.json({ error: "parent folder not found" }, 404)
      update.parentId = body.parentId
    } else update.parentId = null
  }
  if ("color" in body) update.color = body.color?.slice(0, 40) ?? null
  if (Object.keys(update).length === 0) return c.json({ error: "nothing to update" }, 400)
  await db.update(schema.folders).set(update).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true, ...update })
})
folders.get("/:id/download-zip", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const root = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!root) return c.json({ error: "not found" }, 404)
  const ids = await childFolderIds(db, userId, id)
  const allFolders = await db.select().from(schema.folders).where(eq(schema.folders.ownerId, userId)).all()
  const folderById = new Map(allFolders.map((f) => [f.id, f] as const))
  function pathFor(folderId: string | null): string {
    const parts: string[] = []
    let cur = folderId ? folderById.get(folderId) : null
    while (cur) { parts.unshift(cur.name); cur = cur.parentId ? folderById.get(cur.parentId) ?? null : null }
    return parts.join("/")
  }
  const rows = await db.select().from(schema.files).where(and(eq(schema.files.ownerId, userId), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds()), isNull(schema.files.deletedAt))).all()
  const files = [] as Array<{ name: string; bytes: Uint8Array; modifiedAt?: number }>
  for (const row of rows.filter((f) => f.folderId && ids.includes(f.folderId))) {
    const obj = await c.env.FILES.get(row.r2Key)
    if (!obj) continue
    files.push({ name: `${pathFor(row.folderId)}/${row.filename}`, bytes: new Uint8Array(await obj.arrayBuffer()), modifiedAt: row.createdAt })
  }
  if (!files.length) return c.json({ error: "folder is empty" }, 404)
  return zipResponse(makeZip(files), `${root.name}.zip`)
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
  const hasOptions = "password" in body || "downloadLimit" in body || "expiresInDays" in body || "accessMode" in body || "oneTime" in body || "allowlist" in body || "ipAllowlist" in body || "countryAllowlist" in body
  if (hasOptions) {
    update.sharePassword = body.password ? await hashSecret(String(body.password)) : null
    update.shareDownloadLimit = typeof body.downloadLimit === "number" && body.downloadLimit > 0 ? Math.floor(body.downloadLimit) : null
    update.shareExpiresAt = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? nowSeconds() + Math.round(body.expiresInDays * DAY_SECONDS) : null
    update.shareAccessMode = accessMode(body.accessMode)
    update.shareOneTime = !!body.oneTime
    update.shareAllowlist = serializeList(body.allowlist)
    update.shareIpAllowlist = serializeList(body.ipAllowlist)
    update.shareCountryAllowlist = serializeList(body.countryAllowlist)
    update.shareDownloadCount = 0
  }
  await db.update(schema.folders).set(update).where(eq(schema.folders.id, id)).run()
  return c.json({ token, url: `${c.env.PUBLIC_APP_URL}/api/share/folder/${token}`, hasPassword: hasOptions ? !!body.password : !!row.sharePassword, downloadLimit: hasOptions ? (update.shareDownloadLimit as number | null) : row.shareDownloadLimit ?? null, shareExpiresAt: hasOptions ? (update.shareExpiresAt as number | null) : row.shareExpiresAt ?? null, accessMode: hasOptions ? update.shareAccessMode : row.shareAccessMode ?? "download", oneTime: hasOptions ? !!update.shareOneTime : !!row.shareOneTime })
})
folders.delete("/:id/share", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.folders).set({ shareToken: null, sharePassword: null, shareDownloadLimit: null, shareDownloadCount: 0, shareExpiresAt: null, shareAccessMode: "download", shareOneTime: false, shareAllowlist: null, shareIpAllowlist: null, shareCountryAllowlist: null }).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true })
})
folders.get("/:id/share/events", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  const events = await db.select().from(schema.shareEvents).where(eq(schema.shareEvents.folderId, row.id)).orderBy(desc(schema.shareEvents.createdAt)).limit(200).all().catch(() => [])
  const summary = events.reduce((acc, ev) => { acc[ev.event] = (acc[ev.event] ?? 0) + 1; return acc }, {} as Record<string, number>)
  return c.json({ events, summary })
})
folders.delete("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.ownerId, userId))).get()
  if (!row) return c.json({ error: "not found" }, 404)
  await db.update(schema.files).set({ folderId: row.parentId ?? null }).where(and(eq(schema.files.folderId, id), eq(schema.files.ownerId, userId))).run()
  await db.update(schema.folders).set({ parentId: row.parentId ?? null }).where(and(eq(schema.folders.parentId, id), eq(schema.folders.ownerId, userId))).run().catch(() => {})
  await db.delete(schema.folders).where(eq(schema.folders.id, id)).run()
  return c.json({ ok: true })
})
export default folders
