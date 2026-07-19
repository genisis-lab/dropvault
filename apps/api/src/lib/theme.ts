export const DEFAULT_THEME = "neubrutalism";

export const PUBLIC_THEMES = [
  "neubrutalism",
  "quiet",
  "light",
  "dark",
  "sunset",
] as const;

export type PublicTheme = (typeof PUBLIC_THEMES)[number];

export function normalizeTheme(value: unknown): PublicTheme {
  return PUBLIC_THEMES.includes(value as PublicTheme)
    ? (value as PublicTheme)
    : DEFAULT_THEME;
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
