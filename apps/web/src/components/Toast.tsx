import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, Check, Info, X } from "lucide-react"

type ToastKind = "success" | "error" | "info"
type ToastItem = { id: number; kind: ToastKind; message: string }

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}

const enter = { opacity: 0, y: 16, scale: 0.96 }
const shown = { opacity: 1, y: 0, scale: 1 }

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++counter
      setToasts((prev) => [...prev, { id, kind, message }])
      setTimeout(() => remove(id), 4000)
    },
    [remove],
  )

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
    info: (m) => toast(m, "info"),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={enter}
              animate={shown}
              exit={enter}
              className={
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 text-sm drive-shadow-lg " +
                (t.kind === "error"
                  ? "border-red-200"
                  : t.kind === "success"
                    ? "border-emerald-200"
                    : "border-slate-200")
              }
            >
              <span
                className={
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full " +
                  (t.kind === "error"
                    ? "bg-red-50 text-red-500"
                    : t.kind === "success"
                      ? "bg-emerald-50 text-emerald-500"
                      : "bg-slate-100 text-slate-500")
                }
              >
                {t.kind === "error" ? <AlertCircle size={14} /> : t.kind === "success" ? <Check size={14} /> : <Info size={14} />}
              </span>
              <p className="flex-1 leading-snug text-slate-700">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
                className="shrink-0 text-slate-300 transition hover:text-slate-500"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
