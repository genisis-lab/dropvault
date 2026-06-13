import { useCallback, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { UploadCloud, CheckCircle2, AlertCircle } from "lucide-react"
import { presign, uploadToR2, complete } from "../lib/api"
import { formatBytes } from "../lib/format"

type Job = { name: string; size: number; pct: number; state: "uploading" | "done" | "error" }

const zoneIdle = { scale: 1, borderColor: "rgba(255,255,255,0.12)" }
const zoneActive = { scale: 1.01, borderColor: "rgba(99,102,241,0.8)" }
const iconUp = { y: -6 }
const iconDown = { y: 0 }
const rowInitial = { opacity: 0, height: 0 }
const rowAnimate = { opacity: 1, height: "auto" }
const rowExit = { opacity: 0, height: 0 }

export default function UploadZone({
  expiryDays,
  onUploaded,
}: {
  expiryDays: number
  onUploaded: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return
      for (const file of Array.from(fileList)) {
        const key = `${file.name}-${Date.now()}`
        setJobs((j) => ({ ...j, [key]: { name: file.name, size: file.size, pct: 0, state: "uploading" } }))
        try {
          const { id, uploadUrl } = await presign({
            filename: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            expiryDays,
          })
          await uploadToR2(uploadUrl, file, (pct) =>
            setJobs((j) => ({ ...j, [key]: { ...j[key], pct } })),
          )
          await complete(id)
          setJobs((j) => ({ ...j, [key]: { ...j[key], pct: 100, state: "done" } }))
          onUploaded()
          setTimeout(() => setJobs((j) => { const n = { ...j }; delete n[key]; return n }), 1800)
        } catch {
          setJobs((j) => ({ ...j, [key]: { ...j[key], state: "error" } }))
        }
      }
    },
    [expiryDays, onUploaded],
  )

  return (
    <div>
      <motion.div
        animate={dragging ? zoneActive : zoneIdle}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className="glass flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed py-14 text-center transition"
      >
        <motion.div
          animate={dragging ? iconUp : iconDown}
          className="grid h-16 w-16 place-items-center rounded-2xl bg-drift-500/15 text-drift-400"
        >
          <UploadCloud size={30} />
        </motion.div>
        <div>
          <p className="font-semibold">Drop files here, or click to browse</p>
          <p className="text-sm text-white/40">They’ll auto-expire in {expiryDays} day{expiryDays === 1 ? "" : "s"} (you can extend later)</p>
        </div>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </motion.div>

      <div className="mt-3 space-y-2">
        <AnimatePresence>
          {Object.entries(jobs).map(([key, job]) => {
            const barAnimate = { width: `${job.pct}%` }
            const barClass =
              "h-full rounded-full " +
              (job.state === "error" ? "bg-red-500" : "bg-gradient-to-r from-drift-400 to-drift-600")
            return (
              <motion.div
                key={key}
                layout
                initial={rowInitial}
                animate={rowAnimate}
                exit={rowExit}
                className="glass flex items-center gap-3 rounded-xl px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between text-sm">
                    <span className="truncate font-medium">{job.name}</span>
                    <span className="text-white/40">{formatBytes(job.size)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div className={barClass} animate={barAnimate} />
                  </div>
                </div>
                {job.state === "done" && <CheckCircle2 className="text-green-400" size={18} />}
                {job.state === "error" && <AlertCircle className="text-red-400" size={18} />}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
