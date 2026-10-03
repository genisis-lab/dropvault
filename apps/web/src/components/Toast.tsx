import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";

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
        className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(calc(100vw-2rem),36rem)] -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-6 sm:translate-x-0"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={enter}
              animate={shown}
              exit={enter}
              className="snackbar pointer-events-auto flex min-h-[3rem] items-center gap-3 rounded-lg py-2 pl-4 pr-2 text-sm"
              data-kind={t.kind}
            >
              {t.kind === "error" && (
                <AlertCircle
                  size={18}
                  className="shrink-0 text-[#f2b8b5] dark:text-[#b3261e]"
                  aria-hidden="true"
                />
              )}
              <p className="min-w-0 flex-1 leading-snug">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                  className="snackbar-action shrink-0 rounded-full px-3 py-2 font-medium hover:bg-white/10"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full opacity-80 transition hover:bg-white/10 hover:opacity-100"
              >
                <X size={18} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
