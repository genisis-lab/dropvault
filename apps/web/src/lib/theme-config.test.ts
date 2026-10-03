import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  effectiveTheme,
  isTheme,
  resolveTheme,
  THEMES,
} from "./theme-config";

describe("theme configuration", () => {
  it("offers light, dark and device default", () => {
    expect(THEMES).toEqual(["light", "dark", "system"]);
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
  });

  it("follows the device when nothing usable is saved", () => {
    expect(DEFAULT_THEME).toBe("system");
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme("unsupported")).toBe("system");
  });

  it("maps retired themes onto the new look", () => {
    expect(resolveTheme("sunset")).toBe("dark");
    expect(resolveTheme("neubrutalism")).toBe("light");
    expect(resolveTheme("pressroom")).toBe("light");
    expect(resolveTheme("quiet")).toBe("light");
    expect(isTheme("neubrutalism")).toBe(false);
  });

  it("resolves the device default from the color-scheme preference", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(effectiveTheme("light", true)).toBe("light");
  });
});
