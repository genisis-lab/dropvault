import { motion } from "framer-motion"
import { Download, Trash2, Clock, FileText, Image as ImageIcon, Film, Music, Archive } from "lucide-react"
import { useEffect, useState } from "react"
import type { DriftFile } from "../lib/api"
import { downloadUrl } from "../lib/api"
import { formatBytes, timeLeft } from "../lib/format"

const cardInitial = { opacity: 0, y: 16, scale: 0.96 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }
const cardExit = { opacity: 0, scale: 0.9, transition: { duration: 0.15 } }
const cardHover = { y: -4, transition: { type: "spring" as const, stiffness: 300 } }

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
}: {
  file: DriftFile
  onExtend: (id: string, days: number) => void
  onDelete: (id: string) => void
}) {
  const Icon = iconFor(file.contentType)
  const [left, setLeft] = useState(() => timeLeft(file.expiresAt))

  // Live countdown.
  useEffect(() => {
    const t = setInterval(() => setLeft(timeLeft(file.expiresAt)), 30_000)
    return () => clearInterval(t)
  }, [file.expiresAt])

  return (
    <motion.div
      layout
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      whileHover={cardHover}
      className="glass group relative flex flex-col gap-3 rounded-2xl p-4"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-drift-500/15 text-drift-400">
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
        <p className="text-xs text-white/40">{formatBytes(file.sizeBytes)}</p>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <a
          href={downloadUrl(file.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-sm font-medium transition hover:bg-white/10"
        >
          <Download size={15} /> Download
        </a>
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
    </motion.div>
  )
}
