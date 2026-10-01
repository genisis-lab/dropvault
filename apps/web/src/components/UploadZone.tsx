import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  FolderUp,
  Infinity,
  LockKeyhole,
  UploadCloud,
  X,
  ChevronDown,
} from "lucide-react";
import {
  complete,
  cancelUpload,
  fileContentHash,
  fileCapabilities,
  generateAndUploadThumbnail,
  MULTIPART_THRESHOLD,
  permanentDeleteFile,
  presign,
  uploadLargeFile,
  uploadCheckpointMustBeCleared,
  uploadToR2,
  uploadUrlFor,
} from "../lib/api";
import {
  clearUploadCheckpoint,
  getUploadCheckpoint,
  saveUploadCheckpoint,
} from "../lib/resumable";
import { accountStatus } from "../lib/account";
import { formatBytes } from "../lib/format";
import {
  deleteEncryptionKey,
  encryptForUpload,
  MAX_BROWSER_ENCRYPTION_BYTES,
  saveEncryptionKey,
} from "../lib/encryption";
import {
  configureFileRecovery,
  createCredentialSalt,
  createPasswordKeyEnvelope,
  deriveRecoveryProof,
  MAX_RECOVERY_PASSWORD_LENGTH,
  MIN_RECOVERY_PASSWORD_LENGTH,
} from "../lib/vaultRecovery";

type JobState =
  | "queued"
  | "preparing"
  | "uploading"
  | "finishing"
  | "done"
  | "error"
  | "cancelled";
const isActive = (state: JobState) =>
  ["queued", "preparing", "uploading", "finishing"].includes(state);
type Job = {
  name: string;
  size: number;
  pct: number;
  state: JobState;
  error?: string;
  file: File;
};

export type UploadZoneHandle = {
  uploadFiles: (files: FileList | File[] | null) => Promise<void>;
  uploadDrop: (dataTransfer: DataTransfer) => Promise<void>;
};

type UploadZoneProps = {
  hidden?: boolean;
  selectionActive?: boolean;
  expiryDays: number;
  // Whether uploads should be kept forever when the account allows it. The
  // dashboard owns this so its expiration menu and this checkbox agree.
  keepForever?: boolean;
  onKeepForeverChange?: (keepForever: boolean) => void;
  onUploaded: () => void;
  inputRef?: RefObject<HTMLInputElement>;
  folderId?: string | null;
  folderName?: string;
};

// How many files upload in parallel. Bounded so we don't flood the Worker / R2
// (which is what caused large batches to partially fail before).
const UPLOAD_CONCURRENCY = 3;
const MAX_BATCH_FILES = 100;
const MAX_ATTEMPTS = 3;

const zoneIdle = { borderColor: "#cbd5e1", backgroundColor: "#ffffff" };
const zoneActive = {
  borderColor: "#7c3aed",
  backgroundColor: "rgba(124,58,237,0.06)",
};
const iconUp = { y: -6 };
const iconDown = { y: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Errors that will never succeed on retry (quota, type, size, permission, auth).
// Everything else is treated as transient and retried with backoff.
function isPermanentError(message: string): boolean {
  return /quota|not allowed|suspended|permission|blocked|exceeds|too large|offline|cancelled|451|413|415|403|401|400/i.test(
    message,
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = MAX_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? "";
      if (
        (e instanceof DOMException && e.name === "AbortError") ||
        uploadCheckpointMustBeCleared(e) ||
        isPermanentError(msg) ||
        i === attempts - 1
      )
        break;
      await sleep(400 * 2 ** i + Math.random() * 250);
    }
  }
  throw lastErr;
}

function readEntry(entry: any, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (!entry) return resolve();
    if (entry.isFile) {
      entry.file(
        (f: File) => {
          out.push(f);
          resolve();
        },
        () => resolve(),
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all: any[] = [];
      const readBatch = () =>
        reader.readEntries(
          (batch: any[]) => {
            if (!batch.length) {
              Promise.all(all.map((e) => readEntry(e, out))).then(() =>
                resolve(),
              );
            } else {
              all.push(...batch);
              readBatch();
            }
          },
          () => resolve(),
        );
      readBatch();
    } else resolve();
  });
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  const canTraverse =
    items &&
    items.length > 0 &&
    typeof (items[0] as any).webkitGetAsEntry === "function";
  if (canTraverse) {
    const entries: any[] = [];
    for (const it of Array.from(items)) {
      const e = (it as any).webkitGetAsEntry?.();
      if (e) entries.push(e);
    }
    if (entries.length) {
      const out: File[] = [];
      for (const e of entries) await readEntry(e, out);
      if (out.length) return out;
    }
  }
  return Array.from(dt.files);
}

const UploadZone = forwardRef<UploadZoneHandle, UploadZoneProps>(
  function UploadZone(
    {
      hidden = false,
      selectionActive = false,
      expiryDays,
      keepForever = false,
      onKeepForeverChange,
      onUploaded,
      inputRef,
      folderId = null,
      folderName,
    },
    uploadZoneRef,
  ) {
    const controllers = useRef(new Map<string, AbortController>());
    const [trayOpen, setTrayOpen] = useState(true);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [jobs, setJobs] = useState<Record<string, Job>>({});
    const [canKeepForever, setCanKeepForever] = useState(false);
    const [encryptChoice, setEncryptChoice] = useState(false);
    const [accountRecoveryAvailable, setAccountRecoveryAvailable] =
      useState(false);
    const [passwordRecoveryAvailable, setPasswordRecoveryAvailable] =
      useState(false);
    const [accountRecoveryChoice, setAccountRecoveryChoice] = useState(false);
    const [passwordRecoveryChoice, setPasswordRecoveryChoice] = useState(false);
    const [recoveryPassword, setRecoveryPassword] = useState("");
    const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("");
    const [duressChoice, setDuressChoice] = useState(false);
    const [duressPassword, setDuressPassword] = useState("");
    const [duressPasswordConfirm, setDuressPasswordConfirm] = useState("");
    const [e2eCapability, setE2eCapability] = useState<
      "checking" | "available" | "unavailable"
    >("checking");
    const [batchError, setBatchError] = useState<string | null>(null);
    const [batchRunning, setBatchRunning] = useState(false);
    const [releaseAtInput, setReleaseAtInput] = useState("");
    const [expireAfterDownloadChoice, setExpireAfterDownloadChoice] =
      useState(false);
    const localRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const ref = inputRef ?? localRef;
    const jobsRef = useRef(jobs);
    const batchRunningRef = useRef(false);
    useEffect(() => {
      jobsRef.current = jobs;
    }, [jobs]);

    const patchJob = useCallback((key: string, patch: Partial<Job>) => {
      const current = jobsRef.current[key];
      if (!current) return;
      const next = {
        ...jobsRef.current,
        [key]: { ...current, ...patch },
      };
      // Keep the admission check synchronous with the rendered queue. React may
      // batch state updates after a 218+ MiB upload finishes; a ref that still
      // says "uploading" would otherwise reject every immediately-following
      // file even though the batch has released its lock.
      jobsRef.current = next;
      setJobs(next);
    }, []);

    useEffect(() => {
      let alive = true;
      accountStatus()
        .then((status) => {
          if (!alive) return;
          setCanKeepForever(!!status.canKeepFilesForever);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      let alive = true;
      fileCapabilities()
        .then((capabilities) => {
          if (!alive) return;
          const available = capabilities.e2eEncryption === true;
          setE2eCapability(available ? "available" : "unavailable");
          setAccountRecoveryAvailable(capabilities.accountRecovery === true);
          setPasswordRecoveryAvailable(capabilities.passwordRecovery === true);
          setAccountRecoveryChoice(capabilities.accountRecovery === true);
          setPasswordRecoveryChoice(
            available &&
              capabilities.passwordRecovery === true &&
              capabilities.accountRecovery !== true,
          );
          if (!available) setEncryptChoice(false);
        })
        .catch(() => {
          if (!alive) return;
          setE2eCapability("unavailable");
          setAccountRecoveryAvailable(false);
          setPasswordRecoveryAvailable(false);
          setAccountRecoveryChoice(false);
          setPasswordRecoveryChoice(false);
          setEncryptChoice(false);
        });
      return () => {
        alive = false;
      };
    }, []);

    const effectiveKeepForever = canKeepForever && keepForever;
    const expiryText = effectiveKeepForever
      ? "Keep forever"
      : `Auto-expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}`;

    const uploadOne = useCallback(
      async (key: string, file: File) => {
        if (jobsRef.current[key]?.state === "cancelled") return;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        const signal = controller.signal;
        const startedAt = Date.now();
        const attemptId = crypto.randomUUID();
        let stage = "preparing";
        let reservation: string | undefined;
        let committed = false;
        const changeStage = (
          state: "preparing" | "uploading" | "finishing",
        ) => {
          stage = state;
          patchJob(key, { state });
        };
        patchJob(key, { state: "preparing", pct: 0, error: undefined });
        const report = (outcome: string, category?: string) => {
          void fetch(
            `${import.meta.env.VITE_API_URL ?? ""}/api/operations/upload-event`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                attemptId,
                fileId: reservation,
                outcome,
                stage,
                category,
                sizeBytes: file.size,
                durationMs: Date.now() - startedAt,
              }),
            },
          ).catch(() => {});
        };
        const setPct = (pct: number) => patchJob(key, { pct });
        try {
          const encrypted = encryptChoice ? await encryptForUpload(file) : null;
          signal.throwIfAborted();
          const payload = encrypted?.file ?? file;
          const existing =
            !encrypted && payload.size > MULTIPART_THRESHOLD
              ? await getUploadCheckpoint(file).catch(() => null)
              : null;
          // AES-GCM already authenticates the ciphertext and uses a random nonce,
          // so encrypted payload hashes cannot deduplicate files. Skipping this
          // avoids buffering the full ciphertext a second time in browser memory.
          const checksum =
            existing || encrypted
              ? null
              : await fileContentHash(payload, signal);
          const releaseAt = releaseAtInput
            ? Math.floor(new Date(releaseAtInput).getTime() / 1000)
            : null;
          signal.throwIfAborted();
          const id =
            existing?.id ??
            (
              await withRetry(() =>
                presign({
                  filename: payload.name,
                  contentType: payload.type,
                  sizeBytes: payload.size,
                  expiryDays,
                  folderId,
                  keepForever: effectiveKeepForever,
                  checksum,
                  contentHash: checksum,
                  encryptionMode: encrypted ? "aes-gcm" : "none",
                  encryptionNonce: encrypted?.nonce ?? null,
                  encryptedMetadata: encrypted?.encryptedMetadata ?? null,
                  releaseAt,
                  expireAfterDownload: expireAfterDownloadChoice,
                }),
              )
            ).id;
          reservation = id;
          signal.throwIfAborted();
          if (encrypted) {
            try {
              const passwordEnvelope = passwordRecoveryChoice
                ? await createPasswordKeyEnvelope(
                    encrypted.key,
                    recoveryPassword,
                    id,
                  )
                : undefined;
              const credentialSalt = passwordRecoveryChoice
                ? createCredentialSalt()
                : undefined;
              const [passwordProof, duressProof] = await Promise.all([
                passwordRecoveryChoice && credentialSalt
                  ? deriveRecoveryProof(recoveryPassword, credentialSalt)
                  : Promise.resolve(undefined),
                duressChoice && credentialSalt
                  ? deriveRecoveryProof(duressPassword, credentialSalt)
                  : Promise.resolve(undefined),
              ]);
              await configureFileRecovery(id, {
                account: accountRecoveryChoice
                  ? { action: "set", key: encrypted.key }
                  : { action: "remove" },
                password: passwordEnvelope
                  ? {
                      action: "set",
                      envelope: passwordEnvelope,
                      proof: passwordProof,
                      credentialSalt,
                    }
                  : { action: "remove" },
                duress: duressChoice
                  ? { action: "set", proof: duressProof }
                  : { action: "remove" },
              });
              await saveEncryptionKey(id, encrypted.key, {
                nonce: encrypted.nonce,
                encryptedMetadata: encrypted.encryptedMetadata,
              });
            } catch (recoveryCause) {
              // Recovery is part of the encrypted upload contract. Never leave a
              // pending reservation or upload bytes if its cross-device unlock
              // method could not be committed first.
              await permanentDeleteFile(id).catch(() => {});
              await deleteEncryptionKey(id).catch(() => {});
              throw recoveryCause;
            }
          }
          signal.throwIfAborted();
          changeStage("uploading");
          if (payload.size > MULTIPART_THRESHOLD) {
            if (!encrypted)
              await saveUploadCheckpoint(file, id).catch(() => {});
            await withRetry(() => {
              signal.throwIfAborted();
              changeStage("uploading");
              return uploadLargeFile(id, payload, setPct, signal, () =>
                changeStage("finishing"),
              );
            });
          } else {
            await withRetry(async () => {
              try {
                signal.throwIfAborted();
                changeStage("uploading");
                await uploadToR2(uploadUrlFor(id), payload, setPct, signal);
              } catch (e) {
                // A retry after the bytes already landed returns 409; treat as uploaded and finalize.
                if (!String((e as Error)?.message ?? "").includes("409"))
                  throw e;
              }
              signal.throwIfAborted();
              changeStage("finishing");
              await complete(id);
            });
          }
          committed = true;
          changeStage("finishing");
          // Best-effort: generate a small cached thumbnail so the grid/list never
          // has to download the full-size image (fixes slow/failed 12MB previews).
          if (!encrypted && file.type.startsWith("image/")) {
            const previewReady = await generateAndUploadThumbnail(
              id,
              file,
            ).catch(() => false);
            if (!previewReady) report("thumbnail-failed", "preview");
          }
          patchJob(key, { pct: 100, state: "done", error: undefined });
          report("success");
          await clearUploadCheckpoint(file).catch(() => {});
          onUploaded();
        } catch (e) {
          if (signal.aborted) {
            if (reservation && !committed) {
              try {
                const result = await cancelUpload(reservation);
                await clearUploadCheckpoint(file).catch(() => {});
                if (result.completed) {
                  patchJob(key, { state: "done", pct: 100 });
                  report("success");
                  onUploaded();
                  return;
                }
                await deleteEncryptionKey(reservation).catch(() => {});
              } catch {
                patchJob(key, {
                  state: "cancelled",
                  pct: 0,
                  error:
                    "Transfer stopped. Server cleanup could not be confirmed; refresh before retrying.",
                });
                report("cancelled", "cancelled");
                return;
              }
            }
            patchJob(key, { state: "cancelled", pct: 0 });
            report("cancelled", "cancelled");
            return;
          }
          const msg = (e as Error)?.message?.trim() || "Upload failed";
          // Only discard the file checkpoint when the API says the file
          // reservation itself is gone. A stale multipart *session* keeps the
          // same file id and is restarted automatically by uploadLargeFile().
          if (uploadCheckpointMustBeCleared(e)) {
            await clearUploadCheckpoint(file).catch(() => {});
          }
          patchJob(key, { state: "error", error: msg });
          report(
            "failed",
            /quota|too large|413/i.test(msg)
              ? "quota-or-size"
              : /offline|network|connection/i.test(msg)
                ? "network"
                : /permission|blocked|403|401/i.test(msg)
                  ? "access"
                  : "other",
          );
        } finally {
          controllers.current.delete(key);
        }
      },
      [
        expiryDays,
        effectiveKeepForever,
        encryptChoice,
        accountRecoveryChoice,
        passwordRecoveryChoice,
        recoveryPassword,
        duressChoice,
        duressPassword,
        releaseAtInput,
        expireAfterDownloadChoice,
        onUploaded,
        folderId,
        patchJob,
      ],
    );

    // Browser AES-GCM currently buffers a complete file. Encrypt one at a time so
    // a multi-file batch cannot retain several plaintext/ciphertext pairs at once.
    // Normal uploads keep bounded concurrency for throughput.
    const runJobs = useCallback(
      async (entries: Array<{ key: string; file: File }>) => {
        if (!entries.length) return;
        batchRunningRef.current = true;
        setBatchRunning(true);
        let cursor = 0;
        const worker = async () => {
          while (cursor < entries.length) {
            const current = entries[cursor++];
            await uploadOne(current.key, current.file);
          }
        };
        const concurrency = encryptChoice ? 1 : UPLOAD_CONCURRENCY;
        try {
          await Promise.all(
            Array.from({ length: Math.min(concurrency, entries.length) }, () =>
              worker(),
            ),
          );
        } finally {
          batchRunningRef.current = false;
          setBatchRunning(false);
          if (
            entries.every(({ key }) => jobsRef.current[key]?.state === "done")
          ) {
            setRecoveryPassword("");
            setRecoveryPasswordConfirm("");
            setDuressPassword("");
            setDuressPasswordConfirm("");
          }
        }
      },
      [encryptChoice, uploadOne],
    );

    const handleFiles = useCallback(
      async (incoming: FileList | File[] | null) => {
        if (!incoming) return;
        const files = Array.from(incoming);
        if (!files.length) return;
        if (encryptChoice && e2eCapability !== "available") {
          setBatchError(
            "Encrypted upload is unavailable because the production backend has not confirmed encryption support.",
          );
          return;
        }
        if (encryptChoice) {
          if (!accountRecoveryChoice && !passwordRecoveryChoice) {
            setBatchError(
              "Choose signed-in recovery or a recovery password before uploading encrypted files.",
            );
            return;
          }
          if (passwordRecoveryChoice) {
            const normalized = recoveryPassword.normalize("NFKC");
            const length = Array.from(normalized).length;
            if (recoveryPassword !== recoveryPasswordConfirm) {
              setBatchError("Recovery password confirmation does not match.");
              return;
            }
            if (
              length < MIN_RECOVERY_PASSWORD_LENGTH ||
              length > MAX_RECOVERY_PASSWORD_LENGTH
            ) {
              setBatchError(
                `Recovery passwords must be ${MIN_RECOVERY_PASSWORD_LENGTH}-${MAX_RECOVERY_PASSWORD_LENGTH} characters.`,
              );
              return;
            }
          }
          if (duressChoice) {
            const normalizedDuress = duressPassword.normalize("NFKC");
            const duressLength = Array.from(normalizedDuress).length;
            if (!passwordRecoveryChoice) {
              setBatchError(
                "Enable password recovery before adding a duress password.",
              );
              return;
            }
            if (duressPassword !== duressPasswordConfirm) {
              setBatchError("Duress password confirmation does not match.");
              return;
            }
            if (
              duressLength < MIN_RECOVERY_PASSWORD_LENGTH ||
              duressLength > MAX_RECOVERY_PASSWORD_LENGTH ||
              /^\d+$/.test(normalizedDuress)
            ) {
              setBatchError(
                `The duress password must be ${MIN_RECOVERY_PASSWORD_LENGTH}-${MAX_RECOVERY_PASSWORD_LENGTH} characters and cannot be all numeric.`,
              );
              return;
            }
            if (normalizedDuress === recoveryPassword.normalize("NFKC")) {
              setBatchError("Recovery and duress passwords must be different.");
              return;
            }
          }
        }
        const batchActive =
          batchRunningRef.current ||
          Object.values(jobsRef.current).some((job) => isActive(job.state));
        if (batchActive) {
          setBatchError(
            "Wait for the current batch to finish before adding more files.",
          );
          return;
        }
        if (files.length > MAX_BATCH_FILES) {
          setBatchError(
            `A batch can contain up to ${MAX_BATCH_FILES} files. Select fewer files and try again.`,
          );
          return;
        }
        setBatchError(null);
        setTrayOpen(true);
        const entries = files.map((file) => ({
          key: crypto.randomUUID(),
          file,
        }));
        const next: Record<string, Job> = {};
        for (const { key, file } of entries)
          next[key] = {
            name: file.name,
            size: file.size,
            pct: 0,
            state: "queued",
            file,
          };
        // uploadOne() begins before React is required to flush setState. Publish
        // the queue to the ref first so drag/drop and picker uploads both have a
        // row available for their first progress event.
        jobsRef.current = next;
        setJobs(next);
        await runJobs(entries);
      },
      [
        e2eCapability,
        encryptChoice,
        accountRecoveryChoice,
        passwordRecoveryChoice,
        recoveryPassword,
        recoveryPasswordConfirm,
        duressChoice,
        duressPassword,
        duressPasswordConfirm,
        runJobs,
      ],
    );

    useImperativeHandle(
      uploadZoneRef,
      () => ({
        uploadFiles: handleFiles,
        uploadDrop: async (dataTransfer) => {
          await handleFiles(await filesFromDrop(dataTransfer));
        },
      }),
      [handleFiles],
    );

    const retryJob = useCallback(
      (key: string) => {
        if (batchRunningRef.current) return;
        const job = jobsRef.current[key];
        if (!job?.file) return;
        setBatchError(null);
        patchJob(key, { state: "queued", pct: 0, error: undefined });
        void runJobs([{ key, file: job.file }]);
      },
      [patchJob, runJobs],
    );

    const retryAllFailed = useCallback(() => {
      if (batchRunningRef.current) return;
      const failed = Object.entries(jobsRef.current).filter(
        ([, job]) => job.state === "error" && job.file,
      );
      if (!failed.length) return;
      setBatchError(null);
      for (const [key] of failed)
        patchJob(key, { state: "queued", pct: 0, error: undefined });
      void runJobs(failed.map(([key, job]) => ({ key, file: job.file })));
    }, [patchJob, runJobs]);

    function cancelJob(key: string) {
      const job = jobsRef.current[key];
      if (!job || !isActive(job.state) || job.state === "finishing") return;
      if (job.state === "queued") patchJob(key, { state: "cancelled", pct: 0 });
      else controllers.current.get(key)?.abort();
    }
    useEffect(() => {
      const warn = (event: BeforeUnloadEvent) => {
        if (Object.values(jobsRef.current).some((job) => isActive(job.state))) {
          event.preventDefault();
          event.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }, []);
    const jobList = Object.entries(jobs);
    const errorCount = jobList.filter(([, j]) => j.state === "error").length;
    const activeCount = jobList.filter(([, j]) => isActive(j.state)).length;
    const doneCount = jobList.filter(([, j]) => j.state === "done").length;
    // A cleanly finished batch needs no more attention: collapse the tray so
    // it stops covering the file list, then clear it. Failed or cancelled
    // uploads stay until the user retries or dismisses them.
    const batchSucceeded =
      jobList.length > 0 && doneCount === jobList.length;
    useEffect(() => {
      if (!batchSucceeded) return;
      setTrayOpen(false);
      const timer = window.setTimeout(() => {
        jobsRef.current = {};
        setJobs({});
      }, 6000);
      return () => window.clearTimeout(timer);
    }, [batchSucceeded]);
    const totalBytes = jobList.reduce((sum, [, job]) => sum + job.size, 0);
    const completedBytes = jobList.reduce(
      (sum, [, job]) => sum + job.size * (job.pct / 100),
      0,
    );
    const batchPct =
      totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0;

    return (
      <div data-ui="upload-zone">
        <motion.div
          data-hidden={hidden || undefined}
          animate={dragging ? zoneActive : zoneIdle}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            filesFromDrop(e.dataTransfer).then(handleFiles);
          }}
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-4 py-6 text-center drive-shadow transition sm:py-8"
          data-ui="upload-target"
        >
          <motion.div
            animate={dragging ? iconUp : iconDown}
            className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-drift-500 via-glow-500 to-blush-500 text-white shadow-lg shadow-glow-500/25 sm:h-16 sm:w-16"
            data-ui="upload-icon"
          >
            {effectiveKeepForever ? (
              <Infinity size={28} />
            ) : (
              <UploadCloud size={28} />
            )}
          </motion.div>
          <div data-ui="upload-copy">
            <button
              type="button"
              onClick={() => ref.current?.click()}
              className="rounded-xl bg-drift-600 px-6 py-3 font-semibold text-white hover:bg-drift-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Choose files
            </button>
            <p className="mt-3 text-sm font-medium text-slate-700">
              {folderName ? `Upload to “${folderName}”` : "Upload to My Drive"}
            </p>
            <p className="mt-1 hidden text-xs text-slate-500 sm:block">
              Or drag files and folders here
            </p>
            <p className="mt-0.5 text-sm text-slate-400">
              Up to {MAX_BATCH_FILES} files per batch · {expiryText}
            </p>
          </div>
          <p className="text-xs text-slate-600">
            {encryptChoice ? "Encrypted" : "Standard upload"}
            {releaseAtInput ? " · Scheduled release" : ""}
            {expireAfterDownloadChoice ? " · Expires after download" : ""}
          </p>
          <button
            type="button"
            aria-expanded={optionsOpen}
            aria-controls="upload-options"
            onClick={() => setOptionsOpen(!optionsOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Upload options <ChevronDown size={16} />
          </button>
          <div
            id="upload-options"
            hidden={!optionsOpen}
            className="w-full max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left"
          >
            {canKeepForever && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-w-xl rounded-xl border border-drift-200 bg-drift-50 px-3 py-2 text-left text-xs text-drift-800"
                data-ui="upload-lifetime"
              >
                <label className="flex cursor-pointer items-start gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={keepForever}
                    onChange={(e) => onKeepForeverChange?.(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Keep these uploads forever</span>
                </label>
                <p className="mt-1 leading-5 text-drift-700">
                  On by default for your account. Turn it off to expire these
                  uploads after {expiryDays} day{expiryDays === 1 ? "" : "s"}{" "}
                  instead. You can change expiration later from the file
                  details.
                </p>
              </div>
            )}
            {!canKeepForever && (
              <p
                className="max-w-xl text-center text-xs leading-5 text-slate-500"
                data-ui="upload-lifetime-help"
              >
                These files will expire in {expiryDays} day
                {expiryDays === 1 ? "" : "s"}. Change the upload lifetime before
                choosing files, or adjust it later from file details.
              </p>
            )}
            <label
              onClick={(e) => e.stopPropagation()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
              data-ui="upload-encryption"
            >
              <input
                type="checkbox"
                checked={encryptChoice}
                disabled={activeCount > 0 || e2eCapability !== "available"}
                onChange={(e) => setEncryptChoice(e.target.checked)}
              />
              <LockKeyhole size={13} />{" "}
              {e2eCapability === "checking"
                ? "Checking encryption support…"
                : e2eCapability === "unavailable"
                  ? "Encryption unavailable — backend upgrade required"
                  : `Encrypt in this browser (up to ${formatBytes(
                      MAX_BROWSER_ENCRYPTION_BYTES,
                    )})`}
            </label>
            {encryptChoice && (
              <p
                onClick={(e) => e.stopPropagation()}
                className="max-w-xl text-center text-xs leading-5 text-slate-500"
                data-ui="upload-encryption-help"
              >
                Encryption happens in this browser before upload. Choose how the
                file can be recovered on another device below. Encrypted batches
                process one file at a time to limit memory use.
              </p>
            )}
            {encryptChoice && (
              <div
                onClick={(event) => event.stopPropagation()}
                className="w-full max-w-xl space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-left text-xs text-slate-600"
                data-ui="upload-recovery"
              >
                <div>
                  <p className="font-semibold text-slate-800">
                    Cross-device recovery
                  </p>
                  <p className="mt-0.5 leading-5">
                    Signed-in recovery is the easiest option. Password recovery
                    keeps a separately wrapped key for this file.
                  </p>
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={accountRecoveryChoice}
                    disabled={!accountRecoveryAvailable || activeCount > 0}
                    onChange={(event) =>
                      setAccountRecoveryChoice(event.target.checked)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-semibold text-slate-700">
                      Recover after signing in
                    </span>
                    <span className="mt-0.5 block leading-5 text-slate-500">
                      Dropvault stores a service-wrapped copy of the file key.
                      This is convenient, but is not strict end-to-end
                      encryption.
                    </span>
                  </span>
                </label>
                {!accountRecoveryAvailable && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-700">
                    Signed-in recovery is unavailable right now; use a recovery
                    password instead.
                  </p>
                )}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={passwordRecoveryChoice}
                    disabled={!passwordRecoveryAvailable || activeCount > 0}
                    onChange={(event) => {
                      setPasswordRecoveryChoice(event.target.checked);
                      if (!event.target.checked) setDuressChoice(false);
                    }}
                    className="mt-0.5"
                  />
                  <span className="font-semibold text-slate-700">
                    Add a recovery password
                  </span>
                </label>
                {!passwordRecoveryAvailable && (
                  <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-700">
                    Password recovery is unavailable until the recovery key
                    service is configured.
                  </p>
                )}
                {passwordRecoveryChoice && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={recoveryPassword}
                      disabled={activeCount > 0}
                      onChange={(event) =>
                        setRecoveryPassword(event.target.value)
                      }
                      placeholder="Recovery password"
                      className="rounded-xl border border-emerald-200 bg-white px-3 py-2 outline-none focus:border-drift-400"
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={recoveryPasswordConfirm}
                      disabled={activeCount > 0}
                      onChange={(event) =>
                        setRecoveryPasswordConfirm(event.target.value)
                      }
                      placeholder="Confirm recovery password"
                      className="rounded-xl border border-emerald-200 bg-white px-3 py-2 outline-none focus:border-drift-400"
                    />
                  </div>
                )}
                {passwordRecoveryChoice && (
                  <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-red-700">
                    <input
                      type="checkbox"
                      checked={duressChoice}
                      disabled={activeCount > 0}
                      onChange={(event) =>
                        setDuressChoice(event.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-semibold">
                        Add a duress password
                      </span>
                      <span className="mt-0.5 block leading-5">
                        Entering it during password unlock permanently removes
                        the file, versions, shares, folder entry, and Trash
                        entry.
                      </span>
                    </span>
                  </label>
                )}
                {passwordRecoveryChoice && duressChoice && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={duressPassword}
                      disabled={activeCount > 0}
                      onChange={(event) =>
                        setDuressPassword(event.target.value)
                      }
                      placeholder="Duress password"
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 outline-none focus:border-red-400"
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={duressPasswordConfirm}
                      disabled={activeCount > 0}
                      onChange={(event) =>
                        setDuressPasswordConfirm(event.target.value)
                      }
                      placeholder="Confirm duress password"
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 outline-none focus:border-red-400"
                    />
                  </div>
                )}
              </div>
            )}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex min-w-0 flex-wrap items-center justify-center gap-2 text-xs text-slate-600"
              data-ui="upload-schedule"
            >
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={expireAfterDownloadChoice}
                  onChange={(e) =>
                    setExpireAfterDownloadChoice(e.target.checked)
                  }
                />{" "}
                Expire after first download
              </label>
              <label className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                Release at{" "}
                <input
                  type="datetime-local"
                  value={releaseAtInput}
                  onChange={(e) => setReleaseAtInput(e.target.value)}
                  className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-2 py-1 outline-none focus:border-drift-400"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600"
              data-ui="upload-folder"
            >
              <FolderUp size={14} /> Upload a folder
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cameraInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600 sm:hidden"
            >
              Use camera
            </button>
          </div>
          <input
            ref={ref}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = e.currentTarget.files;
              void handleFiles(files);
              e.currentTarget.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = e.currentTarget.files;
              void handleFiles(files);
              e.currentTarget.value = "";
            }}
            {...({ webkitdirectory: "", directory: "" } as Record<
              string,
              string
            >)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const files = e.currentTarget.files;
              void handleFiles(files);
              e.currentTarget.value = "";
            }}
          />
        </motion.div>

        {batchError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <AlertCircle className="mt-0.5 shrink-0" size={14} />
            <span>{batchError}</span>
          </div>
        )}

        {jobList.length > 0 && (
          <section
            aria-label="Upload queue"
            data-ui="upload-tray"
            style={{
              bottom: selectionActive
                ? "10rem"
                : "max(1rem, env(safe-area-inset-bottom))",
            }}
            className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center gap-2 p-4">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                aria-expanded={trayOpen}
                onClick={() => setTrayOpen(!trayOpen)}
              >
                <span className="block text-sm font-semibold text-slate-800">
                  {doneCount} of {jobList.length} uploaded
                </span>
                <span role="status" className="text-xs text-slate-600">
                  {activeCount
                    ? `${activeCount} in progress`
                    : "Batch finished"}
                  {errorCount ? ` · ${errorCount} failed` : ""}
                  {jobList.some(([, j]) => j.state === "cancelled")
                    ? " · Some cancelled"
                    : ""}
                </span>
              </button>
              {activeCount > 0 ? (
                <button
                  onClick={() => jobList.forEach(([key]) => cancelJob(key))}
                  className="rounded-lg px-2 py-2 text-xs text-slate-600"
                >
                  Cancel pending
                </button>
              ) : (
                <button
                  aria-label="Dismiss upload queue"
                  onClick={() => {
                    jobsRef.current = {};
                    setJobs({});
                  }}
                  className="p-2"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div
              role="progressbar"
              aria-label="Bytes uploaded"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={batchPct}
              className="mx-4 h-1.5 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full bg-drift-500"
                style={{ width: `${batchPct}%` }}
              />
            </div>
            {trayOpen && (
              <div className="max-h-[45vh] overflow-y-auto p-4">
                {jobList.map(([key, job]) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 border-b border-slate-100 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium text-slate-800"
                        title={job.name}
                      >
                        {job.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatBytes(job.size)} ·{" "}
                        {job.state === "uploading"
                          ? `Uploading ${job.pct}%`
                          : job.state === "preparing"
                            ? "Preparing"
                            : job.state === "finishing"
                              ? "Finishing"
                              : job.state === "done"
                                ? "Uploaded"
                                : job.state === "cancelled"
                                  ? "Cancelled"
                                  : job.state === "error"
                                    ? "Failed"
                                    : "Queued"}
                      </p>
                      {job.error && (
                        <p className="mt-1 break-words text-xs text-red-600">
                          {job.error}
                        </p>
                      )}
                    </div>
                    {job.state === "done" && (
                      <CheckCircle2 size={18} className="text-emerald-600" />
                    )}
                    {isActive(job.state) && job.state !== "finishing" && (
                      <button
                        aria-label={`Cancel ${job.name}`}
                        onClick={() => cancelJob(key)}
                        className="p-2 text-slate-500"
                      >
                        <X size={16} />
                      </button>
                    )}
                    {job.state === "error" && (
                      <button
                        disabled={batchRunning}
                        onClick={() => retryJob(key)}
                        className="rounded-lg px-2 py-2 text-xs text-drift-700 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
                {errorCount > 0 && (
                  <button
                    disabled={batchRunning}
                    onClick={retryAllFailed}
                    className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Retry failed uploads
                  </button>
                )}
                {activeCount > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    Keep this tab open until uploads finish. Files already
                    finishing cannot be cancelled.
                  </p>
                )}
              </div>
            )}
            {!trayOpen && <div className="h-4" />}
          </section>
        )}
      </div>
    );
  },
);

export default UploadZone;
