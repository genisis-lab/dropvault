import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEscapeToClose } from "../lib/useEscapeToClose";

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
  useEscapeToClose(open, onCancel);
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
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
        >
          <motion.form
            initial={panelInit}
            animate={panelShow}
            exit={panelInit}
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-sm rounded-[28px] bg-menu p-6 drive-shadow-lg"
          >
            <h2 className="text-2xl font-normal text-strong">{title}</h2>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={/file/i.test(title) ? "File name" : "Folder name"}
              aria-label={/file/i.test(title) ? "File name" : "Folder name"}
              className="drive-field mt-4"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="btn-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-filled"
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
