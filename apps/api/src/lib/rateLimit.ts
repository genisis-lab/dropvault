import { eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "./expiry"

export type RateLimitResult = { allowed: boolean; retryAfter: number }

// Fixed-window rate limiter backed by the rate_limits D1 table. Best-effort:
// on any DB error it fails OPEN so a transient issue never locks legitimate
// visitors out of a share link. Windows are keyed by caller-provided strings
// (typically route + token + client IP).
export async function checkRateLimit(
  db: ReturnType<typeof getDb>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = nowSeconds()
  try {
    const row = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key)).get()
    if (!row || row.resetAt <= now) {
      await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, key)).run().catch(() => {})
      await db.insert(schema.rateLimits).values({ key, count: 1, resetAt: now + windowSeconds }).run()
      return { allowed: true, retryAfter: 0 }
    }
    if (row.count >= limit) return { allowed: false, retryAfter: Math.max(1, row.resetAt - now) }
    await db.update(schema.rateLimits).set({ count: row.count + 1 }).where(eq(schema.rateLimits.key, key)).run()
    return { allowed: true, retryAfter: 0 }
  } catch {
    return { allowed: true, retryAfter: 0 }
  }
}

// Best-effort client IP for rate-limit keys. Cloudflare sets CF-Connecting-IP.
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const cf = c.req.header("CF-Connecting-IP")
  if (cf) return cf
  const xff = c.req.header("X-Forwarded-For")
  if (xff) return xff.split(",")[0]?.trim() || "unknown"
  return "unknown"
}
