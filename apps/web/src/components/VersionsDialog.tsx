import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, History, RotateCcw, Upload, X } from "lucide-react";
import {
  fileVersions,
  downloadUrl,
  restoreFileVersion,
  uploadFileVersion,
  versionDownloadUrl,
  type DriftFile,
  type FileVersion,
} from "../lib/api";
import { formatBytes } from "../lib/format";
import { useToast } from "./Toast";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.96, y: 10 };
const panelAnimate = { opacity: 1, scale: 1, y: 0 };
const panelExit = { opacity: 0, scale: 0.96, y: 10 };

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function VersionsDialog({
  file,
  onClose,
}: {
  file: DriftFile | null;
  onClose: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  async function load(active = true) {
    if (!file) return;
    setVersions(null);
    setError(null);
    try {
      const v = await fileVersions(file.id);
      if (active) setVersions(v);
    } catch (e) {
      if (active) setError((e as Error)?.message || "Couldn't load versions");
    }
  }
  useEffect(() => {
    if (!file) return;
    let active = true;
    load(active);
    return () => {
      active = false;
    };
  }, [file?.id]);

  async function restore(v: FileVersion) {
    if (!file) return;
    if (
      !confirm(
        `Restore v${v.versionNumber}? This creates a new current version from that snapshot.`,
      )
    )
      return;
    setRestoring(v.id);
    try {
      const res = await restoreFileVersion(file.id, v.id);
      success(`Restored as v${res.versionNumber}`);
      await load(true);
    } catch (e) {
      toastError((e as Error)?.message || "Couldn't restore version");
    } finally {
      setRestoring(null);
    }
  }

  async function replace(next: File) {
    if (!file) return;
    setUploading(0);
    try {
      const result = await uploadFileVersion(file.id, next, setUploading);
      success(`Uploaded ${next.name} as v${result.versionNumber}`);
      await load(true);
    } catch (e) {
      toastError((e as Error)?.message || "Couldn't upload version");
    } finally {
      setUploading(null);
    }
  }

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
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
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600">
                  <History size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">
                    Version history
                  </h2>
                  <p
                    className="truncate text-xs text-slate-400"
                    title={file.filename}
                  >
                    {file.filename}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="border-b border-slate-100 px-5 py-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-drift-300 bg-drift-50 px-3 py-2 text-xs font-semibold text-drift-700 hover:bg-drift-100">
                <Upload size={15} />{" "}
                {uploading == null
                  ? "Upload a new version"
                  : `Uploading ${uploading}%`}
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading != null}
                  onChange={(event) => {
                    const next = event.target.files?.[0];
                    if (next) void replace(next);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {error ? (
                <p className="py-6 text-center text-sm text-red-500">{error}</p>
              ) : versions == null ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Loading versions…
                </p>
              ) : versions.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  No version history yet.
                </p>
              ) : (
                <ol className="space-y-2">
                  {versions.map((v, i) => (
                    <li
                      key={v.id}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">
                        v{v.versionNumber}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-700">
                          {formatBytes(v.sizeBytes)}
                          {i === 0 && (
                            <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                              Current
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {when(v.createdAt)}
                        </p>
                      </div>
                      <a
                        href={
                          i === 0
                            ? downloadUrl(file.id)
                            : versionDownloadUrl(file.id, v.id)
                        }
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-drift-600"
                        title={
                          i === 0
                            ? "Download current version"
                            : `Download v${v.versionNumber}`
                        }
                      >
                        <Download size={15} />
                      </a>
                      {i !== 0 && (
                        <button
                          disabled={restoring === v.id}
                          onClick={() => restore(v)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"
                          title={`Restore v${v.versionNumber}`}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
