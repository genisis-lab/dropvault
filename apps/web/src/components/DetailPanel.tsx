import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Archive, Check, Clock, Download, FileText, Film, Image as ImageIcon, Infinity as InfinityIcon, Link2, Music, Star, Tags, Trash2, X } from "lucide-react"
import type { DriftFile } from "../lib/api"
import { downloadUrl, inlineUrl, shareUrl } from "../lib/api"
import { formatBytes, timeLeft } from "../lib/format"

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

type Props = {
  file: DriftFile | null
  onClose: () => void
  onShare: (id: string) => Promise<string>
  onRevoke: (id: string) => void
  onPreview: (file: DriftFile) => void
  onToggleFavorite: (id: string) => void
  onEditTags: (id: string) => void
  onExtend: (id: string, days: number) => void
  onDelete: (id: string) => void
  canKeepForever?: boolean
  onKeepForever?: (id: string) => void
  onUnkeepForever?: (id: string) => void
}

const panelInitial = { x: "100%" }
const panelAnimate = { x: 0 }
const overlayInitial = { opacity: 0 }
const overlayAnimate = { opacity: 1 }
const panelTransition = { type: "tween", duration: 0.22 } as const

// Slide-in right-side detail panel for the Calm Workspace. Shows a preview,
// share status, expiry, tags, and quick actions for a single file.
export default function DetailPanel(props: Props) {
  const { file, onClose } = props
  return (
    <AnimatePresence>
      {file && (
        <div className="fixed inset-0 z-40">
          <motion.button
            initial={overlayInitial}
            animate={overlayAnimate}
            exit={overlayInitial}
            aria-label="Close details"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/30 md:bg-slate-900/10"
          />
          <motion.aside
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelInitial}
            transition={panelTransition}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white drive-shadow-lg"
          >
            <DetailBody key={file.id} {...props} file={file} />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

function DetailBody({ file, onClose, onShare, onRevoke, onPreview, onToggleFavorite, onEditTags, onExtend, onDelete, canKeepForever = false, onKeepForever, onUnkeepForever }: Props & { file: DriftFile }) {
  const { Icon, tint } = kindOf(file.contentType)
  const tone = TINT[tint]
  const isImage = (file.contentType || "").startsWith("image/")
  const canPreview = isImage || (file.contentType || "").includes("pdf")
  const left = timeLeft(file.expiresAt)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const created = new Date(file.createdAt * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  const tags = file.tags ?? []

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
    }
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Details</h2>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <button
          type="button"
          onClick={() => canPreview && onPreview(file)}
          className={"flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl " + tone.bg + (canPreview ? " cursor-zoom-in" : " cursor-default")}
        >
          {isImage ? <img src={inlineUrl(file.id)} alt={file.filename} className="h-full w-full object-cover" /> : <Icon size={48} className={tone.fg} />}
        </button>
        <h3 className="mt-4 break-words text-base font-semibold text-slate-800">
          {file.favorite && <Star size={14} className="mr-1 inline fill-amber-400 text-amber-400" />}
          {file.filename}
        </h3>
        <p className="mt-0.5 text-xs text-slate-400">{formatBytes(file.sizeBytes)} · {file.contentType || "file"}</p>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Share status</dt>
            <dd>
              {file.shareToken ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-drift-50 px-2 py-0.5 text-xs font-medium text-drift-600"><Link2 size={11} /> Shared</span>
              ) : (
                <span className="text-slate-500">Private</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Expiry</dt>
            <dd className={file.keepForever && !file.deletedAt ? "font-medium text-drift-600" : left.urgent ? "font-medium text-red-600" : "text-slate-600"}>
              <span className="inline-flex items-center gap-1">{file.keepForever && !file.deletedAt ? <InfinityIcon size={12} /> : <Clock size={12} />} {file.deletedAt ? "In Trash" : file.keepForever ? "Forever" : left.label}</span>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Added</dt>
            <dd className="text-slate-600">{created}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-slate-400">Tags</p>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">#{t}</span>)}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No tags yet.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3 text-sm">
        <a href={downloadUrl(file.id)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600">
          <Download size={16} /> Download
        </a>
        <button disabled={busy} onClick={copyLink} className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-drift-500 to-blush-500 px-3 py-2 font-medium text-white transition hover:opacity-90 disabled:opacity-50">
          {copied ? <Check size={16} /> : <Link2 size={16} />} {file.shareToken ? "Copy link" : "Get link"}
        </button>
        <button onClick={() => onToggleFavorite(file.id)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 transition hover:bg-slate-50">
          <Star size={16} className={file.favorite ? "fill-amber-400 text-amber-400" : ""} /> {file.favorite ? "Unfavorite" : "Favorite"}
        </button>
        <button onClick={() => onEditTags(file.id)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 transition hover:bg-slate-50">
          <Tags size={16} /> Tags
        </button>
        {!file.keepForever && (
          <button onClick={() => onExtend(file.id, 7)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 font-medium text-slate-600 transition hover:bg-slate-50">
            <Clock size={16} /> +7 days
          </button>
        )}
        <button onClick={() => { onDelete(file.id); onClose() }} className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 font-medium text-red-600 transition hover:bg-red-50">
          <Trash2 size={16} /> Trash
        </button>
      </div>
      {!file.deletedAt && (file.keepForever ? (
        <button onClick={() => onUnkeepForever?.(file.id)} className="mx-4 mb-2 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
          <Clock size={16} /> Stop keeping forever
        </button>
      ) : canKeepForever ? (
        <button onClick={() => onKeepForever?.(file.id)} className="mx-4 mb-2 flex items-center justify-center gap-2 rounded-xl border border-drift-200 bg-drift-50 px-3 py-2 text-sm font-medium text-drift-600 transition hover:bg-drift-100">
          <InfinityIcon size={16} /> Keep forever
        </button>
      ) : null)}
      {file.shareToken && (
        <button onClick={() => onRevoke(file.id)} className="mx-4 mb-4 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
          <X size={16} /> Revoke share link
        </button>
      )}
    </>
  )
}
