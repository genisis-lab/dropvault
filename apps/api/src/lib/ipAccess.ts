import { eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "./expiry"

export type IpBanEntry = {
  ip: string
  note: string | null
  createdAt: number
  createdBy: string | null
}

export function normalizeIp(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase()
  if (!value) return null
  const stripped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value
  if (stripped.includes(".")) {
    const parts = stripped.split(".")
    if (parts.length !== 4) return null
    const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN))
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    return nums.join(".")
  }
  if (stripped.includes(":")) {
    if (!/^[0-9a-f:.]+$/.test(stripped)) return null
    if (!/^[0-9a-f:.]*:[0-9a-f:.]*$/.test(stripped)) return null
    return stripped
  }
  return null
}

export function parseIpBans(raw: string | null | undefined): IpBanEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]")
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: IpBanEntry[] = []
    for (const entry of parsed) {
      const ip = normalizeIp(typeof entry?.ip === "string" ? entry.ip : null)
      if (!ip || seen.has(ip)) continue
      seen.add(ip)
      out.push({
        ip,
        note: typeof entry?.note === "string" ? entry.note.slice(0, 200) : null,
        createdAt: Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : 0,
        createdBy: typeof entry?.createdBy === "string" ? entry.createdBy.slice(0, 320) : null,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function getIpBans(db: ReturnType<typeof getDb>): Promise<IpBanEntry[]> {
  const row = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "ipBans")).get().catch(() => null)
  return parseIpBans(row?.value)
}

async function saveIpBans(db: ReturnType<typeof getDb>, bans: IpBanEntry[], updatedBy: string | null): Promise<void> {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "ipBans")).run().catch(() => {})
  if (!bans.length) return
  await db.insert(schema.appSettings).values({ key: "ipBans", value: JSON.stringify(bans), updatedBy, updatedAt: nowSeconds() }).run()
}

export async function addIpBan(db: ReturnType<typeof getDb>, rawIp: string, note: string | null, createdBy: string | null): Promise<IpBanEntry[]> {
  const ip = normalizeIp(rawIp)
  if (!ip) throw new Error("invalid ip")
  const bans = await getIpBans(db)
  const next: IpBanEntry[] = [{ ip, note: note?.slice(0, 200) ?? null, createdAt: nowSeconds(), createdBy }]
  for (const ban of bans) if (ban.ip !== ip) next.push(ban)
  await saveIpBans(db, next, createdBy)
  return next
}

export async function removeIpBan(db: ReturnType<typeof getDb>, rawIp: string, updatedBy: string | null): Promise<IpBanEntry[]> {
  const ip = normalizeIp(rawIp)
  if (!ip) throw new Error("invalid ip")
  const next = (await getIpBans(db)).filter((ban) => ban.ip !== ip)
  await saveIpBans(db, next, updatedBy)
  return next
}

export async function isIpBanned(db: ReturnType<typeof getDb>, rawIp: string | null | undefined): Promise<boolean> {
  const ip = normalizeIp(rawIp)
  if (!ip) return false
  const bans = await getIpBans(db)
  return bans.some((ban) => ban.ip === ip)
}

export function recentIpsFrom(events: Array<{ ip: string | null | undefined; createdAt: number }>, limit = 5): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const event of [...events].sort((a, b) => b.createdAt - a.createdAt)) {
    const ip = normalizeIp(event.ip)
    if (!ip || seen.has(ip)) continue
    seen.add(ip)
    out.push(ip)
    if (out.length >= limit) break
  }
  return out
}
