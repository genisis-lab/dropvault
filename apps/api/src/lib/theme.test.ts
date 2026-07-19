import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, normalizeTheme, PUBLIC_THEMES } from "./theme";

describe("workspace theme", () => {
  it("accepts every public theme", () => {
    for (const theme of PUBLIC_THEMES) expect(normalizeTheme(theme)).toBe(theme);
  });

  it("falls back to Neubrutalism for missing or unsupported values", () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("unknown")).toBe(DEFAULT_THEME);
  });
});
