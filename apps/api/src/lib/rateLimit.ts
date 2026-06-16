import { eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "./expiry"
import { normalizeIp } from "./ipAccess"

export type RateLimitResult = { allowed: boolean; retryAfter: number }
export type ClientIpInfo = { primary: string; ipv4: string | null; ipv6: string | null; all: string[] }

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

function headerCandidates(c: { req: { header: (name: string) => string | undefined } }): string[] {
  return [
    c.req.header("CF-Connecting-IP"),
    c.req.header("True-Client-IP"),
    c.req.header("X-Real-IP"),
    ...(c.req.header("X-Forwarded-For") ?? "").split(","),
    ...forwardedForCandidates(c.req.header("Forwarded")),
  ].filter((x): x is string => !!x && !!x.trim())
}

// Captures every normalized address exposed by Cloudflare/proxy headers. A
// single request usually has either IPv4 OR IPv6, but when a proxy exposes both
// in X-Forwarded-For / Forwarded, we retain both so admin/audit storage can show
// dual-stack clients instead of losing one family.
export function clientIpInfo(c: { req: { header: (name: string) => string | undefined } }): ClientIpInfo {
  const seen = new Set<string>()
  const all: string[] = []
  let ipv4: string | null = null
  let ipv6: string | null = null
  for (const candidate of headerCandidates(c)) {
    const ip = normalizeIp(candidate)
    if (!ip || seen.has(ip)) continue
    seen.add(ip)
    all.push(ip)
    if (ip.includes(".")) ipv4 ??= ip
    else if (ip.includes(":")) ipv6 ??= ip
  }
  // Prefer IPv4 as the display/rate-limit key when both are available, but keep
  // IPv6 in the observation columns. If only IPv6 is present, use it.
  return { primary: ipv4 ?? ipv6 ?? "unknown", ipv4, ipv6, all }
}

// Best-effort client IP for rate-limit keys and legacy single-IP columns.
// Use clientIpInfo when the caller needs both IPv4 and IPv6.
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return clientIpInfo(c).primary
}
