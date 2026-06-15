import { motion } from "framer-motion"
import { Clock, FolderOpen, FolderPlus, HardDrive, Plus, Share2, Shield, type LucideIcon } from "lucide-react"
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
  onNewFolder,
  totalBytes,
  fileCount,
  sharedCount,
  filter,
  setFilter,
  isAdmin,
  onOpenAdmin,
}: {
  onNew: () => void
  onNewFolder: () => void
  totalBytes: number
  fileCount: number
  sharedCount: number
  filter: Filter
  setFilter: (f: Filter) => void
  isAdmin?: boolean
  onOpenAdmin?: () => void
}) {
  const pct = Math.min((totalBytes / (1024 * 1024 * 1024)) * 100, 100)
  const barAnimate = { width: `${pct}%` }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white/80 px-3 py-4 backdrop-blur-xl md:flex">
      <div className="px-2">
        <Logo />
      </div>

      <div className="mt-7 flex items-center gap-2">
        <motion.button
          whileTap={newTap}
          onClick={onNew}
          className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500 py-3 pl-4 pr-5 font-semibold text-white shadow-lg shadow-glow-500/25 transition hover:shadow-glow-500/40"
        >
          <Plus size={20} /> New
        </motion.button>
        <motion.button
          whileTap={newTap}
          onClick={onNewFolder}
          title="New folder"
          aria-label="New folder"
          className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-drift-300 hover:text-drift-600"
        >
          <FolderPlus size={20} />
        </motion.button>
      </div>

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
        {isAdmin && (
          <button
            onClick={onOpenAdmin}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <Shield size={18} />
            <span>Admin</span>
          </button>
        )}
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
          {formatBytes(totalBytes)} used \u00b7 {fileCount} file{fileCount === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">Files auto-expire to free up space</p>
      </div>
    </aside>
  )
}
