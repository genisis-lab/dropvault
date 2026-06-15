import { getDb, schema } from "../db"
import { and, eq, lte, isNull } from "drizzle-orm"
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
    try { await env.FILES.delete(f.r2Key) } catch (err) { console.error(`[sweep] failed to delete R2 object ${f.r2Key}`, err) }
  }
  for (const f of expired) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  for (const f of oldTrash) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  for (const f of stalePending) await db.delete(schema.files).where(eq(schema.files.id, f.id)).run().catch(() => {})
  console.log(`[sweep] removed ${rows.length} file(s) at ${cutoff}`)
  return rows.length
}
