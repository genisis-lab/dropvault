import { useCallback, useRef, useState, type RefObject } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react"
import { complete, MULTIPART_THRESHOLD, presign, uploadLargeFile, uploadToR2, uploadUrlFor } from "../lib/api"
import { formatBytes } from "../lib/format"

type Job = { name: string; size: number; pct: number; state: "uploading" | "done" | "error" }

const zoneIdle = { borderColor: "#cbd5e1", backgroundColor: "#ffffff" }
const zoneActive = { borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,0.06)" }
const iconUp = { y: -6 }
const iconDown = { y: 0 }
const rowInitial = { opacity: 0, height: 0 }
const rowAnimate = { opacity: 1, height: "auto" }
const rowExit = { opacity: 0, height: 0 }

export default function UploadZone({
  expiryDays,
  onUploaded,
  inputRef,
  folderId = null,
  folderName,
}: {
  expiryDays: number
  onUploaded: () => void
  inputRef?: RefObject<HTMLInputElement>
  folderId?: string | null
  folderName?: string
}) {
  const [dragging, setDragging] = useState(false)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return
      for (const file of Array.from(fileList)) {
        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        setJobs((j) => ({ ...j, [key]: { name: file.name, size: file.size, pct: 0, state: "uploading" } }))
        const setPct = (pct: number) => setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], pct } } : j))
        try {
          const { id } = await presign({ filename: file.name, contentType: file.type, sizeBytes: file.size, expiryDays, folderId })
          if (file.size > MULTIPART_THRESHOLD) {
            // Large file: upload in parts, then it's marked ready server-side.
            await uploadLargeFile(id, file, setPct)
          } else {
            await uploadToR2(uploadUrlFor(id), file, setPct)
            await complete(id)
          }
          setJobs((j) => ({ ...j, [key]: { ...j[key], pct: 100, state: "done" } }))
          onUploaded()
          setTimeout(() => setJobs((j) => { const n = { ...j }; delete n[key]; return n }), 1600)
        } catch {
          setJobs((j) => ({ ...j, [key]: { ...j[key], state: "error" } }))
        }
      }
    },
    [expiryDays, onUploaded, folderId],
  )

  return (
    <div>
      <motion.div
        animate={dragging ? zoneActive : zoneIdle}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => ref.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-4 py-10 text-center drive-shadow transition sm:py-12"
      >
        <motion.div
          animate={dragging ? iconUp : iconDown}
          className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-drift-500 via-glow-500 to-blush-500 text-white shadow-lg shadow-glow-500/25 sm:h-16 sm:w-16"
        >
          <UploadCloud size={28} />
        </motion.div>
        <div>
          <p className="font-semibold text-slate-700">
            {folderName ? `Drop files into “${folderName}”` : "Drop files here, or click to browse"}
          </p>
          <p className="mt-0.5 text-sm text-slate-400">
            Auto-expires in {expiryDays} day{expiryDays === 1 ? "" : "s"} · extend or delete anytime
          </p>
        </div>
        <input ref={ref} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </motion.div>

      <div className="mt-3 space-y-2">
        <AnimatePresence>
          {Object.entries(jobs).map(([key, job]) => {
            const barAnimate = { width: `${job.pct}%` }
            const barClass =
              "h-full rounded-full " +
              (job.state === "error" ? "bg-red-500" : "bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500")
            return (
              <motion.div
                key={key}
                layout
                initial={rowInitial}
                animate={rowAnimate}
                exit={rowExit}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 drive-shadow"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-slate-700">{job.name}</span>
                    <span className="shrink-0 text-slate-400">{formatBytes(job.size)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <motion.div className={barClass} animate={barAnimate} />
                  </div>
                </div>
                {job.state === "done" && <CheckCircle2 className="shrink-0 text-emerald-500" size={18} />}
                {job.state === "error" && <AlertCircle className="shrink-0 text-red-500" size={18} />}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
