import { motion } from "framer-motion"
import { Download, Trash2, Clock, Link2, Copy, Check, X, FileText, Image as ImageIcon, Film, Music, Archive } from "lucide-react"
import { useEffect, useState } from "react"
import type { DriftFile } from "../lib/api"
import { downloadUrl, shareUrl } from "../lib/api"
import { formatBytes, timeLeft } from "../lib/format"

const cardInitial = { opacity: 0, y: 16, scale: 0.96 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }
const cardExit = { opacity: 0, scale: 0.9, transition: { duration: 0.15 } }
const cardHover = { y: -4, transition: { type: "spring" as const, stiffness: 300 } }
const panelInitial = { opacity: 0, height: 0 }
const panelAnimate = { opacity: 1, height: "auto" as const }

function iconFor(type: string | null) {
  if (!type) return FileText
  if (type.startsWith("image/")) return ImageIcon
  if (type.startsWith("video/")) return Film
  if (type.startsWith("audio/")) return Music
  if (type.includes("zip") || type.includes("compressed")) return Archive
  return FileText
}

export default function FileCard({
  file,
  onExtend,
  onDelete,
  onShare,
  onRevoke,
}: {
  file: DriftFile
  onExtend: (id: string, days: number) => void
  onDelete: (id: string) => void
  onShare: (id: string) => void
  onRevoke: (id: string) => void
}) {
  const Icon = iconFor(file.contentType)
  const [left, setLeft] = useState(() => timeLeft(file.expiresAt))
  const [copied, setCopied] = useState(false)

  // Live countdown.
  useEffect(() => {
    const t = setInterval(() => setLeft(timeLeft(file.expiresAt)), 30_000)
    return () => clearInterval(t)
  }, [file.expiresAt])

  const link = file.shareToken ? shareUrl(file.shareToken) : null

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked; the field is selectable as a fallback */
    }
  }

  return (
    <motion.div
      layout
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      whileHover={cardHover}
      className="card-glow group relative flex flex-col gap-3 rounded-2xl p-4"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-drift-500/25 to-glow-500/20 text-drift-200">
          <Icon size={20} />
        </div>
        <span
          className={
            "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium " +
            (left.urgent ? "bg-red-500/15 text-red-300" : "bg-white/5 text-white/60")
          }
        >
          <Clock size={12} /> {left.label}
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate font-semibold" title={file.filename}>{file.filename}</p>
        <p className="text-xs text-white/40">
          {formatBytes(file.sizeBytes)}
          {file.shareToken ? <span className="text-drift-300"> · shared</span> : null}
        </p>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <a
          href={downloadUrl(file.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-sm font-medium transition hover:bg-white/10"
        >
          <Download size={15} /> Download
        </a>
        <button
          onClick={() => (link ? copy() : onShare(file.id))}
          title={link ? "Copy share link" : "Create share link"}
          className={
            "rounded-lg p-2 transition " +
            (link ? "bg-drift-500/20 text-drift-200 hover:bg-drift-500/30" : "bg-white/5 text-white/70 hover:bg-white/10")
          }
        >
          <Link2 size={15} />
        </button>
        <button
          onClick={() => onExtend(file.id, 7)}
          title="Extend by 7 days (max 30)"
          className="rounded-lg bg-white/5 p-2 text-white/70 transition hover:bg-drift-500/20 hover:text-drift-300"
        >
          <Clock size={15} />
        </button>
        <button
          onClick={() => onDelete(file.id)}
          title="Delete now"
          className="rounded-lg bg-white/5 p-2 text-white/70 transition hover:bg-red-500/20 hover:text-red-300"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {link && (
        <motion.div initial={panelInitial} animate={panelAnimate} className="overflow-hidden">
          <div className="flex items-center gap-2 rounded-lg border border-drift-400/30 bg-drift-500/10 px-2 py-1.5">
            <Link2 size={13} className="shrink-0 text-drift-300" />
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-xs text-white/70 outline-none"
            />
            <button onClick={copy} title="Copy" className="shrink-0 rounded-md p-1 text-white/60 transition hover:bg-white/10 hover:text-white">
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
            <button onClick={() => onRevoke(file.id)} title="Revoke link" className="shrink-0 rounded-md p-1 text-white/60 transition hover:bg-red-500/20 hover:text-red-300">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
