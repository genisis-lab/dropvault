// SSRF guard for admin-configured notification webhooks.
//
// These URLs are fetched server-side by the Worker, so a malicious or careless
// value could be pointed at internal/cloud-metadata endpoints. This is a
// best-effort allowlist of "plain public http(s) on standard ports". Note it
// validates the URL's literal host only; it does NOT resolve DNS, so a hostname
// that resolves to a private IP (DNS rebinding) can still slip through. Full
// protection would require checking the connected IP, which Workers' fetch does
// not expose. For our threat model (owner-configured webhook) this materially
// reduces risk without that.

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((x) => Number(x));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedHost(host: string): boolean {
  if (!host) return true;
  // Loopback / localhost names.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "localhost.localdomain"
  )
    return true;
  if (host === "0.0.0.0") return true;
  // Cloud metadata hostnames.
  if (host === "metadata.google.internal" || host.endsWith(".internal"))
    return true;
  // IPv6 (callers normalize URL-literal brackets before this check).
  if (host.includes(":")) {
    const lower = host.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    )
      return true;
    const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return false;
}

// Returns true only for a plain http(s) URL on a standard web port pointing at a
// public host, with no embedded credentials.
export function isSafeWebhookUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return !isBlockedHost(host);
}
