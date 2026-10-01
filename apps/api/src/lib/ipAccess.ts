import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { nowSeconds } from "./expiry";

export type IpBanEntry = {
  ip: string;
  note: string | null;
  createdAt: number;
  createdBy: string | null;
};

function cleanIpCandidate(raw: string | null | undefined): string {
  let value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1).trim();

  // Forwarded/proxy headers sometimes include bracketed IPv6 with a port:
  // [2001:db8::10]:443. Store and compare the address only.
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];

  // IPv4 may arrive with a proxy-added port, e.g. 203.0.113.10:443.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value))
    value = value.replace(/:\d+$/, "");

  // Drop IPv6 zone identifiers such as fe80::1%eth0. These are not useful for
  // allowlists/banlists and would make otherwise identical addresses compare
  // differently.
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  return value;
}

function normalizeIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums.join(".");
}

function normalizeIpv6(value: string): string | null {
  if (!value.includes(":")) return null;
  if (!/^[0-9a-f:]+$/.test(value)) return null;
  if (value.includes(":::")) return null;
  const pieces = value.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces[1] ? pieces[1].split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  if (pieces.length === 1 && groups.length !== 8) return null;
  if (pieces.length === 2 && groups.length >= 8) return null;
  const normalizeGroup = (g: string) =>
    g.replace(/^0+([0-9a-f])/, "$1").replace(/^0+$/, "0");
  return pieces.length === 1
    ? groups.map(normalizeGroup).join(":")
    : `${left.map(normalizeGroup).join(":")}::${right.map(normalizeGroup).join(":")}`;
}

export function normalizeIp(raw: string | null | undefined): string | null {
  const value = cleanIpCandidate(raw);
  if (!value) return null;

  // Cloudflare/proxies can report IPv4 clients as IPv4-mapped IPv6.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return normalizeIpv4(mapped[1]);

  if (value.includes(".")) return normalizeIpv4(value);
  return normalizeIpv6(value);
}

function ipv4ToInt(ip: string): number | null {
  const normalized = normalizeIpv4(ip);
  if (!normalized) return null;
  return normalized
    .split(".")
    .reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function ipv4MatchesCidr(ip: string, cidr: string): boolean {
  const [baseRaw, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(baseRaw);
  if (ipInt == null || baseInt == null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// Exact IPv4/IPv6 allowlist matching, with optional IPv4 CIDR support. This is
// used by share links so a visitor coming through Cloudflare as IPv4, IPv6, or
// IPv4-mapped IPv6 can be compared consistently against the owner's allowlist.
export function ipMatchesAllowlist(
  rawIp: string | null | undefined,
  allowlist: string[],
): boolean {
  if (!allowlist.length) return true;
  const ip = normalizeIp(rawIp);
  if (!ip) return false;
  return allowlist.some((entry) => {
    const value = String(entry ?? "")
      .trim()
      .toLowerCase();
    if (!value) return false;
    if (value.includes("/") && ip.includes("."))
      return ipv4MatchesCidr(ip, value);
    return normalizeIp(value) === ip;
  });
}

export function parseIpBans(raw: string | null | undefined): IpBanEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: IpBanEntry[] = [];
    for (const entry of parsed) {
      const ip = normalizeIp(typeof entry?.ip === "string" ? entry.ip : null);
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      out.push({
        ip,
        note: typeof entry?.note === "string" ? entry.note.slice(0, 200) : null,
        createdAt: Number.isFinite(Number(entry?.createdAt))
          ? Number(entry.createdAt)
          : 0,
        createdBy:
          typeof entry?.createdBy === "string"
            ? entry.createdBy.slice(0, 320)
            : null,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function getIpBans(
  db: ReturnType<typeof getDb>,
): Promise<IpBanEntry[]> {
  const row = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "ipBans"))
    .get()
    .catch(() => null);
  return parseIpBans(row?.value);
}

async function saveIpBans(
  db: ReturnType<typeof getDb>,
  bans: IpBanEntry[],
  updatedBy: string | null,
): Promise<void> {
  await db
    .delete(schema.appSettings)
    .where(eq(schema.appSettings.key, "ipBans"))
    .run()
    .catch(() => {});
  if (!bans.length) return;
  await db
    .insert(schema.appSettings)
    .values({
      key: "ipBans",
      value: JSON.stringify(bans),
      updatedBy,
      updatedAt: nowSeconds(),
    })
    .run();
}

export async function addIpBan(
  db: ReturnType<typeof getDb>,
  rawIp: string,
  note: string | null,
  createdBy: string | null,
): Promise<IpBanEntry[]> {
  const ip = normalizeIp(rawIp);
  if (!ip) throw new Error("invalid ip");
  const bans = await getIpBans(db);
  const next: IpBanEntry[] = [
    {
      ip,
      note: note?.slice(0, 200) ?? null,
      createdAt: nowSeconds(),
      createdBy,
    },
  ];
  for (const ban of bans) if (ban.ip !== ip) next.push(ban);
  await saveIpBans(db, next, createdBy);
  return next;
}

export async function removeIpBan(
  db: ReturnType<typeof getDb>,
  rawIp: string,
  updatedBy: string | null,
): Promise<IpBanEntry[]> {
  const ip = normalizeIp(rawIp);
  if (!ip) throw new Error("invalid ip");
  const next = (await getIpBans(db)).filter((ban) => ban.ip !== ip);
  await saveIpBans(db, next, updatedBy);
  return next;
}

// True when banning `target` would block the person making the request. Bans
// apply to every route, so an owner banning their own address would lose
// access to the admin panel needed to lift it.
export function banTargetsRequester(
  target: string | null | undefined,
  requesterIps: readonly string[],
): boolean {
  const ip = normalizeIp(target);
  if (!ip) return false;
  return requesterIps.some((candidate) => normalizeIp(candidate) === ip);
}

export async function isIpBanned(
  db: ReturnType<typeof getDb>,
  rawIp: string | null | undefined,
): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip) return false;
  const bans = await getIpBans(db);
  return bans.some((ban) => ban.ip === ip);
}

export function recentIpsFrom(
  events: Array<{ ip: string | null | undefined; createdAt: number }>,
  limit = 5,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const event of [...events].sort((a, b) => b.createdAt - a.createdAt)) {
    const ip = normalizeIp(event.ip);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
    if (out.length >= limit) break;
  }
  return out;
}
