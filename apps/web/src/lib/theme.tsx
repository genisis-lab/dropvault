import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Monitor, Moon, Sun, Sunset, type LucideIcon } from "lucide-react"

// A user's stored appearance preference. "auto" follows the operating system's
// light/dark setting live; light/dark/sunset are explicit overrides. "sunset"
// is a dark-family accent theme.
export type Theme = "auto" | "light" | "dark" | "sunset"
// The concrete theme actually applied to <html> (never "auto").
export type ResolvedTheme = "light" | "dark" | "sunset"

export const THEMES: Theme[] = ["auto", "light", "dark", "sunset"]
const STORAGE_KEY = "dropvault-theme"

const THEME_OPTIONS: { id: Theme; label: string; icon: LucideIcon }[] = [
  { id: "auto", label: "Auto", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "sunset", label: "Sunset", icon: Sunset },
]

function isTheme(value: unknown): value is Theme {
  return value === "auto" || value === "light" || value === "dark" || value === "sunset"
}

// Whether the operating system currently prefers a dark color scheme.
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

// Resolves a stored preference into the concrete theme to apply. "auto" maps to
// the OS preference (light or dark).
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "auto") return systemPrefersDark() ? "dark" : "light"
  return theme
}

// Applies the theme by toggling a class on <html>. Light is the default (no
// class). Keeping this exported lets the anti-FOUC inline script and React stay
// in sync on the same source of truth.
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return
  const resolved = resolveTheme(theme)
  const el = document.documentElement
  el.classList.remove("dark", "sunset")
  if (resolved !== "light") el.classList.add(resolved)
  el.style.colorScheme = resolved === "light" ? "light" : "dark"
}

function readStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "auto"
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isTheme(stored)) return stored
  } catch {
    /* ignore */
  }
  // No saved preference: follow the operating system out of the box.
  return "auto"
}

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "auto",
  resolvedTheme: "light",
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  )

  useEffect(() => {
    applyTheme(theme)
    setResolvedTheme(resolveTheme(theme))
  }, [theme])

  // When following the system, re-apply whenever the OS light/dark setting flips.
  useEffect(() => {
    if (theme !== "auto") return
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      applyTheme("auto")
      setResolvedTheme(resolveTheme("auto"))
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

const menuInitial = { opacity: 0, scale: 0.95, y: -4 }
const menuAnimate = { opacity: 1, scale: 1, y: 0 }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const current = THEME_OPTIONS.find((o) => o.id === theme) ?? THEME_OPTIONS[0]
  const CurrentIcon = current.icon

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Theme"
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
              className="absolute right-0 top-11 z-40 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
            >
              {THEME_OPTIONS.map((option) => {
                const OptionIcon = option.icon
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setTheme(option.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <OptionIcon size={15} /> {option.label}
                    {theme === option.id && <Check size={14} className="ml-auto text-drift-500" />}
                  </button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
