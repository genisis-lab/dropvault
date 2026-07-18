import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";

const backdropInit = { opacity: 0 };
const backdropShow = { opacity: 1 };
const panelInit = { opacity: 0, scale: 0.96, y: 8 };
const panelShow = { opacity: 1, scale: 1, y: 0 };

export default function NameDialog({
  open,
  title,
  initial,
  confirmLabel = "Create",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  initial?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => {
    if (open) setValue(initial ?? "");
  }, [open, initial]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onConfirm(v);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={backdropInit}
          animate={backdropShow}
          exit={backdropInit}
          onClick={onCancel}
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 px-4 backdrop-blur-sm"
        >
          <motion.form
            initial={panelInit}
            animate={panelShow}
            exit={panelInit}
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 drive-shadow-lg"
          >
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Folder name"
              className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-drift-400 focus:bg-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-gradient-to-r from-drift-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
