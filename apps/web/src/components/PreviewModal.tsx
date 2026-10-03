import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  LockKeyhole,
  LoaderCircle,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { downloadUrl, inlineUrl, type DriftFile } from "../lib/api";
import { downloadOwnedFile } from "../lib/encryption";
import { useToast } from "./Toast";
import { useEscapeToClose } from "../lib/useEscapeToClose";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.97 };
const panelAnimate = { opacity: 1, scale: 1 };

// Full-screen preview for images and PDFs using the owner inline endpoint.
// Other types fall back to a download prompt. Esc or backdrop click closes.
export default function PreviewModal({
  file,
  onClose,
  files = [],
  onNavigate,
}: {
  file: DriftFile | null;
  files?: DriftFile[];
  onNavigate?: (file: DriftFile) => void;
  onClose: () => void;
}) {
  const { error: toastError } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const index = files.findIndex((item) => item.id === file?.id);
  const previous = index > 0 ? files[index - 1] : null;
  const next = index >= 0 ? files[index + 1] : null;
  useEffect(() => {
    setFailed(false);
  }, [file?.id]);
  useEscapeToClose(true, onClose);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      active?.focus();
    };
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLVideoElement) return;
      if (e.key === "ArrowLeft" && previous) onNavigate?.(previous);
      if (e.key === "ArrowRight" && next) onNavigate?.(next);
      if (e.key === "Tab") {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), video, iframe, [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previous, next, onNavigate]);

  const type = file?.contentType || "";
  const isImage = type.startsWith("image/");
  const isVideo = type.startsWith("video/");
  const isPdf = type.includes("pdf");
  const encrypted = file?.encryptionMode === "aes-gcm";

  async function download() {
    if (!file || downloading) return;
    setDownloading(true);
    try {
      await downloadOwnedFile(file, downloadUrl(file.id));
    } catch (error) {
      toastError((error as Error)?.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="File preview"
          tabIndex={-1}
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[70] flex flex-col bg-black/85 p-3 sm:p-6"
        >
          <div
            className="mb-3 flex items-center justify-between gap-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="min-w-0 truncate text-sm font-medium"
              title={file.filename}
            >
              {file.filename}
              {index >= 0 && (
                <span className="ml-2 text-xs text-white/70">
                  {index + 1} / {files.length}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void download()}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium hover:bg-white/10"
              >
                {downloading ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : encrypted ? (
                  <LockKeyhole size={15} />
                ) : (
                  <Download size={15} />
                )}
                {encrypted ? "Decrypt & download" : "Download"}
              </button>
              <button
                onClick={onClose}
                aria-label="Close preview"
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <motion.div
            initial={panelInitial}
            animate={panelAnimate}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => {
              if (isVideo || isPdf) return;
              touch.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
              };
            }}
            onTouchEnd={(e) => {
              const start = touch.current;
              touch.current = null;
              if (!start) return;
              const dx = e.changedTouches[0].clientX - start.x;
              const dy = e.changedTouches[0].clientY - start.y;
              if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5)
                return;
              const target = dx < 0 ? next : previous;
              if (target) onNavigate?.(target);
            }}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl"
          >
            {encrypted ? (
              <div className="max-w-md rounded-2xl bg-white px-8 py-12 text-center text-sm text-slate-500">
                <LockKeyhole
                  className="mx-auto mb-3 text-drift-600"
                  size={28}
                />
                <p className="font-semibold text-slate-700">
                  Encrypted in your browser
                </p>
                <p className="mt-1 leading-5">
                  Dropvault stores the file as ciphertext. Download it with a
                  saved key, signed-in recovery, or its recovery password.
                </p>
              </div>
            ) : failed ? (
              <div
                role="status"
                className="rounded-2xl bg-white p-8 text-center text-slate-700"
              >
                <p className="font-semibold">Preview unavailable</p>
                <p className="mt-2 text-sm">
                  Your original file is preserved. Download it to open in a
                  compatible app.
                </p>
              </div>
            ) : isVideo ? (
              <video
                key={file.id}
                controls
                playsInline
                preload="metadata"
                onError={() => setFailed(true)}
                src={inlineUrl(file.id)}
                className="max-h-full max-w-full rounded-xl"
                aria-label={file.filename}
              />
            ) : isImage ? (
              <img
                key={file.id}
                onError={() => setFailed(true)}
                src={inlineUrl(file.id)}
                alt={file.filename}
                className="max-h-full max-w-full rounded-xl object-contain"
              />
            ) : isPdf ? (
              <iframe
                src={inlineUrl(file.id)}
                title={file.filename}
                className="h-full w-full rounded-xl bg-white"
              />
            ) : (
              <div className="rounded-2xl bg-white px-8 py-12 text-center text-sm text-slate-500">
                Preview unavailable — your original file is preserved.
                <br />
                Use Download to open it.
              </div>
            )}
          </motion.div>
          {onNavigate && files.length > 1 && (
            <div
              className="mt-3 flex justify-center gap-4 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                aria-label="Previous file"
                disabled={!previous}
                onClick={() => previous && onNavigate(previous)}
                className="rounded-full bg-white/10 p-3 hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronLeft />
              </button>
              <button
                aria-label="Next file"
                disabled={!next}
                onClick={() => next && onNavigate(next)}
                className="rounded-full bg-white/10 p-3 hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronRight />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
