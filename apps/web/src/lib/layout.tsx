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
import { Check, LayoutGrid, Shapes, Sparkles, type LucideIcon } from "lucide-react"

// The layout (or "experience") is orthogonal to the color theme in theme.tsx.
// Themes control colors (auto/light/dark/sunset); the layout controls the
// overall shape of the dashboard. "calm" is the Calm Workspace (Concept A) and
// is the default; "classic" preserves the original Dropvault layout; and
// "playground" is the playful, colorful Google-Drive-style skin. Playground
// currently reuses the classic dashboard structure (Dashboard only special-
// cases "calm") while it adds the playful skin via the `skin-playground` class.
export type Layout = "calm" | "classic" | "playground"

export const LAYOUTS: Layout[] = ["calm", "classic", "playground"]
const STORAGE_KEY = "dropvault-layout"

const LAYOUT_OPTIONS: { id: Layout; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "calm", label: "Calm Workspace", desc: "Spacious, search-first home", icon: Sparkles },
  { id: "classic", label: "Classic", desc: "The original Dropvault layout", icon: LayoutGrid },
  { id: "playground", label: "Playground", desc: "Playful, colorful Google-Drive style", icon: Shapes },
]

function isLayout(value: unknown): value is Layout {
  return value === "calm" || value === "classic" || value === "playground"
}

function readStoredLayout(): Layout {
  if (typeof localStorage === "undefined") return "calm"
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLayout(stored)) return stored
  } catch {
    /* ignore */
  }
  return "calm"
}

// Toggles the documentElement class so the Playground skin (colorful, rounded,
// playful tokens in index.css) can re-style the app on top of any color theme,
// without a full structural rebuild.
export function applySkin(layout: Layout) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("skin-playground", layout === "playground")
}

type LayoutContextValue = { layout: Layout; setLayout: (layout: Layout) => void }

const LayoutContext = createContext<LayoutContextValue>({
  layout: "calm",
  setLayout: () => {},
})

export function useLayout() {
  return useContext(LayoutContext)
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayoutState] = useState<Layout>(readStoredLayout)

  useEffect(() => {
    applySkin(layout)
  }, [layout])

  const setLayout = useCallback((next: Layout) => {
    setLayoutState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<LayoutContextValue>(() => ({ layout, setLayout }), [layout, setLayout])

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

const menuInitial = { opacity: 0, scale: 0.95, y: -4 }
const menuAnimate = { opacity: 1, scale: 1, y: 0 }

export function LayoutToggle() {
  const { layout, setLayout } = useLayout()
  const [open, setOpen] = useState(false)
  const current = LAYOUT_OPTIONS.find((o) => o.id === layout) ?? LAYOUT_OPTIONS[0]
  const CurrentIcon = current.icon

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Layout"
        aria-label="Change layout"
        className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <CurrentIcon size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Close layout menu"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={menuInitial}
              animate={menuAnimate}
              exit={menuInitial}
              className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
            >
              {LAYOUT_OPTIONS.map((option) => {
                const OptionIcon = option.icon
                const active = layout === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setLayout(option.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                  >
                    <OptionIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        {option.label}
                        {active && <Check size={14} className="ml-auto text-drift-500" />}
                      </span>
                      <span className="block text-xs text-slate-400">{option.desc}</span>
                    </span>
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
