// One look in three appearances. "system" follows the device's light or dark
// setting; light and dark pin it.
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

export const THEME_OPTIONS: Array<{
  id: Theme;
  label: string;
  description: string;
}> = [
  { id: "light", label: "Light", description: "Bright surfaces" },
  { id: "dark", label: "Dark", description: "Easier on the eyes at night" },
  {
    id: "system",
    label: "Device default",
    description: "Follows your device's setting",
  },
];

export const THEMES = THEME_OPTIONS.map((option) => option.id);

// Themes retired by the redesign. Saved choices keep working: the dark one
// stays dark and the rest become light.
const LEGACY_THEMES: Record<string, Theme> = {
  sunset: "dark",
  neubrutalism: "light",
  pressroom: "light",
  quiet: "light",
};

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

export function resolveTheme(value: unknown, fallback = DEFAULT_THEME): Theme {
  if (isTheme(value)) return value;
  if (typeof value === "string" && value in LEGACY_THEMES)
    return LEGACY_THEMES[value];
  return fallback;
}

export function effectiveTheme(
  theme: Theme,
  prefersDark: boolean,
): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function themeLabel(theme: Theme): string {
  return THEME_OPTIONS.find((option) => option.id === theme)?.label ?? "Theme";
}
