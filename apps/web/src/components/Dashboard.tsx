import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import { listFiles, extendFile, deleteFile } from "../lib/api"
import { signOut } from "../lib/auth-client"
import Logo from "./Logo"
import UploadZone from "./UploadZone"
import FileCard from "./FileCard"

const headerInitial = { opacity: 0, y: -10 }
const headerAnimate = { opacity: 1, y: 0 }
const gridStagger = { visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30]

export default function Dashboard({ userName }: { userName?: string }) {
  const qc = useQueryClient()
  const [expiryDays, setExpiryDays] = useState(2)

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

  const files = filesQuery.data ?? []

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <motion.header
        initial={headerInitial}
        animate={headerAnimate}
        className="flex items-center justify-between"
      >
        <Logo />
        <div className="flex items-center gap-3 text-sm">
          {userName && <span className="text-white/50">Hi, {userName}</span>}
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 transition hover:bg-white/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </motion.header>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Upload</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/40">Expires in</span>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 outline-none"
            >
              {EXPIRY_OPTIONS.map((d) => (
                <option key={d} value={d} className="bg-ink">{d} day{d === 1 ? "" : "s"}</option>
              ))}
            </select>
          </div>
        </div>
        <UploadZone expiryDays={expiryDays} onUploaded={invalidate} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/40">
          Your files {files.length > 0 && <span className="text-white/25">({files.length})</span>}
        </h2>

        {filesQuery.isLoading ? (
          <p className="text-white/40">Loading…</p>
        ) : files.length === 0 ? (
          <div className="glass grid place-items-center rounded-2xl py-16 text-center text-white/40">
            <p>No files yet — drop something above to get started.</p>
          </div>
        ) : (
          <motion.div
            variants={gridStagger}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <AnimatePresence mode="popLayout">
              {files.map((f) => (
                <FileCard
                  key={f.id}
                  file={f}
                  onExtend={(id, days) => extendMut.mutate({ id, days })}
                  onDelete={(id) => deleteMut.mutate(id)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>
    </div>
  )
}
