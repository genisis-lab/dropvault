import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Clock,
  Cloud,
  FileUp,
  FolderPlus,
  FolderUp,
  HardDrive,
  LogOut,
  Plus,
  Settings2,
  Shield,
  Star,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Logo from "./Logo";
import { formatBytes } from "../lib/format";
import { listLimitRequests } from "../lib/api";
import { focusFirstMenuItem, useEscapeToClose } from "../lib/useEscapeToClose";

export type Filter = "all" | "shared" | "expiring" | "favorites" | "trash";

const NAV: { id: Filter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "My Drive", icon: HardDrive },
  { id: "shared", label: "Shared", icon: Users },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "expiring", label: "Expiring soon", icon: Clock },
  { id: "trash", label: "Trash", icon: Trash2 },
];

const barInitial = { width: 0 };
const overlayInitial = { opacity: 0 };
const overlayAnimate = { opacity: 1 };
const drawerInitial = { x: "-100%" };
const drawerAnimate = { x: 0 };
const drawerTransition = { type: "tween", duration: 0.22 } as const;
const menuInitial = { opacity: 0, scale: 0.96, y: -4 };
const menuAnimate = { opacity: 1, scale: 1, y: 0 };

// Everything the "New" menu can start. The dashboard owns the actions so the
// keyboard shortcut, empty states and this menu share one implementation.
export type NewActions = {
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onTakePhoto: () => void;
  onUploadSettings: () => void;
};

type SidebarProps = NewActions & {
  totalBytes: number;
  fileCount: number;
  sharedCount: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  onRequestMore?: () => void;
  quotaBytes?: number | null;
};

export default function Sidebar(props: SidebarProps) {
  const { mobileOpen = false, onCloseMobile, isAdmin } = props;
  const limitRequestsQuery = useQuery({
    queryKey: ["limit-requests"],
    queryFn: listLimitRequests,
    enabled: !!isAdmin,
    refetchInterval: 60000,
  });
  const pendingLimitRequests = (limitRequestsQuery.data ?? []).filter(
    (r) => r.status === "pending",
  ).length;
  return (
    <>
      <aside
        className="fixed bottom-0 left-0 top-16 z-20 hidden w-64 flex-col overflow-y-auto bg-app pb-4 pl-3 pr-4 md:flex"
        data-ui="sidebar"
        aria-label="Drive navigation"
      >
        <SidebarContent
          {...props}
          pendingLimitRequests={pendingLimitRequests}
        />
      </aside>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.button
              initial={overlayInitial}
              animate={overlayAnimate}
              exit={overlayInitial}
              aria-label="Close menu"
              onClick={onCloseMobile}
              className="absolute inset-0 bg-black/40"
            />
            <motion.aside
              initial={drawerInitial}
              animate={drawerAnimate}
              exit={drawerInitial}
              transition={drawerTransition}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto rounded-r-2xl bg-app pb-4 pl-3 pr-4 pt-3"
              data-ui="sidebar"
              aria-label="Drive navigation"
            >
              <SidebarContent
                {...props}
                pendingLimitRequests={pendingLimitRequests}
                onClose={onCloseMobile}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

export function NewMenu({
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onTakePhoto,
  onUploadSettings,
  onDone,
  variant = "sidebar",
}: NewActions & { onDone?: () => void; variant?: "sidebar" | "fab" }) {
  const fab = variant === "fab";
  const [open, setOpen] = useState(false);
  // The sidebar scrolls, which would clip an absolutely positioned menu, so
  // the menu is placed with fixed coordinates taken from its trigger.
  const [anchor, setAnchor] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef(false);
  useEscapeToClose(open, () => setOpen(false), triggerRef);
  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    focusFirstMenuItem(panelRef.current);
  }, [open]);
  const run = (fn: () => void) => () => {
    setOpen(false);
    onDone?.();
    fn();
  };
  return (
    <div
      className={
        fab
          ? "fixed bottom-6 right-4 z-30 md:hidden"
          : "relative"
      }
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          focusOnOpenRef.current = !open && e.detail === 0;
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(
            fab
              ? {
                  bottom: window.innerHeight - rect.top + 8,
                  right: window.innerWidth - rect.right,
                }
              : { top: rect.top, left: rect.left },
          );
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={fab ? "New" : undefined}
        className={
          fab
            ? "grid h-14 w-14 place-items-center rounded-2xl bg-selected text-on-selected drive-shadow-lg"
            : "flex h-14 items-center gap-3 rounded-2xl bg-fab pl-4 pr-6 text-sm font-medium text-strong drive-shadow transition hover:bg-[rgb(var(--c-fab-hover))] hover:shadow-lg"
        }
        data-ui={fab ? "new-fab" : "new-upload"}
        title="New (press U to upload files)"
      >
        <Plus size={24} strokeWidth={2} />
        {!fab && "New"}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Close new menu"
              tabIndex={-1}
              onClick={() => setOpen(false)}
            />
            <motion.div
              ref={panelRef}
              role="menu"
              aria-label="New"
              initial={menuInitial}
              animate={menuAnimate}
              exit={menuInitial}
              style={anchor}
              className="menu-surface fixed z-40 w-72 max-w-[calc(100vw-2rem)]"
              data-ui="new-menu"
            >
              <button role="menuitem" className="menu-item" onClick={run(onNewFolder)}>
                <FolderPlus size={20} /> New folder
              </button>
              <div className="menu-divider" />
              <button
                role="menuitem"
                className="menu-item"
                onClick={run(onUploadFiles)}
                aria-keyshortcuts="u"
              >
                <FileUp size={20} /> File upload
                <span className="ml-auto text-xs text-faint">U</span>
              </button>
              <button role="menuitem" className="menu-item" onClick={run(onUploadFolder)}>
                <FolderUp size={20} /> Folder upload
              </button>
              <button
                role="menuitem"
                className="menu-item sm:hidden"
                onClick={run(onTakePhoto)}
              >
                <Camera size={20} /> Take a photo or video
              </button>
              <div className="menu-divider" />
              <button role="menuitem" className="menu-item" onClick={run(onUploadSettings)}>
                <Settings2 size={20} /> Upload settings…
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarContent({
  totalBytes,
  fileCount,
  sharedCount,
  filter,
  setFilter,
  isAdmin,
  onOpenAdmin,
  onSignOut,
  onClose,
  onRequestMore,
  quotaBytes,
  pendingLimitRequests = 0,
  ...newActions
}: SidebarProps & { onClose?: () => void; pendingLimitRequests?: number }) {
  const pct =
    quotaBytes != null && quotaBytes > 0
      ? Math.min((totalBytes / quotaBytes) * 100, 100)
      : 0;
  const barAnimate = { width: `${pct}%` };
  const nearLimit = quotaBytes != null && pct >= 90;
  const warnLimit = quotaBytes != null && pct >= 75 && pct < 90;
  const barColor = nearLimit
    ? "bg-red-600"
    : warnLimit
      ? "bg-amber-500"
      : "bg-primary";
  const run = (fn?: () => void) => () => {
    fn?.();
    onClose?.();
  };
  return (
    <>
      {onClose && (
        <div className="mb-3 flex items-center justify-between pl-2">
          <button
            type="button"
            onClick={run(() => setFilter("all"))}
            aria-label="Go to My Drive"
            className="rounded-full"
            data-ui="home-link"
          >
            <Logo />
          </button>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="icon-round"
          >
            <X size={20} />
          </button>
        </div>
      )}
      <div className="pb-4 pl-1 pt-2">
        <NewMenu {...newActions} onDone={onClose} />
      </div>
      <nav className="space-y-0.5" aria-label="Locations">
        {NAV.map((item) => {
          const active = filter === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={run(() => setFilter(item.id))}
              aria-current={active ? "page" : undefined}
              className="nav-pill"
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
              <span className="truncate">{item.label}</span>
              {item.id === "shared" && sharedCount > 0 && (
                <span className="ml-auto text-xs">{sharedCount}</span>
              )}
            </button>
          );
        })}
        {isAdmin && (
          <>
            <div className="my-2 h-px bg-line" />
            <button onClick={run(onOpenAdmin)} className="nav-pill">
              <Shield size={18} strokeWidth={1.8} />
              <span>Admin console</span>
              {pendingLimitRequests > 0 && (
                <span
                  title={`${pendingLimitRequests} pending limit request${pendingLimitRequests === 1 ? "" : "s"}`}
                  className="ml-auto flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                >
                  {pendingLimitRequests}
                </span>
              )}
            </button>
          </>
        )}
      </nav>
      <div className="mt-4 pl-4 pr-1" data-ui="storage-card">
        <div className="flex items-center gap-3 text-sm text-strong">
          <Cloud size={18} strokeWidth={1.8} />
          <span>Storage</span>
          {quotaBytes != null && (
            <span
              className={
                "ml-auto text-xs " +
                (nearLimit
                  ? "font-semibold text-red-600"
                  : warnLimit
                    ? "font-semibold text-amber-700"
                    : "text-muted")
              }
            >
              {Math.round(pct)}%
            </span>
          )}
        </div>
        <div className="ml-[30px] mt-2">
          {quotaBytes != null && (
            <div className="h-1 overflow-hidden rounded-full bg-slate-200">
              <motion.div
                className={"h-full rounded-full transition-colors " + barColor}
                initial={barInitial}
                animate={barAnimate}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {quotaBytes != null
              ? `${formatBytes(totalBytes)} of ${formatBytes(quotaBytes)} used`
              : `${formatBytes(totalBytes)} used`}
          </p>
          <p className="text-xs text-faint">
            {fileCount} file{fileCount === 1 ? "" : "s"}
            {quotaBytes == null ? " · Unlimited storage" : ""}
          </p>
          {nearLimit ? (
            <p className="mt-1 text-xs font-medium text-red-600">
              You're almost out of space.
            </p>
          ) : warnLimit ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Storage is filling up.
            </p>
          ) : null}
          {quotaBytes != null && (
            <button
              onClick={run(onRequestMore)}
              className="btn-outlined mt-3 !min-h-9 !px-4"
            >
              Request larger limit
            </button>
          )}
        </div>
      </div>
      {onClose && onSignOut && (
        <div className="mt-auto pt-4">
          <button onClick={run(onSignOut)} className="nav-pill">
            <LogOut size={18} strokeWidth={1.8} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </>
  );
}
