import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, LockKeyhole, ShieldAlert, X } from "lucide-react";
import type { DriftFile } from "../lib/api";
import { getEncryptionKey, saveEncryptionKey } from "../lib/encryption";
import {
  configureFileRecovery,
  createCredentialSalt,
  createPasswordKeyEnvelope,
  deriveRecoveryProof,
  MAX_RECOVERY_PASSWORD_LENGTH,
  MIN_RECOVERY_PASSWORD_LENGTH,
  recoverAccountFileKey,
  recoverPasswordFileKey,
  recoveryStatus,
  type RecoveryStatus,
} from "../lib/vaultRecovery";

type Props = {
  file: DriftFile;
  open: boolean;
  onClose: () => void;
};

const emptyStatus: RecoveryStatus = {
  accountRecovery: false,
  passwordRecovery: false,
  duressEnabled: false,
  legacyBrowserOnly: true,
  credentialSalt: null,
};

export default function VaultRecoveryDialog({ file, open, onClose }: Props) {
  const [status, setStatus] = useState<RecoveryStatus>(emptyStatus);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountEnabled, setAccountEnabled] = useState(true);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [duressEnabled, setDuressEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [duress, setDuress] = useState("");
  const [duressConfirm, setDuressConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    setPassword("");
    setPasswordConfirm("");
    setDuress("");
    setDuressConfirm("");
    recoveryStatus(file.id)
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setAccountEnabled(next.accountRecovery || next.legacyBrowserOnly);
        setPasswordEnabled(next.passwordRecovery);
        setDuressEnabled(next.duressEnabled);
      })
      .catch((cause) => {
        if (active)
          setError((cause as Error)?.message || "Couldn't load recovery settings");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [file.id, open]);

  async function availableFileKey(): Promise<string> {
    const local = await getEncryptionKey(file.id).catch(() => null);
    if (local) return local;
    if (status.accountRecovery) {
      const recovered = await recoverAccountFileKey(file.id);
      await saveEncryptionKey(file.id, recovered, {
        nonce: file.encryptionNonce,
        encryptedMetadata: file.encryptedMetadata,
      });
      return recovered;
    }
    if (status.passwordRecovery && password) {
      const recovered = await recoverPasswordFileKey(
        file.id,
        password,
        status.credentialSalt,
      );
      await saveEncryptionKey(file.id, recovered, {
        nonce: file.encryptionNonce,
        encryptedMetadata: file.encryptedMetadata,
      });
      return recovered;
    }
    throw new Error(
      "Open this file on a browser that already has its key before changing recovery settings.",
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    if (!accountEnabled && !passwordEnabled) {
      setError("Keep account recovery or password recovery enabled.");
      return;
    }
    const passwordChanged = password.length > 0 || passwordConfirm.length > 0;
    if (passwordEnabled && !status.passwordRecovery && !passwordChanged) {
      setError("Enter and confirm a recovery password.");
      return;
    }
    if (passwordChanged) {
      if (password !== passwordConfirm) {
        setError("Recovery password confirmation does not match.");
        return;
      }
      const length = Array.from(password.normalize("NFKC")).length;
      if (
        length < MIN_RECOVERY_PASSWORD_LENGTH ||
        length > MAX_RECOVERY_PASSWORD_LENGTH
      ) {
        setError(
          `Recovery passwords must be ${MIN_RECOVERY_PASSWORD_LENGTH}-${MAX_RECOVERY_PASSWORD_LENGTH} characters.`,
        );
        return;
      }
    }
    const duressChanged = duress.length > 0 || duressConfirm.length > 0;
    if (duressEnabled && !status.duressEnabled && !duressChanged) {
      setError("Enter and confirm a duress password.");
      return;
    }
    if (duressChanged) {
      if (duress !== duressConfirm) {
        setError("Duress password confirmation does not match.");
        return;
      }
      const length = Array.from(duress.normalize("NFKC")).length;
      if (
        length < MIN_RECOVERY_PASSWORD_LENGTH ||
        length > MAX_RECOVERY_PASSWORD_LENGTH ||
        /^\d+$/.test(duress.normalize("NFKC"))
      ) {
        setError(
          `The duress password must be ${MIN_RECOVERY_PASSWORD_LENGTH}-${MAX_RECOVERY_PASSWORD_LENGTH} characters and cannot be all numeric.`,
        );
        return;
      }
      if (!passwordChanged) {
        setError(
          "Re-enter the recovery password when adding or changing the duress password.",
        );
        return;
      }
      if (duress.normalize("NFKC") === password.normalize("NFKC")) {
        setError("Recovery and duress passwords must be different.");
        return;
      }
    }

    setSaving(true);
    try {
      const needsKey =
        (accountEnabled && !status.accountRecovery) ||
        (passwordEnabled && passwordChanged);
      const key = needsKey ? await availableFileKey() : null;
      const passwordEnvelope =
        passwordEnabled && passwordChanged && key
          ? await createPasswordKeyEnvelope(key, password, file.id)
          : undefined;
      const credentialSalt =
        passwordEnabled && passwordChanged
          ? status.credentialSalt ?? createCredentialSalt()
          : status.credentialSalt;
      const [passwordProof, duressProof] = await Promise.all([
        passwordEnabled && passwordChanged && credentialSalt
          ? deriveRecoveryProof(password, credentialSalt)
          : Promise.resolve(undefined),
        duressEnabled && duressChanged && credentialSalt
          ? deriveRecoveryProof(duress, credentialSalt)
          : Promise.resolve(undefined),
      ]);
      const next = await configureFileRecovery(file.id, {
        account: accountEnabled
          ? status.accountRecovery
            ? { action: "keep" }
            : { action: "set", key: key ?? undefined }
          : { action: "remove" },
        password: passwordEnabled
          ? passwordEnvelope
            ? {
                action: "set",
                envelope: passwordEnvelope,
                proof: passwordProof,
                credentialSalt: credentialSalt ?? undefined,
              }
            : { action: "keep" }
          : { action: "remove" },
        duress: duressEnabled
          ? duressChanged
            ? { action: "set", proof: duressProof }
            : { action: "keep" }
          : { action: "remove" },
      });
      setStatus(next);
      setSaved(true);
      setPassword("");
      setPasswordConfirm("");
      setDuress("");
      setDuressConfirm("");
    } catch (cause) {
      setError((cause as Error)?.message || "Couldn't save recovery settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            onClick={(event) => event.stopPropagation()}
            className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <LockKeyhole size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">
                    Encrypted file recovery
                  </h2>
                  <p className="text-xs text-slate-400">
                    Choose how this file can be unlocked on another device.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close recovery settings"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
              {loading ? (
                <p className="text-slate-500">Loading recovery settings…</p>
              ) : (
                <>
                  <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      checked={accountEnabled}
                      onChange={(event) => setAccountEnabled(event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-slate-700">
                        Recover after signing in
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                        Convenient cross-device access. Dropvault stores a
                        service-wrapped copy of the file key, so this mode is
                        not strict end-to-end encryption.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      checked={passwordEnabled}
                      onChange={(event) => {
                        setPasswordEnabled(event.target.checked);
                        if (!event.target.checked) setDuressEnabled(false);
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-slate-700">
                        Recovery password
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                        The password wraps the key in your browser. Leave both
                        fields blank to keep the existing password.
                      </span>
                    </span>
                  </label>
                  {passwordEnabled && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Recovery password"
                        className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400"
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={passwordConfirm}
                        onChange={(event) => setPasswordConfirm(event.target.value)}
                        placeholder="Confirm password"
                        className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400"
                      />
                    </div>
                  )}

                  <label className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
                    <input
                      type="checkbox"
                      checked={duressEnabled}
                      disabled={!passwordEnabled}
                      onChange={(event) => setDuressEnabled(event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-semibold text-red-700">
                        <ShieldAlert size={14} /> Duress password
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-red-700/80">
                        Entering this password permanently removes the file,
                        thumbnail, versions, folder entry, Trash entry, shares,
                        and recovery keys. This cannot be undone.
                      </span>
                    </span>
                  </label>
                  {duressEnabled && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={duress}
                        onChange={(event) => setDuress(event.target.value)}
                        placeholder="Duress password"
                        className="rounded-xl border border-red-200 px-3 py-2 outline-none focus:border-red-400"
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={duressConfirm}
                        onChange={(event) => setDuressConfirm(event.target.value)}
                        placeholder="Confirm duress password"
                        className="rounded-xl border border-red-200 px-3 py-2 outline-none focus:border-red-400"
                      />
                    </div>
                  )}
                </>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              {saved && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <KeyRound size={13} /> Recovery settings saved.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                onClick={() => void save()}
                disabled={loading || saving}
                className="rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save recovery"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
