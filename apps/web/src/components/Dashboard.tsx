import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Download, FolderInput, FolderPlus, HardDrive, Trash2, X } from "lucide-react"
import {
  listFiles,
  listFolders,
  extendFile,
  deleteFile,
  createShare,
  revokeShare,
  moveFile,
  createFolder,
  renameFolder,
  deleteFolder,
  shareFolder,
  revokeFolderShare,
  downloadUrl,
} from "../lib/api"
import { signOut } from "../lib/auth-client"
import Sidebar, { type Filter } from "./Sidebar"
import Topbar, { type ViewMode } from "./Topbar"
import UploadZone from "./UploadZone"
import FileCard from "./FileCard"
import FolderCard from "./FolderCard"
import NameDialog from "./NameDialog"

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30]
const DAY = 86400

type DialogState = { mode: "create" } | { mode: "rename"; folderId: string; current: string } | null

const barInitial = { opacity: 0, y: 24, x: "-50%" }
const barAnimate = { opacity: 1, y: 0, x: "-50%" }
const barExit = { opacity: 0, y: 24, x: "-50%" }
const popInitial = { opacity: 0, scale: 0.95, y: 8 }
const popAnimate = { opacity: 1, scale: 1, y: 0 }

function titleFor(f: Filter): string {
  return f === "shared" ? "Shared" : f === "expiring" ? "Expiring soon" : "My Drive"
}

function triggerDownload(id: string) {
  const a = document.createElement("a")
  a.href = downloadUrl(id)
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export default function Dashboard({ userName, userEmail }: { userName?: string; userEmail?: string }) {
  const qc = useQueryClient()
  const [expiryDays, setExpiryDays] = useState(7)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<ViewMode>("grid")
  const [filter, setFilterState] = useState<Filter>("all")
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveBarOpen, setMoveBarOpen] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const filesQuery = useQuery({ queryKey: ["files"], queryFn: listFiles })
  const foldersQuery = useQuery({ queryKey: ["folders"], queryFn: listFolders })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["files"] })
    qc.invalidateQueries({ queryKey: ["folders"] })
  }

  const extendMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => extendFile(id, days),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteFile(id), onSuccess: invalidate })
  const revokeMut = useMutation({ mutationFn: (id: string) => revokeShare(id), onSuccess: invalidate })
  const moveMut = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => moveFile(id, folderId),
    onSuccess: invalidate,
  })
  const createFolderMut = useMutation({ mutationFn: (name: string) => createFolder(name), onSuccess: invalidate })
  const renameFolderMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameFolder(id, name),
    onSuccess: invalidate,
  })
  const deleteFolderMut = useMutation({ mutationFn: (id: string) => deleteFolder(id), onSuccess: invalidate })
  const revokeFolderMut = useMutation({ mutationFn: (id: string) => revokeFolderShare(id), onSuccess: invalidate })

  async function handleShare(id: string): Promise<string> {
    const res = await createShare(id)
    await invalidate()
    return res.url
  }
  async function handleShareFolder(id: string): Promise<string> {
    const res = await shareFolder(id)
    await invalidate()
    return res.url
  }

  const files = filesQuery.data ?? []
  const folders = foldersQuery.data ?? []
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.sizeBytes || 0), 0), [files])
  const sharedCount = useMemo(
    () => files.filter((f) => f.shareToken).length + folders.filter((f) => f.shareToken).length,
    [files, folders],
  )

  // If the open folder is deleted (or vanishes), fall back to the root.
  useEffect(() => {
    if (currentFolderId && foldersQuery.data && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null)
    }
  }, [currentFolderId, folders, foldersQuery.data])

  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null
  const atRoot = currentFolderId === null

  function clearSelection() {
    setSelected(new Set())
    setMoveBarOpen(false)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function getDragIds(id: string): string[] {
    return selected.has(id) && selected.size > 0 ? Array.from(selected) : [id]
  }

  function moveIds(ids: string[], folderId: string | null) {
    ids.forEach((id) => moveMut.mutate({ id, folderId }))
  }

  function setFilter(f: Filter) {
    setCurrentFolderId(null)
    setFilterState(f)
    clearSelection()
  }

  function openFolder(id: string) {
    setCurrentFolderId(id)
    clearSelection()
  }

  const q = search.trim().toLowerCase()
  const now = Math.floor(Date.now() / 1000)

  const visible = useMemo(() => {
    return files.filter((f) => {
      if (q && !f.filename.toLowerCase().includes(q)) return false
      if (filter === "shared" && !f.shareToken) return false
      if (filter === "expiring" && f.expiresAt - now >= DAY) return false
      if (currentFolderId) return f.folderId === currentFolderId
      if (filter === "all") return !f.folderId
      return true
    })
  }, [files, q, filter, currentFolderId, now])

  const showFolderSection = atRoot && filter === "all"
  const visibleFolders = useMemo(
    () => (showFolderSection ? folders.filter((fd) => !q || fd.name.toLowerCase().includes(q)) : []),
    [folders, q, showFolderSection],
  )

  const folderOptions = useMemo(() => folders.map((f) => ({ id: f.id, name: f.name })), [folders])

  const heading = currentFolder ? currentFolder.name : titleFor(filter)
  const itemCount = visible.length + visibleFolders.length
  const subtitle = `${itemCount} item${itemCount === 1 ? "" : "s"}${userName ? ` \u00b7 ${userName.split(" ")[0]}'s vault` : ""}`

  function onDialogConfirm(name: string) {
    if (!dialog) return
    if (dialog.mode === "create") {
      createFolderMut.mutate(name)
      // Make sure the new folder is visible: jump back to the My Drive root.
      setCurrentFolderId(null)
      setFilterState("all")
    } else {
      renameFolderMut.mutate({ id: dialog.folderId, name })
    }
    setDialog(null)
  }

  function deleteFolderConfirm(id: string) {
    const f = folders.find((x) => x.id === id)
    const msg = f && f.fileCount > 0
      ? `Delete \u201c${f.name}\u201d? Its ${f.fileCount} file${f.fileCount === 1 ? "" : "s"} will move back to My Drive (not deleted).`
      : "Delete this folder?"
    if (window.confirm(msg)) deleteFolderMut.mutate(id)
  }

  const selCount = selected.size

  function bulkMove(folderId: string | null) {
    moveIds(Array.from(selected), folderId)
    clearSelection()
  }
  function bulkDownload() {
    Array.from(selected).forEach((id, i) => setTimeout(() => triggerDownload(id), i * 400))
  }
  function bulkDelete() {
    if (!window.confirm(`Delete ${selCount} file${selCount === 1 ? "" : "s"}? This cannot be undone.`)) return
    Array.from(selected).forEach((id) => deleteMut.mutate(id))
    clearSelection()
  }

  return (
    <div>
      <Sidebar
        onNew={() => uploadInputRef.current?.click()}
        onNewFolder={() => setDialog({ mode: "create" })}
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
            <div className="min-w-0">
              {currentFolder && (
                <button
                  onClick={() => openFolder(currentFolder.id) /* no-op guard */ || setCurrentFolderId(null)}
                  className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-drift-600"
                >
                  <span>My Drive</span>
                  <ChevronRight size={14} />
                  <span className="font-medium text-slate-700">{currentFolder.name}</span>
                </button>
              )}
              <h1 className="truncate text-xl font-bold text-slate-800 sm:text-2xl">{heading}</h1>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setDialog({ mode: "create" })}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600"
              >
                <FolderPlus size={16} /> New folder
              </button>
              <span className="hidden text-slate-400 sm:inline">Expire in</span>
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

          <UploadZone
            expiryDays={expiryDays}
            onUploaded={invalidate}
            inputRef={uploadInputRef}
            folderId={currentFolderId}
            folderName={currentFolder?.name}
          />

          {showFolderSection && visibleFolders.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Folders</h2>
              <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {visibleFolders.map((fd) => (
                    <FolderCard
                      key={fd.id}
                      folder={fd}
                      view="grid"
                      onOpen={openFolder}
                      onShare={handleShareFolder}
                      onRevoke={(id) => revokeFolderMut.mutate(id)}
                      onRename={(id) => setDialog({ mode: "rename", folderId: id, current: fd.name })}
                      onDelete={deleteFolderConfirm}
                      onDropFiles={(folderId, ids) => moveIds(ids, folderId)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
          )}

          <div className="mt-6">
            {(showFolderSection && visibleFolders.length > 0) && (
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Files</h2>
            )}
            {filesQuery.isLoading ? (
              <p className="text-slate-400">Loading\u2026</p>
            ) : visible.length === 0 ? (
              <EmptyState filter={filter} hasFiles={files.length > 0} search={search} inFolder={!!currentFolder} />
            ) : view === "grid" ? (
              <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                <AnimatePresence mode="popLayout">
                  {visible.map((f) => (
                    <FileCard
                      key={f.id}
                      file={f}
                      view="grid"
                      folders={folderOptions}
                      onExtend={(id, days) => extendMut.mutate({ id, days })}
                      onDelete={(id) => deleteMut.mutate(id)}
                      onShare={handleShare}
                      onRevoke={(id) => revokeMut.mutate(id)}
                      onMove={(id, folderId) => moveMut.mutate({ id, folderId })}
                      selected={selected.has(f.id)}
                      onToggleSelect={toggleSelect}
                      anySelected={selCount > 0}
                      getDragIds={getDragIds}
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
                      folders={folderOptions}
                      onExtend={(id, days) => extendMut.mutate({ id, days })}
                      onDelete={(id) => deleteMut.mutate(id)}
                      onShare={handleShare}
                      onRevoke={(id) => revokeMut.mutate(id)}
                      onMove={(id, folderId) => moveMut.mutate({ id, folderId })}
                      selected={selected.has(f.id)}
                      onToggleSelect={toggleSelect}
                      anySelected={selCount > 0}
                      getDragIds={getDragIds}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {selCount > 0 && (
          <motion.div
            initial={barInitial}
            animate={barAnimate}
            exit={barExit}
            className="fixed bottom-5 left-1/2 z-50 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 drive-shadow-lg"
          >
            <span className="px-2 text-sm font-semibold text-slate-700">{selCount} selected</span>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <div className="relative">
              <button
                onClick={() => setMoveBarOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <FolderInput size={16} /> Move
              </button>
              <AnimatePresence>
                {moveBarOpen && (
                  <>
                    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setMoveBarOpen(false)} />
                    <motion.div
                      initial={popInitial}
                      animate={popAnimate}
                      exit={popInitial}
                      className="absolute bottom-12 left-0 z-50 max-h-64 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
                    >
                      <button
                        onClick={() => bulkMove(null)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                      >
                        Remove from folder
                      </button>
                      <div className="my-1 h-px bg-slate-100" />
                      {folders.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No folders yet.</p>}
                      {folders.map((fd) => (
                        <button
                          key={fd.id}
                          onClick={() => bulkMove(fd.id)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                        >
                          <FolderInput size={15} className="shrink-0 text-amber-500" />
                          <span className="truncate">{fd.name}</span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={bulkDownload}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Download size={16} /> Download
            </button>
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 size={16} /> Delete
            </button>
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <button
              onClick={clearSelection}
              aria-label="Clear selection"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <NameDialog
        open={dialog !== null}
        title={dialog?.mode === "rename" ? "Rename folder" : "New folder"}
        initial={dialog?.mode === "rename" ? dialog.current : ""}
        confirmLabel={dialog?.mode === "rename" ? "Rename" : "Create"}
        onCancel={() => setDialog(null)}
        onConfirm={onDialogConfirm}
      />
    </div>
  )
}

function EmptyState({
  filter,
  hasFiles,
  search,
  inFolder,
}: {
  filter: Filter
  hasFiles: boolean
  search: string
  inFolder: boolean
}) {
  const msg = search.trim()
    ? "No files match your search."
    : inFolder
      ? "This folder is empty \u2014 drop files above, or drag files onto it."
      : filter === "shared"
        ? "No shared files yet \u2014 use a file or folder's menu to create a link."
        : filter === "expiring"
          ? "Nothing expires in the next 24 hours."
          : hasFiles
            ? "No files here."
            : "Your vault is empty \u2014 drop files above to get started."
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center text-sm text-slate-400">
      <HardDrive size={28} className="mb-2 text-slate-300" />
      {msg}
    </div>
  )
}
