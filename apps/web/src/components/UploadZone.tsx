import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  FolderUp,
  LockKeyhole,
  X,
} from "lucide-react";
import { useEscapeToClose } from "../lib/useEscapeToClose";
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
  openFilePicker: () => void;
  openFolderPicker: () => void;
  openCamera: () => void;
  openOptions: () => void;
};

type UploadZoneProps = {
  expiryDays: number;
  // Offered lifetimes, in days, for accounts that pick an expiry.
  expiryOptions?: number[];
  onExpiryDaysChange?: (days: number) => void;
  // Whether uploads should be kept forever when the account allows it. The
  // dashboard owns this so its expiration chip and this checkbox agree.
  keepForever?: boolean;
  onKeepForeverChange?: (keepForever: boolean) => void;
  // Reports the upload options that differ from a plain upload, so the
  // dashboard can show them next to its filters.
  onSummaryChange?: (summary: string) => void;
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

const dialogInitial = { opacity: 0, scale: 0.96 };
const dialogAnimate = { opacity: 1, scale: 1 };
const fadeInitial = { opacity: 0 };
const fadeAnimate = { opacity: 1 };

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
      expiryDays,
      expiryOptions = [1, 2, 7, 14, 30],
      onExpiryDaysChange,
      keepForever = false,
      onKeepForeverChange,
      onSummaryChange,
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
        openFilePicker: () => ref.current?.click(),
        openFolderPicker: () => folderInputRef.current?.click(),
        openCamera: () => cameraInputRef.current?.click(),
        openOptions: () => setOptionsOpen(true),
      }),
      [handleFiles, ref],
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

    const summary = [
      encryptChoice && "Encrypted",
      releaseAtInput && "Scheduled release",
      expireAfterDownloadChoice && "Expires after first download",
    ]
      .filter(Boolean)
      .join(" · ");
    useEffect(() => {
      onSummaryChange?.(summary);
    }, [summary, onSummaryChange]);
    useEscapeToClose(optionsOpen, () => setOptionsOpen(false));
    const destination = folderName ? `“${folderName}”` : "My Drive";
    const failedCount = errorCount;
    const trayTitle = activeCount
      ? `Uploading ${activeCount} item${activeCount === 1 ? "" : "s"}`
      : failedCount
        ? `${failedCount} upload${failedCount === 1 ? "" : "s"} failed`
        : `${doneCount} upload${doneCount === 1 ? "" : "s"} complete`;

    return (
      <div data-ui="upload-zone">
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

        <AnimatePresence>
          {optionsOpen && (
            <motion.div
              initial={fadeInitial}
              animate={fadeAnimate}
              exit={fadeInitial}
              className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4"
              onClick={() => setOptionsOpen(false)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="upload-options-title"
                initial={dialogInitial}
                animate={dialogAnimate}
                exit={dialogInitial}
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[min(90vh,46rem)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] bg-sheet drive-shadow-lg"
                data-ui="upload-options"
              >
                <div className="flex items-start gap-3 px-6 pb-2 pt-6">
                  <div className="min-w-0 flex-1">
                    <h2
                      id="upload-options-title"
                      className="text-2xl text-strong"
                    >
                      Upload options
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Applies to the next files you upload to {destination}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOptionsOpen(false)}
                    aria-label="Close upload options"
                    className="icon-round -mr-2 -mt-1"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div
                  id="upload-options"
                  className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-3 text-sm"
                >
                  {batchError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700"
                    >
                      <AlertCircle className="mt-0.5 shrink-0" size={16} />
                      <span>{batchError}</span>
                    </div>
                  )}
                  <section data-ui="upload-lifetime-section">
                    <h3 className="text-sm font-medium text-strong">
                      How long to keep uploads
                    </h3>
                    {canKeepForever && (
                      <div className="mt-2" data-ui="upload-lifetime">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={keepForever}
                            onChange={(e) =>
                              onKeepForeverChange?.(e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4"
                          />
                          <span>
                            <span className="block text-strong">
                              Keep these uploads forever
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted">
                              On by default for your account. Turn it off to
                              expire these uploads after the time below. You
                              can change expiration later from file details.
                            </span>
                          </span>
                        </label>
                      </div>
                    )}
                    {(!canKeepForever || !keepForever) && (
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-muted">
                        Delete automatically after
                        <select
                          value={String(expiryDays)}
                          onChange={(e) =>
                            onExpiryDaysChange?.(Number(e.target.value))
                          }
                          aria-label="Days before uploads expire"
                          className="chip !text-strong"
                        >
                          {expiryOptions.map((d) => (
                            <option key={d} value={d}>
                              {d} day{d === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {!canKeepForever && (
                      <p
                        className="mt-2 text-xs leading-5 text-muted"
                        data-ui="upload-lifetime-help"
                      >
                        These files will expire in {expiryDays} day
                        {expiryDays === 1 ? "" : "s"}. You can adjust it later
                        from file details.
                      </p>
                    )}
                  </section>
                  <section className="border-t border-slate-200 pt-4">
                    <h3 className="text-sm font-medium text-strong">
                      Encryption
                    </h3>
                    <label
                      className="mt-2 flex cursor-pointer items-start gap-3"
                      data-ui="upload-encryption"
                    >
                      <input
                        type="checkbox"
                        checked={encryptChoice}
                        disabled={
                          activeCount > 0 || e2eCapability !== "available"
                        }
                        onChange={(e) => setEncryptChoice(e.target.checked)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span className="flex items-start gap-2 text-strong">
                        <LockKeyhole size={15} className="mt-0.5 shrink-0" />
                        {e2eCapability === "checking"
                          ? "Checking encryption support…"
                          : e2eCapability === "unavailable"
                            ? "Encryption unavailable — backend upgrade required"
                            : `Encrypt in this browser (up to ${formatBytes(
                                MAX_BROWSER_ENCRYPTION_BYTES,
                              )})`}
                      </span>
                    </label>
                    {encryptChoice && (
                      <p
                        className="mt-2 text-xs leading-5 text-muted"
                        data-ui="upload-encryption-help"
                      >
                        Encryption happens in this browser before upload.
                        Choose how the file can be recovered on another device
                        below. Encrypted batches process one file at a time to
                        limit memory use.
                      </p>
                    )}
                    {encryptChoice && (
                      <div
                        className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-4 text-xs text-muted"
                        data-ui="upload-recovery"
                      >
                        <div>
                          <p className="text-sm font-medium text-strong">
                            Cross-device recovery
                          </p>
                          <p className="mt-0.5 leading-5">
                            Signed-in recovery is the easiest option. Password
                            recovery keeps a separately wrapped key for this
                            file.
                          </p>
                        </div>
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={accountRecoveryChoice}
                            disabled={
                              !accountRecoveryAvailable || activeCount > 0
                            }
                            onChange={(event) =>
                              setAccountRecoveryChoice(event.target.checked)
                            }
                            className="mt-0.5 h-4 w-4"
                          />
                          <span>
                            <span className="text-sm text-strong">
                              Recover after signing in
                            </span>
                            <span className="mt-0.5 block leading-5">
                              Dropvault stores a service-wrapped copy of the
                              file key. This is convenient, but is not strict
                              end-to-end encryption.
                            </span>
                          </span>
                        </label>
                        {!accountRecoveryAvailable && (
                          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                            Signed-in recovery is unavailable right now; use a
                            recovery password instead.
                          </p>
                        )}
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={passwordRecoveryChoice}
                            disabled={
                              !passwordRecoveryAvailable || activeCount > 0
                            }
                            onChange={(event) => {
                              setPasswordRecoveryChoice(event.target.checked);
                              if (!event.target.checked)
                                setDuressChoice(false);
                            }}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span className="text-sm text-strong">
                            Add a recovery password
                          </span>
                        </label>
                        {!passwordRecoveryAvailable && (
                          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                            Password recovery is unavailable until the recovery
                            key service is configured.
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
                              aria-label="Recovery password"
                              className="drive-field bg-white"
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
                              aria-label="Confirm recovery password"
                              className="drive-field bg-white"
                            />
                          </div>
                        )}
                        {passwordRecoveryChoice && (
                          <label className="flex items-start gap-3 rounded-xl bg-red-50 p-3 text-red-700">
                            <input
                              type="checkbox"
                              checked={duressChoice}
                              disabled={activeCount > 0}
                              onChange={(event) =>
                                setDuressChoice(event.target.checked)
                              }
                              className="mt-0.5 h-4 w-4"
                            />
                            <span>
                              <span className="text-sm font-medium">
                                Add a duress password
                              </span>
                              <span className="mt-0.5 block leading-5">
                                Entering it during password unlock permanently
                                removes the file, versions, shares, folder
                                entry, and Trash entry.
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
                              aria-label="Duress password"
                              className="drive-field bg-white"
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
                              aria-label="Confirm duress password"
                              className="drive-field bg-white"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                  <section
                    className="border-t border-slate-200 pt-4"
                    data-ui="upload-schedule"
                  >
                    <h3 className="text-sm font-medium text-strong">
                      Sharing and release
                    </h3>
                    <label className="mt-2 flex cursor-pointer items-center gap-3 text-strong">
                      <input
                        type="checkbox"
                        checked={expireAfterDownloadChoice}
                        onChange={(e) =>
                          setExpireAfterDownloadChoice(e.target.checked)
                        }
                        className="h-4 w-4"
                      />
                      Expire after first download
                    </label>
                    <label className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-muted">
                      Release at
                      <input
                        type="datetime-local"
                        value={releaseAtInput}
                        onChange={(e) => setReleaseAtInput(e.target.value)}
                        className="drive-field min-w-0 max-w-full !w-auto"
                      />
                      {releaseAtInput && (
                        <button
                          type="button"
                          onClick={() => setReleaseAtInput("")}
                          className="btn-text !min-h-8"
                        >
                          Clear
                        </button>
                      )}
                    </label>
                  </section>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      folderInputRef.current?.click();
                    }}
                    className="btn-text mr-auto"
                    data-ui="upload-folder"
                  >
                    <FolderUp size={18} /> Upload a folder
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptionsOpen(false)}
                    className="btn-text"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOptionsOpen(false);
                      ref.current?.click();
                    }}
                    className="btn-filled"
                  >
                    <FileUp size={18} /> Choose files
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {batchError && !optionsOpen && (
          <div
            role="alert"
            className="snackbar fixed bottom-6 left-1/2 z-[70] flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-lg px-4 py-3 text-sm"
          >
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span className="min-w-0 flex-1">{batchError}</span>
            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              className="snackbar-action shrink-0 font-medium"
            >
              Review options
            </button>
            <button
              type="button"
              onClick={() => setBatchError(null)}
              aria-label="Dismiss upload error"
              className="shrink-0 opacity-80 hover:opacity-100"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {jobList.length > 0 && (
          <section
            aria-label="Upload queue"
            data-ui="upload-tray"
            className="fixed bottom-0 right-0 z-40 w-full overflow-hidden rounded-t-2xl bg-sheet drive-shadow-lg sm:bottom-4 sm:right-6 sm:w-[22.5rem] sm:rounded-2xl"
          >
            <div className="flex items-center gap-1 bg-slate-100 py-1 pl-4 pr-1">
              <button
                type="button"
                className="min-w-0 flex-1 py-2 text-left"
                aria-expanded={trayOpen}
                onClick={() => setTrayOpen(!trayOpen)}
              >
                <span className="block truncate text-sm font-medium text-strong">
                  {trayTitle}
                </span>
                <span role="status" className="block text-xs text-muted">
                  {doneCount} of {jobList.length} uploaded
                  {activeCount ? ` · ${batchPct}%` : ""}
                  {jobList.some(([, j]) => j.state === "cancelled")
                    ? " · Some cancelled"
                    : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTrayOpen(!trayOpen)}
                aria-label={trayOpen ? "Collapse upload queue" : "Expand upload queue"}
                className="icon-round"
              >
                {trayOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
              </button>
              {activeCount > 0 ? (
                <button
                  onClick={() => jobList.forEach(([key]) => cancelJob(key))}
                  className="btn-text !min-h-9 !px-3"
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
                  className="icon-round"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            <div
              role="progressbar"
              aria-label="Bytes uploaded"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={batchPct}
              className="h-1 overflow-hidden bg-slate-200"
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${batchPct}%` }}
              />
            </div>
            {trayOpen && (
              <div className="max-h-[45vh] overflow-y-auto py-1">
                {jobList.map(([key, job]) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm text-strong"
                        title={job.name}
                      >
                        {job.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
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
                        <p className="mt-1 break-words text-xs text-red-700">
                          {job.error}
                        </p>
                      )}
                    </div>
                    {job.state === "done" && (
                      <CheckCircle2
                        size={20}
                        className="shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                    )}
                    {isActive(job.state) && job.state !== "finishing" && (
                      <button
                        aria-label={`Cancel ${job.name}`}
                        onClick={() => cancelJob(key)}
                        className="icon-round"
                      >
                        <X size={18} />
                      </button>
                    )}
                    {job.state === "error" && (
                      <button
                        disabled={batchRunning}
                        onClick={() => retryJob(key)}
                        className="btn-text !min-h-9 !px-3"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
                {errorCount > 0 && (
                  <div className="px-4 pb-2 pt-1">
                    <button
                      disabled={batchRunning}
                      onClick={retryAllFailed}
                      className="btn-outlined !min-h-9"
                    >
                      Retry failed uploads
                    </button>
                  </div>
                )}
                {activeCount > 0 && (
                  <p className="px-4 pb-3 pt-1 text-xs text-muted">
                    Keep this tab open until uploads finish. Files already
                    finishing cannot be cancelled.
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    );
  },
);

export default UploadZone;
