// The app has one look in three appearances: light, dark, and "system", which
// follows the viewer's device setting.
export const DEFAULT_THEME = "system";

export const PUBLIC_THEMES = ["light", "dark", "system"] as const;

export type PublicTheme = (typeof PUBLIC_THEMES)[number];

// Workspaces saved before the redesign may still hold one of the retired
// themes. The dark ones keep a dark appearance; the rest become light.
const LEGACY_THEMES: Record<string, PublicTheme> = {
  sunset: "dark",
  neubrutalism: "light",
  pressroom: "light",
  quiet: "light",
};

export function normalizeTheme(value: unknown): PublicTheme {
  if (PUBLIC_THEMES.includes(value as PublicTheme)) return value as PublicTheme;
  if (typeof value === "string" && value in LEGACY_THEMES)
    return LEGACY_THEMES[value];
  return DEFAULT_THEME;
}

export async function workspaceDefaultTheme(
  db: D1Database,
): Promise<PublicTheme> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind("defaultTheme")
    .first<{ value: string }>()
    .catch(() => null);
  return normalizeTheme(row?.value);
}
