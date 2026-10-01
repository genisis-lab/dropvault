import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
// An optional inline action, e.g. "Undo" after moving a file to Trash.
type ToastAction = { label: string; onClick: () => void };
type ToastOptions = { action?: ToastAction };
type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
};

type ToastApi = {
  toast: (message: string, kind?: ToastKind, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const enter = { opacity: 0, y: 16, scale: 0.96 };
const shown = { opacity: 1, y: 0, scale: 1 };

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info", options?: ToastOptions) => {
      const id = ++counter;
      setToasts((prev) => [
        ...prev,
        { id, kind, message, action: options?.action },
      ]);
      // Leave actionable toasts up long enough to reach the button.
      setTimeout(() => remove(id), options?.action ? 8000 : 4000);
    },
    [remove],
  );

  const api: ToastApi = {
    toast,
    success: (m, o) => toast(m, "success", o),
    error: (m, o) => toast(m, "error", o),
    info: (m, o) => toast(m, "info", o),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2"
      >
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
                {t.kind === "error" ? (
                  <AlertCircle size={14} />
                ) : t.kind === "success" ? (
                  <Check size={14} />
                ) : (
                  <Info size={14} />
                )}
              </span>
              <p className="flex-1 leading-snug text-slate-700">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                  className="-my-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-drift-600 transition hover:bg-drift-50 hover:text-drift-700"
                >
                  {t.action.label}
                </button>
              )}
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
  );
}
