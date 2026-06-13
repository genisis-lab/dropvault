import { describe, it, expect } from "vitest"
import { computeExpiresAt, clampExtension, isExpired, DAY_SECONDS } from "./expiry"
import type { Bindings } from "../types"

const env = { DEFAULT_EXPIRY_DAYS: "2", MAX_EXPIRY_DAYS: "30" } as Bindings
const t0 = 1_000_000

describe("expiry", () => {
  it("defaults to DEFAULT_EXPIRY_DAYS", () => {
    expect(computeExpiresAt(env, t0)).toBe(t0 + 2 * DAY_SECONDS)
  })

  it("honors a requested duration within range", () => {
    expect(computeExpiresAt(env, t0, 7)).toBe(t0 + 7 * DAY_SECONDS)
  })

  it("clamps requests above the max", () => {
    expect(computeExpiresAt(env, t0, 99)).toBe(t0 + 30 * DAY_SECONDS)
  })

  it("clamps extensions so total lifetime never exceeds max", () => {
    const requested = t0 + 999 * DAY_SECONDS
    expect(clampExtension(env, t0, requested)).toBe(t0 + 30 * DAY_SECONDS)
  })

  it("detects expiry correctly", () => {
    expect(isExpired(t0, t0 + 1)).toBe(true)
    expect(isExpired(t0 + 10, t0)).toBe(false)
  })
})
