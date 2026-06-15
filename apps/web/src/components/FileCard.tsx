import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Film,
  FolderInput,
  FolderMinus,
  Image as ImageIcon,
  Link2,
  MoreVertical,
  Music,
  Pencil,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react"
import type { DriftFile } from "../lib/api"
import { downloadUrl, inlineUrl, shareUrl } from "../lib/api"
import { formatBytes, timeLeft } from "../lib/format"

export const DRAG_MIME = "application/x-dropvault"

type Tint = "indigo" | "emerald" | "rose" | "violet" | "red" | "amber"

const TINT: Record<Tint, { bg: string; fg: string }> = {
  indigo: { bg: "bg-indigo-50", fg: "text-indigo-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-500" },
  rose: { bg: "bg-rose-50", fg: "text-rose-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-500" },
  red: { bg: "bg-red-50", fg: "text-red-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-500" },
}

function kindOf(type: string | null): { Icon: typeof FileText; tint: Tint } {
  if (!type) return { Icon: FileText, tint: "indigo" }
  if (type.startsWith("image/")) return { Icon: ImageIcon, tint: "emerald" }
  if (type.startsWith("video/")) return { Icon: Film, tint: "rose" }
  if (type.startsWith("audio/")) return { Icon: Music, tint: "violet" }
  if (type.includes("pdf")) return { Icon: FileText, tint: "red" }
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return { Icon: Archive, tint: "amber" }
  return { Icon: FileText, tint: "indigo" }
}

type FolderOption = { id: string; name: string }

type Props = {
  file: DriftFile
  view: "grid" | "list"
  folders?: FolderOption[]
  onExtend: (id: string, days: number) => void
  onDelete: (id: string) => void
  onShare: (id: string) => Promise<string>
  onRevoke: (id: string) => void
  onMove?: (id: string, folderId: string | null) => void
  onRename?: (id: string) => void
  onOpenShare?: (id: string) => void
  onPreview?: (file: DriftFile) => void
  selected?: boolean
  onToggleSelect?: (id: string) => void
  anySelected?: boolean
  getDragIds?: (id: string) => string[]
}

const cardInitial = { opacity: 0, y: 12, scale: 0.97 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }
const cardExit = { opacity: 0, scale: 0.92 }
const menuInitial = { opacity: 0, scale: 0.95, y: -4 }
const menuAnimate = { opacity: 1, scale: 1, y: 0 }

export default function FileCard({
  file,
  view,
  folders = [],
  onExtend,
  onDelete,
  onShare,
  onRevoke,
  onMove,
  onRename,
  onOpenShare,
  onPreview,
  selected = false,
  onToggleSelect,
  anySelected = false,
  getDragIds,
}: Props) {
  const { Icon, tint } = kindOf(file.contentType)
  const tone = TINT[tint]
  const isImage = (file.contentType || "").startsWith("image/")
  const canPreview = isImage || (file.contentType || "").includes("pdf")
  const [left, setLeft] = useState(() => timeLeft(file.expiresAt))
  const [menuOpen, setMenuOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setLeft(timeLeft(file.expiresAt)), 30000)
    return () => clearInterval(t)
  }, [file.expiresAt])

  function closeMenu() {
    setMenuOpen(false)
    setMoveOpen(false)
  }

  function handleDragStart(e: React.DragEvent) {
    const ids = getDragIds ? getDragIds(file.id) : [file.id]
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = "move"
  }

  // motion.div reserves onDragStart for its pan gesture; this alias lets us
  // attach the native HTML5 drag handler without a type clash.
  const nativeDragStart = handleDragStart as unknown as React.ComponentProps<typeof motion.div>["onDragStart"]

  function handleContextMenu(e: React.MouseEvent) {
    if (!onToggleSelect) return
    e.preventDefault()
    onToggleSelect(file.id)
  }

  function preview() {
    if (canPreview && onPreview) onPreview(file)
  }

  async function copyLink() {
    setBusy(true)
    try {
      const url = file.shareToken ? shareUrl(file.shareToken) : await onShare(file.id)
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
      closeMenu()
    }
  }

  const canMove = !!onMove
  const moveTargets = folders.filter((f) => f.id !== file.folderId)
  const showCheckbox = !!onToggleSelect && (anySelected || selected)

  const chipClass =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
    (left.urgent ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")

  const checkbox = onToggleSelect ? (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onToggleSelect(file.id)
      }}
      aria-label={selected ? "Deselect" : "Select"}
      className={
        "grid h-5 w-5 place-items-center rounded-md border transition " +
        (selected
          ? "border-drift-500 bg-drift-500 text-white"
          : "border-slate-300 bg-white/90 text-transparent hover:border-drift-400 " +
            (showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100"))
      }
    >
      <Check size={13} />
    </button>
  ) : null

  const menu = (
    <AnimatePresence>
      {menuOpen && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={closeMenu} />
          <motion.div
            initial={menuInitial}
            animate={menuAnimate}
            exit={menuInitial}
            className="absolute right-0 top-9 z-40 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
          >
            {!moveOpen ? (
              <>
                {canPreview && onPreview && (
                  <button
                    onClick={() => {
                      onPreview(file)
                      closeMenu()
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <Eye size={15} /> Preview
                  </button>
                )}
                <a
                  href={downloadUrl(file.id)}
                  onClick={closeMenu}
                  className="flex items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                >
                  <Download size={15} /> Download
                </a>
                {onRename && (
                  <button
                    onClick={() => {
                      onRename(file.id)
                      closeMenu()
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil size={15} /> Rename
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={copyLink}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {copied ? <Check size={15} className="text-emerald-500" /> : <Link2 size={15} />}
                  {file.shareToken ? "Copy link" : "Get link"}
                </button>
                {onOpenShare && (
                  <button
                    onClick={() => {
                      onOpenShare(file.id)
                      closeMenu()
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <SlidersHorizontal size={15} /> Share settings…
                  </button>
                )}
                {file.shareToken && (
                  <button
                    onClick={() => {
                      onRevoke(file.id)
                      closeMenu()
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <X size={15} /> Revoke link
                  </button>
                )}
                {canMove && (
                  <button
                    onClick={() => setMoveOpen(true)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                  >
                    <FolderInput size={15} /> Move to
                    <ChevronRight size={14} className="ml-auto text-slate-400" />
                  </button>
                )}
                <button
                  onClick={() => {
                    onExtend(file.id, 7)
                    closeMenu()
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                >
                  <Clock size={15} /> Extend 7 days
                </button>
                <button
                  onClick={() => {
                    onDelete(file.id)
                    closeMenu()
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={15} /> Delete
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setMoveOpen(false)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 font-medium text-slate-600 hover:bg-slate-50"
                >
                  <ChevronLeft size={15} /> Move to…
                </button>
                <div className="my-1 h-px bg-slate-100" />
                <div className="max-h-52 overflow-y-auto">
                  {file.folderId && onMove && (
                    <button
                      onClick={() => {
                        onMove(file.id, null)
                        closeMenu()
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                    >
                      <FolderMinus size={15} /> Remove from folder
                    </button>
                  )}
                  {moveTargets.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onMove?.(file.id, f.id)
                        closeMenu()
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                    >
                      <FolderInput size={15} className="shrink-0 text-amber-500" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  {moveTargets.length === 0 && !file.folderId && (
                    <p className="px-3 py-2 text-xs text-slate-400">No other folders yet.</p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  if (view === "list") {
    return (
      <motion.div
        layout
        draggable
        onDragStart={nativeDragStart}
        onContextMenu={handleContextMenu}
        initial={cardInitial}
        animate={cardAnimate}
        exit={cardExit}
        className={
          "group relative flex items-center gap-3 px-4 py-2.5 transition " +
          (selected ? "bg-drift-500/10" : "hover:bg-slate-50")
        }
      >
        {onToggleSelect && <div className="flex w-5 justify-center">{checkbox}</div>}
        <button
          type="button"
          onClick={preview}
          className={
            "grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg " +
            tone.bg + " " + tone.fg + (canPreview ? " cursor-zoom-in" : "")
          }
        >
          {isImage ? (
            <img src={inlineUrl(file.id)} alt={file.filename} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <Icon size={18} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800" title={file.filename}>
            {file.filename}
          </p>
          <p className="text-xs text-slate-400 sm:hidden">{formatBytes(file.sizeBytes)}</p>
        </div>
        {file.shareToken && (
          <span className="hidden items-center gap-1 rounded-full bg-drift-50 px-2 py-0.5 text-[11px] font-medium text-drift-600 sm:inline-flex">
            <Link2 size={11} /> Shared
          </span>
        )}
        <span className={chipClass}>
          <Clock size={11} /> {left.label}
        </span>
        <span className="hidden w-20 text-right text-xs text-slate-400 sm:block">{formatBytes(file.sizeBytes)}</span>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="File actions"
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
      draggable
      onDragStart={nativeDragStart}
      onContextMenu={handleContextMenu}
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      className={
        "group relative flex flex-col rounded-2xl border bg-white drive-shadow transition hover:shadow-md " +
        (selected ? "border-drift-400 ring-2 ring-drift-400/60" : "border-slate-200 hover:border-slate-300")
      }
    >
      <div
        onClick={preview}
        className={
          "relative flex h-24 items-center justify-center overflow-hidden rounded-t-2xl " +
          tone.bg + (canPreview ? " cursor-zoom-in" : "")
        }
      >
        {isImage ? (
          <img src={inlineUrl(file.id)} alt={file.filename} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon size={34} className={tone.fg} />
        )}
        {onToggleSelect && <div className="absolute left-2 top-2">{checkbox}</div>}
        <span className={"absolute right-2 top-2 " + chipClass}>
          <Clock size={11} /> {left.label}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={"grid h-7 w-7 shrink-0 place-items-center rounded-md " + tone.bg + " " + tone.fg}>
          <Icon size={15} />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={file.filename}>
          {file.filename}
        </p>
        {file.shareToken && <Link2 size={13} className="shrink-0 text-drift-500" />}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="File actions"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <MoreVertical size={16} />
          </button>
          {menu}
        </div>
      </div>
      <div className="-mt-1 px-3 pb-2.5 text-xs text-slate-400">{formatBytes(file.sizeBytes)}</div>
    </motion.div>
  )
}
