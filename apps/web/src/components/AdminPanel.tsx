import AdminOperations, { PolicyImpact, UserSupport } from "./AdminOperations";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Flag,
  HardDrive,
  Infinity,
  Link2,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Users,
  X,
  ArrowLeft,
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
  adminResendVerification,
  adminTestWebhook,
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
  adminFlagContentUrl,
  adminFilePreviewUrl,
  adminFileDownloadUrl,
  adminBanFlagHash,
  adminHashBans,
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
  adminPolicyHistory,
  adminRollbackPolicy,
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
  type PolicyVersion,
  type IpBanEntry,
} from "../lib/api";
import { formatBytes } from "../lib/format";
import { setUserKeepForever } from "../lib/keepForever";
import { useToast } from "./Toast";
import { useConfirm, useTypedConfirmation } from "./Dialog";
import { useSession } from "../lib/auth-client";
import {
  ADMIN_HASH_PREFIX,
  adminSectionFromHash,
  urlWithoutHash,
} from "../lib/adminRoute";
import { activityLabel, browserSummary } from "../lib/activityFormat";
import { announceWorkspaceDefaultTheme } from "../lib/theme";
import {
  isTheme,
  resolveTheme,
  THEME_OPTIONS,
  type Theme,
} from "../lib/theme-config";
import {
  changedPolicySettings,
  policySettingChanges,
} from "../lib/policy-settings";
import { useEscapeToClose } from "../lib/useEscapeToClose";

type Tab =
  | "operations"
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
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  operations: "Operations",
  activity: "Activity",
  users: "Users",
  admins: "Roles",
  "limit-requests": "Limit Requests",
  files: "Files",
  flags: "Flags",
  requests: "Requests",
  settings: "Policies",
  notifications: "Notifications",
};
// Grouped so the eleven sections stay findable and never scroll off-screen.
const TAB_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: "System", tabs: ["overview", "operations", "activity"] },
  { label: "People", tabs: ["users", "admins", "limit-requests"] },
  { label: "Content", tabs: ["files", "flags", "requests"] },
  { label: "Settings", tabs: ["settings", "notifications"] },
];
function allowedTabs(role: string | null | undefined, canOperate: boolean): Tab[] {
  const all = TAB_GROUPS.flatMap((group) => group.tabs);
  if (canOperate) return all;
  if (role === "auditor")
    return all.filter((id) =>
      ["flags", "settings", "activity", "operations"].includes(id),
    );
  return all.filter((id) => ["flags", "settings"].includes(id));
}
// The open admin section lives in the URL (#admin/users) so reloads,
// bookmarks and shared links land on the same section.
function tabFromHash(): Tab | null {
  if (typeof window === "undefined") return null;
  const id = adminSectionFromHash(window.location.hash);
  return id && id in TAB_LABELS ? (id as Tab) : null;
}
type SortDir = "asc" | "desc";
type GrowthMetric = "files" | "bytes" | "users";
const DAY = 86400;
const GIB = 1024 * 1024 * 1024;
const ROLES: AdminRole[] = ["owner", "admin", "moderator", "auditor"];
const SECURITY_POLICY_KEYS = new Set([
  "defaultExpiryDays",
  "maxExpiryDays",
  "maxUploadBytes",
  "allowedTypes",
  "defaultQuotaBytes",
  "adminMaxQuotaBytes",
  "requirePasswordForShares",
  "publicSharingEnabled",
  "signupMode",
  "trashRetentionDays",
  "rolePermissions",
]);
function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
// Keep-forever files are stored with the API's FOREVER_EXPIRES_AT
// (9999-12-31), which would otherwise display as "Dec 31, 9999".
const FOREVER_EXPIRES_AT = 253402300799;
function fmtExpiry(sec: number): string {
  return sec >= FOREVER_EXPIRES_AT ? "Never" : fmtDate(sec);
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

function adminFileContentAvailable(file: AdminFile): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (
    file.encryptionMode !== "aes-gcm" &&
    file.adminContentAccessible !== false &&
    (file.status === "ready" || file.status === "quarantined") &&
    file.deletedAt == null &&
    (!file.releaseAt || file.releaseAt <= now) &&
    file.expiresAt > now
  );
}

export default function AdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  useEscapeToClose(open, onClose);
  const { success: toastOk, error: toastErr } = useToast();
  const [confirmUi, confirm] = useConfirm();
  const [typedConfirmUi, ownerConfirmation] = useTypedConfirmation();
  const { data: session } = useSession();
  const myEmail = session?.user?.email?.toLowerCase() ?? null;
  const [tab, setTabState] = useState<Tab>(() => tabFromHash() ?? "overview");
  // Follow #admin/<section> changes made elsewhere (e.g. a notification link)
  // while the console is already open.
  useEffect(() => {
    const sync = () => {
      const next = tabFromHash();
      if (next) setTabState(next);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function setTab(next: Tab) {
    setTabState(next);
    window.history.replaceState(
      null,
      "",
      `${urlWithoutHash(window.location)}${ADMIN_HASH_PREFIX}/${next}`,
    );
  }
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
  const [activitySearch, setActivitySearch] = useState("");
  const [activityAction, setActivityAction] = useState("");
  const [activityRange, setActivityRange] = useState("7");
  const [limitFilter, setLimitFilter] = useState("all");
  const [growthMetric, setGrowthMetric] = useState<GrowthMetric>("files");
  const [newAdmin, setNewAdmin] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("admin");
  const [policyDraft, setPolicyDraft] = useState<AdminSettings | null>(null);
  const [policyReview, setPolicyReview] = useState<{
    mode: "save" | "rollback";
    settings: AdminSettings;
    version?: PolicyVersion;
  } | null>(null);
  useEscapeToClose(!!policyReview, () => setPolicyReview(null));
  const [impactReady, setImpactReady] = useState(false);
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
  const canOperate = role === "owner" || role === "admin";
  const canModerate = canOperate || role === "moderator";
  useEffect(() => {
    const allowed =
      role === "auditor"
        ? ["flags", "settings", "activity", "operations"]
        : role === "moderator"
          ? ["flags", "settings"]
          : null;
    if (allowed && !allowed.includes(tab)) setTab("flags");
  }, [role, tab]);
  const statsQ = useQuery({
    queryKey: ["admin-stats"],
    queryFn: adminStats,
    enabled: open && canOperate,
  });
  const usersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: adminUsers,
    enabled: open && tab === "users" && canOperate,
  });
  const ipBansQ = useQuery({
    queryKey: ["admin-ip-bans"],
    queryFn: adminIpBans,
    enabled: open && tab === "users" && isOwner,
  });
  const filesQ = useQuery({
    queryKey: ["admin-files"],
    queryFn: adminFiles,
    enabled: open && tab === "files" && canOperate,
  });
  const flagsQ = useQuery({
    queryKey: ["admin-flags", flagStatus],
    queryFn: () => adminFlags(flagStatus === "all" ? undefined : flagStatus),
    enabled: open && tab === "flags",
  });
  const hashBansQ = useQuery({
    queryKey: ["admin-hash-bans"],
    queryFn: adminHashBans,
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
  const activityActions = useMemo(
    () =>
      Array.from(
        new Set(
          [...(auditQ.data ?? []), ...(activityQ.data ?? [])].map(
            (row) => row.action,
          ),
        ),
      ).sort((a, b) => activityLabel(a).localeCompare(activityLabel(b))),
    [auditQ.data, activityQ.data],
  );
  function filterActivity<T extends ActivityRow>(rows: T[]): T[] {
    const q = activitySearch.trim().toLowerCase();
    const since = activityRange
      ? Math.floor(Date.now() / 1000) - Number(activityRange) * DAY
      : 0;
    return rows.filter((row) => {
      if (row.createdAt < since) return false;
      if (activityAction && row.action !== activityAction) return false;
      if (!q) return true;
      return [
        row.actorEmail,
        row.detail,
        row.targetId,
        "ip" in row ? row.ip : null,
        activityLabel(row.action),
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }
  const settingsQ = useQuery({
    queryKey: ["admin-settings"],
    queryFn: adminSettings,
    enabled: open && (tab === "settings" || tab === "notifications"),
  });
  const policyHistoryQ = useQuery({
    queryKey: ["admin-policy-history"],
    queryFn: adminPolicyHistory,
    enabled: open && tab === "settings",
  });
  const requestsQ = useQuery({
    queryKey: ["upload-requests"],
    queryFn: listUploadRequests,
    enabled: open && tab === "requests",
  });
  const limitRequestsQ = useQuery({
    queryKey: ["limit-requests"],
    queryFn: listLimitRequests,
    enabled: open && tab === "limit-requests" && canOperate,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-user"] });
    qc.invalidateQueries({ queryKey: ["admin-ip-bans"] });
    qc.invalidateQueries({ queryKey: ["admin-files"] });
    qc.invalidateQueries({ queryKey: ["admin-flags"] });
    qc.invalidateQueries({ queryKey: ["admin-hash-bans"] });
    qc.invalidateQueries({ queryKey: ["admin-admins"] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
    qc.invalidateQueries({ queryKey: ["admin-activity"] });
    qc.invalidateQueries({ queryKey: ["admin-settings"] });
    qc.invalidateQueries({ queryKey: ["admin-policy-history"] });
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
    mutationFn: (v: { id: string; confirmation: string }) =>
      adminPermanentDeleteFile(v.id, v.confirmation),
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
      confirmation?: string;
    }) => adminBulkFiles(v.action, v.ids, v.days, v.confirmation),
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
    mutationFn: (v: { id: string; confirmation: string }) =>
      adminDeleteFlag(v.id, v.confirmation),
    onSuccess: () => {
      toastOk("Flag deleted");
      refresh();
    },
    onError: onErr("Couldn't delete flag"),
  });
  const banHashMut = useMutation({
    mutationFn: (v: {
      id: string;
      confirmation: string;
      reason?: string | null;
    }) => adminBanFlagHash(v.id, v.confirmation, v.reason),
    onSuccess: () => {
      toastOk("File hash permanently banned");
      refresh();
    },
    onError: onErr("Couldn't ban file hash"),
  });
  const addAdminMut = useMutation({
    mutationFn: (confirmation: string) =>
      adminAddAdmin(newAdmin.trim(), newRole, confirmation),
    onSuccess: () => {
      toastOk("Admin added");
      setNewAdmin("");
      refresh();
    },
    onError: onErr("Couldn't add admin"),
  });
  const removeAdminMut = useMutation({
    mutationFn: (v: { email: string; confirmation: string }) =>
      adminRemoveAdmin(v.email, v.confirmation),
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
  // IP bans refuse every request from that address, so always confirm and
  // spell out the collateral damage on shared networks.
  async function confirmBan(ip: string, note: string | null) {
    const ok = await confirm({
      title: `Ban ${ip}?`,
      message:
        "Every request from this IP address will be refused, including sign-in and share links. Anyone else on the same network (home Wi-Fi, office, mobile carrier) is blocked too. You can lift the ban from the Users tab.",
      confirmLabel: "Ban IP",
      danger: true,
    });
    if (ok) banIpMut.mutate({ ip, note });
  }
  async function confirmForceRevoke(id: string, email?: string) {
    const ok = await confirm({
      title: "Revoke all share links?",
      message: `Every public link ${email ? `shared by ${email}` : "this user created"} stops working immediately. Their files are not deleted.`,
      confirmLabel: "Revoke links",
      danger: true,
    });
    if (ok) forceRevokeMut.mutate(id);
  }
  async function confirmApprove(id: string) {
    const target = usersQ.data?.find((u) => u.id === id);
    if (target?.emailVerified === false) {
      const ok = await confirm({
        title: "Approve an unverified account?",
        message: `${target.email} hasn't opened their verification link yet, so it isn't confirmed they own this address. They still have to verify before signing in.`,
        confirmLabel: "Approve anyway",
      });
      if (!ok) return;
    }
    approveUserMut.mutate(id);
  }
  const unbanIpMut = useMutation({
    mutationFn: (ip: string) => adminUnbanIp(ip),
    onSuccess: () => {
      toastOk("IP ban removed");
      refresh();
    },
    onError: onErr("Couldn't remove IP ban"),
  });
  const saveSettingsMut = useMutation({
    mutationFn: (v: { settings: AdminSettings; confirmation?: string }) =>
      adminSaveSettings(
        v.settings,
        settingsQ.data?.revision ?? null,
        v.confirmation,
      ),
    onSuccess: (result) => {
      if (isTheme(result.settings.defaultTheme))
        announceWorkspaceDefaultTheme(result.settings.defaultTheme);
      toastOk("Settings saved");
      setPolicyDraft(null);
      setPolicyReview(null);
      refresh();
    },
    onError: onErr("Couldn't save settings"),
  });
  const rollbackPolicyMut = useMutation({
    mutationFn: (v: { versionId: string; confirmation: string }) =>
      adminRollbackPolicy(
        v.versionId,
        settingsQ.data?.revision ?? null,
        v.confirmation,
      ),
    onSuccess: (result) => {
      if (isTheme(result.settings.defaultTheme))
        announceWorkspaceDefaultTheme(result.settings.defaultTheme);
      toastOk("Policy version restored");
      setPolicyDraft(null);
      setPolicyReview(null);
      refresh();
    },
    onError: onErr("Couldn't restore policy version"),
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
    mutationFn: (v: { action: string; ids: string[]; confirmation?: string }) =>
      adminBulkUsers(v.action, v.ids, undefined, v.confirmation),
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
    else if (userFilter === "unverified")
      rows = rows.filter((u) => u.emailVerified === false);
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
  const settings = policyDraft ?? settingsQ.data?.settings ?? {};
  const policyDirty =
    policyDraft != null &&
    Object.keys(
      changedPolicySettings(settingsQ.data?.settings ?? {}, policyDraft),
    ).length > 0;
  const policyReviewChanges = useMemo(() => {
    if (!policyReview) return [];
    const before = settingsQ.data?.settings ?? {};
    return policySettingChanges(before, policyReview.settings);
  }, [policyReview, settingsQ.data?.settings]);
  const selIds = Array.from(selected);
  const userSelIds = Array.from(userSelected);
  const ipBanMap = useMemo(
    () => new Map((ipBansQ.data ?? []).map((ban) => [ban.ip, ban] as const)),
    [ipBansQ.data],
  );

  const visibleTabIds = allowedTabs(role, canOperate);
  useEffect(() => {
    // A link or bookmark can name a section this role cannot open.
    if (open && role && !visibleTabIds.includes(tab))
      setTab(visibleTabIds[0] ?? "flags");
  }, [open, role, tab]);
  // Overview alerts jump straight to the list that needs attention.
  function openAlert(id: string) {
    if (id === "flags") {
      setFlagStatus("open");
      setTab("flags");
    } else if (id === "approval") {
      setSelectedUserId(null);
      setUserFilter("pending");
      setTab("users");
    } else if (id === "quota" || id === "inactive") {
      setSelectedUserId(null);
      setUserFilter("all");
      setUserSort({ key: "storage", dir: id === "quota" ? "desc" : "asc" });
      setTab("users");
    } else if (id === "unprotected" || id === "unlimited") {
      setFileFilter("shared");
      setTab("files");
    } else if (id === "large") {
      setFileFilter("all");
      setFileSort({ key: "size", dir: "desc" });
      setTab("files");
    } else if (id === "pending") {
      setTab("operations");
    }
  }

  if (!open) return null;
  const s = statsQ.data;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-app"
      role="dialog"
      aria-modal="true"
      aria-label="Admin console"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:px-4">
        <button
          onClick={onClose}
          aria-label="Close"
          title="Back to Drive"
          className="icon-round"
        >
          <ArrowLeft size={22} />
        </button>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0b57d0] text-white">
          <Shield size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-normal leading-7 text-strong">
            Admin console
          </h2>
          <p className="text-xs text-muted">
            Current role: <b>{role ? cap(role) : "Loading"}</b>
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          aria-label="Refresh"
          title="Refresh"
          className="icon-round disabled:opacity-60"
        >
          <RefreshCw size={20} className={busy ? "animate-spin" : ""} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Admin sections"
          className="flex shrink-0 gap-1 overflow-x-auto px-3 pb-2 md:w-64 md:flex-col md:gap-0 md:overflow-y-auto md:pb-4 md:pl-3 md:pr-4"
          data-ui="admin-tabs"
        >
          {TAB_GROUPS.map((group) => {
            const groupTabs = group.tabs.filter((id) =>
              visibleTabIds.includes(id),
            );
            if (!groupTabs.length) return null;
            return (
              <div
                key={group.label}
                role="group"
                aria-label={group.label}
                className="flex shrink-0 items-center gap-1 md:mb-2 md:flex-col md:items-stretch md:gap-0.5"
              >
                <span className="hidden px-4 pb-1 pt-3 text-xs font-medium text-muted md:block">
                  {group.label}
                </span>
                {groupTabs.map((id) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className="nav-pill shrink-0 !w-auto whitespace-nowrap md:!w-full"
                  >
                    <span className="truncate">{TAB_LABELS[id]}</span>
                    {id === "flags" && s && s.flagCount > 0 && (
                      <span className="ml-auto rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {s.flagCount}
                      </span>
                    )}
                    {id === "users" &&
                      s &&
                      (s.pendingApprovalCount ?? 0) > 0 && (
                        <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {s.pendingApprovalCount}
                        </span>
                      )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <main
          className="content-sheet min-h-0 flex-1 overflow-y-auto md:mb-4 md:mr-4 max-md:rounded-none"
          data-ui="admin-console"
        >
        <div className="p-6">
          {tab === "operations" && <AdminOperations isOwner={isOwner} />}
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
                <Alerts alerts={s.alerts ?? []} onSelect={openAlert} />
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-strong">
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
                onApprove={(id) => void confirmApprove(id)}
                onForceRevoke={(id) => void confirmForceRevoke(id)}
                onBanIp={(ip, note) => void confirmBan(ip, note ?? null)}
                selfEmail={myEmail}
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
                    <option value="unverified">Email unverified</option>
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
                    {isOwner && (
                      <button
                        onClick={async () => {
                          const confirmation =
                            await ownerConfirmation("EXPIRE USER FILES");
                          if (confirmation)
                            bulkUserMut.mutate({
                              action: "expireFiles",
                              ids: userSelIds,
                              confirmation,
                            });
                        }}
                        className="pill-danger"
                      >
                        Expire files
                      </button>
                    )}
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
                          className="drive-field"
                        />
                      </div>
                      <div className="min-w-[12rem] flex-[1.4]">
                        <input
                          value={ipNote}
                          onChange={(e) => setIpNote(e.target.value)}
                          placeholder="Optional note"
                          className="drive-field"
                        />
                      </div>
                      <button
                        onClick={() =>
                          ipDraft.trim() &&
                          void confirmBan(ipDraft.trim(), ipNote.trim() || null)
                        }
                        disabled={banIpMut.isPending || !ipDraft.trim()}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Ban IP
                      </button>
                    </div>
                    <div className="mt-3">
                      <h4 className="text-sm font-medium text-strong">
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
                    <thead className="text-xs font-medium text-muted">
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
                            {u.emailVerified === false && (
                              <span className="mt-0.5 block text-[11px] font-medium text-amber-700">
                                Email unverified
                              </span>
                            )}
                          </td>
                          <td
                            className="px-3 py-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {u.pendingApproval && (
                                <button
                                  onClick={() => void confirmApprove(u.id)}
                                  className="mini-good"
                                >
                                  Approve
                                </button>
                              )}
                              <button
                                onClick={() =>
                                  void confirmForceRevoke(u.id, u.email)
                                }
                                className="mini"
                              >
                                Revoke shares
                              </button>
                              {isOwner &&
                                u.lastIp &&
                                u.email.toLowerCase() !== myEmail &&
                                !ipBanMap.has(u.lastIp) && (
                                  <button
                                    onClick={() =>
                                      void confirmBan(
                                        u.lastIp!,
                                        `Banned from ${u.email}`,
                                      )
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
                    <thead className="text-xs font-medium text-muted">
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
                          canViewContent={isOwner}
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
                          onExpire={async () => {
                            const ok = await confirm({
                              title: `Expire ${f.filename} now?`,
                              message:
                                "The file and its share links stop working immediately, and the next hourly cleanup deletes it permanently.",
                              confirmLabel: "Expire now",
                              danger: true,
                            });
                            if (ok) expireMut.mutate(f.id);
                          }}
                          onDelete={() => deleteMut.mutate(f.id)}
                          onRestore={() => restoreMut.mutate(f.id)}
                          onPermanent={
                            isOwner
                              ? async () => {
                                  const confirmation =
                                    await ownerConfirmation("PERMANENTLY DELETE");
                                  if (confirmation)
                                    permanentMut.mutate({
                                      id: f.id,
                                      confirmation,
                                    });
                                }
                              : undefined
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
                            {fl.encryptionMode === "aes-gcm" && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                                Encrypted · admin inaccessible
                              </span>
                            )}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">
                            {fl.reason}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {fl.reporterEmail ? fl.reporterEmail + " · " : ""}
                            {fmtDateTime(fl.createdAt)}
                            {fl.ownerEmail ? " · owner " + fl.ownerEmail : ""}
                          </p>
                          {fl.fileExists && (
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
                              <span>{formatBytes(fl.sizeBytes ?? 0)}</span>
                              <span>{fl.contentType || "Unknown type"}</span>
                              <span>State: {fl.fileStatus || "unknown"}</span>
                              {fl.deletedAt && <span>In trash</span>}
                              {fl.contentHash && (
                                <code title={fl.contentHash}>
                                  SHA-256 {fl.contentHash.slice(0, 12)}…
                                </code>
                              )}
                            </div>
                          )}
                          {fl.encryptionMode === "aes-gcm" && (
                            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                              Dropvault stores only ciphertext. Administrators
                              cannot preview this file, recover its plaintext,
                              or derive a stable plaintext hash.
                            </p>
                          )}
                          {fl.adminNote && (
                            <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-500">
                              Note: {fl.adminNote}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {fl.adminContentAccessible && canOperate && (
                            <a
                              href={adminFlagContentUrl(fl.id)}
                              target="_blank"
                              rel="noopener"
                              className="mini"
                            >
                              Review file
                            </a>
                          )}
                          {fl.token && (
                            <a
                              href={shareUrl(fl.token)}
                              target="_blank"
                              rel="noopener"
                              className="icon-btn"
                              aria-label="Open public share"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          {canModerate && (
                            <>
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
                                  flagMut.mutate({
                                    id: fl.id,
                                    status: "resolved",
                                  })
                                }
                                className="mini-good"
                              >
                                Resolve
                              </button>
                              <button
                                onClick={() =>
                                  flagMut.mutate({
                                    id: fl.id,
                                    action: "quarantine",
                                    status: "investigating",
                                    note: "File quarantined during report review.",
                                  })
                                }
                                className="mini-danger"
                              >
                                Quarantine
                              </button>
                            </>
                          )}
                          {canOperate && (
                            <>
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
                              {fl.deletedAt ? (
                                <button
                                  onClick={() =>
                                    flagMut.mutate({
                                      id: fl.id,
                                      action: "restore",
                                      status: "investigating",
                                      note: "File restored from trash during review.",
                                    })
                                  }
                                  className="mini-good"
                                >
                                  Restore
                                </button>
                              ) : (
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
                              )}
                            </>
                          )}
                          {isOwner &&
                            fl.contentHash &&
                            fl.encryptionMode !== "aes-gcm" && (
                              <button
                                onClick={async () => {
                                  const confirmation =
                                    await ownerConfirmation("BAN HASH");
                                  if (confirmation)
                                    banHashMut.mutate({
                                      id: fl.id,
                                      confirmation,
                                      reason: fl.reason,
                                    });
                                }}
                                className="mini-danger"
                              >
                                Ban hash
                              </button>
                            )}
                          {isOwner && (
                            <button
                              onClick={async () => {
                                const confirmation =
                                  await ownerConfirmation("DELETE REPORT");
                                if (confirmation)
                                  deleteFlagMut.mutate({
                                    id: fl.id,
                                    confirmation,
                                  });
                              }}
                              className="icon-danger"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(flagsQ.data ?? []).length === 0 && (
                    <Empty label="No reports here." />
                  )}
                </div>
                <div className="mt-6 rounded-xl border border-slate-200 p-3">
                  <h3 className="text-sm font-bold text-slate-800">
                    Permanently banned file hashes
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Matching SHA-256 uploads are rejected before storage.
                    Client-side encrypted files are excluded because
                    administrators never receive a stable plaintext hash.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {(hashBansQ.data ?? []).map((ban) => (
                      <div
                        key={ban.hash}
                        className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600"
                      >
                        <code>{ban.hash}</code>
                        <div className="mt-0.5 text-slate-400">
                          {ban.reason || "No reason"} ·{" "}
                          {ban.createdBy || "owner"} ·{" "}
                          {fmtDateTime(ban.createdAt)}
                        </div>
                      </div>
                    ))}
                    {(hashBansQ.data ?? []).length === 0 && (
                      <p className="text-xs text-slate-400">
                        No banned hashes.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}

          {tab === "admins" &&
            (adminsQ.isLoading ? (
              <Loading />
            ) : (
              <div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newAdmin.trim()) return;
                    const confirmation = await ownerConfirmation("GRANT ROLE");
                    if (confirmation) addAdminMut.mutate(confirmation);
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    type="email"
                    value={newAdmin}
                    onChange={(e) => setNewAdmin(e.target.value)}
                    placeholder="new.admin@example.com"
                    className="min-w-[14rem] flex-1 rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
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
                    className="flex items-center gap-1.5 rounded-full bg-drift-600 px-3 py-2 text-sm font-medium text-white btn-primary disabled:opacity-50"
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
                        onClick={async () => {
                          const confirmation =
                            await ownerConfirmation("REMOVE ROLE");
                          if (confirmation)
                            removeAdminMut.mutate({
                              email: a.email,
                              confirmation,
                            });
                        }}
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
                <fieldset
                  disabled={!isOwner}
                  className="space-y-6 disabled:opacity-75"
                >
                  <DefaultThemeEditor
                    value={resolveTheme(settings.defaultTheme)}
                    onChange={(defaultTheme) =>
                      setPolicyDraft({ ...settings, defaultTheme })
                    }
                    disabled={!isOwner}
                  />
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
                    <GbPolicyInput
                      label="Max upload size (GB)"
                      k="maxUploadBytes"
                      settings={settings}
                      setSettings={setPolicyDraft}
                      step="0.1"
                      hint="Largest single file anyone can upload. 0 means no limit."
                    />
                    <GbPolicyInput
                      label="Default quota (GB)"
                      k="defaultQuotaBytes"
                      settings={settings}
                      setSettings={setPolicyDraft}
                      hint="New users get this much space unless given a custom quota."
                    />
                    <GbPolicyInput
                      label="Admin quota adjustment cap (GB)"
                      k="adminMaxQuotaBytes"
                      settings={settings}
                      setSettings={setPolicyDraft}
                      hint="Admins cannot assign a user quota above this owner-defined limit."
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
                    <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={settings.signupMode === "approval"}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...settings,
                            signupMode: e.target.checked ? "approval" : "open",
                          })
                        }
                        className="mt-0.5"
                      />{" "}
                      <span>
                        Require admin approval for new accounts
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          Anyone can still sign up, but they can't use Dropvault
                          until an admin approves them under Users.
                        </span>
                      </span>
                    </label>
                  </div>
                  <RolePermsEditor />
                </fieldset>
                {/* Stays in view while scrolling the long form, and says when
                    there is something to save. */}
                <div
                  className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur"
                  data-ui="policy-save-bar"
                >
                  <button
                    onClick={() =>
                      setPolicyReview({
                        mode: "save",
                        settings: { ...settings },
                      })
                    }
                    disabled={!isOwner || saveSettingsMut.isPending}
                    className="rounded-full bg-drift-600 px-4 py-2 text-sm font-medium text-white btn-primary disabled:opacity-50"
                  >
                    Save workspace settings
                  </button>
                  {policyDirty ? (
                    <>
                      <span className="text-sm font-medium text-amber-700">
                        Unsaved changes
                      </span>
                      <button
                        onClick={() => setPolicyDraft(null)}
                        className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                      >
                        Discard
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-slate-400">
                      All changes saved
                    </span>
                  )}
                  {!isOwner && (
                    <span className="text-xs text-amber-600">Owner only</span>
                  )}
                </div>
                <section className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">
                        Policy history and rollback
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Every saved setting records its editor, before/after
                        values, and timestamp. Restores create a new audit
                        entry.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-500">
                      {settingsQ.data?.revision
                        ? "Versioned"
                        : "No history yet"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(policyHistoryQ.data ?? []).map((version) => (
                      <div
                        key={version.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-slate-500">
                            <b className="text-slate-700">
                              {version.actorEmail || "Unknown owner"}
                            </b>{" "}
                            · {fmtDateTime(version.createdAt)} ·{" "}
                            {version.source}
                          </div>
                          {isOwner &&
                            version.id !== settingsQ.data?.revision && (
                              <button
                                onClick={() =>
                                  setPolicyReview({
                                    mode: "rollback",
                                    settings: version.settings,
                                    version,
                                  })
                                }
                                className="mini"
                              >
                                Review restore
                              </button>
                            )}
                        </div>
                        <div className="mt-1.5 space-y-1 text-xs text-slate-500">
                          {version.changes.map((change) => (
                            <div key={change.key}>
                              <code>{change.key}</code>: {change.before || "—"}{" "}
                              → {change.after || "—"}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {(policyHistoryQ.data ?? []).length === 0 && (
                      <p className="text-xs text-slate-400">
                        The first reviewed save will create policy history.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            ))}

          {tab === "requests" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-800">
                  Create upload request link
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <RequestField label="Title">
                    <input
                      value={requestDraft.title}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          title: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="Upload files"
                    />
                  </RequestField>
                  <RequestField label="Password">
                    <input
                      value={requestDraft.password}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          password: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="Optional"
                      type="password"
                      autoComplete="new-password"
                    />
                  </RequestField>
                  <RequestField label="Max file size (GB)">
                    <input
                      value={requestDraft.maxFileSizeGb}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          maxFileSizeGb: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="No limit"
                      type="number"
                      min={1}
                      inputMode="numeric"
                    />
                  </RequestField>
                  <RequestField label="Allowed file types"
                    hint="Comma-separated, e.g. image/*,application/pdf">
                    <input
                      value={requestDraft.allowedTypes}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          allowedTypes: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="Any type"
                    />
                  </RequestField>
                  <RequestField label="Max number of uploads">
                    <input
                      value={requestDraft.uploadLimit}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          uploadLimit: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="Unlimited"
                      type="number"
                      min={1}
                      inputMode="numeric"
                    />
                  </RequestField>
                  <RequestField label="Link expires after (days)">
                    <input
                      value={requestDraft.expiresInDays}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          expiresInDays: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="7"
                      type="number"
                      min={1}
                      inputMode="numeric"
                    />
                  </RequestField>
                  <RequestField label="Instructions for uploaders" wide>
                    <textarea
                      value={requestDraft.instructions}
                      onChange={(e) =>
                        setRequestDraft({
                          ...requestDraft,
                          instructions: e.target.value,
                        })
                      }
                      className="input w-full"
                      placeholder="Optional"
                    />
                  </RequestField>
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
                  className="mt-3 rounded-full bg-drift-600 px-4 py-2 text-sm font-medium text-white btn-primary disabled:opacity-50"
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
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,11rem)]">
                <input
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  placeholder="Filter by person, IP or item"
                  aria-label="Filter activity by person, IP or item"
                  className="input"
                />
                <select
                  value={activityAction}
                  onChange={(e) => setActivityAction(e.target.value)}
                  aria-label="Filter activity by action"
                  className="input"
                >
                  <option value="">All actions</option>
                  {activityActions.map((action) => (
                    <option key={action} value={action}>
                      {activityLabel(action)}
                    </option>
                  ))}
                </select>
                <select
                  value={activityRange}
                  onChange={(e) => setActivityRange(e.target.value)}
                  aria-label="Filter activity by time"
                  className="input"
                >
                  <option value="1">Last 24 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="">All time</option>
                </select>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <ActivityTable
                  title="Admin audit"
                  rows={filterActivity(auditQ.data ?? [])}
                />
                <ActivityTable
                  title="User activity"
                  rows={filterActivity(activityQ.data ?? [])}
                />
              </div>
              <p className="text-xs text-slate-500">
                Showing the most recent 200 entries of each log.
              </p>
            </div>
          )}
          {tab === "notifications" &&
            (settingsQ.isLoading ? (
              <Loading />
            ) : (
              <NotificationsForm
                settings={settings}
                setSettings={setPolicyDraft}
                onSave={() =>
                  setPolicyReview({ mode: "save", settings: { ...settings } })
                }
                saving={saveSettingsMut.isPending}
                isOwner={isOwner}
              />
            ))}
        </div>
        </main>
      </div>
      {policyReview && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-[28px] bg-menu p-6 drive-shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  Review changes
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {policyReview.mode === "rollback"
                    ? `Restore the workspace to the policy saved ${
                        policyReview.version
                          ? fmtDateTime(policyReview.version.createdAt)
                          : "earlier"
                      }.`
                    : "Confirm every before/after value before saving."}
                </p>
              </div>
              <button
                onClick={() => setPolicyReview(null)}
                className="icon-btn"
                aria-label="Close review"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto">
              <PolicyImpact key={JSON.stringify(policyReview.settings)} settings={policyReview.settings} onReady={setImpactReady} />
              {policyReviewChanges.map((change) => (
                <div
                  key={change.key}
                  className="rounded-xl border border-slate-200 px-3 py-2.5"
                >
                  <code className="text-xs font-semibold text-slate-700">
                    {change.key}
                  </code>
                  <div className="mt-1 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-red-50 px-2 py-1.5 text-red-700">
                      <span className="block text-[10px] font-semibold uppercase opacity-70">
                        Before
                      </span>
                      <span className="break-all">{change.before || "—"}</span>
                    </div>
                    <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700">
                      <span className="block text-[10px] font-semibold uppercase opacity-70">
                        After
                      </span>
                      <span className="break-all">{change.after || "—"}</span>
                    </div>
                  </div>
                </div>
              ))}
              {policyReviewChanges.length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  No policy values would change.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPolicyReview(null)} className="mini">
                Cancel
              </button>
              <button
                disabled={
                  !impactReady ||
                  policyReviewChanges.length === 0 ||
                  saveSettingsMut.isPending ||
                  rollbackPolicyMut.isPending
                }
                onClick={async () => {
                  if (
                    policyReview.mode === "rollback" &&
                    policyReview.version
                  ) {
                    const confirmation =
                      await ownerConfirmation("RESTORE POLICY");
                    if (confirmation)
                      rollbackPolicyMut.mutate({
                        versionId: policyReview.version.id,
                        confirmation,
                      });
                    return;
                  }
                  const needsConfirmation = policyReviewChanges.some((change) =>
                    SECURITY_POLICY_KEYS.has(change.key),
                  );
                  const confirmation = needsConfirmation
                    ? await ownerConfirmation("APPLY POLICY")
                    : undefined;
                  if (needsConfirmation && !confirmation) return;
                  const changedSettings = changedPolicySettings(
                    settingsQ.data?.settings ?? {},
                    policyReview.settings,
                  );
                  saveSettingsMut.mutate({
                    settings: changedSettings,
                    confirmation: confirmation ?? undefined,
                  });
                }}
                className="rounded-full bg-drift-600 px-4 py-2 text-sm font-medium text-white btn-primary disabled:opacity-50"
              >
                {policyReview.mode === "rollback"
                  ? "Confirm restore"
                  : "Save reviewed changes"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmUi}
      {typedConfirmUi}
    </div>
  );
}

function RequestField({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"block text-sm " + (wide ? "sm:col-span-2" : "")}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
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
  selfEmail,
}: {
  id: string;
  isOwner: boolean;
  bannedIps: IpBanEntry[];
  selfEmail?: string | null;
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
  const resendMut = useMutation({
    mutationFn: () => adminResendVerification(id),
    onSuccess: () => toastOk("Verification email sent"),
    onError: (e) =>
      toastErr((e as Error)?.message || "Couldn't send verification email"),
  });
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
    ? ["owner", "admin"].includes(q.data.user.role ?? "")
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
          <UserSupport id={id} />
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {q.data.user.name}
            </h3>
            <p className="text-sm text-slate-500">{q.data.user.email}</p>
            {q.data.user.emailVerified === false && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span>Email address not verified yet.</span>
                {q.data.emailDelivery && (
                  <button
                    onClick={() => resendMut.mutate()}
                    disabled={resendMut.isPending}
                    className="mini"
                  >
                    {resendMut.isPending
                      ? "Sending…"
                      : "Resend verification email"}
                  </button>
                )}
              </div>
            )}
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
              {/* A pending account is suspended until approved, so Approve
                  is its only meaningful state change here. */}
              {!q.data.user.pendingApproval && (
                <button
                  onClick={() => {
                    q.data?.user.suspended ? onUnsuspend(id) : onSuspend(id);
                    q.refetch();
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  {q.data.user.suspended ? "Unsuspend" : "Suspend"}
                </button>
              )}
              <button
                onClick={() => onForceRevoke(id)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Revoke all shares
              </button>
              <RolePill role={q.data.user.role ?? null} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-medium text-strong">
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
                className="w-32 rounded border border-outline bg-transparent px-3 py-1.5 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
              />
              <button
                onClick={() => {
                  const n = parseFloat(gb);
                  if (!isNaN(n) && n >= 0) quotaMut.mutate(Math.round(n * GIB));
                }}
                disabled={quotaMut.isPending || !gb}
                className="rounded-full bg-drift-600 px-3 py-1.5 text-sm font-medium text-white btn-primary disabled:opacity-50"
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
                <h4 className="flex items-center gap-1.5 text-sm font-medium text-strong">
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
                    className="rounded-full bg-drift-600 px-3 py-1.5 text-sm font-medium text-white btn-primary disabled:opacity-50"
                  >
                    Grant permission
                  </button>
                )}
              </div>
            )}
          </div>
          {isOwner && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="text-sm font-medium text-strong">
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
                      ) : q.data.user.email.toLowerCase() === selfEmail ? null : (
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
  canViewContent,
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
  canViewContent: boolean;
  selected: boolean;
  onToggle: () => void;
  onRevoke: () => void;
  onExtend: () => void;
  onExpire: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanent?: () => void;
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
      <td className="px-3 py-2.5 text-slate-500">
        {fmtExpiry(file.expiresAt)}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {canViewContent && adminFileContentAvailable(file) && (
            <>
              <a
                href={adminFilePreviewUrl(file.id)}
                target="_blank"
                rel="noopener"
                className="icon-btn"
                aria-label={`Preview ${file.filename}`}
                title="Preview file"
              >
                <FileText size={15} />
              </a>
              <a
                href={adminFileDownloadUrl(file.id)}
                className="icon-btn"
                aria-label={`Download ${file.filename}`}
                title="Download file"
              >
                <Download size={15} />
              </a>
            </>
          )}
          {file.shareToken && (
            <a
              href={shareUrl(file.shareToken)}
              target="_blank"
              rel="noopener"
              className="icon-btn"
              aria-label={`Open public link for ${file.filename}`}
              title="Open public link"
            >
              <ExternalLink size={15} />
            </a>
          )}
          <button
            onClick={onExtend}
            className="icon-btn"
            aria-label={`Extend ${file.filename} by 7 days`}
            title="Extend expiry by 7 days"
          >
            <Clock size={15} />
          </button>
          <button
            onClick={onExpire}
            className="icon-btn"
            aria-label={`Expire ${file.filename} now`}
            title="Expire now"
          >
            <Ban size={15} />
          </button>
          <button
            onClick={onRevoke}
            disabled={!file.shared}
            className="icon-btn disabled:opacity-30"
            aria-label={`Revoke share link for ${file.filename}`}
            title={file.shared ? "Revoke share link" : "Not shared"}
          >
            <Link2 size={15} />
          </button>
          {file.deletedAt ? (
            <button onClick={onRestore} className="mini-good">
              Restore
            </button>
          ) : (
            <button
              onClick={onDelete}
              className="icon-danger"
              aria-label={`Move ${file.filename} to Trash`}
              title="Move to Trash"
            >
              <Trash2 size={15} />
            </button>
          )}
          {onPermanent && (
            <button onClick={onPermanent} className="mini-danger">
              Purge
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
function Alerts({
  alerts,
  onSelect,
}: {
  alerts: Array<{ id: string; label: string; count: number; level: string }>;
  onSelect: (id: string) => void;
}) {
  // Zero-count alerts are noise; only show what needs a look.
  const active = alerts.filter((a) => a.count > 0);
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-strong">
        Alerts
      </h3>
      {active.length === 0 ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          No alerts. Nothing needs attention right now.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {active.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={
                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition hover:brightness-95 " +
                (a.level === "high"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : a.level === "medium"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-white text-slate-600")
              }
            >
              <span>
                <b>{a.count}</b> {a.label}
              </span>
              <ChevronRight size={15} className="shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
type ActivityRow =
  | ActivityEntry
  | {
      id: string;
      actorEmail?: string | null;
      action: string;
      targetType?: string | null;
      targetId?: string | null;
      detail?: string | null;
      createdAt: number;
    };
const ACTIVITY_PAGE = 25;
function ActivityTable({
  title,
  rows,
}: {
  title: string;
  rows: ActivityRow[];
}) {
  const [shown, setShown] = useState(ACTIVITY_PAGE);
  useEffect(() => setShown(ACTIVITY_PAGE), [rows]);
  const visible = rows.slice(0, shown);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-strong">
        {title}{" "}
        <span className="font-normal normal-case tracking-normal text-slate-400">
          ({rows.length})
        </span>
      </h3>
      <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2.5 align-top text-slate-500">
                  {fmtDateTime(r.createdAt)}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className="font-medium text-slate-700"
                    title={r.action}
                  >
                    {activityLabel(r.action)}
                  </span>
                  <div className="text-xs text-slate-500">
                    {r.actorEmail ?? r.detail ?? r.targetId ?? "—"}
                  </div>
                  {"ip" in r && r.ip && (
                    <div
                      className="mt-1 text-[11px] text-slate-400"
                      title={("userAgent" in r && r.userAgent) || undefined}
                    >
                      IP {r.ip}
                      {"userAgent" in r && r.userAgent
                        ? ` · ${browserSummary(r.userAgent)}`
                        : ""}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty label="No matching activity." />}
        {rows.length > shown && (
          <button
            onClick={() => setShown((n) => n + ACTIVITY_PAGE)}
            className="w-full border-t border-slate-100 px-3 py-2 text-sm font-medium text-drift-600 hover:bg-slate-50"
          >
            Show {Math.min(ACTIVITY_PAGE, rows.length - shown)} more
          </button>
        )}
      </div>
    </div>
  );
}
function DefaultThemeEditor({
  value,
  onChange,
  disabled,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  disabled: boolean;
}) {
  return (
    <section
      className="rounded-2xl border border-slate-200 p-4"
      data-ui="default-theme-editor"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-drift-50 text-drift-700">
          <Palette size={18} />
        </span>
        <div>
          <h3 className="font-semibold text-slate-800">Default appearance</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            New visitors and anyone following the workspace default will use
            this appearance, including public share pages. Personal choices
            stay unchanged.
          </p>
        </div>
      </div>
      <div
        className="mt-4 grid gap-2 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Workspace default theme"
      >
        {THEME_OPTIONS.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={
                "theme-preview theme-preview-" +
                option.id +
                (active ? " is-active" : "")
              }
            >
              <span className="theme-preview-canvas" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="mt-2 flex items-center gap-1.5 text-left text-xs font-semibold">
                {option.label}
                {active && <Check size={13} className="ml-auto" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
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
        className="mt-1 w-full rounded border border-outline bg-transparent px-3 py-2 outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
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
  step = "0.5",
}: {
  label: string;
  k: string;
  settings: AdminSettings;
  setSettings: (s: AdminSettings) => void;
  hint?: string;
  step?: string;
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
        step={step}
        value={gb}
        onChange={(e) => {
          const v = e.target.value;
          setSettings({
            ...settings,
            [k]: v === "" ? "" : String(Math.round(Number(v) * GIB)),
          });
        }}
        className="mt-1 w-full rounded border border-outline bg-transparent px-3 py-2 outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
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
function RolePermsEditor() {
  const rules = [
    {
      role: "Owner",
      detail:
        "Global security, encryption, retention, roles, deletion, access policies, and irreversible confirmations.",
    },
    {
      role: "Admin",
      detail:
        "Approve users, review unencrypted reports, revoke links, quarantine files, and adjust quotas within the owner cap.",
    },
    {
      role: "Moderator",
      detail:
        "Review reports and quarantine content. Cannot open client-side encrypted files or change workspace policy.",
    },
    {
      role: "Auditor",
      detail: "Read-only access to policies, reports, and activity logs.",
    },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <h3 className="text-sm font-bold text-slate-800">Permission rules</h3>
      <p className="mt-1 text-xs text-slate-500">
        These boundaries are enforced by the API and cannot be weakened from the
        browser.
      </p>
      <div className="mt-3 space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.role}
            className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
          >
            <div className="text-sm font-semibold text-slate-700">
              {rule.role}
            </div>
            <div className="mt-0.5 text-xs leading-5 text-slate-500">
              {rule.detail}
            </div>
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
  const { success: toastOk, error: toastErr } = useToast();
  const testMut = useMutation({
    mutationFn: (url: string) => adminTestWebhook(url),
    onSuccess: (result) =>
      toastOk(`Test sent. The webhook answered HTTP ${result.status}.`),
    onError: (e) =>
      toastErr((e as Error)?.message || "Couldn't send the test notification"),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-drift-200 bg-drift-50 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-drift-50 text-drift-700">
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
        <div className="sm:col-span-2">
          <PolicyInput
            label="Notification webhook URL"
            k="notifyWebhookUrl"
            settings={settings}
            setSettings={setSettings}
            hint="e.g. a Slack/Discord incoming webhook or your own endpoint."
          />
          <button
            type="button"
            onClick={() =>
              testMut.mutate(String(settings.notifyWebhookUrl ?? "").trim())
            }
            disabled={
              !isOwner ||
              testMut.isPending ||
              !String(settings.notifyWebhookUrl ?? "").trim()
            }
            className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {testMut.isPending ? "Sending test…" : "Send test notification"}
          </button>
        </div>
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
          className="rounded-full bg-drift-600 px-4 py-2 text-sm font-medium text-white btn-primary disabled:opacity-50"
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
      <h3 className="mb-3 text-sm font-medium text-strong">
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
        className="flex items-center gap-1 hover:text-slate-600"
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
