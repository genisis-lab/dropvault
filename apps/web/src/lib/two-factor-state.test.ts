import { describe, expect, it } from "vitest";
import {
  clearTwoFactorPending,
  hasFreshTwoFactorPending,
  markTwoFactorPending,
} from "./two-factor-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("two-factor pending state", () => {
  it("keeps a newly-created challenge", () => {
    const storage = memoryStorage();
    markTwoFactorPending(storage, 1_000);
    expect(hasFreshTwoFactorPending(storage, 1_001)).toBe(true);
  });

  it("clears expired and legacy boolean markers", () => {
    const storage = memoryStorage();
    markTwoFactorPending(storage, 1_000);
    expect(hasFreshTwoFactorPending(storage, 601_000)).toBe(false);
    storage.setItem("dropvault:two-factor-required", "1");
    expect(hasFreshTwoFactorPending(storage, 2_000)).toBe(false);
    expect(storage.getItem("dropvault:two-factor-required")).toBeNull();
  });

  it("can be cleared after success or an invalid cookie", () => {
    const storage = memoryStorage();
    markTwoFactorPending(storage, 1_000);
    clearTwoFactorPending(storage);
    expect(hasFreshTwoFactorPending(storage, 1_001)).toBe(false);
  });
});
