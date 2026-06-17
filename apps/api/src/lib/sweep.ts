import { getDb, schema } from "../db"
import { and, eq, inArray, lte, isNull } from "drizzle-orm"
import { nowSeconds } from "./expiry"
import type { Bindings } from "../types"

export async function sweepExpired(env: Bindings, batchSize = 200): Promise<number> {
  const db = getDb(env.DB)
  const cutoff = nowSeconds()
  // Trash retention is admin-configurable (app_settings.trashRetentionDays).
  // Falls back to 30 days when unset or invalid.
  const trashSetting = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "trashRetentionDays")).get().catch(() => null)
  const trashDays = Number(trashSetting?.value) > 0 ? Number(trashSetting?.value) : 30
  const trashCutoff = cutoff - trashDays * 86400
  const pendingCutoff = cutoff - 24 * 3600

  const expired = await db.select({ id: schema.files.id, r2Key: schema.files.r2Key }).from(schema.files).where(and(lte(schema.files.expiresAt, cutoff), isNull(schema.files.deletedAt))).limit(batchSize).all()
  const oldTrash = await db.select({ id: schema.files.id, r2Key: schema.files.r2Key }).from(schema.files).where(lte(schema.files.deletedAt, trashCutoff)).limit(batchSize).all().catch(() => [])
  const stalePending = await db.select({ id: schema.files.id, r2Key: schema.files.r2Key }).from(schema.files).where(and(eq(schema.files.status, "pending"), lte(schema.files.createdAt, pendingCutoff), isNull(schema.files.deletedAt))).limit(batchSize).all().catch(() => [])
  const rows = [...expired, ...oldTrash, ...stalePending]
  if (rows.length === 0) return 0

  for (const f of rows) {
    try { await env.FILES.delete([f.r2Key, `${f.r2Key}/thumb`]) } catch (err) { console.error(`[sweep] failed to delete R2 object ${f.r2Key}`, err) }
  }
  for (const f of expired) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  for (const f of oldTrash) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  for (const f of stalePending) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  console.log(`[sweep] removed ${rows.length} file(s) at ${cutoff}`)
  return rows.length
}

// Maps an R2 object key back to the base file key it belongs to. Thumbnails are
// stored at `${r2Key}/thumb`; every other object is its own base key (this
// includes version/restore objects, which are tracked in file_versions).
function baseKeyOf(key: string): string {
  return key.endsWith("/thumb") ? key.slice(0, -"/thumb".length) : key
}

// Reconcile orphaned R2 objects: storage left behind by crashes, aborted
// multipart uploads, or lost DB rows. An object is considered LIVE (kept) when
// its base key matches a files.r2Key OR a file_versions.r2Key row. Thumbnails
// are kept while their parent file exists. Anything uploaded within the last
// 24h is skipped so an in-flight upload is never deleted out from under a
// presign/complete cycle. Deliberately conservative — it only ever deletes
// objects it can prove are unreferenced.
export async function reconcileOrphans(env: Bindings, maxObjects = 5000): Promise<number> {
  const db = getDb(env.DB)
  const graceCutoff = Date.now() - 24 * 3600 * 1000
  let cursor: string | undefined = undefined
  let removed = 0
  let scanned = 0
  do {
    const listing: R2Objects = await env.FILES.list({ limit: 1000, cursor })
    cursor = listing.truncated ? listing.cursor : undefined
    const objects = listing.objects
    if (objects.length === 0) break
    scanned += objects.length

    const candidates = objects.map((o) => ({ key: o.key, base: baseKeyOf(o.key), uploaded: o.uploaded ? o.uploaded.getTime() : 0 }))
    const baseKeys = Array.from(new Set(candidates.map((c) => c.base)))
    const live = new Set<string>()
    for (let i = 0; i < baseKeys.length; i += 100) {
      const chunk = baseKeys.slice(i, i + 100)
      const fileRows = await db.select({ r2Key: schema.files.r2Key }).from(schema.files).where(inArray(schema.files.r2Key, chunk)).all().catch(() => [])
      for (const r of fileRows) live.add(r.r2Key)
      const versionRows = await db.select({ r2Key: schema.fileVersions.r2Key }).from(schema.fileVersions).where(inArray(schema.fileVersions.r2Key, chunk)).all().catch(() => [])
      for (const r of versionRows) live.add(r.r2Key)
    }

    const orphanKeys: string[] = []
    for (const cand of candidates) {
      if (cand.uploaded && cand.uploaded > graceCutoff) continue
      if (live.has(cand.base)) continue
      orphanKeys.push(cand.key)
    }
    for (let i = 0; i < orphanKeys.length; i += 100) {
      const chunk = orphanKeys.slice(i, i + 100)
      try { await env.FILES.delete(chunk); removed += chunk.length } catch (err) { console.error(`[reconcile] failed to delete ${chunk.length} orphan object(s)`, err) }
    }
  } while (cursor && scanned < maxObjects)

  if (removed) console.log(`[reconcile] removed ${removed} orphaned R2 object(s) (scanned ${scanned})`)
  return removed
}
