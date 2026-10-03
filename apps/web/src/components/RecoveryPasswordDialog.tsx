import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, X } from "lucide-react";
import type { RecoveryPasswordRequest } from "../lib/vaultRecovery";
import { useEscapeToClose } from "../lib/useEscapeToClose";

export default function RecoveryPasswordDialog() {
  const [request, setRequest] = useState<RecoveryPasswordRequest | null>(null);
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<RecoveryPasswordRequest>).detail;
      if (!detail) return;
      setPassword("");
      setRequest(detail);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    };
    window.addEventListener("dropvault:recovery-password-request", onRequest);
    return () =>
      window.removeEventListener(
        "dropvault:recovery-password-request",
        onRequest,
      );
  }, []);

  function close(value: string | null) {
    request?.resolve(value);
    setRequest(null);
    setPassword("");
  }

  function submit() {
    if (password) close(password);
  }
  useEscapeToClose(!!request, () => close(null));

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
          onClick={() => close(null)}
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-[28px] bg-menu drive-shadow-lg"
          >
            <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <KeyRound size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-xl font-normal text-strong">
                    Recovery password
                  </h2>
                  <p className="truncate text-xs text-slate-400">
                    {request.filename}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => close(null)}
                aria-label="Cancel"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-4">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Enter the password for this encrypted file
              </label>
              <input
                ref={inputRef}
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-outline bg-transparent px-3 py-2.5 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
              />
              <p className="mt-2 text-xs leading-5 text-slate-400">
                The recovery password is used in this browser to unwrap the
                file key. It is never stored as plaintext.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button
                type="button"
                onClick={() => close(null)}
                className="btn-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!password}
                className="rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white shadow-md transition disabled:opacity-50"
              >
                Unlock file
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
