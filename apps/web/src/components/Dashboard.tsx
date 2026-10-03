import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUp,
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  Cloud,
  Download,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  HardDrive,
  Infinity as InfinityIcon,
  LayoutGrid,
  Lightbulb,
  List,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Tags,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import {
  listFiles,
  listFolders,
  extendFile,
  keepFileForever,
  unkeepFileForever,
  bulkKeepForever,
  bulkFiles,
  renameFile,
  deleteFile,
  restoreFile,
  permanentDeleteFile,
  updateFileMeta,
  createShare,
  revokeShare,
  moveFile,
  createFolder,
  renameFolder,
  updateFolder,
  deleteFolder,
  shareFolder,
  revokeFolderShare,
  downloadUrl,
  adminAccess,
  createLimitRequest,
  listMyLimitRequests,
  type BulkFileAction,
  type DriftFile,
  type Folder,
} from "../lib/api";
import { signOut } from "../lib/auth-client";
import { accountStatus } from "../lib/account";
import { formatBytes } from "../lib/format";
import {
  ADMIN_HASH_PREFIX,
  isAdminHash,
  urlWithoutHash,
} from "../lib/adminRoute";
import { useLayout } from "../lib/layout";
import { folderPath } from "../lib/folderPath";
import { dashboardHeading, dashboardSubtitle } from "../lib/dashboardHeading";
import { isTypingTarget, shortcutFor } from "../lib/shortcuts";
import { useEscapeToClose } from "../lib/useEscapeToClose";
import type { NotificationDestination } from "../lib/notificationTarget";
import {
  readSort,
  writeSort,
  readView,
  writeView,
} from "../lib/prefs";
import { downloadFilesAsZip } from "../lib/zip";
import { downloadDecryptedFile } from "../lib/encryption";
import Sidebar, { NewMenu, type Filter, type NewActions } from "./Sidebar";
import Topbar, { type ViewMode } from "./Topbar";
import UploadZone, { type UploadZoneHandle } from "./UploadZone";
import FileCard, { type FileSelectOptions } from "./FileCard";
import FolderCard from "./FolderCard";
import NameDialog from "./NameDialog";
import ShareDialog from "./ShareDialog";
import FolderShareDialog from "./FolderShareDialog";
import DetailPanel from "./DetailPanel";
import FolderDetailPanel from "./FolderDetailPanel";
import VersionsDialog from "./VersionsDialog";
import StorageBreakdown from "./StorageBreakdown";
import RecentStrip from "./RecentStrip";
import { ConfirmDialog, TagsDialog, LimitRequestDialog } from "./Dialog";
import {
  FileGridSkeleton,
  FileListSkeleton,
  FolderGridSkeleton,
} from "./Skeleton";
import { useToast } from "./Toast";

const PreviewModal = lazy(() => import("./PreviewModal"));
const AdminPanel = lazy(() => import("./AdminPanel"));
const AccountSecurityDialog = lazy(() => import("./AccountSecurityDialog"));
const TeamsDialog = lazy(() => import("./TeamsDialog"));

const EXPIRY_OPTIONS = [1, 2, 7, 14, 30];
const DAY = 86400;
const PAGE_SIZE = 60;
const RECENT_STRIP_MIN_FILES = 12;
const FIRST_RUN_TIP_KEY = "dropvault-first-run-tip-dismissed";
type SortKey = "newest" | "name" | "size" | "expiring";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "expiring", label: "Expiring" },
];
type TypeScope = "all" | "folders" | "images" | "docs";
const SCOPE_OPTIONS: { value: TypeScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "folders", label: "Folders" },
  { value: "images", label: "Images" },
  { value: "docs", label: "Docs" },
];
function isDoc(type: string | null): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return (
    t.includes("pdf") ||
    t.includes("word") ||
    t.includes("officedocument") ||
    t.includes("spreadsheet") ||
    t.includes("presentation") ||
    t.startsWith("text/") ||
    t.includes("rtf") ||
    t.includes("csv")
  );
}
type DialogState =
  | { mode: "create" }
  | { mode: "rename"; folderId: string; current: string }
  | { mode: "renameFile"; fileId: string; current: string }
  | null;
type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
} | null;
type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type SelectionGesture = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  targetId: string | null;
  shiftKey: boolean;
  baseSelection: Set<string>;
  active: boolean;
};
const popInitial = { opacity: 0, scale: 0.95, y: 8 };
const popAnimate = { opacity: 1, scale: 1, y: 0 };
const overlayHidden = { opacity: 0 };
const overlayShown = { opacity: 1 };
const LONG_PRESS_MS = 450;
function titleFor(f: Filter): string {
  return f === "shared"
    ? "Shared"
    : f === "expiring"
      ? "Expiring soon"
      : f === "favorites"
        ? "Favorites"
        : f === "trash"
          ? "Trash"
          : "My Drive";
}
function triggerDownload(id: string) {
  const a = document.createElement("a");
  a.href = downloadUrl(id);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Dashboard({
  userName,
  userEmail,
}: {
  userName?: string;
  userEmail?: string;
}) {
  const qc = useQueryClient();
  const { layout } = useLayout();
  const { success: toastOk, error: toastErr } = useToast();
  const errHandler = (fallback: string) => (e: unknown) =>
    toastErr((e as Error)?.message || fallback);
  const [expiryDays, setExpiryDays] = useState(7);
  const [search, setSearch] = useState("");
  // Drive opens in list view; a saved choice wins.
  const [view, setViewState] = useState<ViewMode>(() => readView("list"));
  const [filter, setFilterState] = useState<Filter>("all");
  const [sort, setSortState] = useState<SortKey>(() => readSort() as SortKey);
  const [typeScope, setTypeScope] = useState<TypeScope>("all");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [tagsTarget, setTagsTarget] = useState<{
    ids: string[];
    initial: string[];
    bulk?: boolean;
  } | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveBarOpen, setMoveBarOpen] = useState(false);
  const [moveAnchor, setMoveAnchor] = useState<React.CSSProperties>({});
  useEscapeToClose(moveBarOpen, () => setMoveBarOpen(false));
  const [shareFile, setShareFile] = useState<DriftFile | null>(null);
  const [shareFolderTarget, setShareFolderTarget] = useState<Folder | null>(
    null,
  );
  const [previewFile, setPreviewFile] = useState<DriftFile | null>(null);
  const [detailFile, setDetailFile] = useState<DriftFile | null>(null);
  const [detailFolderId, setDetailFolderId] = useState<string | null>(null);
  const [versionsFile, setVersionsFile] = useState<DriftFile | null>(null);
  const [adminOpen, setAdminOpen] = useState(() =>
    isAdminHash(window.location.hash),
  );
  // Back/forward and hand-edited #admin URLs open and close the console.
  useEffect(() => {
    const sync = () => setAdminOpen(isAdminHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function openAdmin() {
    if (!isAdminHash(window.location.hash))
      window.location.hash = ADMIN_HASH_PREFIX.slice(1);
    setAdminOpen(true);
  }
  // Keyboard shortcuts: "/" search, "u" upload, Delete moves the selection to
  // Trash (with the usual confirmation). Skipped while any dialog is open.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event: KeyboardEvent) => {
    const dialogOpen = Boolean(
      dialog ||
        confirmState ||
        tagsTarget ||
        limitOpen ||
        shareFile ||
        shareFolderTarget ||
        previewFile ||
        versionsFile ||
        adminOpen ||
        securityOpen ||
        teamsOpen ||
        menuOpen,
    );
    if (
      event.key === "Escape" &&
      !dialogOpen &&
      selected.size > 0 &&
      !isTypingTarget(event.target)
    ) {
      clearSelection();
      return;
    }
    const shortcut = shortcutFor(event, {
      typing: isTypingTarget(event.target),
      dialogOpen,
    });
    if (shortcut === "search") {
      const input = document.querySelector<HTMLInputElement>(
        '[data-ui="search"]',
      );
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    } else if (shortcut === "upload" && filter !== "trash") {
      event.preventDefault();
      uploadInputRef.current?.click();
    } else if (shortcut === "trash" && selected.size > 0 && filter !== "trash") {
      event.preventDefault();
      bulkDelete();
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function goToNotification(destination: NotificationDestination) {
    if (destination.kind === "drive") {
      setFilterState("all");
      setCurrentFolderId(null);
      setTypeScope("all");
      setSearch("");
      setSort("newest");
      clearSelection();
    } else if (destination.kind === "expiring") {
      setFilterState("expiring");
      setCurrentFolderId(null);
      clearSelection();
    } else if (destination.kind === "security") {
      setSecurityOpen(true);
    } else if (isAdmin) {
      window.location.hash = `${ADMIN_HASH_PREFIX.slice(1)}/${destination.section}`;
      setAdminOpen(true);
    }
  }
  function closeAdmin() {
    if (isAdminHash(window.location.hash))
      window.history.replaceState(null, "", urlWithoutHash(window.location));
    setAdminOpen(false);
  }
  const [securityOpen, setSecurityOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [osDrag, setOsDrag] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadZoneRef = useRef<UploadZoneHandle>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const selectionSurfaceRef = useRef<HTMLDivElement>(null);
  const selectionGestureRef = useRef<SelectionGesture | null>(null);
  const selectionHoldRef = useRef<number | null>(null);
  const selectedRef = useRef<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const suppressClickUntilRef = useRef(0);
  const suppressContextMenuUntilRef = useRef(0);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
    null,
  );
  const [selectionSelecting, setSelectionSelecting] = useState(false);
  selectedRef.current = selected;
  function setView(v: ViewMode) {
    setViewState(v);
    writeView(v);
  }
  function setSort(s: SortKey) {
    setSortState(s);
    writeSort(s);
  }
  function ask(c: NonNullable<ConfirmState>) {
    setConfirmState(c);
  }
  const filesQuery = useQuery({
    queryKey: ["files"],
    queryFn: () => listFiles(),
  });
  const trashQuery = useQuery({
    queryKey: ["files", "trash"],
    queryFn: () => listFiles({ trash: true }),
    enabled: filter === "trash",
  });
  const foldersQuery = useQuery({
    queryKey: ["folders"],
    queryFn: listFolders,
  });
  const accessQuery = useQuery({
    queryKey: ["admin-access"],
    queryFn: adminAccess,
  });
  const isAdmin = accessQuery.data?.isAdmin ?? false;
  const accountQuery = useQuery({
    queryKey: ["account"],
    queryFn: accountStatus,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  const quotaBytes = accountQuery.data?.quotaBytes ?? null;
  const canKeepForever = accountQuery.data?.canKeepFilesForever ?? false;
  const trashRetentionDays = accountQuery.data?.trashRetentionDays;
  // Eligible accounts keep uploads forever unless they pick an expiry.
  const [keepUploadsForever, setKeepUploadsForever] = useState(true);
  const [uploadSummary, setUploadSummary] = useState("");
  const [firstRunTipDismissed, setFirstRunTipDismissed] = useState(() => {
    try {
      return localStorage.getItem(FIRST_RUN_TIP_KEY) === "1";
    } catch {
      return false;
    }
  });
  function dismissFirstRunTip() {
    setFirstRunTipDismissed(true);
    try {
      localStorage.setItem(FIRST_RUN_TIP_KEY, "1");
    } catch {}
  }
  const uploadsKeptForever = canKeepForever && keepUploadsForever;
  const [dismissedQuota, setDismissedQuota] = useState<number | null>(() => {
    const v = localStorage.getItem("dropvault-storage-notice-dismissed");
    return v == null || v === "" ? null : Number(v);
  });
  function dismissStorageNotice() {
    if (quotaBytes == null) return;
    setDismissedQuota(quotaBytes);
    localStorage.setItem(
      "dropvault-storage-notice-dismissed",
      String(quotaBytes),
    );
  }
  const myLimitRequestsQuery = useQuery({
    queryKey: ["my-limit-requests"],
    queryFn: listMyLimitRequests,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const requests = myLimitRequestsQuery.data;
    if (!requests) return;
    const KEY = "dropvault-seen-limit-requests";
    const firstRun = localStorage.getItem(KEY) == null;
    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      seen = {};
    }
    let changed = false;
    let approved = false;
    for (const r of requests) {
      if (r.status !== "approved" && r.status !== "rejected") continue;
      if (seen[r.id] === r.status) continue;
      if (!firstRun) {
        const gbVal = r.requestedBytes / (1024 * 1024 * 1024);
        const gb = `${Number.isInteger(gbVal) ? gbVal : gbVal.toFixed(1)} GB`;
        if (r.status === "approved") {
          toastOk(
            `Your request for ${gb} of storage was approved — your new limit is active.`,
          );
          approved = true;
        } else toastErr(`Your request for ${gb} of storage was rejected.`);
      }
      seen[r.id] = r.status;
      changed = true;
    }
    if (changed || firstRun) localStorage.setItem(KEY, JSON.stringify(seen));
    if (approved) qc.invalidateQueries({ queryKey: ["account"] });
  }, [myLimitRequestsQuery.data]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };
  const extendMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      extendFile(id, days),
    onSuccess: invalidate,
    onError: errHandler("Couldn't extend file"),
  });
  const keepForeverMut = useMutation({
    mutationFn: (id: string) => keepFileForever(id),
    onSuccess: () => {
      invalidate();
      toastOk("File kept forever");
    },
    onError: errHandler("Couldn't keep file forever"),
  });
  const unkeepForeverMut = useMutation({
    mutationFn: (id: string) => unkeepFileForever(id),
    onSuccess: () => {
      invalidate();
      toastOk("Expiry restored");
    },
    onError: errHandler("Couldn't update file"),
  });
  const bulkKeepForeverMut = useMutation({
    mutationFn: (ids: string[]) => bulkKeepForever(ids, true),
    onSuccess: (res) => {
      invalidate();
      toastOk(`${res.count} file${res.count === 1 ? "" : "s"} kept forever`);
      clearSelection();
    },
    onError: errHandler("Couldn't keep files forever"),
  });
  const renameFileMut = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameFile(id, filename),
    onSuccess: () => {
      invalidate();
      toastOk("File renamed");
    },
    onError: errHandler("Couldn't rename file"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: (_data, id) => {
      invalidate();
      toastOk("Moved to Trash", {
        action: { label: "Undo", onClick: () => restoreMut.mutate(id) },
      });
    },
    onError: errHandler("Couldn't delete file"),
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreFile(id),
    onSuccess: () => {
      invalidate();
      toastOk("File restored");
    },
    onError: errHandler("Couldn't restore file"),
  });
  const permanentMut = useMutation({
    mutationFn: (id: string) => permanentDeleteFile(id),
    onSuccess: () => {
      invalidate();
      toastOk("Permanently deleted");
    },
    onError: errHandler("Couldn't permanently delete file"),
  });
  const metaMut = useMutation({
    mutationFn: ({
      id,
      favorite,
      tags,
    }: {
      id: string;
      favorite?: boolean;
      tags?: string[];
    }) => updateFileMeta(id, { favorite, tags }),
    onSuccess: invalidate,
    onError: errHandler("Couldn't update file"),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: () => {
      invalidate();
      toastOk("Link revoked");
    },
    onError: errHandler("Couldn't revoke link"),
  });
  const moveMut = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      moveFile(id, folderId),
    onSuccess: invalidate,
    onError: errHandler("Couldn't move file"),
  });
  const createFolderMut = useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      createFolder(input.name, { parentId: input.parentId ?? null }),
    onSuccess: () => {
      invalidate();
      toastOk("Folder created");
    },
    onError: errHandler("Couldn't create folder"),
  });
  const renameFolderMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameFolder(id, name),
    onSuccess: () => {
      invalidate();
      toastOk("Folder renamed");
    },
    onError: errHandler("Couldn't rename folder"),
  });
  const deleteFolderMut = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      invalidate();
      toastOk("Folder deleted");
    },
    onError: errHandler("Couldn't delete folder"),
  });
  const revokeFolderMut = useMutation({
    mutationFn: (id: string) => revokeFolderShare(id),
    onSuccess: () => {
      invalidate();
      toastOk("Folder link revoked");
    },
    onError: errHandler("Couldn't revoke folder link"),
  });
  const bulkMut = useMutation({
    mutationFn: ({
      action,
      ids,
      opts,
    }: {
      action: BulkFileAction;
      ids: string[];
      opts?: { folderId?: string | null; tags?: string[] };
    }) => bulkFiles(action, ids, opts),
  });
  async function runBulk(
    action: BulkFileAction,
    ids: string[],
    opts?: { folderId?: string | null; tags?: string[] },
    okMsg?: (n: number) => string,
    undo?: () => void,
  ) {
    if (ids.length === 0) return;
    try {
      const res = await bulkMut.mutateAsync({ action, ids, opts });
      if (okMsg)
        toastOk(
          okMsg(res.count),
          undo ? { action: { label: "Undo", onClick: undo } } : undefined,
        );
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't complete that action");
    } finally {
      invalidate();
      clearSelection();
    }
  }
  function restoreBatch(ids: string[]) {
    return () =>
      runBulk(
        "restore",
        ids,
        undefined,
        (n) => `${n} file${n === 1 ? "" : "s"} restored`,
      );
  }
  async function handleShare(id: string): Promise<string> {
    try {
      const res = await createShare(id);
      await invalidate();
      toastOk("Share link copied");
      return res.url;
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't create share link");
      throw e;
    }
  }
  async function handleShareFolder(id: string): Promise<string> {
    try {
      const res = await shareFolder(id);
      await invalidate();
      toastOk("Folder link copied");
      return res.url;
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't create folder link");
      throw e;
    }
  }
  function requestMoreLimit() {
    setLimitOpen(true);
  }
  async function submitLimitRequest(bytes: number, reason: string) {
    setLimitOpen(false);
    try {
      await createLimitRequest(bytes, reason || undefined);
      toastOk("Upload limit request sent");
      qc.invalidateQueries({ queryKey: ["my-limit-requests"] });
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't send upload limit request");
    }
  }
  useEffect(() => {
    const hasOSFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasOSFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setOsDrag(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasOSFiles(e)) return;
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasOSFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setOsDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setOsDrag(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  const liveFiles = filesQuery.data ?? [];
  const trashFiles = trashQuery.data ?? [];
  const files = filter === "trash" ? trashFiles : liveFiles;
  const folders = foldersQuery.data ?? [];
  const totalBytes = useMemo(
    () => liveFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    [liveFiles],
  );
  const sharedCount = useMemo(
    () =>
      liveFiles.filter((f) => f.shareToken).length +
      folders.filter((f) => f.shareToken).length,
    [liveFiles, folders],
  );
  useEffect(() => {
    if (
      currentFolderId &&
      foldersQuery.data &&
      !folders.some((f) => f.id === currentFolderId)
    )
      setCurrentFolderId(null);
  }, [currentFolderId, folders, foldersQuery.data]);
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null;
  const currentFolderPath = useMemo(
    () => folderPath(folders, currentFolderId),
    [folders, currentFolderId],
  );
  const detailFolder = folders.find((f) => f.id === detailFolderId) ?? null;
  const atRoot = currentFolderId === null;
  const calmHome = layout === "calm" && atRoot && filter === "all";
  function clearSelection() {
    const next = new Set<string>();
    selectedRef.current = next;
    selectionAnchorRef.current = null;
    setSelected(next);
    setMoveBarOpen(false);
  }
  function selectFile(id: string, options: FileSelectOptions = {}) {
    const ids = sorted.map((file) => file.id);
    const anchor = selectionAnchorRef.current;
    const targetIndex = ids.indexOf(id);
    const anchorIndex = anchor ? ids.indexOf(anchor) : -1;
    let next: Set<string>;
    if (
      options.shiftKey &&
      anchorIndex >= 0 &&
      targetIndex >= 0
    ) {
      next = new Set(selectedRef.current);
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      for (let i = start; i <= end; i++) next.add(ids[i]);
    } else {
      next = new Set(selectedRef.current);
      next.has(id) ? next.delete(id) : next.add(id);
    }
    selectedRef.current = next;
    selectionAnchorRef.current = id;
    setSelected(next);
  }
  function getDragIds(id: string): string[] {
    return selected.has(id) && selected.size > 0 ? Array.from(selected) : [id];
  }
  function moveIds(ids: string[], folderId: string | null) {
    ids.forEach((id) => moveMut.mutate({ id, folderId }));
  }
  function setFilter(f: Filter) {
    setCurrentFolderId(null);
    setFilterState(f);
    setTypeScope("all");
    clearSelection();
  }
  function openFolder(id: string) {
    // Opening a folder from search results shows the folder itself.
    setSearch("");
    setCurrentFolderId(id);
    setFilterState("all");
    clearSelection();
  }
  function goToRoot() {
    setCurrentFolderId(null);
    clearSelection();
  }
  function editTags(file: DriftFile) {
    setTagsTarget({ ids: [file.id], initial: file.tags ?? [] });
  }
  const q = search.trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const visible = useMemo(
    () =>
      files.filter((f) => {
        const hay = `${f.filename} ${(f.tags ?? []).join(" ")}`.toLowerCase();
        if (q && !hay.includes(q)) return false;
        if (filter !== "trash") {
          if (typeScope === "folders") return false;
          if (
            typeScope === "images" &&
            !(f.contentType || "").startsWith("image/")
          )
            return false;
          if (typeScope === "docs" && !isDoc(f.contentType)) return false;
        }
        if (filter === "favorites" && !f.favorite) return false;
        if (filter === "shared" && !f.shareToken) return false;
        if (filter === "expiring" && (f.keepForever || f.expiresAt <= now || f.expiresAt - now >= DAY)) return false;
        if (filter === "trash") return true;
        // "Search in Dropvault" looks inside every folder, not just this one.
        if (q) return true;
        if (currentFolderId) return f.folderId === currentFolderId;
        if (filter === "all") return !f.folderId;
        return true;
      }),
    [files, q, filter, currentFolderId, now, typeScope],
  );
  const sorted = useMemo(() => {
    const arr = [...visible];
    if (sort === "name")
      arr.sort((a, b) => a.filename.localeCompare(b.filename));
    else if (sort === "size") arr.sort((a, b) => b.sizeBytes - a.sizeBytes);
    else if (sort === "expiring") arr.sort((a, b) => a.expiresAt - b.expiresAt);
    else arr.sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }, [visible, sort]);
  const recentFiles = useMemo(
    () => [...liveFiles].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
    [liveFiles],
  );
  // On a small drive the list already shows everything, so a "Recent" strip
  // would only repeat it.
  const showRecentStrip = liveFiles.length > RECENT_STRIP_MIN_FILES;
  const detailFileLive = useMemo(
    () =>
      detailFile
        ? (liveFiles.find((f) => f.id === detailFile.id) ?? detailFile)
        : null,
    [detailFile, liveFiles],
  );
  const expiringSoon = useMemo(
    () =>
      liveFiles.filter(
        (f) =>
          !f.keepForever && f.expiresAt - now < DAY && f.expiresAt - now > 0,
      ),
    [liveFiles, now],
  );
  const expiredFiles = useMemo(
    () => liveFiles.filter((f) => !f.keepForever && f.expiresAt <= now),
    [liveFiles, now],
  );
  const pagedFiles = useMemo(
    () => sorted.slice(0, visibleCount),
    [sorted, visibleCount],
  );
  const hasMore = visibleCount < sorted.length;
  function fileIdFromTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>("[data-file-id]")?.dataset.fileId ?? null;
  }
  function isSelectionControlTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const control = target.closest(
      "[data-file-actions], [data-file-select-toggle], button, a, input, select, textarea",
    );
    // Filenames are buttons so they can be clicked and focused, but they
    // cover most of a row: long-press and drag selection still start there.
    return Boolean(control && !control.hasAttribute("data-file-open"));
  }
  function rectFromPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): SelectionRect {
    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }
  function applySelectionRect(
    gesture: SelectionGesture,
    rect: SelectionRect,
  ): void {
    const next = new Set(gesture.baseSelection);
    const selectionRight = rect.left + rect.width;
    const selectionBottom = rect.top + rect.height;
    const surface = selectionSurfaceRef.current;
    const elements = surface?.querySelectorAll<HTMLElement>("[data-file-id]");
    elements?.forEach((element) => {
      const id = element.dataset.fileId;
      if (!id) return;
      const box = element.getBoundingClientRect();
      const isPointSelection = rect.width === 0 && rect.height === 0;
      const hit = isPointSelection
        ? rect.left >= box.left &&
          rect.left <= box.right &&
          rect.top >= box.top &&
          rect.top <= box.bottom
        : rect.left < box.right &&
          selectionRight > box.left &&
          rect.top < box.bottom &&
          selectionBottom > box.top;
      if (hit) next.add(id);
    });
    if (gesture.targetId) next.add(gesture.targetId);
    selectedRef.current = next;
    setSelected(next);
  }
  function clearSelectionHold() {
    if (selectionHoldRef.current == null) return;
    window.clearTimeout(selectionHoldRef.current);
    selectionHoldRef.current = null;
  }
  function startSelectionGesture() {
    const gesture = selectionGestureRef.current;
    const surface = selectionSurfaceRef.current;
    if (!gesture || gesture.active || !surface) return;
    gesture.active = true;
    setSelectionSelecting(true);
    suppressClickUntilRef.current = performance.now() + 500;
    suppressContextMenuUntilRef.current = performance.now() + 1000;
    const rect = rectFromPoints(
      gesture.startX,
      gesture.startY,
      gesture.startX,
      gesture.startY,
    );
    setSelectionRect(rect);
    applySelectionRect(gesture, rect);
    try {
      surface.setPointerCapture(gesture.pointerId);
    } catch {
      /* The pointer may have been cancelled between the timer and capture. */
    }
  }
  function handleSelectionPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (selectionGestureRef.current || isSelectionControlTarget(e.target))
      return;
    const targetId = fileIdFromTarget(e.target);
    const isTouch = e.pointerType !== "mouse";
    if (isTouch && !targetId) return;
    const gesture: SelectionGesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      targetId,
      shiftKey: e.shiftKey,
      baseSelection: e.shiftKey
        ? new Set(selectedRef.current)
        : new Set<string>(),
      active: false,
    };
    selectionGestureRef.current = gesture;
    if (isTouch || Boolean(targetId)) {
      selectionHoldRef.current = window.setTimeout(
        startSelectionGesture,
        LONG_PRESS_MS,
      );
    }
  }
  function handleSelectionPointerMove(e: React.PointerEvent<HTMLElement>) {
    const gesture = selectionGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const distance = Math.hypot(
      e.clientX - gesture.startX,
      e.clientY - gesture.startY,
    );
    if (!gesture.active) {
      if (gesture.pointerType !== "mouse") {
        if (distance > 8) {
          clearSelectionHold();
          selectionGestureRef.current = null;
        }
        return;
      }
      if (gesture.targetId) {
        if (distance > 5) {
          clearSelectionHold();
          selectionGestureRef.current = null;
        }
        return;
      }
      if (distance <= 5) return;
      e.preventDefault();
      startSelectionGesture();
    }
    if (!gesture.active) return;
    e.preventDefault();
    const rect = rectFromPoints(
      gesture.startX,
      gesture.startY,
      e.clientX,
      e.clientY,
    );
    setSelectionRect(rect);
    applySelectionRect(gesture, rect);
  }
  function finishSelectionGesture(
    e: React.PointerEvent<HTMLElement>,
    cancelled = false,
  ) {
    const gesture = selectionGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    clearSelectionHold();
    if (gesture.active) {
      e.preventDefault();
      suppressClickUntilRef.current = performance.now() + 500;
      if (gesture.targetId) selectionAnchorRef.current = gesture.targetId;
      const surface = selectionSurfaceRef.current;
      if (surface?.hasPointerCapture(gesture.pointerId))
        surface.releasePointerCapture(gesture.pointerId);
    }
    selectionGestureRef.current = null;
    setSelectionRect(null);
    setSelectionSelecting(false);
    if (cancelled) suppressClickUntilRef.current = 0;
  }
  function handleSelectionContextMenu(e: React.MouseEvent<HTMLElement>) {
    const id = fileIdFromTarget(e.target);
    if (!id || isSelectionControlTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < suppressContextMenuUntilRef.current) return;
    selectFile(id);
  }
  function handleSelectionClickCapture(e: React.MouseEvent<HTMLElement>) {
    if (performance.now() >= suppressClickUntilRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntilRef.current = 0;
  }
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, sort, currentFolderId, q, typeScope]);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setVisibleCount((c) =>
            c < sorted.length ? Math.min(c + PAGE_SIZE, sorted.length) : c,
          );
      },
      { rootMargin: "800px 0px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [hasMore, sorted.length, view, filter, typeScope, currentFolderId]);
  function extendAllExpiring() {
    if (expiringSoon.length === 0) return;
    expiringSoon.forEach((f) => extendMut.mutate({ id: f.id, days: 7 }));
    toastOk(
      `Extending ${expiringSoon.length} file${expiringSoon.length === 1 ? "" : "s"} by 7 days`,
    );
  }
  function emptyTrash() {
    if (trashFiles.length === 0) return;
    ask({
      title: "Empty Trash",
      message: `Permanently delete all ${trashFiles.length} item${trashFiles.length === 1 ? "" : "s"} in Trash? This can't be undone.`,
      danger: true,
      confirmLabel: "Empty Trash",
      onConfirm: () =>
        runBulk(
          "permanentDelete",
          trashFiles.map((f) => f.id),
          undefined,
          (n) => `${n} item${n === 1 ? "" : "s"} permanently deleted`,
        ),
    });
  }
  function deleteExpired() {
    if (expiredFiles.length === 0) return;
    ask({
      title: "Delete expired files",
      message: `Move ${expiredFiles.length} expired file${expiredFiles.length === 1 ? "" : "s"} to Trash?`,
      danger: true,
      confirmLabel: "Move to Trash",
      onConfirm: () => {
        const ids = expiredFiles.map((f) => f.id);
        runBulk(
          "trash",
          ids,
          undefined,
          (n) => `${n} file${n === 1 ? "" : "s"} moved to Trash`,
          restoreBatch(ids),
        );
      },
    });
  }
  const scopeOptions =
    filter === "all"
      ? SCOPE_OPTIONS
      : SCOPE_OPTIONS.filter((o) => o.value !== "folders");
  const showFolderSection =
    filter === "all" && (typeScope === "all" || typeScope === "folders");
  const showFilesSection = typeScope !== "folders";
  const visibleFolders = useMemo(
    () =>
      showFolderSection
        ? folders.filter((fd) =>
            q
              ? fd.name.toLowerCase().includes(q)
              : (fd.parentId ?? null) === currentFolderId,
          )
        : [],
    [folders, q, showFolderSection, currentFolderId],
  );
  const folderOptions = useMemo(
    () => folders.map((f) => ({ id: f.id, name: f.name })),
    [folders],
  );
  const firstName = userName ? userName.split(" ")[0] : "";
  const heading = dashboardHeading({
    search,
    greet: calmHome,
    firstName,
    isNewAccount:
      filesQuery.isSuccess &&
      foldersQuery.isSuccess &&
      liveFiles.length === 0 &&
      folders.length === 0,
    title: currentFolder ? currentFolder.name : titleFor(filter),
  });
  const itemCount = visible.length + visibleFolders.length;
  const searching = Boolean(q);
  const calmDetails =
    layout === "calm" ? (file: DriftFile) => setDetailFile(file) : undefined;
  function onDialogConfirm(name: string) {
    if (!dialog) return;
    if (dialog.mode === "create") {
      createFolderMut.mutate({ name, parentId: currentFolderId });
      setFilterState("all");
    } else if (dialog.mode === "rename")
      renameFolderMut.mutate({ id: dialog.folderId, name });
    else renameFileMut.mutate({ id: dialog.fileId, filename: name });
    setDialog(null);
  }
  function deleteFolderConfirm(id: string) {
    const f = folders.find((x) => x.id === id);
    const fileCount = f?.totalFileCount ?? f?.fileCount ?? 0;
    const childCount = f?.totalFolderCount ?? 0;
    const contents = [
      fileCount
        ? `${fileCount} file${fileCount === 1 ? "" : "s"}`
        : "",
      childCount
        ? `${childCount} subfolder${childCount === 1 ? "" : "s"}`
        : "",
    ]
      .filter(Boolean)
      .join(" and ");
    const msg = f
      ? `Delete “${f.name}”${contents ? ` and its ${contents}` : ""}? Contained files will move to Trash and the folder tree will be removed.`
      : "Delete this folder and move its contained files to Trash?";
    ask({
      title: "Delete folder",
      message: msg,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => deleteFolderMut.mutate(id),
    });
  }
  const selCount = selected.size;
  function bulkMove(folderId: string | null) {
    runBulk(
      "move",
      Array.from(selected),
      { folderId },
      (n) => `${n} file${n === 1 ? "" : "s"} moved`,
    );
  }
  const [extendingSelection, setExtendingSelection] = useState(false);
  async function extendSelection(days: number) {
    setExtendingSelection(true);
    let extended = 0;
    const failed = new Set<string>();
    for (const id of selected) {
      const original = liveFiles.find((file) => file.id === id);
      if (original?.keepForever) continue;
      try {
        const result = await extendFile(id, days);
        if (original && result.expiresAt <= original.expiresAt) failed.add(id);
        else extended++;
      } catch { failed.add(id); }
    }
    setExtendingSelection(false);
    setSelected(failed);
    invalidate();
    if (extended) toastOk(`${extended} file${extended === 1 ? "" : "s"} extended within retention limits.`);
    if (failed.size) toastErr(`${failed.size} could not be extended. They remain selected; check their retention limits.`);
  }
  async function bulkDownload() {
    const selectedFiles = Array.from(selected)
      .map((id) => files.find((f) => f.id === id))
      .filter((f): f is DriftFile => !!f);
    const items = selectedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
    }));
    if (items.length === 0) return;
    if (selectedFiles.some((file) => file.encryptionMode === "aes-gcm")) {
      try {
        for (const file of selectedFiles) {
          if (file.encryptionMode === "aes-gcm")
            await downloadDecryptedFile(file, downloadUrl(file.id));
          else triggerDownload(file.id);
        }
        toastOk("Downloads started");
      } catch (e) {
        toastErr((e as Error)?.message || "Couldn't decrypt selected files");
      }
      clearSelection();
      return;
    }
    if (items.length === 1) {
      triggerDownload(items[0].id);
      clearSelection();
      return;
    }
    try {
      toastOk(`Zipping ${items.length} files…`);
      await downloadFilesAsZip(items, "dropvault.zip");
      toastOk("Download ready");
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't build ZIP");
    }
    clearSelection();
  }
  function bulkDelete() {
    ask({
      title: "Move to Trash",
      message: `Move ${selCount} file${selCount === 1 ? "" : "s"} to Trash?`,
      danger: true,
      confirmLabel: "Move to Trash",
      onConfirm: () => {
        const ids = Array.from(selected);
        runBulk(
          "trash",
          ids,
          undefined,
          (n) => `${n} file${n === 1 ? "" : "s"} moved to Trash`,
          restoreBatch(ids),
        );
      },
    });
  }
  const dialogTitle =
    dialog?.mode === "rename"
      ? "Rename folder"
      : dialog?.mode === "renameFile"
        ? "Rename file"
        : currentFolder
          ? `New folder in ${currentFolder.name}`
          : "New folder";
  const dialogInitial =
    dialog && dialog.mode !== "create" ? dialog.current : "";
  const dialogConfirm = dialog?.mode === "create" ? "Create" : "Rename";
  const newActions: NewActions = {
    onNewFolder: () => setDialog({ mode: "create" }),
    onUploadFiles: () => uploadZoneRef.current?.openFilePicker(),
    onUploadFolder: () => uploadZoneRef.current?.openFolderPicker(),
    onTakePhoto: () => uploadZoneRef.current?.openCamera(),
    onUploadSettings: () => uploadZoneRef.current?.openOptions(),
  };
  const loadingFiles =
    filesQuery.isLoading || (filter === "trash" && trashQuery.isLoading);
  const loadingFolders = showFolderSection && foldersQuery.isLoading;
  const nothingToShow =
    !loadingFiles &&
    !loadingFolders &&
    (!showFilesSection || visible.length === 0) &&
    visibleFolders.length === 0;
  const showHomeExtras = calmHome && !q && typeScope === "all";
  const uploadLifetimeLabel = uploadsKeptForever
    ? "Kept forever"
    : `Expire in ${expiryDays} day${expiryDays === 1 ? "" : "s"}`;
  function sortHeader(key: SortKey, label: string, align = "") {
    const active = sort === key;
    return (
      <button
        type="button"
        onClick={() => setSort(active ? "newest" : key)}
        aria-label={
          active ? `Sorted by ${label}. Sort by newest` : `Sort by ${label}`
        }
        className={
          "inline-flex items-center gap-1 rounded-full px-2 py-1 -mx-2 hover:bg-[rgb(var(--c-strong)/0.06)] " +
          (active ? "text-strong " : "") +
          align
        }
      >
        {label}
        {active && <ArrowUp size={14} aria-hidden="true" />}
      </button>
    );
  }
  function renderFile(f: DriftFile, mode: ViewMode) {
    return (
      <FileCard
        key={f.id}
        file={f}
        view={mode}
        folders={folderOptions}
        onExtend={(id, days) => extendMut.mutate({ id, days })}
        onRename={(id) =>
          setDialog({
            mode: "renameFile",
            fileId: id,
            current: f.filename,
          })
        }
        onDelete={(id) => deleteMut.mutate(id)}
        onShare={handleShare}
        onRevoke={(id) => revokeMut.mutate(id)}
        onMove={(id, folderId) => moveMut.mutate({ id, folderId })}
        onOpenShare={(id) =>
          setShareFile(files.find((x) => x.id === id) ?? null)
        }
        onPreview={(file) => setPreviewFile(file)}
        onOpenDetails={calmDetails}
        onOpenVersions={(file) => setVersionsFile(file)}
        onToggleFavorite={(id) => metaMut.mutate({ id, favorite: !f.favorite })}
        onEditTags={() => editTags(f)}
        onRestore={(id) => restoreMut.mutate(id)}
        onPermanentDelete={(id) =>
          ask({
            title: "Delete forever",
            message: "Permanently delete this file? This can't be undone.",
            danger: true,
            confirmLabel: "Delete forever",
            onConfirm: () => permanentMut.mutate(id),
          })
        }
        canKeepForever={canKeepForever}
        trashRetentionDays={trashRetentionDays}
        onKeepForever={(id) => keepForeverMut.mutate(id)}
        onUnkeepForever={(id) => unkeepForeverMut.mutate(id)}
        selected={selected.has(f.id)}
        onToggleSelect={selectFile}
        anySelected={selCount > 0}
        getDragIds={getDragIds}
      />
    );
  }
  function renderFolder(fd: Folder, mode: ViewMode) {
    return (
      <FolderCard
        key={fd.id}
        folder={fd}
        view={mode}
        onOpen={openFolder}
        onShare={handleShareFolder}
        onRevoke={(id) => revokeFolderMut.mutate(id)}
        onRename={(id) =>
          setDialog({
            mode: "rename",
            folderId: id,
            current: fd.name,
          })
        }
        onDelete={deleteFolderConfirm}
        onOpenShare={(id) =>
          setShareFolderTarget(folders.find((x) => x.id === id) ?? null)
        }
        onOpenDetails={(id) => setDetailFolderId(id)}
        onDropFiles={(folderId, ids) => moveIds(ids, folderId)}
      />
    );
  }
  const selectionHandlers = {
    ref: selectionSurfaceRef,
    onPointerDown: handleSelectionPointerDown,
    onPointerMove: handleSelectionPointerMove,
    onPointerUp: finishSelectionGesture,
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) =>
      finishSelectionGesture(e, true),
    onContextMenuCapture: handleSelectionContextMenu,
    onClickCapture: handleSelectionClickCapture,
    "data-selecting": selectionSelecting ? "true" : undefined,
  };
  const selectionButton =
    "icon-round !h-10 !w-10 disabled:opacity-40";
  return (
    <div
      data-ui="dashboard-shell"
      data-layout={layout}
      className="min-h-screen bg-app"
    >
      <Topbar
        search={search}
        setSearch={setSearch}
        userName={userName}
        userEmail={userEmail}
        onSignOut={() => signOut()}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenSecurity={() => setSecurityOpen(true)}
        onOpenTeams={() => setTeamsOpen(true)}
        onGoHome={() => setFilter("all")}
        onNotificationNavigate={goToNotification}
      />
      <Sidebar
        {...newActions}
        totalBytes={totalBytes}
        fileCount={liveFiles.length}
        sharedCount={sharedCount}
        filter={filter}
        setFilter={setFilter}
        isAdmin={isAdmin}
        onOpenAdmin={openAdmin}
        onSignOut={() => signOut()}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
        onRequestMore={requestMoreLimit}
        quotaBytes={quotaBytes}
      />
      <div className="md:pb-4 md:pl-64 md:pr-4" data-ui="dashboard-content">
        <main
          className="content-sheet min-h-[calc(100vh-4rem)] px-3 pb-28 sm:px-5 md:min-h-[calc(100vh-5rem)] md:pb-10 max-md:rounded-none"
          data-ui="workspace"
        >
          <div className="flex min-h-[4rem] items-center gap-3 pt-2">
            <div className="min-w-0 flex-1">
              {currentFolder && !searching ? (
                <nav
                  aria-label="Folder path"
                  data-ui="folder-path"
                  className="flex min-w-0 items-center gap-0.5 text-[22px] leading-tight"
                >
                  <button
                    onClick={goToRoot}
                    className="shrink-0 rounded-full px-2 py-1 font-display text-muted hover:bg-[rgb(var(--c-strong)/0.06)] sm:px-3"
                  >
                    My Drive
                  </button>
                  {currentFolderPath.map((folder, index) => (
                    <span
                      key={folder.id}
                      className="flex min-w-0 items-center gap-0.5"
                    >
                      <ChevronRight
                        size={20}
                        className="shrink-0 text-muted"
                        aria-hidden="true"
                      />
                      {index === currentFolderPath.length - 1 ? (
                        <h1
                          aria-current="page"
                          className="truncate rounded-full px-2 py-1 text-[22px] font-normal text-strong sm:px-3"
                        >
                          {folder.name}
                        </h1>
                      ) : (
                        <button
                          onClick={() => openFolder(folder.id)}
                          className="truncate rounded-full px-2 py-1 font-display text-muted hover:bg-[rgb(var(--c-strong)/0.06)] sm:px-3"
                        >
                          {folder.name}
                        </button>
                      )}
                    </span>
                  ))}
                </nav>
              ) : (
                <>
                  <h1 className="truncate px-1 text-[22px] font-normal leading-tight text-strong sm:px-2">
                    {heading}
                  </h1>
                  {searching && (
                    <p className="px-1 text-sm text-muted sm:px-2">
                      {dashboardSubtitle({ search, itemCount, firstName })}
                    </p>
                  )}
                </>
              )}
            </div>
            {!searching && (
              <span className="hidden shrink-0 text-sm text-muted lg:inline">
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setView(view === "list" ? "grid" : "list")}
              aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"}
              title={view === "list" ? "Grid layout" : "List layout"}
              className="icon-round sm:hidden"
            >
              {view === "list" ? <LayoutGrid size={20} /> : <List size={20} />}
            </button>
            <div
              className="segmented hidden shrink-0 sm:inline-flex"
              role="group"
              aria-label="View"
            >
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                aria-label="List view"
                title="List layout"
              >
                {view === "list" && <Check size={16} aria-hidden="true" />}
                <List size={18} />
              </button>
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-pressed={view === "grid"}
                aria-label="Grid view"
                title="Grid layout"
              >
                {view === "grid" && <Check size={16} aria-hidden="true" />}
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>

          <div
            className="sticky top-16 z-10 -mx-3 bg-sheet px-3 pb-2 pt-1 sm:-mx-5 sm:px-5"
            data-ui="content-toolbar"
          >
            {selCount > 0 ? (
              <div
                role="toolbar"
                aria-label="Selection actions"
                className="flex h-12 items-center gap-0.5 overflow-x-auto rounded-full bg-slate-100 px-1"
                data-ui="selection-bar"
              >
                <button
                  onClick={clearSelection}
                  aria-label="Clear selection"
                  title="Clear selection"
                  className={selectionButton}
                >
                  <X size={20} />
                </button>
                <span className="whitespace-nowrap px-1.5 text-sm font-medium text-strong">
                  {selCount} selected
                </span>
                <span className="mx-1 h-6 w-px shrink-0 bg-slate-300" />
                {filter !== "trash" && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        // The toolbar scrolls sideways on phones, which would
                        // clip an absolutely positioned menu.
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMoveAnchor({
                          top: rect.bottom + 6,
                          left: Math.max(
                            8,
                            Math.min(rect.left, window.innerWidth - 264),
                          ),
                        });
                        setMoveBarOpen((v) => !v);
                      }}
                      aria-label="Move"
                      title="Move"
                      aria-haspopup="menu"
                      aria-expanded={moveBarOpen}
                      className={selectionButton}
                    >
                      <FolderInput size={20} />
                    </button>
                    <AnimatePresence>
                      {moveBarOpen && (
                        <>
                          <button
                            className="fixed inset-0 z-40 cursor-default"
                            aria-label="Close"
                            tabIndex={-1}
                            onClick={() => setMoveBarOpen(false)}
                          />
                          <motion.div
                            role="menu"
                            initial={popInitial}
                            animate={popAnimate}
                            exit={popInitial}
                            style={moveAnchor}
                            className="menu-surface fixed z-50 max-h-72 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto"
                          >
                            <p className="px-4 pb-1 pt-1 text-xs font-medium text-muted">
                              Move {selCount} file{selCount === 1 ? "" : "s"} to
                            </p>
                            <button
                              role="menuitem"
                              onClick={() => bulkMove(null)}
                              className="menu-item"
                            >
                              <HardDrive size={18} /> My Drive (no folder)
                            </button>
                            {folders.length > 0 && (
                              <div className="menu-divider" />
                            )}
                            {folders.map((fd) => (
                              <button
                                key={fd.id}
                                role="menuitem"
                                onClick={() => bulkMove(fd.id)}
                                className="menu-item"
                              >
                                <FolderIcon size={18} />
                                <span className="truncate">{fd.name}</span>
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                <button
                  onClick={bulkDownload}
                  aria-label={selCount > 1 ? "Download ZIP" : "Download"}
                  title={selCount > 1 ? "Download as ZIP" : "Download"}
                  className={selectionButton}
                >
                  <Download size={20} />
                </button>
                {filter === "trash" ? (
                  <button
                    onClick={() =>
                      runBulk(
                        "restore",
                        Array.from(selected),
                        undefined,
                        (n) => `${n} file${n === 1 ? "" : "s"} restored`,
                      )
                    }
                    aria-label="Restore"
                    title="Restore from Trash"
                    className={selectionButton}
                  >
                    <RotateCcw size={20} />
                  </button>
                ) : (
                  <button
                    onClick={bulkDelete}
                    aria-label="Trash"
                    title="Move to Trash"
                    className={selectionButton}
                  >
                    <Trash2 size={20} />
                  </button>
                )}
                <button
                  onClick={() =>
                    runBulk(
                      "favorite",
                      Array.from(selected),
                      undefined,
                      (n) => `${n} file${n === 1 ? "" : "s"} favorited`,
                    )
                  }
                  aria-label="Favorite"
                  title="Add to favorites"
                  className={selectionButton}
                >
                  <Star size={20} />
                </button>
                {filter !== "trash" && (
                  <button
                    disabled={extendingSelection}
                    aria-label={extendingSelection ? "Extending…" : "Extend 7 days"}
                    title="Extend by 7 days"
                    className={selectionButton}
                    onClick={() =>
                      ask({
                        title: "Extend selected files",
                        message: `Extend ${selected.size} files by 7 days, up to each file's retention limit? Permanent files remain permanent.`,
                        confirmLabel: "Extend 7 days",
                        onConfirm: () => {
                          void extendSelection(7);
                        },
                      })
                    }
                  >
                    <CalendarPlus size={20} />
                  </button>
                )}
                {canKeepForever && filter !== "trash" && (
                  <button
                    onClick={() =>
                      bulkKeepForeverMut.mutate(Array.from(selected))
                    }
                    aria-label="Keep forever"
                    title="Keep forever"
                    className={selectionButton}
                  >
                    <InfinityIcon size={20} />
                  </button>
                )}
                <button
                  onClick={() =>
                    setTagsTarget({
                      ids: Array.from(selected),
                      initial: [],
                      bulk: true,
                    })
                  }
                  aria-label="Tags"
                  title="Edit tags"
                  className={selectionButton}
                >
                  <Tags size={20} />
                </button>
              </div>
            ) : (
              <div
                className="flex h-12 items-center gap-2 overflow-x-auto"
                data-ui="filter-chips"
              >
                {filter !== "trash" &&
                  scopeOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setTypeScope(o.value)}
                      aria-pressed={typeScope === o.value}
                      className="chip shrink-0"
                    >
                      {typeScope === o.value && (
                        <Check size={16} aria-hidden="true" />
                      )}
                      {o.label}
                    </button>
                  ))}
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort files"
                  className="chip shrink-0"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      Sort: {o.label}
                    </option>
                  ))}
                </select>
                {/* Upload lifetime only matters where uploads happen. "Keep
                    forever" appears only for accounts allowed to keep files. */}
                {filter !== "trash" && (
                  <select
                    value={uploadsKeptForever ? "forever" : String(expiryDays)}
                    onChange={(e) => {
                      if (e.target.value === "forever") {
                        setKeepUploadsForever(true);
                        return;
                      }
                      setKeepUploadsForever(false);
                      setExpiryDays(Number(e.target.value));
                    }}
                    aria-label="Upload expiration"
                    title="How long new uploads are kept"
                    className="chip shrink-0"
                  >
                    {canKeepForever && (
                      <option value="forever">Uploads: Keep forever</option>
                    )}
                    {EXPIRY_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        Uploads: Expire in {d} day{d === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                )}
                {filter !== "trash" && uploadSummary && (
                  <button
                    type="button"
                    onClick={() => uploadZoneRef.current?.openOptions()}
                    className="chip is-selected shrink-0"
                    title="Upload options"
                    data-ui="upload-summary"
                  >
                    <Settings2 size={16} aria-hidden="true" />
                    {uploadSummary}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 empty:hidden" data-ui="notices">
            {filter === "trash" && (trashRetentionDays || trashFiles.length > 0) && (
              <Notice icon={<Trash2 size={20} />}>
                <span className="min-w-0 flex-1">
                  {trashRetentionDays
                    ? `Items in Trash are permanently deleted after ${trashRetentionDays} day${trashRetentionDays === 1 ? "" : "s"}.`
                    : "Items in Trash can be restored until you empty it."}
                </span>
                {trashFiles.length > 0 && (
                  <button onClick={emptyTrash} className="btn-text shrink-0">
                    Empty Trash
                  </button>
                )}
              </Notice>
            )}
            {filter !== "trash" && expiredFiles.length > 0 && (
              <Notice icon={<AlertTriangle size={20} />} tone="danger">
                <span className="min-w-0 flex-1">
                  {expiredFiles.length} file
                  {expiredFiles.length === 1 ? " has" : "s have"} expired and
                  will be cleaned up soon.
                </span>
                <button onClick={deleteExpired} className="btn-text shrink-0">
                  Delete {expiredFiles.length} expired
                </button>
              </Notice>
            )}
            {filter !== "trash" && expiringSoon.length > 0 && (
              <Notice icon={<Clock size={20} />} tone="warn">
                <span className="min-w-0 flex-1">
                  {expiringSoon.length} file
                  {expiringSoon.length === 1 ? " expires" : "s expire"} in the
                  next 24 hours.
                </span>
                <button
                  onClick={extendAllExpiring}
                  className="btn-text shrink-0"
                >
                  Extend {expiringSoon.length} expiring
                </button>
              </Notice>
            )}
            {filter !== "trash" &&
              quotaBytes != null &&
              dismissedQuota !== quotaBytes && (
                <Notice icon={<Cloud size={20} />}>
                  <span className="min-w-0 flex-1">
                    Your upload limit is{" "}
                    <span className="font-medium text-strong">
                      {formatBytes(quotaBytes)}
                    </span>
                    . Need more? Request an increase.
                  </span>
                  <button
                    onClick={requestMoreLimit}
                    className="btn-text shrink-0"
                  >
                    Request more
                  </button>
                  <button
                    onClick={dismissStorageNotice}
                    aria-label="Dismiss storage notice"
                    className="icon-round !h-8 !w-8 shrink-0"
                  >
                    <X size={18} />
                  </button>
                </Notice>
              )}
            {!firstRunTipDismissed &&
              filesQuery.isSuccess &&
              liveFiles.length === 0 &&
              filter === "all" &&
              !currentFolder && (
                <div
                  className="flex items-start gap-3 rounded-xl bg-drift-50 px-4 py-3 text-sm text-strong"
                  data-ui="first-run-tip"
                >
                  <Lightbulb
                    size={20}
                    className="mt-0.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Welcome to Dropvault</p>
                    <p className="mt-0.5 text-muted">
                      {uploadsKeptForever
                        ? "Your uploads are kept forever by default. Pick an expiry from the Uploads chip above if you'd rather they disappear on their own."
                        : `Files you upload delete themselves after ${expiryDays} day${expiryDays === 1 ? "" : "s"}. Change that from the Uploads chip above before uploading, or later from a file's details.`}
                    </p>
                  </div>
                  <button
                    onClick={dismissFirstRunTip}
                    aria-label="Dismiss tip"
                    className="icon-round !h-8 !w-8 shrink-0"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
          </div>

          {showHomeExtras && showRecentStrip && (
            <div className="mt-4">
              <RecentStrip
                files={recentFiles}
                onOpen={(file) => setDetailFile(file)}
              />
            </div>
          )}

          <div className="mt-2">
            {nothingToShow ? (
              <EmptyState
                filter={filter}
                hasFiles={liveFiles.length > 0 || folders.length > 0}
                search={search}
                inFolder={!!currentFolder}
                foldersOnly={typeScope === "folders"}
                onClearSearch={() => setSearch("")}
                onUpload={() => uploadZoneRef.current?.openFilePicker()}
                onNewFolder={() => setDialog({ mode: "create" })}
              />
            ) : view === "list" ? (
              <div
                // A new location starts fresh instead of animating the old
                // rows out.
                key={`${filter}:${currentFolderId ?? "root"}`}
                {...selectionHandlers}
                className="file-selection-surface"
                data-ui="file-list"
              >
                <div
                  className="h-12 border-b border-slate-200 px-3 text-sm font-medium text-muted"
                  data-ui="file-list-header"
                >
                  <span />
                  <span>{sortHeader("name", "Name")}</span>
                  <span>Sharing</span>
                  <span>
                    {filter === "trash"
                      ? "Time left"
                      : sortHeader("expiring", "Expires")}
                  </span>
                  <span>{sortHeader("size", "Size")}</span>
                  <span>
                    <span className="sr-only">Actions</span>
                  </span>
                </div>
                {loadingFolders ? (
                  <FileListSkeleton count={2} />
                ) : (
                  <AnimatePresence initial={false}>
                    {visibleFolders.map((fd) => renderFolder(fd, "list"))}
                  </AnimatePresence>
                )}
                {showFilesSection &&
                  (loadingFiles ? (
                    <FileListSkeleton />
                  ) : (
                    <AnimatePresence initial={false}>
                      {pagedFiles.map((f) => renderFile(f, "list"))}
                    </AnimatePresence>
                  ))}
              </div>
            ) : (
              <div key={`${filter}:${currentFolderId ?? "root"}`}>
                {showFolderSection &&
                  (loadingFolders ? (
                    <section className="mb-6">
                      <h2 className="mb-3 px-1 text-sm font-medium text-strong">
                        Folders
                      </h2>
                      <FolderGridSkeleton />
                    </section>
                  ) : visibleFolders.length > 0 ? (
                    <section className="mb-6">
                      <h2 className="mb-3 px-1 text-sm font-medium text-strong">
                        Folders
                      </h2>
                      <motion.div
                        layout
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                      >
                        <AnimatePresence initial={false}>
                          {visibleFolders.map((fd) => renderFolder(fd, "grid"))}
                        </AnimatePresence>
                      </motion.div>
                    </section>
                  ) : null)}
                {showFilesSection &&
                  (loadingFiles ? (
                    <FileGridSkeleton />
                  ) : visible.length > 0 ? (
                    <section>
                      <h2 className="mb-3 px-1 text-sm font-medium text-strong">
                        Files
                      </h2>
                      <motion.div
                        layout
                        {...selectionHandlers}
                        data-ui="file-selection-grid"
                        className="file-selection-surface grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                      >
                        <AnimatePresence initial={false}>
                          {pagedFiles.map((f) => renderFile(f, "grid"))}
                        </AnimatePresence>
                      </motion.div>
                    </section>
                  ) : null)}
              </div>
            )}
            {hasMore && (
              <div ref={loadMoreRef} aria-hidden="true" className="h-12" />
            )}
            {hasMore && (
              <p className="mt-3 text-center text-xs text-muted">
                Showing {pagedFiles.length} of {sorted.length}
              </p>
            )}
          </div>

          {showHomeExtras && liveFiles.length > 0 && (
            <div className="mt-8">
              <StorageBreakdown files={liveFiles} />
            </div>
          )}
        </main>
      </div>
      <NewMenu {...newActions} variant="fab" />
      <UploadZone
        ref={uploadZoneRef}
        expiryDays={expiryDays}
        expiryOptions={EXPIRY_OPTIONS}
        onExpiryDaysChange={(days) => {
          setKeepUploadsForever(false);
          setExpiryDays(days);
        }}
        keepForever={keepUploadsForever}
        onKeepForeverChange={setKeepUploadsForever}
        onSummaryChange={setUploadSummary}
        onUploaded={invalidate}
        inputRef={uploadInputRef}
        folderId={currentFolderId}
        folderName={currentFolder?.name}
      />
      {selectionRect && selectionSelecting && (
        <div
          aria-hidden="true"
          data-ui="selection-rectangle"
          className="pointer-events-none fixed z-[55] rounded border border-primary bg-primary/10"
          style={selectionRect}
        />
      )}
      <AnimatePresence>
        {osDrag && filter !== "trash" && (
          <motion.div
            initial={overlayHidden}
            animate={overlayShown}
            exit={overlayHidden}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOsDrag(false);
              dragDepth.current = 0;
              void uploadZoneRef.current?.uploadDrop(e.dataTransfer);
            }}
            className="fixed inset-0 z-[80]"
            data-ui="drop-overlay"
          >
            <div className="pointer-events-none absolute inset-0 top-16 rounded-2xl border-2 border-primary bg-primary/10 md:bottom-4 md:left-64 md:right-4" />
            <div className="pointer-events-none absolute bottom-8 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-1 rounded-2xl bg-primary px-6 py-3 text-center text-on-primary drive-shadow-lg">
              <span className="flex items-center gap-2 text-sm">
                <UploadCloud size={20} aria-hidden="true" />
                Drop files to upload them to
              </span>
              <span className="flex items-center gap-2 text-base font-medium">
                <FolderIcon size={18} aria-hidden="true" className="fill-current" />
                {currentFolder ? currentFolder.name : "My Drive"}
              </span>
              <span className="text-xs opacity-90">{uploadLifetimeLabel}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ShareDialog
        key={shareFile?.id}
        file={shareFile}
        onClose={() => setShareFile(null)}
        onChanged={invalidate}
      />
      <FolderShareDialog
        key={shareFolderTarget?.id}
        folder={shareFolderTarget}
        onClose={() => setShareFolderTarget(null)}
        onChanged={invalidate}
      />
      <Suspense fallback={null}>
        {previewFile && (
          <PreviewModal
            file={previewFile}
            files={sorted}
            onNavigate={setPreviewFile}
            onClose={() => setPreviewFile(null)}
          />
        )}
      </Suspense>
      <DetailPanel
        file={detailFileLive}
        onClose={() => setDetailFile(null)}
        onShare={handleShare}
        onRevoke={(id) => revokeMut.mutate(id)}
        onPreview={(file) => setPreviewFile(file)}
        onToggleFavorite={(id) =>
          metaMut.mutate({ id, favorite: !detailFileLive?.favorite })
        }
        onEditTags={(id) => {
          const f = files.find((x) => x.id === id);
          if (f) editTags(f);
        }}
        onExtend={(id, days) => extendMut.mutate({ id, days })}
        onDelete={(id) => deleteMut.mutate(id)}
        canKeepForever={canKeepForever}
        onKeepForever={(id) => keepForeverMut.mutate(id)}
        onUnkeepForever={(id) => unkeepForeverMut.mutate(id)}
      />
      <FolderDetailPanel
        folder={detailFolder}
        onClose={() => setDetailFolderId(null)}
        onOpen={openFolder}
        onShare={handleShareFolder}
        onRevoke={(id) => revokeFolderMut.mutate(id)}
        onOpenShare={(id) =>
          setShareFolderTarget(folders.find((x) => x.id === id) ?? null)
        }
        onRename={(id) => {
          const f = folders.find((x) => x.id === id);
          if (f) setDialog({ mode: "rename", folderId: id, current: f.name });
        }}
        onDelete={deleteFolderConfirm}
        onSaveAutomation={async (id, input) => {
          try {
            await updateFolder(id, input);
            invalidate();
            toastOk("Folder automation saved");
          } catch (e) {
            toastErr(
              (e as Error)?.message || "Couldn't save folder automation",
            );
            throw e;
          }
        }}
      />
      <VersionsDialog
        file={versionsFile}
        onClose={() => setVersionsFile(null)}
      />
      <Suspense fallback={null}>
        {adminOpen && isAdmin && (
          <AdminPanel open={adminOpen} onClose={closeAdmin} />
        )}
        {securityOpen && (
          <AccountSecurityDialog
            open={securityOpen}
            onClose={() => setSecurityOpen(false)}
          />
        )}
        {teamsOpen && (
          <TeamsDialog open={teamsOpen} onClose={() => setTeamsOpen(false)} />
        )}
      </Suspense>
      <NameDialog
        open={dialog !== null}
        title={dialogTitle}
        initial={dialogInitial}
        confirmLabel={dialogConfirm}
        onCancel={() => setDialog(null)}
        onConfirm={onDialogConfirm}
      />
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        onConfirm={() => {
          confirmState?.onConfirm();
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />
      <TagsDialog
        open={tagsTarget !== null}
        initialTags={tagsTarget?.initial ?? []}
        onConfirm={(tags) => {
          if (tagsTarget?.bulk)
            runBulk(
              "tags",
              tagsTarget.ids,
              { tags },
              (n) => `Tags updated on ${n} file${n === 1 ? "" : "s"}`,
            );
          else tagsTarget?.ids.forEach((id) => metaMut.mutate({ id, tags }));
          setTagsTarget(null);
        }}
        onCancel={() => setTagsTarget(null)}
      />
      <LimitRequestDialog
        open={limitOpen}
        currentBytes={quotaBytes}
        onConfirm={submitLimitRequest}
        onCancel={() => setLimitOpen(false)}
      />
    </div>
  );
}
function Notice({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone?: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2 text-sm sm:flex-nowrap " +
        (tone === "danger"
          ? "bg-red-50 text-red-700"
          : tone === "warn"
            ? "bg-amber-50 text-amber-900"
            : "bg-slate-100 text-muted")
      }
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      {children}
    </div>
  );
}
function EmptyState({
  filter,
  hasFiles,
  search,
  inFolder,
  foldersOnly,
  onClearSearch,
  onUpload,
  onNewFolder,
}: {
  filter: Filter;
  hasFiles: boolean;
  search: string;
  inFolder: boolean;
  foldersOnly: boolean;
  onClearSearch: () => void;
  onUpload: () => void;
  onNewFolder: () => void;
}) {
  const searching = !!search.trim();
  const title = searching
    ? "No files match your search"
    : foldersOnly
      ? "No folders here"
      : inFolder
        ? "This folder is empty"
        : filter === "shared"
          ? "Nothing shared yet"
          : filter === "favorites"
            ? "No favorites yet"
            : filter === "trash"
              ? "Trash is empty"
              : filter === "expiring"
                ? "Nothing expiring soon"
                : hasFiles
                  ? "No files here"
                  : "Drop files here";
  const msg = searching
    ? "Try another name or tag."
    : foldersOnly
      ? "Create a folder to group related files."
      : inFolder
        ? "Drop files here, or use the New button to upload or add a subfolder."
        : filter === "shared"
          ? "Use a file or folder's menu to create a link."
          : filter === "favorites"
            ? "Star files to keep them handy."
            : filter === "trash"
              ? "Items moved to Trash show up here."
              : filter === "expiring"
                ? "Nothing expires in the next 24 hours."
                : hasFiles
                  ? "Files in folders appear when you open the folder."
                  : "Or use the New button to upload files and folders.";
  const canAdd =
    !searching && (filter === "all" || inFolder);
  const Icon = searching
    ? Search
    : filter === "trash"
      ? Trash2
      : filter === "favorites"
        ? Star
        : filter === "expiring"
          ? Clock
          : filter === "shared"
            ? Users
            : UploadCloud;
  return (
    <div
      className="flex flex-col items-center px-4 py-16 text-center"
      data-ui="empty-state"
    >
      <span className="grid h-24 w-24 place-items-center rounded-full bg-slate-100 text-primary">
        <Icon size={40} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-[22px] font-normal text-strong">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{msg}</p>
      {searching && (
        <button onClick={onClearSearch} className="btn-outlined mt-5">
          Clear search
        </button>
      )}
      {canAdd && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {!foldersOnly && (
            <button onClick={onUpload} className="btn-filled">
              <UploadCloud size={18} aria-hidden="true" /> Upload files
            </button>
          )}
          <button onClick={onNewFolder} className="btn-outlined">
            <FolderPlus size={18} aria-hidden="true" /> New folder
          </button>
        </div>
      )}
    </div>
  );
}
