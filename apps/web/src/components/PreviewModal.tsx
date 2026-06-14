import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Download, X } from "lucide-react"
import { downloadUrl, inlineUrl, type DriftFile } from "../lib/api"

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } }
const panelInitial = { opacity: 0, scale: 0.97 }
const panelAnimate = { opacity: 1, scale: 1 }

// Full-screen preview for images and PDFs using the owner inline endpoint.
// Other types fall back to a download prompt. Esc or backdrop click closes.
export default function PreviewModal({ file, onClose }: { file: DriftFile | null; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const type = file?.contentType || ""
  const isImage = type.startsWith("image/")
  const isPdf = type.includes("pdf")

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
          <div className="mb-3 flex items-center justify-between gap-3 text-white" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 truncate text-sm font-medium" title={file.filename}>{file.filename}</p>
            <div className="flex items-center gap-2">
              <a
                href={downloadUrl(file.id)}
                className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
              >
                <Download size={15} /> Download
              </a>
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
            {isImage ? (
              <img src={inlineUrl(file.id)} alt={file.filename} className="max-h-full max-w-full rounded-xl object-contain" />
            ) : isPdf ? (
              <iframe src={inlineUrl(file.id)} title={file.filename} className="h-full w-full rounded-xl bg-white" />
            ) : (
              <div className="rounded-2xl bg-white px-8 py-12 text-center text-sm text-slate-500">
                No inline preview for this file type.<br />Use Download to open it.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
