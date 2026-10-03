import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FolderInput,
  FolderMinus,
  History,
  Infinity as InfinityIcon,
  Link2,
  Lock,
  MoreVertical,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type { DriftFile } from "../lib/api";
import { downloadUrl, shareUrlForFile, thumbUrl } from "../lib/api";
import {
  downloadDecryptedFile,
  isEndToEndEncrypted,
} from "../lib/encryption";
import { copyTextFrom } from "../lib/clipboard";
import { formatBytes, timeLeft } from "../lib/format";
import { focusFirstMenuItem, useEscapeToClose } from "../lib/useEscapeToClose";
import { useToast } from "./Toast";
import { fileKind } from "../lib/fileKind";

export const DRAG_MIME = "application/x-dropvault";
type FolderOption = { id: string; name: string };
type MenuPos = { top?: number; bottom?: number; left: number };
export type FileSelectOptions = { shiftKey?: boolean };
type Props = {
  file: DriftFile;
  view: "grid" | "list";
  folders?: FolderOption[];
  onExtend: (id: string, days: number) => void;
  onDelete: (id: string) => void;
  onShare: (id: string) => Promise<string>;
  onRevoke: (id: string) => void;
  onMove?: (id: string, folderId: string | null) => void;
  onRename?: (id: string) => void;
  onOpenShare?: (id: string) => void;
  onPreview?: (file: DriftFile) => void;
  onOpenDetails?: (file: DriftFile) => void;
  onOpenVersions?: (file: DriftFile) => void;
  onToggleFavorite?: (id: string) => void;
  onEditTags?: (id: string) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
  canKeepForever?: boolean;
  trashRetentionDays?: number;
  onKeepForever?: (id: string) => void;
  onUnkeepForever?: (id: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string, options?: FileSelectOptions) => void;
  anySelected?: boolean;
  getDragIds?: (id: string) => string[];
};
const cardInitial = { opacity: 0, y: 12, scale: 0.97 };
const cardAnimate = { opacity: 1, y: 0, scale: 1 };
// Rows leave quickly so filtering and search results settle at once.
const cardExit = { opacity: 0, scale: 0.92, transition: { duration: 0.1 } };
const menuInitial = { opacity: 0, y: 8 };
const menuAnimate = { opacity: 1, y: 0 };
const menuTransition = { duration: 0.18, ease: "easeOut" };
const overlayInitial = { opacity: 0 };
const overlayAnimate = { opacity: 1 };
const MENU_W = 240;
const MENU_ITEM_DANGER = "menu-item !text-red-700 [&>svg]:!text-red-700";

export default function FileCard({
  file,
  view,
  folders = [],
  onExtend,
  onDelete,
  onShare,
  onRevoke,
  onMove,
  onRename,
  onOpenShare,
  onPreview,
  onOpenDetails,
  onOpenVersions,
  onToggleFavorite,
  onEditTags,
  onRestore,
  onPermanentDelete,
  canKeepForever = false,
  trashRetentionDays,
  onKeepForever,
  onUnkeepForever,
  selected = false,
  onToggleSelect,
  anySelected = false,
  getDragIds,
}: Props) {
  const { error } = useToast();
  const { Icon, tint: tone } = fileKind(file.contentType);
  const encrypted = isEndToEndEncrypted(file);
  const isImage =
    !encrypted && (file.contentType || "").startsWith("image/");
  const canPreview =
    !encrypted && (isImage || (file.contentType || "").includes("pdf"));
  // Trashed files count down to their permanent deletion instead of expiry.
  const purgeAt =
    file.deletedAt && trashRetentionDays
      ? file.deletedAt + trashRetentionDays * 86400
      : null;
  const countdownTo = purgeAt ?? file.expiresAt;
  const [left, setLeft] = useState(() => timeLeft(countdownTo));
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const openedAtRef = useRef(0);
  const justTouchedRef = useRef(false);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const focusMenuOnOpenRef = useRef(false);
  useEffect(() => {
    setLeft(timeLeft(countdownTo));
    const t = setInterval(() => setLeft(timeLeft(countdownTo)), 30000);
    return () => clearInterval(t);
  }, [countdownTo]);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  const showThumb = isImage && !file.deletedAt && !thumbFailed;
  function closeMenu() {
    setMenuOpen(false);
    setMoveOpen(false);
    setPos(null);
  }
  useEscapeToClose(menuOpen, closeMenu, menuTriggerRef);
  useEffect(() => {
    if (!menuOpen || !focusMenuOnOpenRef.current) return;
    focusMenuOnOpenRef.current = false;
    focusFirstMenuItem(menuPanelRef.current);
  }, [menuOpen]);
  function openMenuAt(btn: HTMLElement | null) {
    openedAtRef.current = Date.now();
    menuTriggerRef.current = btn;
    setMoveOpen(false);
    const desktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 640px)").matches;
    if (desktop && btn) {
      const r = btn.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8),
      );
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow > 320) setPos({ top: r.bottom + 6, left });
      else setPos({ bottom: window.innerHeight - r.top + 6, left });
    } else setPos(null);
    setMenuOpen(true);
  }
  function openMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (justTouchedRef.current) return;
    focusMenuOnOpenRef.current = e.detail === 0;
    openMenuAt(e.currentTarget);
  }
  function openMenuTouch(e: React.TouchEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.preventDefault();
    justTouchedRef.current = true;
    window.setTimeout(() => {
      justTouchedRef.current = false;
    }, 600);
    openMenuAt(e.currentTarget);
  }
  function dismissMenu(e: React.MouseEvent<HTMLElement>) {
    e.stopPropagation();
    if (Date.now() - openedAtRef.current < 250) return;
    closeMenu();
  }
  function handleDragStart(e: React.DragEvent) {
    const ids = getDragIds ? getDragIds(file.id) : [file.id];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  }
  const nativeDragStart = handleDragStart as unknown as React.ComponentProps<
    typeof motion.div
  >["onDragStart"];
  function handleContextMenu(e: React.MouseEvent) {
    if (!onToggleSelect) return;
    if (
      e.target instanceof Element &&
      e.target.closest("[data-file-actions], [data-file-select-toggle]")
    )
      return;
    e.preventDefault();
    onToggleSelect(file.id);
  }
  function preview(e?: React.MouseEvent<HTMLElement>) {
    if (e?.shiftKey && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(file.id, { shiftKey: true });
      return;
    }
    if (file.deletedAt) return;
    if (onOpenDetails) {
      onOpenDetails(file);
      return;
    }
    if (canPreview && onPreview) onPreview(file);
  }
  async function copyLink() {
    setBusy(true);
    try {
      const { result } = await copyTextFrom(async () =>
        ((file.shareToken ? await shareUrlForFile(file) : null) ??
          (await onShare(file.id))),
      );
      if (result === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch (e) {
      error((e as Error)?.message || "Couldn't copy the link");
    } finally {
      setBusy(false);
      closeMenu();
    }
  }
  const canMove = !!onMove && !file.deletedAt;
  const moveTargets = folders.filter((f) => f.id !== file.folderId);
  const showCheckbox = !!onToggleSelect && (anySelected || selected);
  const canDrag = !file.deletedAt && !coarsePointer;
  const clickable = canPreview || !!onOpenDetails;
  const chipShape =
    "items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium drive-shadow ";
  const chipTone = file.deletedAt
    ? left.urgent
      ? "bg-white text-red-700"
      : "bg-white text-muted"
    : file.keepForever
      ? "bg-white text-drift-700"
      : left.urgent
        ? "bg-white text-red-700"
        : "bg-white text-muted";
  const chipClass = "inline-flex " + chipShape + chipTone;
  // Phone list rows show expiry inline under the name instead of as a badge,
  // which leaves room for the filename itself.
  const inlineExpiryTone =
    !file.keepForever && left.urgent
      ? "text-red-700"
      : file.keepForever
        ? "text-drift-700"
        : "";
  // Trash's "Time left" column header and policy note supply the context.
  const chipLabel = file.deletedAt
    ? purgeAt
      ? left.label.replace(/ left$/, "")
      : "Trash"
    : file.keepForever
      ? "Forever"
      : left.label;
  const chipIcon = file.deletedAt ? (
    <Trash2 size={11} />
  ) : file.keepForever ? (
    <InfinityIcon size={11} />
  ) : (
    <Clock size={11} />
  );
  const chipTitle = purgeAt
    ? `Permanently deleted ${new Date(purgeAt * 1000).toLocaleString()}`
    : undefined;
  const dlText =
    file.shareToken && file.shareDownloadLimit
      ? `${file.shareDownloadCount ?? 0}/${file.shareDownloadLimit}`
      : null;
  const sharedPill = file.shareToken ? (
    <span
      className="hidden min-w-0 items-center gap-1.5 text-sm text-muted sm:inline-flex"
      data-ui="shared-label"
    >
      <Users size={15} className="shrink-0" /> Shared
      {file.shareHasPassword && (
        <Lock size={13} aria-label="Password protected" className="shrink-0" />
      )}
      {file.shareExpiresAt && (
        <CalendarClock size={13} aria-label="Link expires" className="shrink-0" />
      )}
      {dlText && <span className="text-xs text-faint">{dlText}</span>}
    </span>
  ) : null;
  const encryptedPill =
    file.encryptionMode === "aes-gcm" ? (
      <span
        className="hidden shrink-0 items-center gap-1 text-sm text-muted sm:inline-flex"
        data-ui="encrypted-label"
        title="Encrypted in the browser"
      >
        <Lock size={14} /> Encrypted
      </span>
    ) : null;
  const checkbox = onToggleSelect ? (
    <button
      type="button"
      data-file-select-toggle
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect(file.id, { shiftKey: e.shiftKey });
      }}
      aria-label={selected ? "Deselect" : "Select"}
      className={
        "file-select-toggle grid h-[18px] w-[18px] place-items-center rounded-sm border-2 transition " +
        (selected
          ? "file-select-toggle-active border-primary bg-primary text-on-primary"
          : "border-outline bg-sheet text-transparent " +
            (showCheckbox ? "file-select-toggle-active" : ""))
      }
    >
      <Check size={13} strokeWidth={3} />
    </button>
  ) : null;
  const panelClass = pos
    ? "menu-surface z-10 w-60 max-h-[70vh] overflow-y-auto"
    : "menu-surface relative z-10 max-h-[75vh] w-full overflow-y-auto !rounded-b-none !rounded-t-[28px] pb-6 pt-3";
  const panelStyle = pos
    ? {
        position: "fixed" as const,
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
      }
    : undefined;
  const menu = createPortal(
    <AnimatePresence>
      {menuOpen && (
        <motion.div
          key="file-actions"
          onClick={dismissMenu}
          initial={overlayInitial}
          animate={overlayAnimate}
          exit={overlayInitial}
          transition={menuTransition}
          className={
            pos
              ? "fixed inset-0 z-[60]"
              : "fixed inset-0 z-[60] flex items-end justify-center bg-black/40"
          }
        >
          <motion.div
            ref={menuPanelRef}
            onClick={(e) => e.stopPropagation()}
            initial={menuInitial}
            animate={menuAnimate}
            exit={menuInitial}
            transition={menuTransition}
            style={panelStyle}
            className={panelClass}
          >
            {!pos && (
              <div className="mb-1 flex items-center gap-3 border-b border-slate-200 px-4 pb-3">
                <Icon size={20} className={"shrink-0 " + tone} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-strong">
                  {file.filename}
                </p>
              </div>
            )}
            {!moveOpen ? (
              <>
                {file.deletedAt ? (
                  <>
                    <button
                      onClick={() => {
                        onRestore?.(file.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <RotateCcw size={18} /> Restore
                    </button>
                    <button
                      onClick={() => {
                        onPermanentDelete?.(file.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <Trash2 size={18} /> Delete forever
                    </button>
                  </>
                ) : (
                  <>
                    {canPreview && onPreview && (
                      <button
                        onClick={() => {
                          onPreview(file);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <Eye size={18} /> Preview
                      </button>
                    )}
                    {file.encryptionMode === "aes-gcm" ? (
                      <button
                        onClick={() => {
                          closeMenu();
                          downloadDecryptedFile(
                            file,
                            downloadUrl(file.id),
                          ).catch((err) =>
                            error(
                              (err as Error).message ||
                                "Couldn't decrypt this file",
                            ),
                          );
                        }}
                        className="menu-item"
                      >
                        <Download size={18} /> Decrypt &amp; download
                      </button>
                    ) : (
                      <a
                        href={downloadUrl(file.id)}
                        onClick={closeMenu}
                        className="menu-item"
                      >
                        <Download size={18} /> Download
                      </a>
                    )}
                    {onRename && (
                      <button
                        onClick={() => {
                          onRename(file.id);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <Pencil size={18} /> Rename
                      </button>
                    )}
                    {onOpenVersions && (
                      <button
                        onClick={() => {
                          onOpenVersions(file);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <History size={18} /> Version history
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onToggleFavorite?.(file.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <Star
                        size={15}
                        className={
                          file.favorite ? "fill-amber-400 text-amber-400" : ""
                        }
                      />{" "}
                      {file.favorite ? "Unfavorite" : "Favorite"}
                    </button>
                    <button
                      onClick={() => {
                        onEditTags?.(file.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <Tags size={18} /> Edit tags
                    </button>
                    <button
                      disabled={busy}
                      onClick={copyLink}
                      className="menu-item"
                    >
                      {copied ? (
                        <Check size={18} className="text-emerald-500" />
                      ) : (
                        <Link2 size={18} />
                      )}
                      {file.shareToken ? "Copy link" : "Get link"}
                    </button>
                    {onOpenShare && (
                      <button
                        onClick={() => {
                          onOpenShare(file.id);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <SlidersHorizontal size={18} /> Share settings…
                      </button>
                    )}
                    {file.shareToken && (
                      <button
                        onClick={() => {
                          onRevoke(file.id);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <X size={18} /> Revoke link
                      </button>
                    )}
                    {canMove && (
                      <button
                        onClick={() => setMoveOpen(true)}
                        className="menu-item"
                      >
                        <FolderInput size={18} /> Move to
                        <ChevronRight
                          size={14}
                          className="ml-auto text-slate-400"
                        />
                      </button>
                    )}
                    {!file.keepForever && (
                      <button
                        onClick={() => {
                          onExtend(file.id, 7);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <Clock size={18} /> Extend 7 days
                      </button>
                    )}
                    {canKeepForever && !file.keepForever && onKeepForever && (
                      <button
                        onClick={() => {
                          onKeepForever(file.id);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <InfinityIcon size={18} /> Keep forever
                      </button>
                    )}
                    {file.keepForever && onUnkeepForever && (
                      <button
                        onClick={() => {
                          onUnkeepForever(file.id);
                          closeMenu();
                        }}
                        className="menu-item"
                      >
                        <Clock size={18} /> Stop keeping forever
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onDelete(file.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <Trash2 size={18} /> Move to Trash
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => setMoveOpen(false)}
                  className="menu-item font-medium"
                >
                  <ChevronLeft size={18} /> Move to…
                </button>
                <div className="menu-divider" />
                <div className="max-h-52 overflow-y-auto">
                  {file.folderId && onMove && (
                    <button
                      onClick={() => {
                        onMove(file.id, null);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <FolderMinus size={18} /> Remove from folder
                    </button>
                  )}
                  {moveTargets.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onMove?.(file.id, f.id);
                        closeMenu();
                      }}
                      className="menu-item"
                    >
                      <FolderInput size={18} className="shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                  {moveTargets.length === 0 && !file.folderId && (
                    <p className="px-4 py-2 text-xs text-muted">
                      No other folders yet.
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
  const tagLine =
    (file.tags ?? []).length > 0 ? (
      <p className="truncate text-xs text-faint">
        #{(file.tags ?? []).join(" #")}
      </p>
    ) : null;
  const quickButton =
    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-[rgb(var(--c-strong)/0.08)] hover:text-strong";
  const quickActions =
    !file.deletedAt ? (
      <div className="row-quick-actions items-center" data-file-actions>
        {onOpenShare && (
          <button
            type="button"
            onClick={() => onOpenShare(file.id)}
            title="Share"
            aria-label={`Share ${file.filename}`}
            className={quickButton}
          >
            <Link2 size={17} />
          </button>
        )}
        {file.encryptionMode === "aes-gcm" ? (
          <button
            type="button"
            onClick={() =>
              downloadDecryptedFile(file, downloadUrl(file.id)).catch((err) =>
                error((err as Error).message || "Couldn't decrypt this file"),
              )
            }
            title="Decrypt and download"
            aria-label={`Download ${file.filename}`}
            className={quickButton}
          >
            <Download size={17} />
          </button>
        ) : (
          <a
            href={downloadUrl(file.id)}
            title="Download"
            aria-label={`Download ${file.filename}`}
            className={quickButton}
          >
            <Download size={17} />
          </a>
        )}
        {onRename && (
          <button
            type="button"
            onClick={() => onRename(file.id)}
            title="Rename"
            aria-label={`Rename ${file.filename}`}
            className={quickButton}
          >
            <Pencil size={17} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleFavorite?.(file.id)}
          title={file.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={
            file.favorite
              ? `Remove ${file.filename} from favorites`
              : `Add ${file.filename} to favorites`
          }
          className={quickButton}
        >
          <Star
            size={17}
            className={file.favorite ? "fill-current text-[#f9ab00]" : ""}
          />
        </button>
      </div>
    ) : null;
  const moreButton = (size: number) => (
    <button
      type="button"
      onClick={openMenu}
      onTouchEnd={openMenuTouch}
      aria-label="File actions"
      aria-expanded={menuOpen}
      className={
        "grid shrink-0 touch-manipulation place-items-center rounded-full text-muted hover:bg-[rgb(var(--c-strong)/0.08)] hover:text-strong " +
        (size === 8 ? "h-8 w-8" : "h-7 w-7")
      }
    >
      <MoreVertical size={18} />
    </button>
  );
  const expiryText = (
    <span
      className={
        "inline-flex items-center gap-1.5 text-sm " +
        (!file.keepForever && left.urgent ? "text-red-700" : "text-muted")
      }
      title={chipTitle}
      data-ui="file-expiry"
    >
      {chipIcon} {chipLabel}
    </span>
  );
  // The filename is where people click first, so it opens the file just like
  // the icon does. Trashed files have nothing to open.
  const openable = clickable && !file.deletedAt;
  function fileName(className: string) {
    return openable ? (
      <button
        type="button"
        onClick={(e) => preview(e)}
        title={file.filename}
        data-file-open
        className={"min-w-0 text-left hover:underline " + className}
      >
        {file.filename}
      </button>
    ) : (
      <span className={className} title={file.filename}>
        {file.filename}
      </span>
    );
  }
  if (view === "list")
    return (
      <motion.div
        layout
        draggable={canDrag}
        onDragStart={nativeDragStart}
        onContextMenu={handleContextMenu}
        initial={cardInitial}
        animate={cardAnimate}
        exit={cardExit}
        aria-selected={selected}
        className={
          "group relative flex min-h-[3rem] items-center gap-3 border-b border-slate-200 px-2 py-1.5 transition-colors sm:px-3 " +
          (selected
            ? "bg-selected text-on-selected"
            : "hover:bg-[rgb(var(--c-strong)/0.04)]")
        }
        data-file-id={file.id}
        data-ui="file-row"
      >
        {onToggleSelect ? (
          <div
            className={
              "w-6 justify-center " + (showCheckbox ? "flex" : "hidden")
            }
            data-ui="row-select"
          >
            {checkbox}
          </div>
        ) : (
          <span data-ui="row-lead" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3" data-ui="file-name">
          <button
            type="button"
            onClick={(e) => preview(e)}
            aria-label={`Open details for ${file.filename}`}
            // The filename button does the same thing; one tab stop is enough.
            tabIndex={openable ? -1 : undefined}
            className={
              "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded " +
              tone +
              (canPreview
                ? " cursor-zoom-in"
                : clickable
                  ? " cursor-pointer"
                  : "")
            }
            data-ui="file-icon"
          >
            {showThumb ? (
              <img
                src={thumbUrl(file.id)}
                alt=""
                className="h-8 w-8 rounded object-cover"
                loading="lazy"
                decoding="async"
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <Icon size={20} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-strong">
              {fileName("truncate font-medium")}
              {file.favorite && (
                <Star
                  size={13}
                  aria-label="Favorite"
                  className="shrink-0 fill-current text-[#f9ab00]"
                />
              )}
              {file.encryptionMode === "aes-gcm" && (
                <Lock
                  size={13}
                  aria-label="Encrypted"
                  className="shrink-0 text-muted"
                  data-ui="file-inline-badge"
                />
              )}
              {file.shareToken && (
                <Users
                  size={13}
                  aria-label="Shared"
                  className="shrink-0 text-muted"
                  data-ui="file-inline-badge"
                />
              )}
            </p>
            {tagLine}
            {/* Narrow lists (phones, and tablets beside the sidebar) show
                size and expiry here instead of in columns; index.css
                switches between the two by the list's own width. */}
            <p
              className="flex items-center gap-1 text-xs text-muted"
              data-ui="file-inline-meta"
            >
              {formatBytes(file.sizeBytes)}
              <span aria-hidden="true">·</span>
              <span
                className={"inline-flex items-center gap-0.5 " + inlineExpiryTone}
                title={chipTitle}
              >
                {chipIcon} {chipLabel}
              </span>
            </p>
          </div>
        </div>
        <div className="items-center gap-1.5" data-ui="file-security">
          {encryptedPill}
          {sharedPill}
          {!encryptedPill && !sharedPill && (
            <span className="text-sm text-faint">Only you</span>
          )}
        </div>
        <span data-ui="file-expiry-col">{expiryText}</span>
        <span className="text-sm text-muted" data-ui="file-size">
          {formatBytes(file.sizeBytes)}
        </span>
        <div
          className="relative flex items-center justify-end"
          data-file-actions
          data-ui="file-actions"
        >
          {quickActions}
          {moreButton(8)}
          {menu}
        </div>
      </motion.div>
    );
  return (
    <motion.div
      layout
      draggable={canDrag}
      onDragStart={nativeDragStart}
      onContextMenu={handleContextMenu}
      initial={cardInitial}
      animate={cardAnimate}
      exit={cardExit}
      aria-selected={selected}
      className={
        "group relative flex flex-col rounded-xl px-1 pb-1 transition-colors " +
        (selected
          ? "bg-selected text-on-selected"
          : "bg-slate-100 hover:bg-[rgb(var(--c-strong)/0.1)]")
      }
      data-file-id={file.id}
      data-ui="file-card"
    >
      <div className="flex h-12 items-center gap-2 pl-3 pr-0.5">
        <Icon size={18} className={"shrink-0 " + tone} />
        {fileName("min-w-0 flex-1 truncate text-sm font-medium text-strong")}
        <div className="relative" data-file-actions>
          {moreButton(7)}
          {menu}
        </div>
      </div>
      <div
        onClick={(e) => preview(e)}
        className={
          "relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-white " +
          (canPreview ? " cursor-zoom-in" : clickable ? " cursor-pointer" : "")
        }
        data-file-preview
      >
        {showThumb ? (
          <img
            src={thumbUrl(file.id)}
            alt={file.filename}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <Icon size={56} strokeWidth={1.4} className={tone} />
        )}
        {onToggleSelect && (
          <div className="absolute left-2 top-2">{checkbox}</div>
        )}
        <span
          className={"absolute bottom-2 right-2 " + chipClass}
          title={chipTitle}
        >
          {chipIcon} {chipLabel}
        </span>
      </div>
      <div className="flex min-h-[2rem] items-center gap-1.5 px-2 pt-1 text-xs text-muted">
        {file.favorite && (
          <Star
            size={12}
            aria-label="Favorite"
            className="shrink-0 fill-current text-[#f9ab00]"
          />
        )}
        {file.shareToken && (
          <Users size={12} aria-label="Shared" className="shrink-0" />
        )}
        {file.shareToken && file.shareHasPassword && (
          <Lock size={11} aria-label="Password protected" className="shrink-0" />
        )}
        {file.encryptionMode === "aes-gcm" && (
          <span
            title="Client-side encrypted"
            aria-label="Client-side encrypted"
            className="inline-flex shrink-0 items-center gap-0.5"
          >
            <Lock size={11} />
          </span>
        )}
        <span className="min-w-0 truncate">
          {formatBytes(file.sizeBytes)}
          {dlText ? ` · ${dlText} downloads` : ""}
          {(file.tags ?? []).length > 0
            ? " · #" + (file.tags ?? []).join(" #")
            : ""}
        </span>
      </div>
    </motion.div>
  );
}
