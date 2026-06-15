import { motion, AnimatePresence } from "framer-motion"
import { Clock, FolderOpen, FolderPlus, HardDrive, LogOut, Plus, Share2, Shield, Star, Trash2, X, type LucideIcon } from "lucide-react"
import Logo from "./Logo"
import { formatBytes } from "../lib/format"

export type Filter = "all" | "shared" | "expiring" | "favorites" | "trash"

const NAV: { id: Filter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "My Drive", icon: FolderOpen },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "expiring", label: "Expiring soon", icon: Clock },
  { id: "trash", label: "Trash", icon: Trash2 },
]

const newTap = { scale: 0.97 }
const barInitial = { width: 0 }
const overlayInitial = { opacity: 0 }
const overlayAnimate = { opacity: 1 }
const drawerInitial = { x: "-100%" }
const drawerAnimate = { x: 0 }
const drawerTransition = { type: "tween", duration: 0.22 } as const

type SidebarProps = {
  onNew: () => void
  onNewFolder: () => void
  totalBytes: number
  fileCount: number
  sharedCount: number
  filter: Filter
  setFilter: (f: Filter) => void
  isAdmin?: boolean
  onOpenAdmin?: () => void
  onSignOut?: () => void
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export default function Sidebar(props: SidebarProps) {
  const { mobileOpen = false, onCloseMobile } = props
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white/80 px-3 py-4 backdrop-blur-xl md:flex">
        <SidebarContent {...props} />
      </aside>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.button initial={overlayInitial} animate={overlayAnimate} exit={overlayInitial} aria-label="Close menu" onClick={onCloseMobile} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.aside initial={drawerInitial} animate={drawerAnimate} exit={drawerInitial} transition={drawerTransition} className="absolute inset-y-0 left-0 flex w-72 max-w-[80vw] flex-col border-r border-slate-200 bg-white px-3 py-4">
              <SidebarContent {...props} onClose={onCloseMobile} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

function SidebarContent({ onNew, onNewFolder, totalBytes, fileCount, sharedCount, filter, setFilter, isAdmin, onOpenAdmin, onSignOut, onClose }: SidebarProps & { onClose?: () => void }) {
  const pct = Math.min((totalBytes / (1024 * 1024 * 1024)) * 100, 100)
  const barAnimate = { width: `${pct}%` }
  const run = (fn?: () => void) => () => { fn?.(); onClose?.() }
  return (
    <>
      <div className="flex items-center justify-between px-2">
        <Logo />
        {onClose && <button onClick={onClose} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 md:hidden"><X size={18} /></button>}
      </div>
      <div className="mt-7 flex items-center gap-2">
        <motion.button whileTap={newTap} onClick={run(onNew)} className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500 py-3 pl-4 pr-5 font-semibold text-white shadow-lg shadow-glow-500/25 transition hover:shadow-glow-500/40"><Plus size={20} /> New</motion.button>
        <motion.button whileTap={newTap} onClick={run(onNewFolder)} title="New folder" aria-label="New folder" className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-drift-300 hover:text-drift-600"><FolderPlus size={20} /></motion.button>
      </div>
      <nav className="mt-7 space-y-1">
        {NAV.map((item) => {
          const active = filter === item.id
          const Icon = item.icon
          return <button key={item.id} onClick={run(() => setFilter(item.id))} className={"flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition " + (active ? "bg-drift-500/10 text-drift-700" : "text-slate-600 hover:bg-slate-100")}><Icon size={18} /><span>{item.label}</span>{item.id === "shared" && sharedCount > 0 && <span className="ml-auto text-xs text-slate-400">{sharedCount}</span>}</button>
        })}
        {isAdmin && <button onClick={run(onOpenAdmin)} className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"><Shield size={18} /><span>Admin</span></button>}
      </nav>
      <div className="mt-auto space-y-3">
        <div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2 text-sm font-medium text-slate-700"><HardDrive size={16} /> Storage</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><motion.div className="h-full rounded-full bg-gradient-to-r from-drift-500 to-blush-500" initial={barInitial} animate={barAnimate} /></div><p className="mt-2 text-xs text-slate-500">{formatBytes(totalBytes)} used · {fileCount} file{fileCount === 1 ? "" : "s"}</p><p className="mt-0.5 text-[11px] text-slate-400">Deleted files stay in Trash before cleanup</p></div>
        {onClose && onSignOut && <button onClick={run(onSignOut)} className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 md:hidden"><LogOut size={18} /><span>Sign out</span></button>}
      </div>
    </>
  )
}
