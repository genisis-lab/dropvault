import { describe, expect, it } from "vitest"

// Baseline sanity test so the API test runner is wired into CI. Replace/extend
// with route + handler tests as the API surface stabilizes.
describe("api toolchain", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2)
  })
  it("has a sane runtime environment", () => {
    expect(typeof globalThis.fetch).toBe("function")
  })
})
