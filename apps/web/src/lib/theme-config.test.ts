import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, resolveTheme, THEMES } from "./theme-config";

describe("theme configuration", () => {
  it("recognizes every available theme", () => {
    expect(THEMES).toEqual([
      "neubrutalism",
      "quiet",
      "light",
      "dark",
      "sunset",
    ]);
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
  });

  it("uses Neubrutalism as the safe workspace fallback", () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme("unsupported")).toBe("neubrutalism");
  });
});
