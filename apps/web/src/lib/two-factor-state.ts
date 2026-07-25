const TWO_FACTOR_PENDING_KEY = "dropvault:two-factor-required";
const TWO_FACTOR_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function markTwoFactorPending(
  storage: StorageLike,
  now = Date.now(),
) {
  storage.setItem(TWO_FACTOR_PENDING_KEY, String(now));
}

export function clearTwoFactorPending(storage: StorageLike) {
  storage.removeItem(TWO_FACTOR_PENDING_KEY);
}

export function hasFreshTwoFactorPending(
  storage: StorageLike,
  now = Date.now(),
) {
  const value = storage.getItem(TWO_FACTOR_PENDING_KEY);
  const createdAt = value ? Number(value) : Number.NaN;
  const fresh =
    value !== "1" &&
    Number.isFinite(createdAt) &&
    createdAt <= now &&
    now - createdAt < TWO_FACTOR_PENDING_MAX_AGE_MS;
  if (!fresh && value) clearTwoFactorPending(storage);
  return fresh;
}
