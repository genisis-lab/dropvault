import { useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { listFiles, extendFile, deleteFile, createShare, revokeShare } from "../lib/api"
import { signOut } from "../lib/auth-client"
import Sidebar, { type Filter } from "./Sidebar"
import Topbar, { type ViewMode } from "./Topbar"
import UploadZone from "./UploadZone"
import FileCard from "./FileCard"

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30]
const DAY = 86400

function titleFor(f: Filter): string {
  return f === "shared" ? "Shared" : f === "expiring" ? "Expiring soon" : "My Drive"
}

export default function Dashboard({ userName, userEmail }: { userName?: string; userEmail?: string }) {
  const qc = useQueryClient()
  const [expiryDays, setExpiryDays] = useState(7)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<ViewMode>("grid")
  const [filter, setFilter] = useState<Filter>("all")
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const filesQuery = useQuery({ queryKey: ["files"], queryFn: listFiles })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["files"] })

  const extendMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => extendFile(id, days),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteFile(id), onSuccess: invalidate })
  const revokeMut = useMutation({ mutationFn: (id: string) => revokeShare(id), onSuccess: invalidate })

  async function handleShare(id: string): Promise<string> {
    const res = await createShare(id)
    await invalidate()
    return res.url
  }

  const files = filesQuery.data ?? []
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.sizeBytes || 0), 0), [files])
  const sharedCount = useMemo(() => files.filter((f) => f.shareToken).length, [files])

  const visible = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const q = search.trim().toLowerCase()
    return files.filter((f) => {
      if (q && !f.filename.toLowerCase().includes(q)) return false
      if (filter === "shared" && !f.shareToken) return false
      if (filter === "expiring" && f.expiresAt - now >= DAY) return false
      return true
    })
  }, [files, search, filter])

  const subtitle = `${visible.length} item${visible.length === 1 ? "" : "s"}${userName ? ` · ${userName.split(" ")[0]}'s vault` : ""}`

  return (
    <div>
      <Sidebar
        onNew={() => uploadInputRef.current?.click()}
        totalBytes={totalBytes}
        fileCount={files.length}
        sharedCount={sharedCount}
        filter={filter}
        setFilter={setFilter}
      />

      <div className="md:pl-60">
        <Topbar
          search={search}
          setSearch={setSearch}
          view={view}
          setView={setView}
          userEmail={userEmail}
          onNew={() => uploadInputRef.current?.click()}
          onSignOut={() => signOut()}
        />

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{titleFor(filter)}</h1>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">New files expire in</span>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 outline-none transition focus:border-drift-400"
              >
                {EXPIRY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} day{d === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <UploadZone expiryDays={expiryDays} onUploaded={invalidate} inputRef={uploadInputRef} />

          <div className="mt-6">
            {filesQuery.isLoading ? (
              <p className="text-slate-400">Loading…</p>
            ) : visible.length === 0 ? (
              <EmptyState filter={filter} hasFiles={files.length > 0} search={search} />
            ) : view === "grid" ? (
              <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                <AnimatePresence mode="popLayout">
                  {visible.map((f) => (
                    <FileCard
                      key={f.id}
                      file={f}
                      view="grid"
                      onExtend={(id, days) => extendMut.mutate({ id, days })}
                      onDelete={(id) => deleteMut.mutate(id)}
                      onShare={handleShare}
                      onRevoke={(id) => revokeMut.mutate(id)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white drive-shadow">
                <AnimatePresence mode="popLayout">
                  {visible.map((f) => (
                    <FileCard
                      key={f.id}
                      file={f}
                      view="list"
                      onExtend={(id, days) => extendMut.mutate({ id, days })}
                      onDelete={(id) => deleteMut.mutate(id)}
                      onShare={handleShare}
                      onRevoke={(id) => revokeMut.mutate(id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function EmptyState({ filter, hasFiles, search }: { filter: Filter; hasFiles: boolean; search: string }) {
  const msg = search.trim()
    ? "No files match your search."
    : filter === "shared"
      ? "No shared files yet — use a file's menu to create a link."
      : filter === "expiring"
        ? "Nothing expires in the next 24 hours."
        : hasFiles
          ? "No files here."
          : "Your vault is empty — drop files above to get started."
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center text-sm text-slate-400">
      {msg}
    </div>
  )
}
