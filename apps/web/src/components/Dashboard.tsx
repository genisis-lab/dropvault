import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Clock,
  Download,
  FolderInput,
  FolderPlus,
  HardDrive,
  Infinity as InfinityIcon,
  RotateCcw,
  Star,
  Tags,
  Trash2,
  UploadCloud,
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
  presign,
  complete,
  uploadToR2,
  uploadUrlFor,
  uploadLargeFile,
  MULTIPART_THRESHOLD,
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
import { useLayout } from "../lib/layout";
import { readSort, writeSort, readView, writeView } from "../lib/prefs";
import { downloadFilesAsZip } from "../lib/zip";
import { downloadDecryptedFile } from "../lib/encryption";
import Sidebar, { type Filter } from "./Sidebar";
import Topbar, { type ViewMode } from "./Topbar";
import UploadZone from "./UploadZone";
import FileCard from "./FileCard";
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
const barInitial = { opacity: 0, y: 24, x: "-50%" };
const barAnimate = { opacity: 1, y: 0, x: "-50%" };
const barExit = { opacity: 0, y: 24, x: "-50%" };
const popInitial = { opacity: 0, scale: 0.95, y: 8 };
const popAnimate = { opacity: 1, scale: 1, y: 0 };
const overlayHidden = { opacity: 0 };
const overlayShown = { opacity: 1 };
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
  const [view, setViewState] = useState<ViewMode>(() => readView());
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
  const [shareFile, setShareFile] = useState<DriftFile | null>(null);
  const [shareFolderTarget, setShareFolderTarget] = useState<Folder | null>(
    null,
  );
  const [previewFile, setPreviewFile] = useState<DriftFile | null>(null);
  const [detailFile, setDetailFile] = useState<DriftFile | null>(null);
  const [detailFolderId, setDetailFolderId] = useState<string | null>(null);
  const [versionsFile, setVersionsFile] = useState<DriftFile | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [osDrag, setOsDrag] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
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
    onSuccess: () => {
      invalidate();
      toastOk("Moved to Trash");
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
  ) {
    if (ids.length === 0) return;
    try {
      const res = await bulkMut.mutateAsync({ action, ids, opts });
      if (okMsg) toastOk(okMsg(res.count));
    } catch (e) {
      toastErr((e as Error)?.message || "Couldn't complete that action");
    } finally {
      invalidate();
      clearSelection();
    }
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
  async function uploadDropped(fileList: FileList) {
    const arr = Array.from(fileList);
    if (arr.length === 0 || filter === "trash") return;
    toastOk(`Uploading ${arr.length} file${arr.length === 1 ? "" : "s"}…`);
    for (const file of arr) {
      try {
        const { id } = await presign({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          expiryDays,
          folderId: currentFolderId,
        });
        if (file.size > MULTIPART_THRESHOLD)
          await uploadLargeFile(id, file, () => {});
        else {
          await uploadToR2(uploadUrlFor(id), file, () => {});
          await complete(id);
        }
      } catch (e) {
        toastErr((e as Error)?.message || `Couldn't upload ${file.name}`);
      }
    }
    invalidate();
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
  const detailFolder = folders.find((f) => f.id === detailFolderId) ?? null;
  const atRoot = currentFolderId === null;
  const calmHome = layout === "calm" && atRoot && filter === "all";
  function clearSelection() {
    setSelected(new Set());
    setMoveBarOpen(false);
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
        if (filter === "expiring" && f.expiresAt - now >= DAY) return false;
        if (filter === "trash") return true;
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
      onConfirm: () =>
        runBulk(
          "trash",
          expiredFiles.map((f) => f.id),
          undefined,
          (n) => `${n} file${n === 1 ? "" : "s"} moved to Trash`,
        ),
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
        ? folders.filter(
            (fd) =>
              (fd.parentId ?? null) === currentFolderId &&
              (!q || fd.name.toLowerCase().includes(q)),
          )
        : [],
    [folders, q, showFolderSection, currentFolderId],
  );
  const folderOptions = useMemo(
    () => folders.map((f) => ({ id: f.id, name: f.name })),
    [folders],
  );
  const firstName = userName ? userName.split(" ")[0] : "";
  const heading = calmHome
    ? firstName
      ? `Welcome back, ${firstName}`
      : "Welcome to Dropvault"
    : currentFolder
      ? currentFolder.name
      : titleFor(filter);
  const itemCount = visible.length + visibleFolders.length;
  const subtitle = `${itemCount} item${itemCount === 1 ? "" : "s"}${userName ? ` · ${userName.split(" ")[0]}'s vault` : ""}`;
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
    const msg =
      f && f.fileCount > 0
        ? `Delete “${f.name}”? Its ${f.fileCount} file${f.fileCount === 1 ? "" : "s"} will move back to the parent folder (not deleted).`
        : "Delete this folder?";
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
      onConfirm: () =>
        runBulk(
          "trash",
          Array.from(selected),
          undefined,
          (n) => `${n} file${n === 1 ? "" : "s"} moved to Trash`,
        ),
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
  return (
    <div>
      <Sidebar
        onNew={() => uploadInputRef.current?.click()}
        onNewFolder={() => setDialog({ mode: "create" })}
        totalBytes={totalBytes}
        fileCount={liveFiles.length}
        sharedCount={sharedCount}
        filter={filter}
        setFilter={setFilter}
        isAdmin={isAdmin}
        onOpenAdmin={() => setAdminOpen(true)}
        onSignOut={() => signOut()}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
        onRequestMore={requestMoreLimit}
        quotaBytes={quotaBytes}
      />
      <div className="md:pl-60">
        <Topbar
          search={search}
          setSearch={setSearch}
          view={view}
          setView={setView}
          userEmail={userEmail}
          onNew={() => uploadInputRef.current?.click()}
          onSignOut={() => signOut()}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSecurity={() => setSecurityOpen(true)}
          onOpenTeams={() => setTeamsOpen(true)}
        />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              {currentFolder && (
                <button
                  onClick={goToRoot}
                  className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-drift-600"
                >
                  <span>My Drive</span>
                  <ChevronRight size={14} />
                  <span className="font-medium text-slate-700">
                    {currentFolder.name}
                  </span>
                </button>
              )}
              <h1 className="truncate text-xl font-bold text-slate-800 sm:text-2xl">
                {heading}
              </h1>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {filter === "trash" && trashFiles.length > 0 && (
                <button
                  onClick={emptyTrash}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-medium text-red-700 transition hover:bg-red-100"
                >
                  <Trash2 size={16} /> Empty Trash
                </button>
              )}
              {filter !== "trash" && expiredFiles.length > 0 && (
                <button
                  onClick={deleteExpired}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 font-medium text-red-700 transition hover:bg-red-100"
                >
                  <Trash2 size={16} /> Delete {expiredFiles.length} expired
                </button>
              )}
              {expiringSoon.length > 0 && filter !== "trash" && (
                <button
                  onClick={extendAllExpiring}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-700 transition hover:bg-amber-100"
                >
                  <Clock size={16} /> Extend {expiringSoon.length} expiring
                </button>
              )}
              <button
                onClick={() => setDialog({ mode: "create" })}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-drift-300 hover:text-drift-600"
              >
                <FolderPlus size={16} /> New folder
              </button>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort files"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 outline-none transition focus:border-drift-400"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="hidden text-slate-400 sm:inline">Expire in</span>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 outline-none transition focus:border-drift-400"
              >
                {EXPIRY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} day{d === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {filter !== "trash" && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {scopeOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setTypeScope(o.value)}
                  className={
                    "rounded-full border px-3.5 py-1.5 text-sm font-medium transition " +
                    (typeScope === o.value
                      ? "border-drift-300 bg-drift-500/10 text-drift-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-drift-300 hover:text-drift-600")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {filter !== "trash" &&
            quotaBytes != null &&
            dismissedQuota !== quotaBytes && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-drift-200 bg-drift-50/70 px-3 py-2">
                <p className="min-w-0 text-xs text-slate-600">
                  Your upload limit is{" "}
                  <span className="font-semibold text-slate-800">
                    {formatBytes(quotaBytes)}
                  </span>
                  . Need more? Request an increase from the menu.
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={requestMoreLimit}
                    className="rounded-lg border border-drift-200 bg-white px-2.5 py-1 text-xs font-medium text-drift-600 transition hover:bg-drift-50"
                  >
                    Request more
                  </button>
                  <button
                    onClick={dismissStorageNotice}
                    aria-label="Dismiss storage notice"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-600"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}
          {filter !== "trash" && (
            <UploadZone
              expiryDays={expiryDays}
              onUploaded={invalidate}
              inputRef={uploadInputRef}
              folderId={currentFolderId}
              folderName={currentFolder?.name}
            />
          )}
          {calmHome && !q && typeScope === "all" && recentFiles.length > 0 && (
            <div className="mt-6">
              <RecentStrip
                files={recentFiles}
                onOpen={(file) => setDetailFile(file)}
              />
            </div>
          )}
          {calmHome && !q && typeScope === "all" && liveFiles.length > 0 && (
            <div className="mt-6">
              <StorageBreakdown files={liveFiles} />
            </div>
          )}
          {showFolderSection &&
            (foldersQuery.isLoading ? (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Folders
                </h2>
                <FolderGridSkeleton />
              </div>
            ) : visibleFolders.length > 0 ? (
              <div className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Folders
                </h2>
                <motion.div
                  layout
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <AnimatePresence mode="popLayout">
                    {visibleFolders.map((fd) => (
                      <FolderCard
                        key={fd.id}
                        folder={fd}
                        view="grid"
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
                          setShareFolderTarget(
                            folders.find((x) => x.id === id) ?? null,
                          )
                        }
                        onOpenDetails={(id) => setDetailFolderId(id)}
                        onDropFiles={(folderId, ids) => moveIds(ids, folderId)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            ) : null)}
          {showFilesSection && (
            <div className="mt-6">
              {showFolderSection && visibleFolders.length > 0 && (
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Files
                </h2>
              )}
              {filesQuery.isLoading ||
              (filter === "trash" && trashQuery.isLoading) ? (
                view === "grid" ? (
                  <FileGridSkeleton />
                ) : (
                  <FileListSkeleton />
                )
              ) : visible.length === 0 ? (
                <EmptyState
                  filter={filter}
                  hasFiles={liveFiles.length > 0 || folders.length > 0}
                  search={search}
                  inFolder={!!currentFolder}
                />
              ) : view === "grid" ? (
                <motion.div
                  layout
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
                >
                  <AnimatePresence mode="popLayout">
                    {pagedFiles.map((f) => (
                      <FileCard
                        key={f.id}
                        file={f}
                        view="grid"
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
                        onMove={(id, folderId) =>
                          moveMut.mutate({ id, folderId })
                        }
                        onOpenShare={(id) =>
                          setShareFile(files.find((x) => x.id === id) ?? null)
                        }
                        onPreview={(file) => setPreviewFile(file)}
                        onOpenDetails={calmDetails}
                        onOpenVersions={(file) => setVersionsFile(file)}
                        onToggleFavorite={(id) =>
                          metaMut.mutate({ id, favorite: !f.favorite })
                        }
                        onEditTags={() => editTags(f)}
                        onRestore={(id) => restoreMut.mutate(id)}
                        onPermanentDelete={(id) =>
                          ask({
                            title: "Delete forever",
                            message:
                              "Permanently delete this file? This can't be undone.",
                            danger: true,
                            confirmLabel: "Delete forever",
                            onConfirm: () => permanentMut.mutate(id),
                          })
                        }
                        canKeepForever={canKeepForever}
                        onKeepForever={(id) => keepForeverMut.mutate(id)}
                        onUnkeepForever={(id) => unkeepForeverMut.mutate(id)}
                        selected={selected.has(f.id)}
                        onToggleSelect={toggleSelect}
                        anySelected={selCount > 0}
                        getDragIds={getDragIds}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white drive-shadow">
                  <AnimatePresence mode="popLayout">
                    {pagedFiles.map((f) => (
                      <FileCard
                        key={f.id}
                        file={f}
                        view="list"
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
                        onMove={(id, folderId) =>
                          moveMut.mutate({ id, folderId })
                        }
                        onOpenShare={(id) =>
                          setShareFile(files.find((x) => x.id === id) ?? null)
                        }
                        onPreview={(file) => setPreviewFile(file)}
                        onOpenDetails={calmDetails}
                        onOpenVersions={(file) => setVersionsFile(file)}
                        onToggleFavorite={(id) =>
                          metaMut.mutate({ id, favorite: !f.favorite })
                        }
                        onEditTags={() => editTags(f)}
                        onRestore={(id) => restoreMut.mutate(id)}
                        onPermanentDelete={(id) =>
                          ask({
                            title: "Delete forever",
                            message:
                              "Permanently delete this file? This can't be undone.",
                            danger: true,
                            confirmLabel: "Delete forever",
                            onConfirm: () => permanentMut.mutate(id),
                          })
                        }
                        canKeepForever={canKeepForever}
                        onKeepForever={(id) => keepForeverMut.mutate(id)}
                        onUnkeepForever={(id) => unkeepForeverMut.mutate(id)}
                        selected={selected.has(f.id)}
                        onToggleSelect={toggleSelect}
                        anySelected={selCount > 0}
                        getDragIds={getDragIds}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
              {hasMore && (
                <div ref={loadMoreRef} aria-hidden="true" className="h-12" />
              )}
              {hasMore && (
                <p className="mt-3 text-center text-xs text-slate-400">
                  Showing {pagedFiles.length} of {sorted.length}
                </p>
              )}
            </div>
          )}
        </main>
      </div>
      <AnimatePresence>
        {selCount > 0 && (
          <motion.div
            initial={barInitial}
            animate={barAnimate}
            exit={barExit}
            className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 drive-shadow-lg"
          >
            <span className="whitespace-nowrap px-1.5 text-sm font-semibold text-slate-700">
              {selCount}
              <span className="hidden sm:inline"> selected</span>
            </span>
            <div className="mx-0.5 h-6 w-px bg-slate-200" />
            {filter !== "trash" && (
              <div className="relative">
                <button
                  onClick={() => setMoveBarOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
                >
                  <FolderInput size={16} />
                  <span className="hidden sm:inline">Move</span>
                </button>
                <AnimatePresence>
                  {moveBarOpen && (
                    <>
                      <button
                        className="fixed inset-0 z-40 cursor-default"
                        aria-label="Close"
                        onClick={() => setMoveBarOpen(false)}
                      />
                      <motion.div
                        initial={popInitial}
                        animate={popAnimate}
                        exit={popInitial}
                        className="absolute bottom-12 left-0 z-50 max-h-64 w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm drive-shadow-lg"
                      >
                        <button
                          onClick={() => bulkMove(null)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-slate-700 hover:bg-slate-50"
                        >
                          Remove from folder
                        </button>
                        <div className="my-1 h-px bg-slate-100" />
                        {folders.map((fd) => (
                          <button
                            key={fd.id}
                            onClick={() => bulkMove(fd.id)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                          >
                            <FolderInput
                              size={15}
                              className="shrink-0 text-amber-500"
                            />
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
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
            >
              <Download size={16} />
              <span className="hidden sm:inline">
                {selCount > 1 ? "Download ZIP" : "Download"}
              </span>
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
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
              >
                <RotateCcw size={16} />
                <span className="hidden sm:inline">Restore</span>
              </button>
            ) : (
              <button
                onClick={bulkDelete}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 sm:px-3"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Trash</span>
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
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
            >
              <Star size={16} />
              <span className="hidden sm:inline">Favorite</span>
            </button>
            {canKeepForever && filter !== "trash" && (
              <button
                onClick={() => bulkKeepForeverMut.mutate(Array.from(selected))}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-drift-600 hover:bg-drift-50 sm:px-3"
              >
                <InfinityIcon size={16} />
                <span className="hidden sm:inline">Keep forever</span>
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
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
            >
              <Tags size={16} />
              <span className="hidden sm:inline">Tags</span>
            </button>
            <div className="mx-0.5 h-6 w-px bg-slate-200" />
            <button
              onClick={clearSelection}
              aria-label="Clear selection"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
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
              uploadDropped(e.dataTransfer.files);
            }}
            className="fixed inset-0 z-[80] grid place-items-center bg-drift-600/20 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-drift-400 bg-white/90 px-10 py-8 text-center drive-shadow-lg">
              <UploadCloud size={36} className="text-drift-600" />
              <p className="text-base font-semibold text-slate-800">
                {currentFolder
                  ? `Drop to upload into “${currentFolder.name}”`
                  : "Drop to upload to your vault"}
              </p>
              <p className="text-sm text-slate-500">
                Files expire in {expiryDays} day{expiryDays === 1 ? "" : "s"}
              </p>
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
        {adminOpen && (
          <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
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
function EmptyState({
  filter,
  hasFiles,
  search,
  inFolder,
}: {
  filter: Filter;
  hasFiles: boolean;
  search: string;
  inFolder: boolean;
}) {
  const msg = search.trim()
    ? "No files match your search."
    : inFolder
      ? "This folder is empty — drop files above, or create a subfolder."
      : filter === "shared"
        ? "No shared files yet — use a file or folder's menu to create a link."
        : filter === "favorites"
          ? "No favorites yet — star files to keep them handy."
          : filter === "trash"
            ? "Trash is empty."
            : filter === "expiring"
              ? "Nothing expires in the next 24 hours."
              : hasFiles
                ? "No files here."
                : "Your vault is empty — drop files above to get started.";
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center text-sm text-slate-400">
      <HardDrive size={28} className="mb-2 text-slate-300" />
      {msg}
    </div>
  );
}
