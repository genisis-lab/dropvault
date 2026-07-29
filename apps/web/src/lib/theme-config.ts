export type Theme =
  | "neubrutalism"
  | "pressroom"
  | "quiet"
  | "light"
  | "dark"
  | "sunset";

export const DEFAULT_THEME: Theme = "neubrutalism";

export const THEME_OPTIONS: Array<{
  id: Theme;
  label: string;
  description: string;
}> = [
  {
    id: "neubrutalism",
    label: "Neubrutalism",
    description: "Bold borders, hard shadows, cobalt accents",
  },
  {
    id: "pressroom",
    label: "Pressroom",
    description: "Warm paper, editorial type, coral accents",
  },
  {
    id: "quiet",
    label: "Quiet Drive",
    description: "Clean, compact, productivity-first",
  },
  { id: "light", label: "Light", description: "Original light palette" },
  { id: "dark", label: "Dark", description: "Original dark palette" },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm dark palette",
  },
];

export const THEMES = THEME_OPTIONS.map((option) => option.id);

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

export function resolveTheme(value: unknown, fallback = DEFAULT_THEME): Theme {
  return isTheme(value) ? value : fallback;
}
