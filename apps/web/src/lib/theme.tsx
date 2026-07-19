import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  Check,
  Cloud,
  Moon,
  RotateCcw,
  Sun,
  Sunset,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_THEME,
  isTheme,
  THEME_OPTIONS,
  THEMES,
  type Theme,
} from "./theme-config";

export type { Theme } from "./theme-config";
export { DEFAULT_THEME, THEME_OPTIONS, THEMES } from "./theme-config";

const API = import.meta.env.VITE_API_URL ?? "";
const PREFERENCE_KEY = "dropvault-theme";
const WORKSPACE_KEY = "dropvault-workspace-theme";
const DEFAULT_THEME_EVENT = "dropvault-default-theme";

const THEME_ICONS: Record<Theme, LucideIcon> = {
  neubrutalism: Box,
  quiet: Cloud,
  light: Sun,
  dark: Moon,
  sunset: Sunset,
};

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.remove(...THEMES);
  if (theme !== "light") el.classList.add(theme);
  el.dataset.theme = theme;
  el.style.colorScheme = theme === "dark" || theme === "sunset" ? "dark" : "light";
}

function readStorage(key: string): Theme | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(key);
    return isTheme(value) ? value : null;
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
  return isTheme(body.theme) ? body.theme : DEFAULT_THEME;
}

export function announceWorkspaceDefaultTheme(theme: Theme) {
  writeStorage(WORKSPACE_KEY, theme);
  window.dispatchEvent(
    new CustomEvent<Theme>(DEFAULT_THEME_EVENT, { detail: theme }),
  );
}

type ThemeContextValue = {
  theme: Theme;
  workspaceDefault: Theme;
  followsWorkspaceDefault: boolean;
  setTheme: (theme: Theme) => void;
  useWorkspaceDefault: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
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
  const [workspaceDefault, setWorkspaceDefault] = useState<Theme>(
    initial.workspaceDefault,
  );
  const [followsWorkspaceDefault, setFollowsWorkspaceDefault] = useState(
    initial.followsWorkspaceDefault,
  );

  useEffect(() => {
    applyTheme(theme);
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
      const next = (event as CustomEvent<unknown>).detail;
      if (!isTheme(next)) return;
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
      workspaceDefault,
      followsWorkspaceDefault,
      setTheme,
      useWorkspaceDefault,
    }),
    [
      theme,
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

const menuInitial = { opacity: 0, scale: 0.95, y: -4 };
const menuAnimate = { opacity: 1, scale: 1, y: 0 };

export function ThemeToggle() {
  const {
    theme,
    workspaceDefault,
    followsWorkspaceDefault,
    setTheme,
    useWorkspaceDefault,
  } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
  const CurrentIcon = THEME_ICONS[current.id];
  const defaultLabel =
    THEME_OPTIONS.find((option) => option.id === workspaceDefault)?.label ??
    "Workspace theme";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title={`Theme: ${current.label}`}
        aria-label="Change theme"
        className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <CurrentIcon size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Close theme menu"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={menuInitial}
              animate={menuAnimate}
              exit={menuInitial}
              className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
            >
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Appearance
              </div>
              {THEME_OPTIONS.map((option) => {
                const OptionIcon = THEME_ICONS[option.id];
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setTheme(option.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                  >
                    <OptionIcon size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        {option.label}
                        {!followsWorkspaceDefault && theme === option.id && (
                          <Check size={14} className="ml-auto text-drift-500" />
                        )}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="my-1 h-px bg-slate-100" />
              <button
                onClick={() => {
                  useWorkspaceDefault();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw size={15} />
                <span>
                  <span className="flex items-center gap-2 font-medium">
                    Use workspace default
                    {followsWorkspaceDefault && (
                      <Check size={14} className="ml-auto text-drift-500" />
                    )}
                  </span>
                  <span className="block text-xs text-slate-400">
                    Currently {defaultLabel}
                  </span>
                </span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
