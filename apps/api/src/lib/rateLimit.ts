import { eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "./expiry"
import { normalizeIp } from "./ipAccess"

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

function forwardedForCandidates(header: string | undefined): string[] {
  if (!header) return []
  const out: string[] = []
  for (const match of header.matchAll(/for=("?\[[^\]]+]"?|"?[^;,\s"]+"?)/gi)) {
    out.push(match[1].replace(/^"|"$/g, ""))
  }
  return out
}

// Best-effort client IP for rate-limit keys and admin/audit capture.
// Cloudflare sets CF-Connecting-IP for both IPv4 and IPv6. The fallbacks cover
// common proxy headers and normalize IPv4, IPv6, IPv4-with-port, bracketed IPv6,
// and IPv4-mapped IPv6 into one comparable value.
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const candidates = [
    c.req.header("CF-Connecting-IP"),
    c.req.header("True-Client-IP"),
    c.req.header("X-Real-IP"),
    ...(c.req.header("X-Forwarded-For") ?? "").split(","),
    ...forwardedForCandidates(c.req.header("Forwarded")),
  ]
  for (const candidate of candidates) {
    const ip = normalizeIp(candidate)
    if (ip) return ip
  }
  return "unknown"
}
