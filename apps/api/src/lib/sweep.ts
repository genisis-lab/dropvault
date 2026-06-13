import { getDb, schema } from "../db"
import { lte } from "drizzle-orm"
import { nowSeconds } from "./expiry"
import type { Bindings } from "../types"

// Storage-reclamation sweep run by the Cron Trigger. Deletes expired objects
// from R2 and their rows from D1. Paginated/batched to stay within limits.
export async function sweepExpired(env: Bindings, batchSize = 200): Promise<number> {
  const db = getDb(env.DB)
  const cutoff = nowSeconds()

  const expired = await db
    .select({ id: schema.files.id, r2Key: schema.files.r2Key })
    .from(schema.files)
    .where(lte(schema.files.expiresAt, cutoff))
    .limit(batchSize)
    .all()

  if (expired.length === 0) return 0

  // Delete R2 objects (best-effort) then their DB rows.
  for (const f of expired) {
    try {
      await env.FILES.delete(f.r2Key)
    } catch (err) {
      console.error(`[sweep] failed to delete R2 object ${f.r2Key}`, err)
    }
  }

  for (const f of expired) {
    await db.delete(schema.files).where(lte(schema.files.expiresAt, cutoff)).run()
    break // single delete covers all <= cutoff rows
  }

  console.log(`[sweep] removed ${expired.length} expired file(s) at ${cutoff}`)
  return expired.length
}
