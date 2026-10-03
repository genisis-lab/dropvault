import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Folder,
  FolderOpen,
  Info,
  Link2,
  Lock,
  MoreVertical,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Folder as FolderT } from "../lib/api";
import { folderShareUrl } from "../lib/api";
import { copyTextFrom } from "../lib/clipboard";
import { focusFirstMenuItem, useEscapeToClose } from "../lib/useEscapeToClose";
import { useToast } from "./Toast";

export const DRAG_MIME = "application/x-dropvault";

const cardInitial = { opacity: 0, y: 12, scale: 0.97 };
const cardAnimate = { opacity: 1, y: 0, scale: 1 };
const cardExit = { opacity: 0, scale: 0.92 };
const menuInitial = { opacity: 0, scale: 0.95, y: -4 };
const menuAnimate = { opacity: 1, scale: 1, y: 0 };

type Props = {
  folder: FolderT;
  view: "grid" | "list";
  onOpen: (id: string) => void;
  onShare: (id: string) => Promise<string>;
  onRevoke: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenShare?: (id: string) => void;
  onOpenDetails?: (id: string) => void;
  onDropFiles?: (folderId: string, ids: string[]) => void;
};

export default function FolderCard({
  folder,
  view,
  onOpen,
  onShare,
  onRevoke,
  onRename,
  onDelete,
  onOpenShare,
  onOpenDetails,
  onDropFiles,
}: Props) {
  const { error } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const focusMenuOnOpenRef = useRef(false);
  useEscapeToClose(menuOpen, () => setMenuOpen(false), menuTriggerRef);
  useEffect(() => {
    if (!menuOpen || !focusMenuOnOpenRef.current) return;
    focusMenuOnOpenRef.current = false;
    focusFirstMenuItem(menuPanelRef.current);
  }, [menuOpen]);
  function toggleMenu(e: React.MouseEvent) {
    focusMenuOnOpenRef.current = !menuOpen && e.detail === 0;
    setMenuOpen((v) => !v);
  }

  async function copyLink() {
    setBusy(true);
    try {
      const { result } = await copyTextFrom(async () =>
        folder.shareToken
          ? folderShareUrl(folder.shareToken)
          : await onShare(folder.id),
      );
      if (result === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch (e) {
      error((e as Error)?.message || "Couldn't copy the link");
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!onDropFiles || !e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }

  function handleDrop(e: React.DragEvent) {
    setDropActive(false);
    if (!onDropFiles || !e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    try {
      const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME));
      if (Array.isArray(ids) && ids.length) onDropFiles(folder.id, ids);
    } catch {
      /* ignore */
    }
  }

  const itemCount = folder.itemCount ?? folder.fileCount;
  const meta = `${itemCount} item${itemCount === 1 ? "" : "s"}`;

  const menu = (
    <AnimatePresence>
      {menuOpen && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
          />
          <motion.div
            ref={menuPanelRef}
            role="menu"
            initial={menuInitial}
            animate={menuAnimate}
            exit={menuInitial}
            className="menu-surface absolute right-0 top-9 z-40 w-56"
          >
            <button
              role="menuitem"
              onClick={() => {
                onOpen(folder.id);
                setMenuOpen(false);
              }}
              className="menu-item"
            >
              <FolderOpen size={18} /> Open
            </button>
            {onOpenDetails && (
              <button
                role="menuitem"
                onClick={() => {
                  onOpenDetails(folder.id);
                  setMenuOpen(false);
                }}
                className="menu-item"
              >
                <Info size={18} /> Details
              </button>
            )}
            <div className="menu-divider" />
            <button
              role="menuitem"
              disabled={busy}
              onClick={copyLink}
              className="menu-item"
            >
              {copied ? (
                <Check size={18} className="!text-emerald-600" />
              ) : (
                <Link2 size={18} />
              )}
              {folder.shareToken ? "Copy link" : "Get link"}
            </button>
            {onOpenShare && (
              <button
                role="menuitem"
                onClick={() => {
                  onOpenShare(folder.id);
                  setMenuOpen(false);
                }}
                className="menu-item"
              >
                <SlidersHorizontal size={18} /> Share settings…
              </button>
            )}
            {folder.shareToken && (
              <button
                role="menuitem"
                onClick={() => {
                  onRevoke(folder.id);
                  setMenuOpen(false);
                }}
                className="menu-item"
              >
                <X size={18} /> Revoke link
              </button>
            )}
            <div className="menu-divider" />
            <button
              role="menuitem"
              onClick={() => {
                onRename(folder.id);
                setMenuOpen(false);
              }}
              className="menu-item"
            >
              <Pencil size={18} /> Rename
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onDelete(folder.id);
                setMenuOpen(false);
              }}
              className="menu-item"
            >
              <Trash2 size={18} /> Delete
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const actionsButton = (
    <div className="relative">
      <button
        ref={menuTriggerRef}
        onClick={toggleMenu}
        aria-label="Folder actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-[rgb(var(--c-strong)/0.08)] hover:text-strong"
      >
        <MoreVertical size={18} />
      </button>
      {menu}
    </div>
  );

  const folderIcon = (
    <Folder
      size={20}
      className="shrink-0 fill-current text-[#5f6368] dark:text-[#c4c7c5]"
      aria-hidden="true"
    />
  );

  if (view === "list") {
    return (
      <motion.div
        layout
        initial={cardInitial}
        animate={cardAnimate}
        exit={cardExit}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
        className={
          "group relative flex min-h-[3rem] items-center gap-3 border-b border-slate-200 px-2 py-1.5 transition-colors sm:px-3 " +
          (dropActive
            ? "bg-selected"
            : "hover:bg-[rgb(var(--c-strong)/0.04)]")
        }
        data-ui="folder-row"
      >
        <span className="hidden sm:block" />
        <button
          onClick={() => onOpen(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            {folderIcon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-strong">
              {folder.name}
            </span>
            <span className="block text-xs text-muted sm:hidden">
              {dropActive ? "Drop to move here" : meta}
            </span>
          </span>
        </button>
        <span className="hidden min-w-0 items-center gap-1.5 text-sm text-muted sm:flex">
          {folder.shareToken ? (
            <>
              <Users size={15} className="shrink-0" /> Shared
              {folder.shareHasPassword && (
                <Lock size={13} aria-label="Password protected" />
              )}
            </>
          ) : (
            <span className="text-faint">Only you</span>
          )}
        </span>
        <span className="hidden text-sm text-faint sm:block">—</span>
        <span className="hidden text-sm text-muted sm:block">
          {dropActive ? "Drop here" : meta}
        </span>
        <div className="flex justify-end">{actionsButton}</div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
      className={
        "group relative flex h-12 items-center gap-1 rounded-xl pl-1 pr-1 transition-colors " +
        (dropActive
          ? "bg-selected ring-2 ring-primary"
          : "bg-slate-100 hover:bg-[rgb(var(--c-strong)/0.1)]")
      }
      data-ui="folder-tile"
    >
      <button
        onClick={() => onOpen(folder.id)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl pl-3 text-left"
        title={dropActive ? "Drop to move here" : `${folder.name} · ${meta}`}
      >
        {folderIcon}
        <span className="min-w-0 truncate text-sm font-medium text-strong">
          {dropActive ? "Drop to move here" : folder.name}
        </span>
        {folder.shareToken && !dropActive && (
          <Users
            size={14}
            aria-label="Shared"
            className="shrink-0 text-muted"
          />
        )}
      </button>
      {actionsButton}
    </motion.div>
  );
}
