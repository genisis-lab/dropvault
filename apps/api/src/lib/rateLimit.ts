import { nowSeconds } from "./expiry";
import { normalizeIp } from "./ipAccess";

export type RateLimitResult = { allowed: boolean; retryAfter: number };
export type ClientIpInfo = {
  primary: string;
  ipv4: string | null;
  ipv6: string | null;
  all: string[];
};

// Fixed-window rate limiter backed by D1. The upsert is a single atomic SQLite
// statement so concurrent password guesses cannot all observe and overwrite
// the same count. Protected public endpoints fail closed on a database error;
// silently disabling brute-force protection is the less safe failure mode.
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = nowSeconds();
  try {
    const row = await db
      .prepare(
        `
          INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE
              WHEN rate_limits.reset_at <= ? THEN 1
              ELSE MIN(rate_limits.count + 1, ?)
            END,
            reset_at = CASE
              WHEN rate_limits.reset_at <= ? THEN excluded.reset_at
              ELSE rate_limits.reset_at
            END
          RETURNING count, reset_at AS resetAt
        `,
      )
      .bind(key, now + windowSeconds, now, limit + 1, now)
      .first<{ count: number; resetAt: number }>();
    if (!row) throw new Error("rate limit state unavailable");
    return {
      allowed: row.count <= limit,
      retryAfter: row.count <= limit ? 0 : Math.max(1, row.resetAt - now),
    };
  } catch {
    return { allowed: false, retryAfter: windowSeconds };
  }
}

function forwardedForCandidates(header: string | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const match of header.matchAll(/for=("?\[[^\]]+]"?|"?[^;,\s"]+"?)/gi)) {
    out.push(match[1].replace(/^"|"$/g, ""));
  }
  return out;
}

function headerCandidates(c: {
  req: { header: (name: string) => string | undefined };
}): string[] {
  return [
    c.req.header("CF-Connecting-IP"),
    c.req.header("True-Client-IP"),
    c.req.header("X-Real-IP"),
    ...(c.req.header("X-Forwarded-For") ?? "").split(","),
    ...forwardedForCandidates(c.req.header("Forwarded")),
  ].filter((x): x is string => !!x && !!x.trim());
}

// Captures every normalized address exposed by Cloudflare/proxy headers. A
// single request usually has either IPv4 OR IPv6, but when a proxy exposes both
// in X-Forwarded-For / Forwarded, we retain both so admin/audit storage can show
// dual-stack clients instead of losing one family.
export function clientIpInfo(c: {
  req: { header: (name: string) => string | undefined };
}): ClientIpInfo {
  // Cloudflare overwrites CF-Connecting-IP at the edge. If it is present, do
  // not mix it with client-controlled forwarding headers: a forged IPv4 XFF
  // value could otherwise outrank a real IPv6 address and bypass rate limits.
  const cloudflareHeader = c.req.header("CF-Connecting-IP");
  if (cloudflareHeader !== undefined) {
    const ip = normalizeIp(cloudflareHeader);
    if (!ip) return { primary: "unknown", ipv4: null, ipv6: null, all: [] };
    const ipv4 = ip.includes(".") ? ip : null;
    const ipv6 = ip.includes(":") ? ip : null;
    return { primary: ip, ipv4, ipv6, all: [ip] };
  }

  // These fallbacks support local development and deployments behind a
  // trusted non-Cloudflare reverse proxy. Production Workers always receive
  // CF-Connecting-IP and therefore never reach this branch.
  const seen = new Set<string>();
  const all: string[] = [];
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  for (const candidate of headerCandidates(c)) {
    const ip = normalizeIp(candidate);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    all.push(ip);
    if (ip.includes(".")) ipv4 ??= ip;
    else if (ip.includes(":")) ipv6 ??= ip;
  }
  // Prefer IPv4 as the display/rate-limit key when both are available, but keep
  // IPv6 in the observation columns. If only IPv6 is present, use it.
  return { primary: ipv4 ?? ipv6 ?? "unknown", ipv4, ipv6, all };
}

// Best-effort client IP for rate-limit keys and legacy single-IP columns.
// Use clientIpInfo when the caller needs both IPv4 and IPv6.
export function clientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  return clientIpInfo(c).primary;
}
