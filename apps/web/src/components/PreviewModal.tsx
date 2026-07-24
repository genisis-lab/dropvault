import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, LockKeyhole, LoaderCircle, X } from "lucide-react";
import { downloadUrl, inlineUrl, type DriftFile } from "../lib/api";
import { downloadOwnedFile } from "../lib/encryption";
import { useToast } from "./Toast";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.97 };
const panelAnimate = { opacity: 1, scale: 1 };

// Full-screen preview for images and PDFs using the owner inline endpoint.
// Other types fall back to a download prompt. Esc or backdrop click closes.
export default function PreviewModal({
  file,
  onClose,
}: {
  file: DriftFile | null;
  onClose: () => void;
}) {
  const { error: toastError } = useToast();
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const type = file?.contentType || "";
  const isImage = type.startsWith("image/");
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
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[70] flex flex-col bg-slate-900/80 p-3 backdrop-blur-sm sm:p-6"
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
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void download()}
                className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
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
                className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <motion.div
            initial={panelInitial}
            animate={panelAnimate}
            onClick={(e) => e.stopPropagation()}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl"
          >
            {encrypted ? (
              <div className="max-w-md rounded-2xl bg-white px-8 py-12 text-center text-sm text-slate-500">
                <LockKeyhole
                  className="mx-auto mb-3 text-drift-600"
                  size={28}
                />
                <p className="font-semibold text-slate-700">
                  End-to-end encrypted
                </p>
                <p className="mt-1 leading-5">
                  Dropvault stores only ciphertext. Decrypt and download this
                  file with the key saved in this browser.
                </p>
              </div>
            ) : isImage ? (
              <img
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
                No inline preview for this file type.
                <br />
                Use Download to open it.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
