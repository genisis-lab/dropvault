import type { Bindings } from "../types";

export const DAY_SECONDS = 60 * 60 * 24;
export const FOREVER_EXPIRES_AT = 253402300799; // 9999-12-31T23:59:59Z

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Clamp a requested expiry duration (in days) to [0, MAX_EXPIRY_DAYS] and
// return the absolute epoch-second expiry relative to createdAt.
export function computeExpiresAt(
  env: Bindings,
  createdAt: number,
  requestedDays?: number,
): number {
  const def = Number(env.DEFAULT_EXPIRY_DAYS) || 2;
  const max = Number(env.MAX_EXPIRY_DAYS) || 30;
  const days = Math.min(Math.max(requestedDays ?? def, 1), max);
  return createdAt + Math.round(days * DAY_SECONDS);
}

// When extending, clamp so total lifetime (expiresAt - createdAt) never exceeds max.
export function clampExtension(
  env: Bindings,
  createdAt: number,
  requestedExpiresAt: number,
): number {
  const max = Number(env.MAX_EXPIRY_DAYS) || 30;
  const ceiling = createdAt + max * DAY_SECONDS;
  return Math.min(requestedExpiresAt, ceiling);
}

export function isExpired(
  expiresAt: number,
  at: number = nowSeconds(),
): boolean {
  return expiresAt <= at;
}

// Human countdown for public pages. Keep-forever files store
// FOREVER_EXPIRES_AT, which would otherwise read "Expires in 2912169 days".
export function expiryCountdownLabel(
  expiresAt: number,
  now: number = nowSeconds(),
): string {
  if (expiresAt >= FOREVER_EXPIRES_AT) return "Never expires";
  const secs = expiresAt - now;
  if (secs <= 0) return "Expired";
  const d = Math.floor(secs / DAY_SECONDS);
  const h = Math.floor((secs % DAY_SECONDS) / 3600);
  if (d >= 1) return `Expires in ${d} day${d === 1 ? "" : "s"}`;
  if (h >= 1) return `Expires in ${h} hour${h === 1 ? "" : "s"}`;
  const m = Math.max(1, Math.floor((secs % 3600) / 60));
  return `Expires in ${m} minute${m === 1 ? "" : "s"}`;
}
