import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, CheckCircle2, FolderUp, Infinity, RotateCw, UploadCloud } from "lucide-react"
import { complete, generateAndUploadThumbnail, MULTIPART_THRESHOLD, presign, uploadLargeFile, uploadToR2, uploadUrlFor } from "../lib/api"
import { accountStatus } from "../lib/account"
import { formatBytes } from "../lib/format"

type JobState = "queued" | "uploading" | "done" | "error"
type Job = { name: string; size: number; pct: number; state: JobState; error?: string; file: File }

// How many files upload in parallel. Bounded so we don't flood the Worker / R2
// (which is what caused large batches to partially fail before).
const UPLOAD_CONCURRENCY = 3
const MAX_ATTEMPTS = 3

const zoneIdle = { borderColor: "#cbd5e1", backgroundColor: "#ffffff" }
const zoneActive = { borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,0.06)" }
const iconUp = { y: -6 }
const iconDown = { y: 0 }
const rowInitial = { opacity: 0, height: 0 }
const rowAnimate = { opacity: 1, height: "auto" }
const rowExit = { opacity: 0, height: 0 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Errors that will never succeed on retry (quota, type, size, permission, auth).
// Everything else is treated as transient and retried with backoff.
function isPermanentError(message: string): boolean {
  return /quota|not allowed|suspended|permission|exceeds|too large|413|415|403|401|400/i.test(message)
}

async function withRetry<T>(fn: () => Promise<T>, attempts = MAX_ATTEMPTS): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = (e as Error)?.message ?? ""
      if (isPermanentError(msg) || i === attempts - 1) break
      await sleep(400 * 2 ** i + Math.random() * 250)
    }
  }
  throw lastErr
}

function readEntry(entry: any, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (!entry) return resolve()
    if (entry.isFile) {
      entry.file((f: File) => { out.push(f); resolve() }, () => resolve())
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const all: any[] = []
      const readBatch = () => reader.readEntries((batch: any[]) => {
        if (!batch.length) {
          Promise.all(all.map((e) => readEntry(e, out))).then(() => resolve())
        } else { all.push(...batch); readBatch() }
      }, () => resolve())
      readBatch()
    } else resolve()
  })
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = dt.items
  const canTraverse = items && items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === "function"
  if (canTraverse) {
    const entries: any[] = []
    for (const it of Array.from(items)) { const e = (it as any).webkitGetAsEntry?.(); if (e) entries.push(e) }
    if (entries.length) {
      const out: File[] = []
      for (const e of entries) await readEntry(e, out)
      if (out.length) return out
    }
  }
  return Array.from(dt.files)
}

export default function UploadZone({
  expiryDays,
  keepForever = false,
  onUploaded,
  inputRef,
  folderId = null,
  folderName,
}: {
  expiryDays: number
  keepForever?: boolean
  onUploaded: () => void
  inputRef?: RefObject<HTMLInputElement>
  folderId?: string | null
  folderName?: string
}) {
  const [dragging, setDragging] = useState(false)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [canKeepForever, setCanKeepForever] = useState(false)
  const [keepForeverChoice, setKeepForeverChoice] = useState(keepForever)
  const localRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const jobsRef = useRef(jobs)
  useEffect(() => { jobsRef.current = jobs }, [jobs])

  useEffect(() => {
    let alive = true
    accountStatus()
      .then((status) => {
        if (!alive) return
        const allowed = !!status.canKeepFilesForever
        setCanKeepForever(allowed)
        if (!allowed) setKeepForeverChoice(false)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => { if (keepForever) setKeepForeverChoice(true) }, [keepForever])

  const effectiveKeepForever = canKeepForever && keepForeverChoice
  const expiryText = effectiveKeepForever ? "Keep forever" : `Auto-expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}`

  const uploadOne = useCallback(
    async (key: string, file: File) => {
      setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], state: "uploading", pct: 0, error: undefined } } : j))
      const setPct = (pct: number) => setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], pct } } : j))
      try {
        const { id } = await withRetry(() => presign({ filename: file.name, contentType: file.type, sizeBytes: file.size, expiryDays, folderId, keepForever: effectiveKeepForever }))
        if (file.size > MULTIPART_THRESHOLD) {
          await withRetry(() => uploadLargeFile(id, file, setPct))
        } else {
          await withRetry(async () => {
            try {
              await uploadToR2(uploadUrlFor(id), file, setPct)
            } catch (e) {
              // A retry after the bytes already landed returns 409; treat as uploaded and finalize.
              if (!String((e as Error)?.message ?? "").includes("409")) throw e
            }
            await complete(id)
          })
        }
        // Best-effort: generate a small cached thumbnail so the grid/list never
        // has to download the full-size image (fixes slow/failed 12MB previews).
        if (file.type.startsWith("image/")) {
          await generateAndUploadThumbnail(id, file).catch(() => {})
        }
        setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], pct: 100, state: "done" } } : j))
        onUploaded()
        setTimeout(() => setJobs((j) => { const n = { ...j }; delete n[key]; return n }), 1600)
      } catch (e) {
        const msg = (e as Error)?.message?.trim() || "Upload failed"
        setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], state: "error", error: msg } } : j))
      }
    },
    [expiryDays, effectiveKeepForever, onUploaded, folderId],
  )

  // Run a set of jobs through a bounded worker pool so large batches upload
  // concurrently without overwhelming the backend.
  const runJobs = useCallback(
    async (entries: Array<{ key: string; file: File }>) => {
      if (!entries.length) return
      let cursor = 0
      const worker = async () => {
        while (cursor < entries.length) {
          const current = entries[cursor++]
          await uploadOne(current.key, current.file)
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, entries.length) }, () => worker()))
    },
    [uploadOne],
  )

  const handleFiles = useCallback(
    async (incoming: FileList | File[] | null) => {
      if (!incoming) return
      const files = Array.from(incoming)
      if (!files.length) return
      const entries = files.map((file) => ({
        key: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
      }))
      setJobs((j) => {
        const next = { ...j }
        for (const { key, file } of entries) next[key] = { name: file.name, size: file.size, pct: 0, state: "queued", file }
        return next
      })
      await runJobs(entries)
    },
    [runJobs],
  )

  const retryJob = useCallback(
    (key: string) => {
      const job = jobsRef.current[key]
      if (!job?.file) return
      setJobs((j) => (j[key] ? { ...j, [key]: { ...j[key], state: "queued", pct: 0, error: undefined } } : j))
      void runJobs([{ key, file: job.file }])
    },
    [runJobs],
  )

  const retryAllFailed = useCallback(() => {
    const failed = Object.entries(jobsRef.current).filter(([, job]) => job.state === "error" && job.file)
    if (!failed.length) return
    setJobs((j) => {
      const next = { ...j }
      for (const [key] of failed) if (next[key]) next[key] = { ...next[key], state: "queued", pct: 0, error: undefined }
      return next
    })
    void runJobs(failed.map(([key, job]) => ({ key, file: job.file })))
  }, [runJobs])

  const jobList = Object.entries(jobs)
  const errorCount = jobList.filter(([, j]) => j.state === "error").length
  const activeCount = jobList.filter(([, j]) => j.state === "uploading" || j.state === "queued").length
  const doneCount = jobList.filter(([, j]) => j.state === "done").length

  return (
    <div>
      <motion.div
        animate={dragging ? zoneActive : zoneIdle}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); filesFromDrop(e.dataTransfer).then(handleFiles) }}
        onClick={() => ref.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-4 py-10 text-center drive-shadow transition sm:py-12"
      >
        <motion.div
          animate={dragging ? iconUp : iconDown}
          className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-drift-500 via-glow-500 to-blush-500 text-white shadow-lg shadow-glow-500/25 sm:h-16 sm:w-16"
        >
          {effectiveKeepForever ? <Infinity size={28} /> : <UploadCloud size={28} />}
        </motion.div>
        <div>
          <p className="font-semibold text-slate-700">
            {folderName ? `Drop files or folders into “${folderName}”` : "Drop files or folders here, or click to browse"}
          </p>
          <p className="mt-0.5 text-sm text-slate-400">
            {expiryText} · extend or delete anytime
          </p>
        </div>
        {canKeepForever && (
          <label onClick={(e) => e.stopPropagation()} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-drift-200 bg-drift-50 px-3 py-1.5 text-xs font-medium text-drift-700">
            <input type="checkbox" checked={keepForeverChoice} onChange={(e) => setKeepForeverChoice(e.target.checked)} />
            Keep these uploads forever
          </label>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click() }}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600"
        >
          <FolderUp size={14} /> Upload a folder
        </button>
        <input ref={ref} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        <input ref={folderInputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
      </motion.div>

      {jobList.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 px-1 text-xs text-slate-500">
          <span>
            {activeCount > 0 ? `Uploading — ${doneCount} done, ${activeCount} left` : `${doneCount} uploaded`}
            {errorCount > 0 && <span className="text-red-500">{` · ${errorCount} failed`}</span>}
          </span>
          {errorCount > 0 && (
            <button
              type="button"
              onClick={retryAllFailed}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 font-medium text-red-600 transition hover:bg-red-100"
            >
              <RotateCw size={13} /> Retry {errorCount} failed
            </button>
          )}
        </div>
      )}

      <div className="mt-2 space-y-2">
        <AnimatePresence>
          {jobList.map(([key, job]) => {
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
                  {job.state === "error" ? (
                    <p className="mt-1 truncate text-xs text-red-500">{job.error ?? "Upload failed"}</p>
                  ) : (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <motion.div className={barClass} animate={barAnimate} />
                    </div>
                  )}
                </div>
                {job.state === "queued" && <span className="shrink-0 text-xs text-slate-400">Queued</span>}
                {job.state === "done" && <CheckCircle2 className="shrink-0 text-emerald-500" size={18} />}
                {job.state === "error" && (
                  <button
                    type="button"
                    onClick={() => retryJob(key)}
                    title="Retry upload"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                  >
                    <RotateCw size={13} /> Retry
                  </button>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
