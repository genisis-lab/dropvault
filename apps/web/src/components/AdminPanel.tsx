import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bell,
  Check,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Flag,
  HardDrive,
  Infinity,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  adminAccess,
  adminStats,
  adminUsers,
  adminUser,
  adminSetQuota,
  adminSuspendUser,
  adminUnsuspendUser,
  adminApproveUser,
  adminBulkUsers,
  adminFiles,
  adminRevokeFile,
  adminExtendFile,
  adminExpireFile,
  adminDeleteFile,
  adminRestoreFile,
  adminPermanentDeleteFile,
  adminBulkFiles,
  adminFlags,
  adminUpdateFlag,
  adminDeleteFlag,
  adminAdmins,
  adminAddAdmin,
  adminRemoveAdmin,
  adminIpBans,
  adminBanIp,
  adminUnbanIp,
  adminAudit,
  adminActivity,
  adminSettings,
  adminSaveSettings,
  listUploadRequests,
  createUploadRequest,
  revokeUploadRequest,
  shareUrl,
  listLimitRequests,
  approveLimitRequest,
  rejectLimitRequest,
  type ActivityEntry,
  type AdminFile,
  type AdminGrowthPoint,
  type AdminRole,
  type AdminSettings,
  type IpBanEntry,
} from "../lib/api";
import { formatBytes } from "../lib/format";
import { setUserKeepForever } from "../lib/keepForever";
import { useToast } from "./Toast";

type Tab =
  | "overview"
  | "users"
  | "files"
  | "flags"
  | "admins"
  | "settings"
  | "requests"
  | "limit-requests"
  | "activity"
  | "notifications";
type SortDir = "asc" | "desc";
type GrowthMetric = "files" | "bytes" | "users";
const DAY = 86400;
const GIB = 1024 * 1024 * 1024;
const ROLES: AdminRole[] = ["owner", "admin", "moderator", "viewer"];
const CAPABILITIES: { key: string; label: string; def: AdminRole }[] = [
  {
    key: "manageUsers",
    label: "Manage users (quota, suspend, approve)",
    def: "admin",
  },
  {
    key: "manageFiles",
    label: "Manage files (revoke, expire, delete)",
    def: "admin",
  },
  { key: "manageFlags", label: "Handle abuse reports", def: "moderator" },
];

function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function fmtDateTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>,
) {
  const blob = new Blob(
    [rows.map((r) => r.map(csvCell).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success: toastOk, error: toastErr } = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [userQuery, setUserQuery] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [fileQuery, setFileQuery] = useState("");
  const [fileFilter, setFileFilter] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [userSelected, setUserSelected] = useState<Set<string>>(new Set());
  const [fileSort, setFileSort] = useState<{ key: string; dir: SortDir }>({
    key: "created",
    dir: "desc",
  });
  const [userSort, setUserSort] = useState<{ key: string; dir: SortDir }>({
    key: "storage",
    dir: "desc",
  });
  const [flagStatus, setFlagStatus] = useState("open");
  const [limitFilter, setLimitFilter] = useState("all");
  const [growthMetric, setGrowthMetric] = useState<GrowthMetric>("files");
  const [newAdmin, setNewAdmin] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("admin");
  const [policyDraft, setPolicyDraft] = useState<AdminSettings | null>(null);
  const [requestDraft, setRequestDraft] = useState({
    title: "Upload files",
    instructions: "",
    password: "",
    maxFileSizeGb: "",
    allowedTypes: "",
    uploadLimit: "",
    requireEmail: true,
    expiresInDays: "7",
  });
  const [ipDraft, setIpDraft] = useState("");
  const [ipNote, setIpNote] = useState("");

  const accessQ = useQuery({
    queryKey: ["admin-access"],
    queryFn: adminAccess,
    enabled: open,
  });
  const role = accessQ.data?.role ?? null;
  const isOwner = role === "owner";
  const statsQ = useQuery({
    queryKey: ["admin-stats"],
    queryFn: adminStats,
    enabled: open,
  });
  const usersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: adminUsers,
    enabled: open && tab === "users",
  });
  const ipBansQ = useQuery({
    queryKey: ["admin-ip-bans"],
    queryFn: adminIpBans,
    enabled: open && tab === "users" && isOwner,
  });
  const filesQ = useQuery({
    queryKey: ["admin-files"],
    queryFn: adminFiles,
    enabled: open && tab === "files",
  });
  const flagsQ = useQuery({
    queryKey: ["admin-flags", flagStatus],
    queryFn: () => adminFlags(flagStatus === "all" ? undefined : flagStatus),
    enabled: open && tab === "flags",
  });
  const adminsQ = useQuery({
    queryKey: ["admin-admins"],
    queryFn: adminAdmins,
    enabled: open && tab === "admins",
  });
  const auditQ = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => adminAudit(200),
    enabled: open && tab === "activity",
  });
  const activityQ = useQuery({
    queryKey: ["admin-activity"],
    queryFn: () => adminActivity(200),
    enabled: open && tab === "activity",
  });
  const settingsQ = useQuery({
    queryKey: ["admin-settings"],
    queryFn: adminSettings,
    enabled: open && (tab === "settings" || tab === "notifications"),
  });
  const requestsQ = useQuery({
    queryKey: ["upload-requests"],
    queryFn: listUploadRequests,
    enabled: open && tab === "requests",
  });
  const limitRequestsQ = useQuery({
    queryKey: ["limit-requests"],
    queryFn: listLimitRequests,
    enabled: open && tab === "limit-requests",
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-user"] });
    qc.invalidateQueries({ queryKey: ["admin-ip-bans"] });
    qc.invalidateQueries({ queryKey: ["admin-files"] });
    qc.invalidateQueries({ queryKey: ["admin-flags"] });
    qc.invalidateQueries({ queryKey: ["admin-admins"] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
    qc.invalidateQueries({ queryKey: ["admin-activity"] });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
    qc.invalidateQueries({ queryKey: ["upload-requests"] });
    qc.invalidateQueries({ queryKey: ["limit-requests"] });
  }
  const busy =
    statsQ.isFetching ||
    usersQ.isFetching ||
    ipBansQ.isFetching ||
    filesQ.isFetching ||
    flagsQ.isFetching ||
    adminsQ.isFetching ||
    auditQ.isFetching ||
    activityQ.isFetching ||
    settingsQ.isFetching ||
    requestsQ.isFetching ||
    limitRequestsQ.isFetching;

  const onErr = (fallback: string) => (e: unknown) =>
    toastErr((e as Error)?.message || fallback);
  const revokeMut = useMutation({
    mutationFn: (id: string) => adminRevokeFile(id),
    onSuccess: () => {
      toastOk("Share link revoked");
      refresh();
    },
    onError: onErr("Couldn't revoke link"),
  });
  const extendMut = useMutation({
    mutationFn: (id: string) => adminExtendFile(id, 7),
    onSuccess: () => {
      toastOk("Extended by 7 days");
      refresh();
    },
    onError: onErr("Couldn't extend file"),
  });
  const expireMut = useMutation({
    mutationFn: (id: string) => adminExpireFile(id),
    onSuccess: () => {
      toastOk("File expired");
      refresh();
    },
    onError: onErr("Couldn't expire file"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFile(id),
    onSuccess: () => {
      toastOk("Moved to trash");
      refresh();
    },
    onError: onErr("Couldn't delete file"),
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) => adminRestoreFile(id),
    onSuccess: () => {
      toastOk("Restored");
      refresh();
    },
    onError: onErr("Couldn't restore file"),
  });
  const permanentMut = useMutation({
    mutationFn: (id: string) => adminPermanentDeleteFile(id),
    onSuccess: () => {
      toastOk("Permanently deleted");
      refresh();
    },
    onError: onErr("Couldn't permanently delete file"),
  });
  const bulkMut = useMutation({
    mutationFn: (v: {
      action:
        | "revoke"
        | "delete"
        | "expire"
        | "extend"
        | "restore"
        | "permanentDelete";
      ids: string[];
      days?: number;
    }) => adminBulkFiles(v.action, v.ids, v.days),
    onSuccess: (r) => {
      toastOk(`Updated ${r.count} file${r.count === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    },
    onError: onErr("Bulk action failed"),
  });
  const flagMut = useMutation({
    mutationFn: (v: {
      id: string;
      status?: string;
      note?: string;
      action?: string;
    }) => adminUpdateFlag(v.id, v),
    onSuccess: () => {
      toastOk("Flag updated");
      refresh();
    },
    onError: onErr("Couldn't update flag"),
  });
  const deleteFlagMut = useMutation({
    mutationFn: (id: string) => adminDeleteFlag(id),
    onSuccess: () => {
      toastOk("Flag deleted");
      refresh();
    },
    onError: onErr("Couldn't delete flag"),
  });
  const addAdminMut = useMutation({
    mutationFn: () => adminAddAdmin(newAdmin.trim(), newRole),
    onSuccess: () => {
      toastOk("Admin added");
      setNewAdmin("");
      refresh();
    },
    onError: onErr("Couldn't add admin"),
  });
  const removeAdminMut = useMutation({
    mutationFn: (email: string) => adminRemoveAdmin(email),
    onSuccess: () => {
      toastOk("Admin removed");
      refresh();
    },
    onError: onErr("Couldn't remove admin"),
  });
  const banIpMut = useMutation({
    mutationFn: (v: { ip: string; note?: string | null }) =>
      adminBanIp(v.ip, v.note ?? null),
    onSuccess: () => {
      toastOk("IP banned");
      setIpDraft("");
      setIpNote("");
      refresh();
    },
    onError: onErr("Couldn't ban IP"),
  });
  const unbanIpMut = useMutation({
    mutationFn: (ip: string) => adminUnbanIp(ip),
    onSuccess: () => {
      toastOk("IP ban removed");
      refresh();
    },
    onError: onErr("Couldn't remove IP ban"),
  });
  const saveSettingsMut = useMutation({
    mutationFn: (s: AdminSettings) => adminSaveSettings(s),
    onSuccess: () => {
      toastOk("Settings saved");
      setPolicyDraft(null);
      refresh();
    },
    onError: onErr("Couldn't save settings"),
  });
  const createReqMut = useMutation({
    mutationFn: () =>
      createUploadRequest({
        title: requestDraft.title,
        instructions: requestDraft.instructions || null,
        password: requestDraft.password || null,
        maxFileSize: requestDraft.maxFileSizeGb
          ? Math.round(Number(requestDraft.maxFileSizeGb) * GIB)
          : null,
        allowedTypes: requestDraft.allowedTypes,
        uploadLimit: requestDraft.uploadLimit
          ? Number(requestDraft.uploadLimit)
          : null,
        requireEmail: requestDraft.requireEmail,
        expiresInDays: requestDraft.expiresInDays
          ? Number(requestDraft.expiresInDays)
          : null,
      }),
    onSuccess: () => {
      toastOk("Upload request created");
      refresh();
    },
    onError: onErr("Couldn't create upload request"),
  });
  const revokeReqMut = useMutation({
    mutationFn: (id: string) => revokeUploadRequest(id),
    onSuccess: () => {
      toastOk("Request revoked");
      refresh();
    },
    onError: onErr("Couldn't revoke request"),
  });
  const suspendMut = useMutation({
    mutationFn: (id: string) =>
      adminSuspendUser(id, "Suspended from admin console"),
    onSuccess: () => {
      toastOk("User suspended");
      refresh();
    },
    onError: onErr("Couldn't suspend user"),
  });
  const unsuspendMut = useMutation({
    mutationFn: (id: string) => adminUnsuspendUser(id),
    onSuccess: () => {
      toastOk("User unsuspended");
      refresh();
    },
    onError: onErr("Couldn't unsuspend user"),
  });
  const approveUserMut = useMutation({
    mutationFn: (id: string) => adminApproveUser(id),
    onSuccess: () => {
      toastOk("User approved");
      refresh();
    },
    onError: onErr("Couldn't approve user"),
  });
  const forceRevokeMut = useMutation({
    mutationFn: (id: string) => adminBulkUsers("revokeLinks", [id]),
    onSuccess: () => {
      toastOk("Revoked all shares for user");
      refresh();
    },
    onError: onErr("Couldn't revoke shares"),
  });
  const bulkUserMut = useMutation({
    mutationFn: (v: { action: string; ids: string[] }) =>
      adminBulkUsers(v.action, v.ids),
    onSuccess: (r) => {
      toastOk(`Updated ${r.count} user${r.count === 1 ? "" : "s"}`);
      setUserSelected(new Set());
      refresh();
    },
    onError: onErr("Bulk action failed"),
  });
  const approveLimitMut = useMutation({
    mutationFn: (id: string) => approveLimitRequest(id),
    onSuccess: () => {
      toastOk("Limit request approved");
      refresh();
    },
    onError: onErr("Couldn't approve request"),
  });
  const rejectLimitMut = useMutation({
    mutationFn: (id: string) => rejectLimitRequest(id),
    onSuccess: () => {
      toastOk("Limit request rejected");
      refresh();
    },
    onError: onErr("Couldn't reject request"),
  });

  const now = Math.floor(Date.now() / 1000);
  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    let rows = [...(usersQ.data ?? [])];
    if (userFilter === "suspended")
      rows = rows.filter((u) => u.suspended && !u.pendingApproval);
    else if (userFilter === "pending")
      rows = rows.filter((u) => u.pendingApproval);
    else if (userFilter === "active") rows = rows.filter((u) => !u.suspended);
    if (q)
      rows = rows.filter((u) => {
        const ipHay =
          `${u.lastIp ?? ""} ${(u.recentIps ?? []).join(" ")}`.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          ipHay.includes(q)
        );
      });
    const dir = userSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) =>
      userSort.key === "name"
        ? a.name.localeCompare(b.name) * dir
        : userSort.key === "files"
          ? (a.fileCount - b.fileCount) * dir
          : userSort.key === "joined"
            ? (a.createdAt - b.createdAt) * dir
            : (a.totalBytes - b.totalBytes) * dir,
    );
    return rows;
  }, [usersQ.data, userQuery, userFilter, userSort]);
  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    let rows = [...(filesQ.data ?? [])];
    if (fileFilter === "shared") rows = rows.filter((f) => f.shared);
    else if (fileFilter === "expiring")
      rows = rows.filter(
        (f) => f.status === "ready" && f.expiresAt - now < DAY,
      );
    else if (fileFilter === "trash") rows = rows.filter((f) => !!f.deletedAt);
    if (q)
      rows = rows.filter(
        (f) =>
          f.filename.toLowerCase().includes(q) ||
          (f.ownerEmail ?? "").toLowerCase().includes(q) ||
          (f.tags ?? []).join(" ").toLowerCase().includes(q),
      );
    const dir = fileSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) =>
      fileSort.key === "name"
        ? a.filename.localeCompare(b.filename) * dir
        : fileSort.key === "size"
          ? (a.sizeBytes - b.sizeBytes) * dir
          : fileSort.key === "owner"
            ? (a.ownerEmail ?? "").localeCompare(b.ownerEmail ?? "") * dir
            : fileSort.key === "expires"
              ? (a.expiresAt - b.expiresAt) * dir
              : (a.createdAt - b.createdAt) * dir,
    );
    return rows;
  }, [filesQ.data, fileQuery, fileFilter, fileSort, now]);
  const filteredLimitRequests = useMemo(() => {
    const rows = limitRequestsQ.data ?? [];
    return limitFilter === "all"
      ? rows
      : rows.filter((r) => r.status === limitFilter);
  }, [limitRequestsQ.data, limitFilter]);
  const settings = policyDraft ?? settingsQ.data ?? {};
  const selIds = Array.from(selected);
  const userSelIds = Array.from(userSelected);
  const ipBanMap = useMemo(
    () => new Map((ipBansQ.data ?? []).map((ban) => [ban.ip, ban] as const)),
    [ipBansQ.data],
  );

  if (!open) return null;
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "files", label: "Files" },
    { id: "flags", label: "Flags" },
    { id: "admins", label: "Roles" },
    { id: "settings", label: "Policies" },
    { id: "requests", label: "Requests" },
    { id: "limit-requests", label: "Limit Requests" },
    { id: "activity", label: "Activity" },
    { id: "notifications", label: "Notifications" },
  ];
  const s = statsQ.data;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8">
      <button
        className="fixed inset-0 -z-10 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="mt-6 w-full max-w-5xl rounded-3xl border border-slate-200 bg-white drive-shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-drift-500/10 text-drift-600">
              <Shield size={18} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Admin console
              </h2>
              <p className="text-xs text-slate-500">
                Current role: <b>{role ? cap(role) : "Loading"}</b>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={busy}
              aria-label="Refresh"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
            >
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition " +
                (tab === t.id
                  ? "border-drift-500 text-drift-700"
                  : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              {t.label}
              {t.id === "flags" && s && s.flagCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {s.flagCount}
                </span>
              )}
              {t.id === "users" && s && (s.pendingApprovalCount ?? 0) > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {s.pendingApprovalCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === "overview" &&
            (statsQ.isLoading ? (
              <Loading />
            ) : s ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    icon={<Users size={16} />}
                    label="Users"
                    value={String(s.userCount)}
                  />
                  <Stat
                    icon={<FileText size={16} />}
                    label="Files"
                    value={String(s.fileCount)}
                  />
                  <Stat
                    icon={<HardDrive size={16} />}
                    label="Storage"
                    value={formatBytes(s.totalBytes)}
                  />
                  <Stat
                    icon={<Shield size={16} />}
                    label="Admins"
                    value={String(s.adminCount)}
                  />
                  <Stat
                    label="Pending"
                    value={String(s.pendingFileCount ?? 0)}
                  />
                  <Stat label="Trash" value={String(s.deletedFileCount ?? 0)} />
                  <Stat
                    icon={<Flag size={16} />}
                    label="Open flags"
                    value={String(s.flagCount)}
                  />
                  <Stat
                    label="Awaiting approval"
                    value={String(s.pendingApprovalCount ?? 0)}
                  />
                </div>
                <Alerts alerts={s.alerts ?? []} />
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Trend (last 30 days)
                    </h3>
                    <div className="flex gap-1">
                      {(["files", "bytes", "users"] as GrowthMetric[]).map(
                        (m) => (
                          <button
                            key={m}
                            onClick={() => setGrowthMetric(m)}
                            className={
                              "rounded-lg px-2 py-1 text-xs font-medium " +
                              (growthMetric === m
                                ? "bg-drift-500/10 text-drift-700"
                                : "text-slate-500 hover:bg-slate-100")
                            }
                          >
                            {m === "bytes" ? "Storage" : cap(m)}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <GrowthChart data={s.growth ?? []} metric={growthMetric} />
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <MiniBars
                    title="Storage by type"
                    rows={(s.typeBreakdown ?? []).map((x) => ({
                      label: cap(x.category),
                      value: x.bytes,
                      note: `${formatBytes(x.bytes)} · ${x.count}`,
                    }))}
                  />
                  <MiniBars
                    title="Top users by storage"
                    rows={(s.topUsers ?? []).map((x) => ({
                      label: x.email ?? x.name,
                      value: x.totalBytes,
                      note: `${formatBytes(x.totalBytes)} · ${x.fileCount}`,
                    }))}
                  />
                </div>
              </div>
            ) : (
              <Empty label="No stats." />
            ))}

          {tab === "users" &&
            (selectedUserId ? (
              <UserDetail
                id={selectedUserId}
                isOwner={isOwner}
                bannedIps={ipBansQ.data ?? []}
                onBack={() => setSelectedUserId(null)}
                onChanged={refresh}
                onSuspend={(id) => suspendMut.mutate(id)}
                onUnsuspend={(id) => unsuspendMut.mutate(id)}
                onApprove={(id) => approveUserMut.mutate(id)}
                onForceRevoke={(id) => forceRevokeMut.mutate(id)}
                onBanIp={(ip, note) => banIpMut.mutate({ ip, note })}
                onUnbanIp={(ip) => unbanIpMut.mutate(ip)}
              />
            ) : usersQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <SearchBox
                      value={userQuery}
                      onChange={setUserQuery}
                      placeholder={
                        isOwner ? "Search users, email, or IP" : "Search users"
                      }
                    />
                  </div>
                  <select
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending approval</option>
                    <option value="suspended">Suspended</option>
                  </select>
                  <button
                    onClick={() =>
                      downloadCsv("dropvault-users.csv", [
                        [
                          "Name",
                          "Email",
                          "Files",
                          "Bytes",
                          "Quota",
                          "Role",
                          "State",
                          ...(isOwner ? ["Last IP"] : []),
                        ],
                        ...filteredUsers.map((u) => [
                          u.name,
                          u.email,
                          u.fileCount,
                          u.totalBytes,
                          u.quotaBytes ?? "",
                          u.role ?? "",
                          u.pendingApproval
                            ? "pending"
                            : u.suspended
                              ? "suspended"
                              : "active",
                          ...(isOwner ? [u.lastIp ?? ""] : []),
                        ]),
                      ])
                    }
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Export
                  </button>
                </div>
                {userSelected.size > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-drift-200 bg-drift-50 px-3 py-2 text-sm">
                    <b className="text-drift-700">
                      {userSelected.size} selected
                    </b>
                    <button
                      onClick={() =>
                        bulkUserMut.mutate({
                          action: "approve",
                          ids: userSelIds,
                        })
                      }
                      className="pill"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() =>
                        bulkUserMut.mutate({
                          action: "revokeLinks",
                          ids: userSelIds,
                        })
                      }
                      className="pill"
                    >
                      Revoke shares
                    </button>
                    <button
                      onClick={() =>
                        window.confirm(
                          "Expire all files for the selected users?",
                        ) &&
                        bulkUserMut.mutate({
                          action: "expireFiles",
                          ids: userSelIds,
                        })
                      }
                      className="pill-danger"
                    >
                      Expire files
                    </button>
                    <button
                      onClick={() => setUserSelected(new Set())}
                      className="text-slate-400"
                    >
                      Clear
                    </button>
                  </div>
                )}
                {isOwner && (
                  <div className="mt-3 rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[10rem] flex-1">
                        <input
                          value={ipDraft}
                          onChange={(e) => setIpDraft(e.target.value)}
                          placeholder="IP to ban"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400"
                        />
                      </div>
                      <div className="min-w-[12rem] flex-[1.4]">
                        <input
                          value={ipNote}
                          onChange={(e) => setIpNote(e.target.value)}
                          placeholder="Optional note"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400"
                        />
                      </div>
                      <button
                        onClick={() =>
                          ipDraft.trim() &&
                          banIpMut.mutate({
                            ip: ipDraft.trim(),
                            note: ipNote.trim() || null,
                          })
                        }
                        disabled={banIpMut.isPending || !ipDraft.trim()}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Ban IP
                      </button>
                    </div>
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Current bans
                      </h4>
                      {(ipBansQ.data ?? []).length === 0 ? (
                        <p className="mt-2 text-sm text-slate-400">
                          No IP bans configured.
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-col gap-2">
                          {(ipBansQ.data ?? []).map((ban) => (
                            <div
                              key={ban.ip}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <code className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                                    {ban.ip}
                                  </code>
                                  {ban.note && (
                                    <span className="truncate text-sm text-slate-600">
                                      {ban.note}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400">
                                  {fmtDateTime(ban.createdAt)}
                                  {ban.createdBy ? ` · ${ban.createdBy}` : ""}
                                </div>
                              </div>
                              <button
                                onClick={() => unbanIpMut.mutate(ban.ip)}
                                className="mini-danger"
                              >
                                Unban
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={
                              filteredUsers.length > 0 &&
                              userSelected.size === filteredUsers.length
                            }
                            onChange={() =>
                              setUserSelected(
                                userSelected.size === filteredUsers.length
                                  ? new Set()
                                  : new Set(filteredUsers.map((u) => u.id)),
                              )
                            }
                          />
                        </th>
                        <SortTh
                          label="User"
                          k="name"
                          sort={userSort}
                          setSort={setUserSort}
                        />
                        <SortTh
                          label="Files"
                          k="files"
                          sort={userSort}
                          setSort={setUserSort}
                        />
                        <SortTh
                          label="Storage"
                          k="storage"
                          sort={userSort}
                          setSort={setUserSort}
                        />
                        {isOwner && <th className="px-3 py-2">Last IP</th>}
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2">State</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => (
                        <tr
                          key={u.id}
                          onClick={() => setSelectedUserId(u.id)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td
                            className="px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={userSelected.has(u.id)}
                              onChange={() =>
                                setUserSelected((p) => {
                                  const n = new Set(p);
                                  n.has(u.id) ? n.delete(u.id) : n.add(u.id);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-slate-700">
                              {u.name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {u.email}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {u.fileCount}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {formatBytes(u.totalBytes)}
                          </td>
                          {isOwner && (
                            <td className="px-3 py-2.5 text-slate-500">
                              {u.lastIp ? (
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                                  {u.lastIp}
                                </code>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <RolePill role={u.role ?? null} />
                          </td>
                          <td className="px-3 py-2.5">
                            {u.pendingApproval ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                Pending
                              </span>
                            ) : u.suspended ? (
                              <span className="text-slate-500">Suspended</span>
                            ) : (
                              <span className="text-slate-500">Active</span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {u.pendingApproval && (
                                <button
                                  onClick={() => approveUserMut.mutate(u.id)}
                                  className="mini-good"
                                >
                                  Approve
                                </button>
                              )}
                              <button
                                onClick={() =>
                                  window.confirm(
                                    `Revoke all share links for ${u.email}?`,
                                  ) && forceRevokeMut.mutate(u.id)
                                }
                                className="mini"
                              >
                                Revoke shares
                              </button>
                              {isOwner &&
                                u.lastIp &&
                                !ipBanMap.has(u.lastIp) && (
                                  <button
                                    onClick={() =>
                                      banIpMut.mutate({
                                        ip: u.lastIp!,
                                        note: `Banned from ${u.email}`,
                                      })
                                    }
                                    className="mini-danger"
                                  >
                                    Ban IP
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredUsers.length === 0 && (
                    <Empty label="No matching users." />
                  )}
                </div>
              </div>
            ))}

          {tab === "files" &&
            (filesQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <SearchBox
                      value={fileQuery}
                      onChange={setFileQuery}
                      placeholder="Search files, owners, or tags"
                    />
                  </div>
                  <select
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="shared">Shared</option>
                    <option value="expiring">Expiring</option>
                    <option value="trash">Trash</option>
                  </select>
                  <button
                    onClick={() =>
                      downloadCsv("dropvault-files.csv", [
                        [
                          "Filename",
                          "Owner",
                          "Bytes",
                          "Status",
                          "Shared",
                          "Tags",
                          "Deleted",
                        ],
                        ...filteredFiles.map((f) => [
                          f.filename,
                          f.ownerEmail ?? f.ownerId,
                          f.sizeBytes,
                          f.status,
                          f.shared ? "yes" : "no",
                          (f.tags ?? []).join(";"),
                          f.deletedAt ? "yes" : "no",
                        ]),
                      ])
                    }
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Export
                  </button>
                </div>
                {selected.size > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-drift-200 bg-drift-50 px-3 py-2 text-sm">
                    <b className="text-drift-700">{selected.size} selected</b>
                    <button
                      onClick={() =>
                        bulkMut.mutate({
                          action: "extend",
                          ids: selIds,
                          days: 7,
                        })
                      }
                      className="pill"
                    >
                      Extend
                    </button>
                    <button
                      onClick={() =>
                        bulkMut.mutate({ action: "revoke", ids: selIds })
                      }
                      className="pill"
                    >
                      Revoke
                    </button>
                    <button
                      onClick={() =>
                        bulkMut.mutate({ action: "expire", ids: selIds })
                      }
                      className="pill"
                    >
                      Expire
                    </button>
                    <button
                      onClick={() =>
                        bulkMut.mutate({ action: "restore", ids: selIds })
                      }
                      className="pill"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() =>
                        bulkMut.mutate({ action: "delete", ids: selIds })
                      }
                      className="pill-danger"
                    >
                      Trash
                    </button>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-slate-400"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={
                              selected.size > 0 &&
                              selected.size === filteredFiles.length
                            }
                            onChange={() =>
                              setSelected(
                                selected.size === filteredFiles.length
                                  ? new Set()
                                  : new Set(filteredFiles.map((f) => f.id)),
                              )
                            }
                          />
                        </th>
                        <SortTh
                          label="File"
                          k="name"
                          sort={fileSort}
                          setSort={setFileSort}
                        />
                        <SortTh
                          label="Owner"
                          k="owner"
                          sort={fileSort}
                          setSort={setFileSort}
                        />
                        <SortTh
                          label="Size"
                          k="size"
                          sort={fileSort}
                          setSort={setFileSort}
                        />
                        <SortTh
                          label="Expires"
                          k="expires"
                          sort={fileSort}
                          setSort={setFileSort}
                        />
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFiles.map((f) => (
                        <FileRow
                          key={f.id}
                          file={f}
                          selected={selected.has(f.id)}
                          onToggle={() =>
                            setSelected((p) => {
                              const n = new Set(p);
                              n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                              return n;
                            })
                          }
                          onRevoke={() => revokeMut.mutate(f.id)}
                          onExtend={() => extendMut.mutate(f.id)}
                          onExpire={() => expireMut.mutate(f.id)}
                          onDelete={() => deleteMut.mutate(f.id)}
                          onRestore={() => restoreMut.mutate(f.id)}
                          onPermanent={() =>
                            window.confirm("Permanently delete this file?") &&
                            permanentMut.mutate(f.id)
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                  {filteredFiles.length === 0 && (
                    <Empty label="No matching files." />
                  )}
                </div>
              </div>
            ))}

          {tab === "flags" &&
            (flagsQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <div className="flex items-center gap-1">
                  {[
                    "open",
                    "investigating",
                    "resolved",
                    "dismissed",
                    "all",
                  ].map((st) => (
                    <button
                      key={st}
                      onClick={() => setFlagStatus(st)}
                      className={
                        "rounded-lg px-3 py-1.5 text-sm font-medium " +
                        (flagStatus === st
                          ? "bg-drift-500/10 text-drift-700"
                          : "text-slate-500 hover:bg-slate-100")
                      }
                    >
                      {cap(st)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {(flagsQ.data ?? []).map((fl) => (
                    <div
                      key={fl.id}
                      className="rounded-xl border border-slate-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <Flag size={14} className="text-red-500" />
                            <span className="truncate">
                              {fl.filename ?? "(file removed)"}
                            </span>
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                              {fl.status}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
                            {fl.reason}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {fl.reporterEmail ? fl.reporterEmail + " · " : ""}
                            {fmtDateTime(fl.createdAt)}
                            {fl.ownerEmail ? " · owner " + fl.ownerEmail : ""}
                          </p>
                          {fl.adminNote && (
                            <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-500">
                              Note: {fl.adminNote}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {fl.token && (
                            <a
                              href={shareUrl(fl.token)}
                              target="_blank"
                              rel="noopener"
                              className="icon-btn"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          <button
                            onClick={() =>
                              flagMut.mutate({
                                id: fl.id,
                                status: "investigating",
                              })
                            }
                            className="mini"
                          >
                            Investigate
                          </button>
                          <button
                            onClick={() =>
                              flagMut.mutate({ id: fl.id, status: "resolved" })
                            }
                            className="mini-good"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() =>
                              flagMut.mutate({
                                id: fl.id,
                                action: "revoke",
                                status: "resolved",
                                note: "Share link revoked from flag.",
                              })
                            }
                            className="mini"
                          >
                            Revoke
                          </button>
                          <button
                            onClick={() =>
                              flagMut.mutate({
                                id: fl.id,
                                action: "delete",
                                status: "resolved",
                                note: "File moved to trash from flag.",
                              })
                            }
                            className="mini-danger"
                          >
                            Trash file
                          </button>
                          <button
                            onClick={() => deleteFlagMut.mutate(fl.id)}
                            className="icon-danger"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(flagsQ.data ?? []).length === 0 && (
                    <Empty label="No reports here." />
                  )}
                </div>
              </div>
            ))}

          {tab === "admins" &&
            (adminsQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newAdmin.trim()) addAdminMut.mutate();
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    type="email"
                    value={newAdmin}
                    onChange={(e) => setNewAdmin(e.target.value)}
                    placeholder="new.admin@example.com"
                    className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400"
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as AdminRole)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {cap(r)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={
                      !isOwner || addAdminMut.isPending || !newAdmin.trim()
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-drift-500 px-3 py-2 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
                  >
                    <Plus size={15} /> Add role
                  </button>
                </form>
                {!isOwner && (
                  <p className="mt-2 text-xs text-amber-600">
                    Only Owners can manage admin roles.
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {(adminsQ.data ?? []).map((a) => (
                    <div
                      key={a.email}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <span>{a.email}</span>
                          <RolePill
                            role={
                              a.role ?? (a.source === "env" ? "owner" : null)
                            }
                          />
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                            {a.source === "env" ? "Config" : "DB"}
                          </span>
                        </div>
                        {a.createdAt && (
                          <div className="text-xs text-slate-400">
                            {a.addedBy ? "by " + a.addedBy + " · " : ""}
                            {fmtDate(a.createdAt)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeAdminMut.mutate(a.email)}
                        disabled={
                          !isOwner ||
                          a.source === "env" ||
                          removeAdminMut.isPending
                        }
                        className="icon-danger disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          {tab === "settings" &&
            (settingsQ.isLoading ? (
              <Loading />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <PolicyInput
                    label="Default expiry days"
                    k="defaultExpiryDays"
                    settings={settings}
                    setSettings={setPolicyDraft}
                  />
                  <PolicyInput
                    label="Max expiry days"
                    k="maxExpiryDays"
                    settings={settings}
                    setSettings={setPolicyDraft}
                  />
                  <PolicyInput
                    label="Max upload bytes"
                    k="maxUploadBytes"
                    settings={settings}
                    setSettings={setPolicyDraft}
                  />
                  <GbPolicyInput
                    label="Default quota (GB)"
                    k="defaultQuotaBytes"
                    settings={settings}
                    setSettings={setPolicyDraft}
                    hint="New users get this much space unless given a custom quota. Stored as bytes."
                  />
                  <PolicyInput
                    label="Allowed file types"
                    k="allowedTypes"
                    settings={settings}
                    setSettings={setPolicyDraft}
                    hint="Comma-separated, e.g. image/*,application/pdf"
                  />
                  <PolicyInput
                    label="Trash retention (days)"
                    k="trashRetentionDays"
                    settings={settings}
                    setSettings={setPolicyDraft}
                    hint="Trashed files are permanently purged after this many days. Default 30."
                  />
                  <TogglePolicy
                    label="Require passwords for public links"
                    k="requirePasswordForShares"
                    settings={settings}
                    setSettings={setPolicyDraft}
                  />
                  <TogglePolicy
                    label="Public sharing enabled"
                    k="publicSharingEnabled"
                    settings={settings}
                    setSettings={setPolicyDraft}
                  />
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={settings.signupMode === "approval"}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...settings,
                          signupMode: e.target.checked ? "approval" : "open",
                        })
                      }
                    />{" "}
                    <span>
                      Invite-only signups — require admin approval before new
                      accounts can be used
                    </span>
                  </label>
                </div>
                <RolePermsEditor
                  settings={settings}
                  setSettings={setPolicyDraft}
                  isOwner={isOwner}
                />
                <div>
                  <button
                    onClick={() => saveSettingsMut.mutate(settings)}
                    disabled={!isOwner || saveSettingsMut.isPending}
                    className="rounded-lg bg-drift-500 px-4 py-2 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
                  >
                    Save policies
                  </button>
                  {!isOwner && (
                    <span className="ml-2 text-xs text-amber-600">
                      Owner only
                    </span>
                  )}
                </div>
              </div>
            ))}

          {tab === "requests" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-800">
                  Create upload request link
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    value={requestDraft.title}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        title: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Title"
                  />
                  <input
                    value={requestDraft.password}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        password: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Password optional"
                  />
                  <input
                    value={requestDraft.maxFileSizeGb}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        maxFileSizeGb: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Max file size GB"
                  />
                  <input
                    value={requestDraft.allowedTypes}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        allowedTypes: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Allowed types"
                  />
                  <input
                    value={requestDraft.uploadLimit}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        uploadLimit: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Upload limit"
                  />
                  <input
                    value={requestDraft.expiresInDays}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        expiresInDays: e.target.value,
                      })
                    }
                    className="input"
                    placeholder="Expires in days"
                  />
                  <textarea
                    value={requestDraft.instructions}
                    onChange={(e) =>
                      setRequestDraft({
                        ...requestDraft,
                        instructions: e.target.value,
                      })
                    }
                    className="input sm:col-span-2"
                    placeholder="Instructions"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={requestDraft.requireEmail}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          requireEmail: e.target.checked,
                        })
                      }
                    />{" "}
                    Require uploader email
                  </label>
                </div>
                <button
                  onClick={() => createReqMut.mutate()}
                  disabled={createReqMut.isPending}
                  className="mt-3 rounded-lg bg-drift-500 px-4 py-2 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
                >
                  Create request
                </button>
              </div>
              {requestsQ.isLoading ? (
                <Loading />
              ) : (
                <div className="space-y-2">
                  {(requestsQ.data ?? []).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700">
                          {r.title}
                        </div>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener"
                          className="truncate text-xs text-drift-600 hover:underline"
                        >
                          {r.url}
                        </a>
                        <div className="text-xs text-slate-400">
                          {r.uploadCount}
                          {r.uploadLimit ? " / " + r.uploadLimit : ""} uploads ·{" "}
                          {r.revokedAt
                            ? "revoked"
                            : r.expiresAt
                              ? "expires " + fmtDate(r.expiresAt)
                              : "no expiry"}
                        </div>
                      </div>
                      <button
                        onClick={() => revokeReqMut.mutate(r.id)}
                        disabled={!!r.revokedAt}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "limit-requests" &&
            (limitRequestsQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-slate-600">
                    Users requesting larger upload/storage limits. Approving
                    sets their quota to the requested size.
                  </div>
                  <select
                    value={limitFilter}
                    onChange={(e) => setLimitFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div className="mt-3 space-y-2">
                  {filteredLimitRequests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-slate-200 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-slate-700">
                            {r.userEmail ?? r.userId} ·{" "}
                            {formatBytes(r.requestedBytes)}
                          </div>
                          <div className="text-xs text-slate-400">
                            {r.reason ?? "No reason"} ·{" "}
                            {fmtDateTime(r.createdAt)} ·{" "}
                            <span
                              className={
                                r.status === "pending"
                                  ? "text-amber-600"
                                  : r.status === "approved"
                                    ? "text-emerald-600"
                                    : "text-slate-500"
                              }
                            >
                              {r.status}
                            </span>
                            {r.approvedBy ? " · by " + r.approvedBy : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {r.status === "pending" && (
                            <>
                              <button
                                onClick={() => approveLimitMut.mutate(r.id)}
                                className="mini-good"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => rejectLimitMut.mutate(r.id)}
                                className="mini-danger"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredLimitRequests.length === 0 && (
                    <Empty label="No requests here." />
                  )}
                </div>
              </div>
            ))}

          {tab === "activity" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <ActivityTable title="Admin audit" rows={auditQ.data ?? []} />
              <ActivityTable
                title="User activity"
                rows={activityQ.data ?? []}
              />
            </div>
          )}
          {tab === "notifications" &&
            (settingsQ.isLoading ? (
              <Loading />
            ) : (
              <NotificationsForm
                settings={settings}
                setSettings={setPolicyDraft}
                onSave={() => saveSettingsMut.mutate(settings)}
                saving={saveSettingsMut.isPending}
                isOwner={isOwner}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function UserDetail({
  id,
  isOwner,
  bannedIps,
  onBack,
  onChanged,
  onSuspend,
  onUnsuspend,
  onApprove,
  onForceRevoke,
  onBanIp,
  onUnbanIp,
}: {
  id: string;
  isOwner: boolean;
  bannedIps: IpBanEntry[];
  onBack: () => void;
  onChanged: () => void;
  onSuspend: (id: string) => void;
  onUnsuspend: (id: string) => void;
  onApprove: (id: string) => void;
  onForceRevoke: (id: string) => void;
  onBanIp: (ip: string, note?: string | null) => void;
  onUnbanIp: (ip: string) => void;
}) {
  const { success: toastOk, error: toastErr } = useToast();
  const q = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => adminUser(id),
  });
  const [gb, setGb] = useState("");
  const quotaMut = useMutation({
    mutationFn: (bytes: number | null) => adminSetQuota(id, bytes),
    onSuccess: () => {
      toastOk("Quota updated");
      setGb("");
      q.refetch();
      onChanged();
    },
    onError: (e: unknown) =>
      toastErr((e as Error)?.message || "Couldn't update quota"),
  });
  const keepForeverMut = useMutation({
    mutationFn: (allowed: boolean) => setUserKeepForever(id, allowed),
    onSuccess: (r) => {
      toastOk(
        r.keepFilesForever
          ? "Keep-forever permission granted"
          : "Keep-forever permission removed",
      );
      q.refetch();
      onChanged();
    },
    onError: (e: unknown) =>
      toastErr(
        (e as Error)?.message || "Couldn't update keep-forever permission",
      ),
  });
  const bannedSet = new Set(bannedIps.map((ban) => ban.ip));
  const keepByRole = q.data
    ? ["owner", "admin", "moderator"].includes(q.data.user.role ?? "")
    : false;
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft size={15} /> Back to users
      </button>
      {q.isLoading ? (
        <Loading />
      ) : q.data ? (
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {q.data.user.name}
            </h3>
            <p className="text-sm text-slate-500">{q.data.user.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              Joined {fmtDate(q.data.user.createdAt)} · {q.data.user.fileCount}{" "}
              files · {formatBytes(q.data.user.totalBytes)}
              {q.data.user.pendingApproval
                ? " · awaiting approval"
                : q.data.user.suspended
                  ? " · suspended"
                  : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.data.user.pendingApproval && (
                <button
                  onClick={() => {
                    onApprove(id);
                    q.refetch();
                  }}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
                >
                  Approve
                </button>
              )}
              <button
                onClick={() => {
                  q.data?.user.suspended ? onUnsuspend(id) : onSuspend(id);
                  q.refetch();
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {q.data.user.suspended ? "Unsuspend" : "Suspend"}
              </button>
              <button
                onClick={() =>
                  window.confirm("Revoke all share links for this user?") &&
                  onForceRevoke(id)
                }
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Revoke all shares
              </button>
              <RolePill role={q.data.user.role ?? null} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Storage quota
            </h4>
            <p className="mt-1 text-sm text-slate-600">
              Current:{" "}
              {q.data.user.quotaBytes == null
                ? "Unlimited"
                : formatBytes(q.data.user.quotaBytes)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                value={gb}
                onChange={(e) => setGb(e.target.value)}
                placeholder="Limit in GB"
                className="w-32 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-drift-400"
              />
              <button
                onClick={() => {
                  const n = parseFloat(gb);
                  if (!isNaN(n) && n >= 0) quotaMut.mutate(Math.round(n * GIB));
                }}
                disabled={quotaMut.isPending || !gb}
                className="rounded-lg bg-drift-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
              >
                Set quota
              </button>
              <button
                onClick={() => quotaMut.mutate(null)}
                disabled={quotaMut.isPending || q.data.user.quotaBytes == null}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Infinity size={13} /> Keep files forever
                </h4>
                <p className="mt-1 text-sm text-slate-600">
                  {keepByRole
                    ? "Enabled automatically for this role — owners, admins, and moderators can always keep files forever."
                    : q.data.user.keepFilesForeverGranted
                      ? "Granted. This user can upload files with no expiry date."
                      : "This user's uploads expire normally. Grant permission to let them keep files forever without sending a request."}
                </p>
              </div>
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                  (q.data.user.keepFilesForever
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500")
                }
              >
                {q.data.user.keepFilesForever ? "On" : "Off"}
              </span>
            </div>
            {keepByRole ? (
              <p className="mt-2 text-xs text-slate-400">
                Role-based access can't be turned off here. Change the user's
                role under Roles to adjust it.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {q.data.user.keepFilesForeverGranted ? (
                  <button
                    onClick={() => keepForeverMut.mutate(false)}
                    disabled={keepForeverMut.isPending}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove permission
                  </button>
                ) : (
                  <button
                    onClick={() => keepForeverMut.mutate(true)}
                    disabled={keepForeverMut.isPending}
                    className="rounded-lg bg-drift-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
                  >
                    Grant permission
                  </button>
                )}
              </div>
            )}
          </div>
          {isOwner && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recent IPs
              </h4>
              {(q.data.user.recentIps ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  No IP activity recorded for this user yet.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {(q.data.user.recentIps ?? []).map((ip) => (
                    <div
                      key={ip}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-white px-2 py-0.5 text-xs text-slate-700">
                            {ip}
                          </code>
                          {q.data.user.lastIp === ip && (
                            <span className="rounded-full bg-drift-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-drift-700">
                              Latest
                            </span>
                          )}
                          {bannedSet.has(ip) && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                              Banned
                            </span>
                          )}
                        </div>
                      </div>
                      {bannedSet.has(ip) ? (
                        <button onClick={() => onUnbanIp(ip)} className="mini">
                          Unban
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            onBanIp(ip, `Banned from ${q.data.user.email}`)
                          }
                          className="mini-danger"
                        >
                          Ban IP
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <ActivityTable title="Recent activity" rows={q.data.activity ?? []} />
        </div>
      ) : (
        <Empty label="User not found." />
      )}
    </div>
  );
}

function FileRow({
  file,
  selected,
  onToggle,
  onRevoke,
  onExtend,
  onExpire,
  onDelete,
  onRestore,
  onPermanent,
}: {
  file: AdminFile;
  selected: boolean;
  onToggle: () => void;
  onRevoke: () => void;
  onExtend: () => void;
  onExpire: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanent: () => void;
}) {
  return (
    <tr className={selected ? "bg-drift-500/5" : ""}>
      <td className="px-3 py-2.5">
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td className="max-w-[16rem] px-3 py-2.5">
        <div
          className="truncate font-medium text-slate-700"
          title={file.filename}
        >
          {file.favorite ? "★ " : ""}
          {file.filename}
        </div>
        <div className="text-xs text-slate-400">
          {file.status}
          {file.shared ? " · shared" : ""}
          {file.deletedAt ? " · trash" : ""}
          {file.tags?.length ? " · " + file.tags.join(", ") : ""}
        </div>
      </td>
      <td className="px-3 py-2.5 text-slate-500">
        {file.ownerEmail ?? file.ownerId}
      </td>
      <td className="px-3 py-2.5 text-slate-600">
        {formatBytes(file.sizeBytes)}
      </td>
      <td className="px-3 py-2.5 text-slate-500">{fmtDate(file.expiresAt)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {file.shareToken && (
            <a
              href={shareUrl(file.shareToken)}
              target="_blank"
              rel="noopener"
              className="icon-btn"
            >
              <ExternalLink size={15} />
            </a>
          )}
          <button onClick={onExtend} className="icon-btn">
            <Clock size={15} />
          </button>
          <button onClick={onExpire} className="icon-btn">
            <Ban size={15} />
          </button>
          <button
            onClick={onRevoke}
            disabled={!file.shared}
            className="icon-btn disabled:opacity-30"
          >
            <Link2 size={15} />
          </button>
          {file.deletedAt ? (
            <button onClick={onRestore} className="mini-good">
              Restore
            </button>
          ) : (
            <button onClick={onDelete} className="icon-danger">
              <Trash2 size={15} />
            </button>
          )}
          <button onClick={onPermanent} className="mini-danger">
            Purge
          </button>
        </div>
      </td>
    </tr>
  );
}
function Alerts({
  alerts,
}: {
  alerts: Array<{ id: string; label: string; count: number; level: string }>;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Alerts
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {alerts.map((a) => (
          <div
            key={a.id}
            className={
              "rounded-xl border px-3 py-2 text-sm " +
              (a.level === "high"
                ? "border-red-200 bg-red-50 text-red-700"
                : a.level === "medium"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-white text-slate-600")
            }
          >
            <b>{a.count}</b> {a.label}
          </div>
        ))}
      </div>
    </div>
  );
}
function ActivityTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<
    | ActivityEntry
    | {
        id: string;
        actorEmail?: string | null;
        action: string;
        targetType?: string | null;
        targetId?: string | null;
        detail?: string | null;
        createdAt: number;
      }
  >;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2.5 text-slate-500">
                  {fmtDateTime(r.createdAt)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {r.action}
                  </span>
                  <div className="text-xs text-slate-400">
                    {r.actorEmail ?? r.detail ?? r.targetId ?? "—"}
                  </div>
                  {"ip" in r && r.ip && (
                    <div className="mt-1 text-[11px] text-slate-400">
                      IP {r.ip}
                      {"userAgent" in r && r.userAgent
                        ? ` · ${r.userAgent}`
                        : ""}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty label="No activity yet." />}
      </div>
    </div>
  );
}
function PolicyInput({
  label,
  k,
  settings,
  setSettings,
  hint,
}: {
  label: string;
  k: string;
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        value={settings[k] ?? ""}
        onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-drift-400"
      />
      {hint && (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
    </label>
  );
}
function GbPolicyInput({
  label,
  k,
  settings,
  setSettings,
  hint,
}: {
  label: string;
  k: string;
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
  hint?: string;
}) {
  const raw = settings[k] ?? "";
  const n = Number(raw);
  const gb =
    raw !== "" && Number.isFinite(n) ? String(+(n / GIB).toFixed(3)) : "";
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        type="number"
        min="0"
        step="0.5"
        value={gb}
        onChange={(e) => {
          const v = e.target.value;
          setSettings({
            ...settings,
            [k]: v === "" ? "" : String(Math.round(Number(v) * GIB)),
          });
        }}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-drift-400"
      />
      {hint && (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
    </label>
  );
}
function TogglePolicy({
  label,
  k,
  settings,
  setSettings,
}: {
  label: string;
  k: string;
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
}) {
  const checked = settings[k] === "true";
  return (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) =>
          setSettings({ ...settings, [k]: String(e.target.checked) })
        }
      />{" "}
      {label}
    </label>
  );
}
function RolePermsEditor({
  settings,
  setSettings,
  isOwner,
}: {
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
  isOwner: boolean;
}) {
  let parsed: Record<string, string> = {};
  try {
    parsed = settings.rolePermissions
      ? JSON.parse(settings.rolePermissions)
      : {};
  } catch {
    parsed = {};
  }
  const setCap = (key: string, value: string) => {
    const next = { ...parsed, [key]: value };
    setSettings({ ...settings, rolePermissions: JSON.stringify(next) });
  };
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <h3 className="text-sm font-bold text-slate-800">
        Granular role permissions
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Choose the minimum role required for each capability. Owners and admins
        always retain full control of settings and roles.
        {!isOwner && " Only the owner can change these."}
      </p>
      <div className="mt-3 space-y-2">
        {CAPABILITIES.map((c) => (
          <div
            key={c.key}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
          >
            <span className="text-sm text-slate-700">{c.label}</span>
            <select
              disabled={!isOwner}
              value={parsed[c.key] ?? c.def}
              onChange={(e) => setCap(c.key, e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 disabled:opacity-60"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {cap(r)} and up
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
function NotificationsForm({
  settings,
  setSettings,
  onSave,
  saving,
  isOwner,
}: {
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
  onSave: () => void;
  saving: boolean;
  isOwner: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-drift-200 bg-drift-50 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-drift-500/10 text-drift-600">
          <Bell size={18} />
        </span>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
          <p className="mt-1 text-sm text-slate-600">
            Send a webhook POST (JSON: event, message, at) when the events below
            happen. Signup and limit-request events are delivered automatically
            when enabled.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PolicyInput
          label="Notification webhook URL"
          k="notifyWebhookUrl"
          settings={settings}
          setSettings={setSettings}
          hint="e.g. a Slack/Discord incoming webhook or your own endpoint."
        />
        <PolicyInput
          label="Notification email (for reference)"
          k="notifyEmail"
          settings={settings}
          setSettings={setSettings}
          hint="Stored for your records; delivery uses the webhook."
        />
        <TogglePolicy
          label="Notify on new abuse flag"
          k="notifyOnFlag"
          settings={settings}
          setSettings={setSettings}
        />
        <TogglePolicy
          label="Notify on new signup"
          k="notifyOnSignup"
          settings={settings}
          setSettings={setSettings}
        />
        <TogglePolicy
          label="Notify on upload-limit request"
          k="notifyOnLimitRequest"
          settings={settings}
          setSettings={setSettings}
        />
      </div>
      <div>
        <button
          onClick={onSave}
          disabled={!isOwner || saving}
          className="rounded-lg bg-drift-500 px-4 py-2 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
        >
          Save notifications
        </button>
        {!isOwner && (
          <span className="ml-2 text-xs text-amber-600">Owner only</span>
        )}
      </div>
    </div>
  );
}
function RolePill({ role }: { role: AdminRole | null }) {
  if (!role) return null;
  return (
    <span
      className={
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
        (role === "owner"
          ? "bg-purple-100 text-purple-700"
          : role === "admin"
            ? "bg-drift-500/10 text-drift-600"
            : "bg-slate-100 text-slate-600")
      }
    >
      {role}
    </span>
  );
}
function MiniBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; note: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {rows.length === 0 ? (
        <Empty label="No data yet." />
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="truncate font-medium text-slate-600">
                  {r.label}
                </span>
                <span className="shrink-0 text-slate-400">{r.note}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-drift-400"
                  style={widthStyle((r.value / max) * 100)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function SortTh({
  label,
  k,
  sort,
  setSort,
}: {
  label: string;
  k: string;
  sort: { key: string; dir: SortDir };
  setSort: (v: { key: string; dir: SortDir }) => void;
}) {
  const active = sort.key === k;
  return (
    <th className="px-3 py-2">
      <button
        onClick={() =>
          setSort({
            key: k,
            dir: active && sort.dir === "asc" ? "desc" : "asc",
          })
        }
        className="flex items-center gap-1 uppercase tracking-wide hover:text-slate-600"
      >
        {label}
        {active && (
          <span className="text-[10px]">{sort.dir === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    </th>
  );
}
function GrowthChart({
  data,
  metric,
}: {
  data: AdminGrowthPoint[];
  metric: GrowthMetric;
}) {
  const points = data ?? [];
  if (points.length === 0) return <Empty label="No activity yet." />;
  const valueOf = (p: AdminGrowthPoint) =>
    metric === "bytes" ? p.bytes : metric === "users" ? p.users : p.files;
  const max = Math.max(1, ...points.map(valueOf));
  const label = (p: AdminGrowthPoint) =>
    metric === "bytes" ? formatBytes(valueOf(p)) : String(valueOf(p));
  return (
    <div>
      <div className="flex h-28 items-end gap-1">
        {points.map((p) => (
          <div
            key={p.date}
            className="flex-1 rounded-t bg-drift-400"
            style={heightStyle((valueOf(p) / max) * 100)}
            title={`${p.date}: ${label(p)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}
function heightStyle(pct: number): React.CSSProperties {
  return { height: `${Math.max(3, Math.min(100, pct))}%` };
}
function widthStyle(pct: number): React.CSSProperties {
  return { width: `${Math.max(2, Math.min(100, pct))}%` };
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-drift-400"
      />
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-800">{value}</div>
    </div>
  );
}
function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" /> Loading...
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <p className="py-10 text-center text-sm text-slate-400">{label}</p>;
}
