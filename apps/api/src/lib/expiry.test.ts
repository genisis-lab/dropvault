import { describe, it, expect } from "vitest";
import {
  computeExpiresAt,
  clampExtension,
  isExpired,
  DAY_SECONDS,
  expiryCountdownLabel,
  FOREVER_EXPIRES_AT,
} from "./expiry";
import type { Bindings } from "../types";

const env = { DEFAULT_EXPIRY_DAYS: "2", MAX_EXPIRY_DAYS: "30" } as Bindings;
const t0 = 1_000_000;

describe("expiry", () => {
  it("defaults to DEFAULT_EXPIRY_DAYS", () => {
    expect(computeExpiresAt(env, t0)).toBe(t0 + 2 * DAY_SECONDS);
  });

  it("honors a requested duration within range", () => {
    expect(computeExpiresAt(env, t0, 7)).toBe(t0 + 7 * DAY_SECONDS);
  });

  it("clamps requests above the max", () => {
    expect(computeExpiresAt(env, t0, 99)).toBe(t0 + 30 * DAY_SECONDS);
  });

  it("clamps extensions so total lifetime never exceeds max", () => {
    const requested = t0 + 999 * DAY_SECONDS;
    expect(clampExtension(env, t0, requested)).toBe(t0 + 30 * DAY_SECONDS);
  });

  it("detects expiry correctly", () => {
    expect(isExpired(t0, t0 + 1)).toBe(true);
    expect(isExpired(t0 + 10, t0)).toBe(false);
  });
});

describe("expiryCountdownLabel", () => {
  const now = 1_700_000_000;
  it("shows keep-forever files as never expiring", () => {
    expect(expiryCountdownLabel(FOREVER_EXPIRES_AT, now)).toBe("Never expires");
  });
  it("counts down in days, hours, then minutes", () => {
    expect(expiryCountdownLabel(now + 3 * DAY_SECONDS + 60, now)).toBe(
      "Expires in 3 days",
    );
    expect(expiryCountdownLabel(now + 2 * 3600 + 60, now)).toBe(
      "Expires in 2 hours",
    );
    expect(expiryCountdownLabel(now + 30, now)).toBe("Expires in 1 minute");
    expect(expiryCountdownLabel(now - 1, now)).toBe("Expired");
  });
});
