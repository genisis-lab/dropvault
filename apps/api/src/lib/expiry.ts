import type { Bindings } from "../types"

export const DAY_SECONDS = 60 * 60 * 24
export const FOREVER_EXPIRES_AT = 253402300799 // 9999-12-31T23:59:59Z

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// Clamp a requested expiry duration (in days) to [0, MAX_EXPIRY_DAYS] and
// return the absolute epoch-second expiry relative to createdAt.
export function computeExpiresAt(
  env: Bindings,
  createdAt: number,
  requestedDays?: number,
): number {
  const def = Number(env.DEFAULT_EXPIRY_DAYS) || 2
  const max = Number(env.MAX_EXPIRY_DAYS) || 30
  const days = Math.min(Math.max(requestedDays ?? def, 1), max)
  return createdAt + Math.round(days * DAY_SECONDS)
}

// When extending, clamp so total lifetime (expiresAt - createdAt) never exceeds max.
export function clampExtension(
  env: Bindings,
  createdAt: number,
  requestedExpiresAt: number,
): number {
  const max = Number(env.MAX_EXPIRY_DAYS) || 30
  const ceiling = createdAt + max * DAY_SECONDS
  return Math.min(requestedExpiresAt, ceiling)
}

export function isExpired(expiresAt: number, at: number = nowSeconds()): boolean {
  return expiresAt <= at
}
