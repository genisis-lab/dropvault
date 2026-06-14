import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Folder, Link2, MoreVertical, Pencil, Share2, Trash2, X } from "lucide-react"
import type { Folder as FolderT } from "../lib/api"
import { folderShareUrl } from "../lib/api"

export const DRAG_MIME = "application/x-dropvault"

const cardInitial = { opacity: 0, y: 12, scale: 0.97 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }
const cardExit = { opacity: 0, scale: 0.92 }
const menuInitial = { opacity: 0, scale: 0.95, y: -4 }
const menuAnimate = { opacity: 1, scale: 1, y: 0 }

type Props = {
  folder: FolderT
  view: "grid" | "list"
  onOpen: (id: string) => void
  onShare: (id: string) => Promise<string>
  onRevoke: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onDropFiles?: (folderId: string, ids: string[]) => void
}

export default function FolderCard({ folder, view, onOpen, onShare, onRevoke, onRename, onDelete, onDropFiles }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)

  async function copyLink() {
    setBusy(true)
    try {
      const url = folder.shareToken ? folderShareUrl(folder.shareToken) : await onShare(folder.id)
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!onDropFiles || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropActive(true)
  }

  function handleDrop(e: React.DragEvent) {
    setDropActive(false)
    if (!onDropFiles || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    try {
      const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME))
      if (Array.isArray(ids) && ids.length) onDropFiles(folder.id, ids)
    } catch {
      /* ignore */
    }
  }

  const meta = `${folder.fileCount} item${folder.fileCount === 1 ? "" : "s"}`

  const menu = (
    <AnimatePresence>
      {menuOpen && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <motion.div
            initial={menuInitial}
            animate={menuAnimate}
            exit={menuInitial}
            className="absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
          >
            <button
              disabled={busy}
              onClick={copyLink}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Link2 size={15} />}
              {folder.shareToken ? "Copy link" : "Get link"}
            </button>
            {folder.shareToken && (
              <button
                onClick={() => {
                  onRevoke(folder.id)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
              >
                <X size={15} /> Revoke link
              </button>
            )}
            <button
              onClick={() => {
                onRename(folder.id)
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              <Pencil size={15} /> Rename
            </button>
            <button
              onClick={() => {
                onDelete(folder.id)
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={15} /> Delete
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  const ringClass = dropActive
    ? "border-drift-400 ring-2 ring-drift-400/60 bg-drift-500/5"
    : "border-slate-200 hover:border-slate-300"

  if (view === "list") {
    return (
      <motion.div
        layout
        initial={cardInitial}
        animate={cardAnimate}
        exit={cardExit}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
        className={"relative flex items-center gap-3 border-l-2 px-4 py-2.5 transition " + (dropActive ? "border-drift-400 bg-drift-500/5" : "border-transparent hover:bg-slate-50")}
      >
        <button onClick={() => onOpen(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-500">
            <Folder size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{folder.name}</p>
            <p className="text-xs text-slate-400">{meta}</p>
          </div>
        </button>
        {folder.shareToken && (
          <span className="hidden items-center gap-1 rounded-full bg-drift-50 px-2 py-0.5 text-[11px] font-medium text-drift-600 sm:inline-flex">
            <Share2 size={11} /> Shared
          </span>
        )}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Folder actions"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <MoreVertical size={16} />
          </button>
          {menu}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
      className={"group relative flex items-center gap-3 rounded-2xl border bg-white px-3 py-3 drive-shadow transition hover:shadow-md " + ringClass}
    >
      <button onClick={() => onOpen(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-500">
          <Folder size={20} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800" title={folder.name}>
            {folder.name}
          </p>
          <p className="text-xs text-slate-400">
            {dropActive ? "Drop to move here" : meta + (folder.shareToken ? " \u00b7 shared" : "")}
          </p>
        </div>
      </button>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Folder actions"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <MoreVertical size={16} />
        </button>
        {menu}
      </div>
    </motion.div>
  )
}
