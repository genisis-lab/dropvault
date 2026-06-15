import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Download, History, X } from "lucide-react"
import { fileVersions, downloadUrl, type DriftFile, type FileVersion } from "../lib/api"
import { formatBytes } from "../lib/format"

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } }
const panelInitial = { opacity: 0, scale: 0.96, y: 10 }
const panelAnimate = { opacity: 1, scale: 1, y: 0 }
const panelExit = { opacity: 0, scale: 0.96, y: 10 }

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

// Shows the upload history for a file (versions sharing its versionGroupId).
// The newest version is the current file; older versions are listed for reference.
export default function VersionsDialog({ file, onClose }: { file: DriftFile | null; onClose: () => void }) {
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return
    let active = true
    setVersions(null)
    setError(null)
    fileVersions(file.id)
      .then((v) => { if (active) setVersions(v) })
      .catch((e) => { if (active) setError((e as Error)?.message || "Couldn't load versions") })
    return () => { active = false }
  }, [file?.id])

  return (
    <AnimatePresence>
      {file && (
        <motion.div variants={backdrop} initial="hidden" animate="show" exit="hidden" onClick={onClose} className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <motion.div initial={panelInitial} animate={panelAnimate} exit={panelExit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600"><History size={18} /></div><div className="min-w-0"><h2 className="text-sm font-semibold text-slate-800">Version history</h2><p className="truncate text-xs text-slate-400" title={file.filename}>{file.filename}</p></div></div>
              <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {error ? <p className="py-6 text-center text-sm text-red-500">{error}</p> : versions == null ? <p className="py-6 text-center text-sm text-slate-400">Loading versions…</p> : versions.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No version history yet.</p> : (
                <ol className="space-y-2">
                  {versions.map((v, i) => (
                    <li key={v.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500">v{v.versionNumber}</div>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-700">{formatBytes(v.sizeBytes)}{i === 0 && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">Current</span>}</p><p className="text-xs text-slate-400">{when(v.createdAt)}</p></div>
                      {i === 0 && <a href={downloadUrl(file.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-drift-600" title="Download current version"><Download size={15} /></a>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
