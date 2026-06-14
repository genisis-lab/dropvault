import { motion } from "framer-motion"
import { Clock, FolderOpen, HardDrive, Plus, Share2, type LucideIcon } from "lucide-react"
import Logo from "./Logo"
import { formatBytes } from "../lib/format"

export type Filter = "all" | "shared" | "expiring"

const NAV: { id: Filter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "My Drive", icon: FolderOpen },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "expiring", label: "Expiring soon", icon: Clock },
]

const newTap = { scale: 0.97 }
const barInitial = { width: 0 }

export default function Sidebar({
  onNew,
  totalBytes,
  fileCount,
  sharedCount,
  filter,
  setFilter,
}: {
  onNew: () => void
  totalBytes: number
  fileCount: number
  sharedCount: number
  filter: Filter
  setFilter: (f: Filter) => void
}) {
  const pct = Math.min((totalBytes / (1024 * 1024 * 1024)) * 100, 100)
  const barAnimate = { width: `${pct}%` }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white/80 px-3 py-4 backdrop-blur-xl md:flex">
      <div className="px-2">
        <Logo />
      </div>

      <motion.button
        whileTap={newTap}
        onClick={onNew}
        className="mt-7 flex items-center gap-3 self-start rounded-2xl bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500 py-3 pl-4 pr-5 font-semibold text-white shadow-lg shadow-glow-500/25 transition hover:shadow-glow-500/40"
      >
        <Plus size={20} /> New
      </motion.button>

      <nav className="mt-7 space-y-1">
        {NAV.map((item) => {
          const active = filter === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={
                "flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition " +
                (active ? "bg-drift-500/10 text-drift-700" : "text-slate-600 hover:bg-slate-100")
              }
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.id === "shared" && sharedCount > 0 && (
                <span className="ml-auto text-xs text-slate-400">{sharedCount}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <HardDrive size={16} /> Storage
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-drift-500 to-blush-500"
            initial={barInitial}
            animate={barAnimate}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {formatBytes(totalBytes)} used · {fileCount} file{fileCount === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">Files auto-expire to free up space</p>
      </div>
    </aside>
  )
}
