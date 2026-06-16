import { LayoutGrid, List, LogOut, Menu, Plus, Search, ShieldCheck } from "lucide-react"
import { ThemeToggle } from "../lib/theme"
import { LayoutToggle } from "../lib/layout"
import NotificationsBell from "./NotificationsBell"

export type ViewMode = "grid" | "list"

export default function Topbar({
  search,
  setSearch,
  view,
  setView,
  userEmail,
  onNew,
  onSignOut,
  onOpenMenu,
  onOpenSecurity,
}: {
  search: string
  setSearch: (s: string) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  userEmail?: string
  onNew: () => void
  onSignOut: () => void
  onOpenMenu?: () => void
  onOpenSecurity?: () => void
}) {
  const initial = (userEmail?.[0] ?? "U").toUpperCase()

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/70 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-4 py-3 sm:gap-3">
        <button onClick={onOpenMenu} aria-label="Open menu" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 md:hidden"><Menu size={22} /></button>
        <button onClick={onNew} aria-label="New upload" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-r from-drift-500 to-blush-500 text-white shadow-md shadow-glow-500/25 md:hidden"><Plus size={20} /></button>
        <div className="relative flex-1"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search in Dropvault" className="w-full rounded-full bg-slate-100 py-2.5 pl-11 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-drift-300" /></div>
        <div className="hidden items-center rounded-full border border-slate-200 bg-white p-0.5 sm:flex"><button onClick={() => setView("grid")} aria-label="Grid view" className={"grid h-8 w-8 place-items-center rounded-full transition " + (view === "grid" ? "bg-drift-500/10 text-drift-700" : "text-slate-400 hover:text-slate-600")}><LayoutGrid size={16} /></button><button onClick={() => setView("list")} aria-label="List view" className={"grid h-8 w-8 place-items-center rounded-full transition " + (view === "list" ? "bg-drift-500/10 text-drift-700" : "text-slate-400 hover:text-slate-600")}><List size={16} /></button></div>
        <LayoutToggle />
        <ThemeToggle />
        <NotificationsBell />
        <button onClick={onOpenSecurity} title="Account security" aria-label="Account security" className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:block"><ShieldCheck size={18} /></button>
        <div className="flex items-center gap-2"><div title={userEmail} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-drift-500 to-blush-500 text-sm font-semibold text-white">{initial}</div><button onClick={onSignOut} title="Sign out" aria-label="Sign out" className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:block"><LogOut size={18} /></button></div>
      </div>
    </header>
  )
}
