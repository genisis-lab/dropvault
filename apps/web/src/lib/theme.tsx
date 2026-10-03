import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  effectiveTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "./theme-config";

export type { ResolvedTheme, Theme } from "./theme-config";
export {
  DEFAULT_THEME,
  THEME_OPTIONS,
  THEMES,
  themeLabel,
} from "./theme-config";

const API = import.meta.env.VITE_API_URL ?? "";
const PREFERENCE_KEY = "dropvault-theme";
const WORKSPACE_KEY = "dropvault-workspace-theme";
const DEFAULT_THEME_EVENT = "dropvault-default-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = effectiveTheme(theme, prefersDark());
  if (typeof document === "undefined") return resolved;
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.dataset.theme = theme;
  el.style.colorScheme = resolved;
  return resolved;
}

function readStorage(key: string): Theme | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(key);
    return value == null ? null : resolveTheme(value, DEFAULT_THEME);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: Theme) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore unavailable storage */
  }
}

function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore unavailable storage */
  }
}

function initialTheme() {
  const preference = readStorage(PREFERENCE_KEY);
  const workspaceDefault = readStorage(WORKSPACE_KEY) ?? DEFAULT_THEME;
  return {
    theme: preference ?? workspaceDefault,
    workspaceDefault,
    followsWorkspaceDefault: preference == null,
  };
}

export async function fetchWorkspaceDefaultTheme(): Promise<Theme> {
  const response = await fetch(`${API}/api/theme`, { credentials: "include" });
  if (!response.ok) throw new Error("Could not load the workspace theme");
  const body = (await response.json()) as { theme?: unknown };
  return resolveTheme(body.theme);
}

export function announceWorkspaceDefaultTheme(theme: Theme) {
  writeStorage(WORKSPACE_KEY, theme);
  window.dispatchEvent(
    new CustomEvent<Theme>(DEFAULT_THEME_EVENT, { detail: theme }),
  );
}

type ThemeContextValue = {
  // The chosen appearance, which may be "system".
  theme: Theme;
  // What is actually on screen.
  resolvedTheme: ResolvedTheme;
  workspaceDefault: Theme;
  followsWorkspaceDefault: boolean;
  setTheme: (theme: Theme) => void;
  useWorkspaceDefault: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolvedTheme: "light",
  workspaceDefault: DEFAULT_THEME,
  followsWorkspaceDefault: true,
  setTheme: () => {},
  useWorkspaceDefault: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialTheme);
  const [theme, setThemeState] = useState<Theme>(initial.theme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    effectiveTheme(initial.theme, prefersDark()),
  );
  const [workspaceDefault, setWorkspaceDefault] = useState<Theme>(
    initial.workspaceDefault,
  );
  const [followsWorkspaceDefault, setFollowsWorkspaceDefault] = useState(
    initial.followsWorkspaceDefault,
  );

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
    if (theme !== "system" || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setResolvedTheme(applyTheme("system"));
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [theme]);

  useEffect(() => {
    let active = true;
    fetchWorkspaceDefaultTheme()
      .then((next) => {
        if (!active) return;
        setWorkspaceDefault(next);
        writeStorage(WORKSPACE_KEY, next);
        if (followsWorkspaceDefault) setThemeState(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [followsWorkspaceDefault]);

  useEffect(() => {
    const onDefaultTheme = (event: Event) => {
      const next = resolveTheme((event as CustomEvent<unknown>).detail);
      setWorkspaceDefault(next);
      if (followsWorkspaceDefault) setThemeState(next);
    };
    window.addEventListener(DEFAULT_THEME_EVENT, onDefaultTheme);
    return () => window.removeEventListener(DEFAULT_THEME_EVENT, onDefaultTheme);
  }, [followsWorkspaceDefault]);

  const setTheme = useCallback((next: Theme) => {
    setFollowsWorkspaceDefault(false);
    setThemeState(next);
    writeStorage(PREFERENCE_KEY, next);
  }, []);

  const useWorkspaceDefault = useCallback(() => {
    removeStorage(PREFERENCE_KEY);
    setFollowsWorkspaceDefault(true);
    setThemeState(workspaceDefault);
  }, [workspaceDefault]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      workspaceDefault,
      followsWorkspaceDefault,
      setTheme,
      useWorkspaceDefault,
    }),
    [
      theme,
      resolvedTheme,
      workspaceDefault,
      followsWorkspaceDefault,
      setTheme,
      useWorkspaceDefault,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
