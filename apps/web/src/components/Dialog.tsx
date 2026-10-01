import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  HardDrive,
  ShieldAlert,
  Tags as TagsIcon,
  X,
} from "lucide-react";
import { useEscapeToClose } from "../lib/useEscapeToClose";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.96, y: 10 };
const panelAnimate = { opacity: 1, scale: 1, y: 0 };
const panelExit = { opacity: 0, scale: 0.96, y: 10 };

function Shell({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEscapeToClose(true, onClose);
  return (
    <motion.div
      variants={backdrop}
      initial="hidden"
      animate="show"
      exit="hidden"
      onClick={onClose}
      className="fixed inset-0 z-[97] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={panelInitial}
        animate={panelAnimate}
        exit={panelExit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon}
            <h2 className="truncate text-sm font-semibold text-slate-800">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const btn = danger
    ? "bg-red-600 hover:bg-red-500"
    : "bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 hover:brightness-105";
  return (
    <AnimatePresence>
      {open && (
        <Shell
          title={title}
          icon={
            danger ? (
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-red-50 text-red-600">
                <AlertTriangle size={18} />
              </div>
            ) : undefined
          }
          onClose={onCancel}
        >
          <div className="px-5 py-4 text-sm text-slate-600">{message}</div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={
                "rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-md transition " +
                btn
              }
            >
              {confirmLabel}
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  );
}

export function PromptDialog({
  open,
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel = "Save",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initial]);
  function submit() {
    onConfirm(value.trim());
  }
  return (
    <AnimatePresence>
      {open && (
        <Shell title={title} onClose={onCancel}>
          <div className="px-5 py-4">
            {label && (
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {label}
              </span>
            )}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder={placeholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105"
            >
              {confirmLabel}
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  );
}

export function TagsDialog({
  open,
  title = "Edit tags",
  initialTags = [],
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  initialTags?: string[];
  onConfirm: (tags: string[]) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(initialTags.join(", "));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setRaw(initialTags.join(", "));
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initialTags.join("|")]);
  function submit() {
    onConfirm(
      raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
  }
  const preview = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <AnimatePresence>
      {open && (
        <Shell
          title={title}
          icon={
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600">
              <TagsIcon size={18} />
            </div>
          }
          onClose={onCancel}
        >
          <div className="px-5 py-4">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Tags <span className="text-slate-400">(comma-separated)</span>
            </span>
            <input
              ref={inputRef}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder="work, invoices, 2026"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
            />
            {preview.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {preview.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105"
            >
              Save tags
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  );
}

export function LimitRequestDialog({
  open,
  currentBytes,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  currentBytes?: number | null;
  onConfirm: (bytes: number, reason: string) => void;
  onCancel: () => void;
}) {
  const [gb, setGb] = useState("5");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setGb("5");
      setReason("");
    }
  }, [open]);
  const gbNum = Number(gb);
  const valid = Number.isFinite(gbNum) && gbNum >= 1;
  function submit() {
    if (!valid) return;
    onConfirm(Math.floor(gbNum * 1024 * 1024 * 1024), reason.trim());
  }
  const currentGb =
    currentBytes != null
      ? (currentBytes / (1024 * 1024 * 1024)).toFixed(
          currentBytes % (1024 * 1024 * 1024) === 0 ? 0 : 1,
        )
      : null;
  return (
    <AnimatePresence>
      {open && (
        <Shell
          title="Request a larger upload limit"
          icon={
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600">
              <HardDrive size={18} />
            </div>
          }
          onClose={onCancel}
        >
          <div className="space-y-4 px-5 py-4">
            {currentGb && (
              <p className="text-xs text-slate-500">
                Your current limit is{" "}
                <span className="font-semibold text-slate-700">
                  {currentGb} GB
                </span>
                .
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Requested limit (GB)
              </span>
              <input
                type="number"
                min={1}
                value={gb}
                onChange={(e) => setGb(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Reason <span className="text-slate-400">(optional)</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Uploading larger files for work"
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!valid}
              className="rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-50"
            >
              Send request
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  );
}

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

// In-app replacement for window.confirm: render the returned element once,
// then `await confirm({...})` resolves true only when the user confirms.
export function useConfirm(): [
  ReactNode,
  (options: ConfirmOptions) => Promise<boolean>,
] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((next: ConfirmOptions) => {
    resolveRef.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);
  const settle = (ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setOpen(false);
  };
  const element = (
    <ConfirmDialog
      open={open}
      title={options?.title ?? ""}
      message={options?.message ?? ""}
      confirmLabel={options?.confirmLabel}
      danger={options?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [element, confirm];
}

function TypedConfirmDialog({
  phrase,
  onConfirm,
  onCancel,
}: {
  phrase: string | null;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!phrase) return;
    setValue("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [phrase]);
  const matches = phrase != null && value === phrase;
  return (
    <AnimatePresence>
      {phrase && (
        <Shell
          title="Owner confirmation required"
          icon={
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-red-50 text-red-600">
              <ShieldAlert size={18} />
            </div>
          }
          onClose={onCancel}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (matches) onConfirm(value);
            }}
          >
            <label className="block px-5 py-4 text-sm text-slate-600">
              Type{" "}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800">
                {phrase}
              </span>{" "}
              to continue.
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label={`Type ${phrase} to continue`}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none transition focus:border-red-400"
              />
            </label>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!matches}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-500 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </form>
        </Shell>
      )}
    </AnimatePresence>
  );
}

// In-app replacement for the "type PHRASE to continue" window.prompt. Resolves
// to the phrase once typed exactly, or null if the dialog is dismissed.
export function useTypedConfirmation(): [
  ReactNode,
  (phrase: string) => Promise<string | null>,
] {
  const [phrase, setPhrase] = useState<string | null>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);
  const request = useCallback((next: string) => {
    resolveRef.current?.(null);
    setPhrase(next);
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);
  const settle = (value: string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setPhrase(null);
  };
  const element = (
    <TypedConfirmDialog
      phrase={phrase}
      onConfirm={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  );
  return [element, request];
}
