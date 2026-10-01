import { useRef, useState } from "react";
import {
  LayoutGrid,
  List,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import {
  THEME_OPTIONS,
  ThemeToggle,
  useTheme,
  type Theme,
} from "../lib/theme";
import { LayoutToggle, useLayout, type Layout } from "../lib/layout";
import NotificationsBell from "./NotificationsBell";
import type { NotificationDestination } from "../lib/notificationTarget";

export type ViewMode = "grid" | "list";

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
  onOpenTeams,
  onNotificationNavigate,
}: {
  search: string;
  setSearch: (s: string) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  userEmail?: string;
  onNew: () => void;
  onSignOut: () => void;
  onOpenMenu?: () => void;
  onOpenSecurity?: () => void;
  onOpenTeams?: () => void;
  onNotificationNavigate?: (destination: NotificationDestination) => void;
}) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { layout, setLayout } = useLayout();
  const {
    theme,
    workspaceDefault,
    followsWorkspaceDefault,
    setTheme,
    useWorkspaceDefault,
  } = useTheme();
  const initial = (userEmail?.[0] ?? "U").toUpperCase();
  const currentTheme = THEME_OPTIONS.find((option) => option.id === theme);
  const workspaceTheme = THEME_OPTIONS.find(
    (option) => option.id === workspaceDefault,
  );
  function chooseMobileLayout(next: Layout) {
    setLayout(next);
    setMobileActionsOpen(false);
  }
  function chooseMobileTheme(value: string) {
    if (value === "workspace") useWorkspaceDefault();
    else setTheme(value as Theme);
    setMobileActionsOpen(false);
  }
  const viewButton = (mode: ViewMode, label: string) => (
    <button
      onClick={() => setView(mode)}
      aria-label={label}
      className={
        "grid h-8 w-8 place-items-center rounded-full transition " +
        (view === mode
          ? "bg-drift-500/10 text-drift-700"
          : "text-slate-400 hover:text-slate-600")
      }
    >
      {mode === "grid" ? <LayoutGrid size={16} /> : <List size={16} />}
    </button>
  );
  return (
    <header
      className="sticky top-0 z-20 border-b border-slate-200 bg-white/70 backdrop-blur-xl"
      data-ui="topbar"
    >
      <div className="relative flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 md:hidden"
        >
          <Menu size={22} />
        </button>
        <button
          onClick={onNew}
          aria-label="New upload"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-r from-drift-500 to-blush-500 text-white shadow-md shadow-glow-500/25 md:hidden"
        >
          <Plus size={20} />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          {/* A short placeholder still fits beside the phone toolbar; the
              accessible name keeps the full description. */}
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search in Dropvault"
            title="Search (press /)"
            aria-keyshortcuts="/"
            className={
              "w-full rounded-full bg-slate-100 py-2.5 pl-11 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-drift-300 [&::-webkit-search-cancel-button]:hidden " +
              (search ? "pr-10" : "pr-4")
            }
            data-ui="search"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="hidden items-center rounded-full border border-slate-200 bg-white p-0.5 sm:flex">
          {viewButton("grid", "Grid view")}
          {viewButton("list", "List view")}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <LayoutToggle />
          <ThemeToggle />
        </div>
        <NotificationsBell onNavigate={onNotificationNavigate} />
        <div className="relative sm:hidden">
          <button
            onClick={() => setMobileActionsOpen((v) => !v)}
            aria-label="More actions"
            className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <MoreHorizontal size={20} />
          </button>
          {mobileActionsOpen && (
            <>
              <button
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close actions"
                onClick={() => setMobileActionsOpen(false)}
              />
              <div
                className="absolute right-0 top-11 z-50 max-h-[calc(100vh-5rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/60"
                data-ui="mobile-actions"
              >
                <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Quick actions
                </div>
                <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">
                    View
                  </span>
                  <div className="flex items-center rounded-full border border-slate-200 bg-white p-0.5">
                    {viewButton("grid", "Grid view")}
                    {viewButton("list", "List view")}
                  </div>
                </div>
                <div
                  className="mb-2 rounded-xl bg-slate-50 px-3 py-2.5"
                  data-ui="mobile-display-controls"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Workspace
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => chooseMobileLayout("calm")}
                      aria-pressed={layout === "calm"}
                      className={
                        "min-w-0 rounded-lg border px-2.5 py-2 text-left transition " +
                        (layout === "calm"
                          ? "border-drift-300 bg-white text-drift-700"
                          : "border-slate-200 bg-white text-slate-600")
                      }
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Sparkles size={14} /> Calm
                      </span>
                      <span className="mt-0.5 block whitespace-normal text-[11px] leading-4 text-slate-400">
                        Spacious home
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseMobileLayout("classic")}
                      aria-pressed={layout === "classic"}
                      className={
                        "min-w-0 rounded-lg border px-2.5 py-2 text-left transition " +
                        (layout === "classic"
                          ? "border-drift-300 bg-white text-drift-700"
                          : "border-slate-200 bg-white text-slate-600")
                      }
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <LayoutGrid size={14} /> Classic
                      </span>
                      <span className="mt-0.5 block whitespace-normal text-[11px] leading-4 text-slate-400">
                        Original layout
                      </span>
                    </button>
                  </div>
                  <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Theme
                    <select
                      value={
                        followsWorkspaceDefault ? "workspace" : theme
                      }
                      onChange={(event) =>
                        chooseMobileTheme(event.target.value)
                      }
                      aria-label="Mobile theme"
                      className="mt-1.5 block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-drift-400"
                    >
                      <option value="workspace">Workspace default</option>
                      {THEME_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1.5 whitespace-normal break-words text-[11px] leading-4 text-slate-400">
                    {followsWorkspaceDefault
                      ? `Workspace default: ${workspaceTheme?.label ?? "Default"}`
                      : `${currentTheme?.label ?? "Theme"}: ${currentTheme?.description ?? ""}`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setMobileActionsOpen(false);
                    onOpenTeams?.();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <Users size={17} className="text-slate-400" />
                  Teams & shared spaces
                </button>
                <button
                  onClick={() => {
                    setMobileActionsOpen(false);
                    onOpenSecurity?.();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <ShieldCheck size={17} className="text-slate-400" />
                  Account security
                </button>
                <button
                  onClick={() => {
                    setMobileActionsOpen(false);
                    onSignOut();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-500 transition hover:bg-red-50"
                >
                  <LogOut size={17} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={onOpenTeams}
          title="Teams"
          aria-label="Teams"
          className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:block"
        >
          <Users size={18} />
        </button>
        <button
          onClick={onOpenSecurity}
          title="Account security"
          aria-label="Account security"
          className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:block"
        >
          <ShieldCheck size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div
            title={userEmail}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-drift-500 to-blush-500 text-sm font-semibold text-white"
          >
            {initial}
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="hidden rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:block"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
