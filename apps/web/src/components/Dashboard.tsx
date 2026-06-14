import { useMemo, useState, type ReactNode } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { LogOut, HardDrive, Files as FilesIcon, Clock3 } from "lucide-react"
import { listFiles, extendFile, deleteFile, createShare, revokeShare } from "../lib/api"
import { signOut } from "../lib/auth-client"
import { formatBytes } from "../lib/format"
import Logo from "./Logo"
import UploadZone from "./UploadZone"
import FileCard from "./FileCard"

const headerInitial = { opacity: 0, y: -10 }
const headerAnimate = { opacity: 1, y: 0 }
const gridStagger = { visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30]

export default function Dashboard({ userName }: { userName?: string }) {
  const qc = useQueryClient()
  const [expiryDays, setExpiryDays] = useState(7)

  const filesQuery = useQuery({ queryKey: ["files"], queryFn: listFiles })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["files"] })

  const extendMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => extendFile(id, days),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: invalidate,
  })
  const shareMut = useMutation({
    mutationFn: (id: string) => createShare(id),
    onSuccess: invalidate,
  })
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: invalidate,
  })

  const files = filesQuery.data ?? []
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.sizeBytes || 0), 0), [files])

  return (
    <div className="relative">
      <motion.header
        initial={headerInitial}
        animate={headerAnimate}
        className="sticky top-0 z-20 border-b border-white/5 bg-ink/60 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            {userName && <span className="hidden text-white/50 sm:inline">Hi, {userName.split(" ")[0]}</span>}
            <button
              onClick={() => signOut()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10"
            >
              <LogOut size={15} /> <span className="hidden xs:inline">Sign out</span>
            </button>
          </div>
        </div>
      </motion.header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:pt-8">
        <section>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
            Your <span className="text-gradient">vault</span>
          </h1>
          <p className="mt-1 text-sm text-white/50 sm:text-base">Drop files, share a link, and let them vanish on schedule.</p>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-3">
            <Stat icon={<FilesIcon size={16} />} label="Files" value={String(files.length)} />
            <Stat icon={<HardDrive size={16} />} label="Stored" value={formatBytes(totalBytes)} />
            <Stat icon={<Clock3 size={16} />} label="Default" value={`${expiryDays}d`} />
          </div>
        </section>

        <section className="mt-7 sm:mt-9">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Upload</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-white/40">Expires in</span>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 outline-none transition focus:border-drift-400"
              >
                {EXPIRY_OPTIONS.map((d) => (
                  <option key={d} value={d} className="bg-ink">
                    {d} day{d === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <UploadZone expiryDays={expiryDays} onUploaded={invalidate} />
        </section>

        <section className="mt-8 sm:mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/40">
            Your files {files.length > 0 && <span className="text-white/25">({files.length})</span>}
          </h2>
          {filesQuery.isLoading ? (
            <p className="text-white/40">Loading…</p>
          ) : files.length === 0 ? (
            <div className="glass grid place-items-center rounded-2xl px-4 py-14 text-center text-sm text-white/40 sm:py-16 sm:text-base">
              <p>No files yet — drop something above to get started.</p>
            </div>
          ) : (
            <motion.div
              variants={gridStagger}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
            >
              <AnimatePresence mode="popLayout">
                {files.map((f) => (
                  <FileCard
                    key={f.id}
                    file={f}
                    onExtend={(id, days) => extendMut.mutate({ id, days })}
                    onDelete={(id) => deleteMut.mutate(id)}
                    onShare={(id) => shareMut.mutate(id)}
                    onRevoke={(id) => revokeMut.mutate(id)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </main>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-2xl px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-drift-500/15 text-drift-300 sm:h-9 sm:w-9">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold leading-tight sm:text-lg">{value}</p>
        <p className="text-[11px] text-white/40 sm:text-xs">{label}</p>
      </div>
    </div>
  )
}
