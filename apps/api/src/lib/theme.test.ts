import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, normalizeTheme, PUBLIC_THEMES } from "./theme";

describe("workspace theme", () => {
  it("accepts every public theme", () => {
    for (const theme of PUBLIC_THEMES) expect(normalizeTheme(theme)).toBe(theme);
  });

  it("follows the device for missing or unsupported values", () => {
    expect(DEFAULT_THEME).toBe("system");
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("unknown")).toBe(DEFAULT_THEME);
  });

  it("maps retired themes onto the new light and dark looks", () => {
    expect(normalizeTheme("sunset")).toBe("dark");
    expect(normalizeTheme("neubrutalism")).toBe("light");
    expect(normalizeTheme("pressroom")).toBe("light");
    expect(normalizeTheme("quiet")).toBe("light");
  });
});
