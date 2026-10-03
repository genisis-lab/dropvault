import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brush,
  Bell,
  Check,
  Copy,
  Download,
  History,
  Infinity,
  KeyRound,
  Laptop,
  LogOut,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { copyText } from "../lib/clipboard";
import {
  adminAccess,
  listSessions,
  myActivity,
  revokeOtherSessions,
  revokeSession,
  type ActivityEntry,
  type SessionItem,
} from "../lib/api";
import { authClient, useSession } from "../lib/auth-client";
import {
  adminPortalRequests,
  approvePortalRequest,
  createPortalRequest,
  myPortalRequests,
  rejectPortalRequest,
} from "../lib/portalRequests";
import {
  adminKeepForeverRequests,
  approveKeepForeverRequest,
  createKeepForeverRequest,
  keepForeverStatus,
  rejectKeepForeverRequest,
} from "../lib/keepForever";
import { useToast } from "./Toast";
import {
  deleteAccount,
  downloadAccountExport,
  notificationPreferences,
  portalBrand,
  saveNotificationPreferences,
  savePortalBrand,
  type NotificationPreferences,
} from "../lib/account";
import { useEscapeToClose } from "../lib/useEscapeToClose";

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const panelInitial = { opacity: 0, scale: 0.96, y: 10 };
const panelAnimate = { opacity: 1, scale: 1, y: 0 };
const panelExit = { opacity: 0, scale: 0.96, y: 10 };
function when(value: string | number | Date) {
  const d =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function actionLabel(a: string): string {
  return a
    ? a.replace(/[._-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    : "Activity";
}
function deviceLabel(ua?: string | null) {
  const v = (ua || "").toLowerCase();
  if (v.includes("iphone") || v.includes("android")) return "Mobile device";
  if (v.includes("ipad") || v.includes("tablet")) return "Tablet";
  if (v.includes("mac")) return "Mac";
  if (v.includes("windows")) return "Windows PC";
  return "Device";
}
function isMobile(ua?: string | null) {
  const v = (ua || "").toLowerCase();
  return v.includes("iphone") || v.includes("android") || v.includes("ipad");
}
function secretFromUri(uri?: string | null) {
  if (!uri) return "";
  try {
    return new URL(uri).searchParams.get("secret") || "";
  } catch {
    return "";
  }
}
function authErrorMessage(res: any, fallback: string) {
  const err = res?.error;
  return (
    err?.message || err?.statusText || err?.code || err?.status || fallback
  );
}
function twoFactorBody(password: string, extra?: Record<string, unknown>) {
  const body: Record<string, unknown> = { ...(extra ?? {}) };
  const trimmed = password.trim();
  if (trimmed) body.password = trimmed;
  return body;
}

export default function AccountSecurityDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEscapeToClose(open, onClose);
  const qc = useQueryClient();
  const { success, error } = useToast();
  const sessionQ = useSession();
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    enabled: open,
  });
  const activityQ = useQuery({
    queryKey: ["my-activity"],
    queryFn: () => myActivity(50),
    enabled: open,
  });
  const accessQ = useQuery({
    queryKey: ["admin-access"],
    queryFn: adminAccess,
    enabled: open,
  });
  const isAdmin = !!accessQ.data?.isAdmin;
  const portalQ = useQuery({
    queryKey: ["portal-requests", "mine"],
    queryFn: myPortalRequests,
    enabled: open,
  });
  const adminPortalQ = useQuery({
    queryKey: ["portal-requests", "admin", "pending"],
    queryFn: () => adminPortalRequests("pending"),
    enabled: open && isAdmin,
  });
  const keepQ = useQuery({
    queryKey: ["keep-forever", "status"],
    queryFn: keepForeverStatus,
    enabled: open,
  });
  const adminKeepQ = useQuery({
    queryKey: ["keep-forever", "admin", "pending"],
    queryFn: () => adminKeepForeverRequests("pending"),
    enabled: open && isAdmin,
  });
  const preferencesQ = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: notificationPreferences,
    enabled: open,
  });
  const brandQ = useQuery({
    queryKey: ["portal-brand"],
    queryFn: portalBrand,
    enabled: open,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sessions"] });
  const invalidatePortal = () => {
    qc.invalidateQueries({ queryKey: ["portal-requests"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const invalidateKeepForever = () => {
    qc.invalidateQueries({ queryKey: ["keep-forever"] });
    qc.invalidateQueries({ queryKey: ["account"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const revokeMut = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      success("Session revoked");
      invalidate();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't revoke session"),
  });
  const revokeOthersMut = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (res) => {
      success(
        `Revoked ${res.count} other session${res.count === 1 ? "" : "s"}`,
      );
      invalidate();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't revoke sessions"),
  });
  const portalMut = useMutation({
    mutationFn: createPortalRequest,
    onSuccess: () => {
      success("Branded portal request sent");
      invalidatePortal();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't send request"),
  });
  const approvePortalMut = useMutation({
    mutationFn: approvePortalRequest,
    onSuccess: () => {
      success("Portal access approved");
      invalidatePortal();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't approve request"),
  });
  const rejectPortalMut = useMutation({
    mutationFn: rejectPortalRequest,
    onSuccess: () => {
      success("Portal request rejected");
      invalidatePortal();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't reject request"),
  });
  const keepRequestMut = useMutation({
    mutationFn: createKeepForeverRequest,
    onSuccess: () => {
      success("Keep-forever request sent");
      invalidateKeepForever();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't send request"),
  });
  const approveKeepMut = useMutation({
    mutationFn: approveKeepForeverRequest,
    onSuccess: () => {
      success("Keep-forever access approved");
      invalidateKeepForever();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't approve request"),
  });
  const rejectKeepMut = useMutation({
    mutationFn: rejectKeepForeverRequest,
    onSuccess: () => {
      success("Keep-forever request rejected");
      invalidateKeepForever();
    },
    onError: (e) => error((e as Error)?.message || "Couldn't reject request"),
  });
  const preferencesMut = useMutation({
    mutationFn: saveNotificationPreferences,
    onSuccess: (value) => {
      qc.setQueryData(["notification-preferences"], value);
      success("Notification preferences saved");
    },
    onError: (e) =>
      error((e as Error)?.message || "Couldn't save notification preferences"),
  });
  const brandSettingsMut = useMutation({
    mutationFn: savePortalBrand,
    onSuccess: (value) => {
      qc.setQueryData(["portal-brand"], value);
      success("Portal branding saved");
    },
    onError: (e) =>
      error((e as Error)?.message || "Couldn't save portal branding"),
  });
  const [brand, setBrand] = useState("");
  const [reason, setReason] = useState("");
  const [foreverReason, setForeverReason] = useState("");
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    emailEnabled: false,
    webhookEnabled: false,
    webhookUrl: null,
    expiryWarnings: true,
    uploadEvents: true,
    securityEvents: true,
  });
  const [portalSlug, setPortalSlug] = useState("");
  const [portalName, setPortalName] = useState("");
  const [portalColor, setPortalColor] = useState("#7c3aed");
  const [portalLogo, setPortalLogo] = useState("");
  const [portalWelcome, setPortalWelcome] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [dataBusy, setDataBusy] = useState(false);
  const pendingPortal = (portalQ.data?.requests ?? []).find(
    (r) => r.status === "pending",
  );
  const approvedPortal = portalQ.data?.approved;
  const twoFactorEnabled = !!(sessionQ.data?.user as any)?.twoFactorEnabled;
  useEffect(() => {
    if (preferencesQ.data) setPrefs(preferencesQ.data);
  }, [preferencesQ.data]);
  useEffect(() => {
    const value = brandQ.data;
    if (!value) return;
    setPortalSlug(value.slug);
    setPortalName(value.name);
    setPortalColor(value.accentColor);
    setPortalLogo(value.logoUrl ?? "");
    setPortalWelcome(value.welcomeMessage ?? "");
  }, [brandQ.data]);
  async function start2FA() {
    setTwoFactorBusy(true);
    try {
      const res = await (authClient as any).twoFactor.enable(
        twoFactorBody(password, { issuer: "Dropvault" }),
      );
      if (res?.error)
        throw new Error(authErrorMessage(res, "Couldn't start 2FA setup"));
      const uri = res?.data?.totpURI || res?.data?.totpUri || "";
      if (!uri)
        throw new Error(
          "2FA setup started but no authenticator setup key was returned. Make sure the 2FA database migration is deployed.",
        );
      setTotpUri(uri);
      setBackupCodes(res?.data?.backupCodes || []);
      success("Authenticator setup started");
    } catch (e) {
      error((e as Error)?.message || "Couldn't start 2FA setup");
    } finally {
      setTwoFactorBusy(false);
    }
  }
  async function verify2FA() {
    setTwoFactorBusy(true);
    try {
      const res = await (authClient as any).twoFactor.verifyTotp({
        code: totpCode.trim(),
        trustDevice: true,
      });
      if (res?.error) throw new Error(authErrorMessage(res, "Invalid code"));
      success("Two-factor authentication enabled");
      setPassword("");
      setTotpUri("");
      setTotpCode("");
      window.location.reload();
    } catch (e) {
      error((e as Error)?.message || "Invalid code");
    } finally {
      setTwoFactorBusy(false);
    }
  }
  async function disable2FA() {
    setTwoFactorBusy(true);
    try {
      const res = await (authClient as any).twoFactor.disable(
        twoFactorBody(password),
      );
      if (res?.error)
        throw new Error(authErrorMessage(res, "Couldn't disable 2FA"));
      success("Two-factor authentication disabled");
      setPassword("");
      setBackupCodes([]);
      window.location.reload();
    } catch (e) {
      error((e as Error)?.message || "Couldn't disable 2FA");
    } finally {
      setTwoFactorBusy(false);
    }
  }
  async function regenerateBackups() {
    setTwoFactorBusy(true);
    try {
      const res = await (authClient as any).twoFactor.generateBackupCodes(
        twoFactorBody(password),
      );
      if (res?.error)
        throw new Error(
          authErrorMessage(res, "Couldn't generate backup codes"),
        );
      setBackupCodes(res?.data?.backupCodes || []);
      success("New backup codes generated");
    } catch (e) {
      error((e as Error)?.message || "Couldn't generate backup codes");
    } finally {
      setTwoFactorBusy(false);
    }
  }
  const manualSecret = secretFromUri(totpUri);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
        >
          <motion.div
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-[28px] bg-menu drive-shadow-lg"
          >
            <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
              <div className="flex items-center gap-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-drift-50 text-drift-700">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-normal text-strong">
                    Account security
                  </h2>
                  <p className="text-xs text-slate-400">
                    Sessions, devices, and account protection
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="icon-round"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                    <KeyRound size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          Two-factor authentication
                        </p>
                        <p className="text-xs text-slate-500">
                          {twoFactorEnabled
                            ? "Enabled for password sign-ins."
                            : "Add an authenticator app code to password sign-ins."}
                        </p>
                      </div>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                          (twoFactorEnabled
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500")
                        }
                      >
                        {twoFactorEnabled ? "On" : "Off"}
                      </span>
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Current password (leave blank for Google-only accounts)"
                      className="mt-3 drive-field"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Password is required for email/password accounts.
                      Google-only accounts can leave it blank.
                    </p>
                    {!twoFactorEnabled && !totpUri && (
                      <button
                        onClick={start2FA}
                        disabled={twoFactorBusy}
                        className="mt-2 rounded-full bg-drift-600 px-3 py-1.5 text-xs font-medium text-white btn-primary disabled:opacity-50"
                      >
                        Set up 2FA
                      </button>
                    )}
                    {totpUri && (
                      <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-600">
                          Add this setup key to your authenticator app, then
                          enter the 6-digit code.
                        </p>
                        <div className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs font-mono text-slate-700">
                          <span className="min-w-0 flex-1 truncate">
                            {manualSecret || totpUri}
                          </span>
                          <button
                            onClick={() =>
                              void copyText(manualSecret || totpUri)
                            }
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <input
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="6-digit code"
                          inputMode="numeric"
                          className="drive-field"
                        />
                        <button
                          onClick={verify2FA}
                          disabled={twoFactorBusy || !totpCode.trim()}
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                        >
                          Verify and enable
                        </button>
                      </div>
                    )}
                    {twoFactorEnabled && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={regenerateBackups}
                          disabled={twoFactorBusy}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          New backup codes
                        </button>
                        <button
                          onClick={disable2FA}
                          disabled={twoFactorBusy}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Disable 2FA
                        </button>
                      </div>
                    )}
                    {backupCodes.length > 0 && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold text-amber-800">
                          Save these backup codes now. They are shown only once.
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-amber-900">
                          {backupCodes.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-white/70 px-2 py-1"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-drift-50 text-drift-600">
                    <Infinity size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      Keep files forever
                    </p>
                    <p className="text-xs text-slate-500">
                      Upload files without an expiry date. Owners, admins, and
                      moderators get this by default.
                    </p>
                    {keepQ.data?.canKeepFilesForever ? (
                      <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                        Enabled for your account. You’ll see a “Keep these
                        uploads forever” option in Upload options.
                      </p>
                    ) : keepQ.data?.pendingRequest ? (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        Request pending admin approval.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={foreverReason}
                          onChange={(e) => setForeverReason(e.target.value)}
                          placeholder="Why do you need files to stay forever?"
                          rows={2}
                          className="w-full resize-none rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
                        />
                        <button
                          onClick={() =>
                            keepRequestMut.mutate(foreverReason || undefined)
                          }
                          disabled={keepRequestMut.isPending}
                          className="rounded-full bg-drift-600 px-3 py-1.5 text-xs font-medium text-white btn-primary disabled:opacity-50"
                        >
                          Request permission
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-strong">
                        Pending keep-forever approvals
                      </p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        {adminKeepQ.data?.length ?? 0}
                      </span>
                    </div>
                    {adminKeepQ.isLoading ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        Loading…
                      </p>
                    ) : (adminKeepQ.data ?? []).length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        No pending keep-forever requests.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(adminKeepQ.data ?? []).map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-slate-200 bg-white p-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-700">
                                  {r.userEmail ?? r.userName ?? r.userId}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {when(r.createdAt)}
                                </p>
                                {r.reason && (
                                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                                    {r.reason}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  title="Approve"
                                  onClick={() => approveKeepMut.mutate(r.id)}
                                  className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  title="Reject"
                                  onClick={() => rejectKeepMut.mutate(r.id)}
                                  className="grid h-7 w-7 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-50 text-purple-600">
                    <Brush size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      Branded portal access
                    </p>
                    <p className="text-xs text-slate-500">
                      Customize the identity shown on your public upload pages.
                    </p>
                    {approvedPortal || isAdmin ? (
                      <div className="mt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={portalName}
                            onChange={(e) => setPortalName(e.target.value)}
                            placeholder="Portal name"
                            className="rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
                          />
                          <input
                            value={portalSlug}
                            onChange={(e) =>
                              setPortalSlug(e.target.value.toLowerCase())
                            }
                            placeholder="portal-slug"
                            className="rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
                          />
                        </div>
                        <input
                          value={portalLogo}
                          onChange={(e) => setPortalLogo(e.target.value)}
                          placeholder="HTTPS logo URL (optional)"
                          className="drive-field"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={portalColor}
                            onChange={(e) => setPortalColor(e.target.value)}
                            className="h-9 w-12 rounded border border-slate-200 bg-white p-1"
                          />
                          <input
                            value={portalWelcome}
                            onChange={(e) => setPortalWelcome(e.target.value)}
                            placeholder="Welcome message"
                            className="min-w-0 flex-1 rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
                          />
                        </div>
                        <button
                          onClick={() =>
                            brandSettingsMut.mutate({
                              slug: portalSlug,
                              name: portalName,
                              logoUrl: portalLogo || null,
                              accentColor: portalColor,
                              welcomeMessage: portalWelcome || null,
                            })
                          }
                          disabled={brandSettingsMut.isPending}
                          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                        >
                          Save portal
                        </button>
                      </div>
                    ) : pendingPortal ? (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        Request pending admin approval.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <input
                          value={brand}
                          onChange={(e) => setBrand(e.target.value)}
                          placeholder="Brand / business name optional"
                          className="drive-field"
                        />
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why do you need a branded portal?"
                          rows={2}
                          className="w-full resize-none rounded border border-outline bg-transparent px-3 py-2 text-sm outline-none focus:border-primary focus:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]"
                        />
                        <button
                          onClick={() =>
                            portalMut.mutate({
                              requestedBrand: brand || null,
                              reason: reason || null,
                            })
                          }
                          disabled={portalMut.isPending}
                          className="rounded-full bg-drift-600 px-3 py-1.5 text-xs font-medium text-white btn-primary disabled:opacity-50"
                        >
                          Request access
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-strong">
                        Pending portal approvals
                      </p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        {adminPortalQ.data?.length ?? 0}
                      </span>
                    </div>
                    {adminPortalQ.isLoading ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        Loading…
                      </p>
                    ) : (adminPortalQ.data ?? []).length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        No pending portal requests.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(adminPortalQ.data ?? []).map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-slate-200 bg-white p-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-700">
                                  {r.userEmail ?? r.userName ?? r.userId}
                                </p>
                                <p className="text-xs text-slate-400">
                                  {r.requestedBrand || "No brand name"} ·{" "}
                                  {when(r.createdAt)}
                                </p>
                                {r.reason && (
                                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                                    {r.reason}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  title="Approve"
                                  onClick={() => approvePortalMut.mutate(r.id)}
                                  className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  title="Reject"
                                  onClick={() => rejectPortalMut.mutate(r.id)}
                                  className="grid h-7 w-7 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                    <Bell size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      Notifications &amp; webhooks
                    </p>
                    <p className="text-xs text-slate-500">
                      Choose delivery channels and event categories. Webhooks
                      are signed when a workspace secret is configured.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.emailEnabled}
                          onChange={(e) =>
                            setPrefs({
                              ...prefs,
                              emailEnabled: e.target.checked,
                            })
                          }
                        />{" "}
                        Email delivery
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.webhookEnabled}
                          onChange={(e) =>
                            setPrefs({
                              ...prefs,
                              webhookEnabled: e.target.checked,
                            })
                          }
                        />{" "}
                        Custom webhook
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.expiryWarnings}
                          onChange={(e) =>
                            setPrefs({
                              ...prefs,
                              expiryWarnings: e.target.checked,
                            })
                          }
                        />{" "}
                        Expiry warnings
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.uploadEvents}
                          onChange={(e) =>
                            setPrefs({
                              ...prefs,
                              uploadEvents: e.target.checked,
                            })
                          }
                        />{" "}
                        Upload events
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={prefs.securityEvents}
                          onChange={(e) =>
                            setPrefs({
                              ...prefs,
                              securityEvents: e.target.checked,
                            })
                          }
                        />{" "}
                        Security events
                      </label>
                    </div>
                    {prefs.webhookEnabled && (
                      <input
                        value={prefs.webhookUrl ?? ""}
                        onChange={(e) =>
                          setPrefs({ ...prefs, webhookUrl: e.target.value })
                        }
                        placeholder="https://example.com/dropvault-events"
                        className="mt-2 drive-field"
                      />
                    )}
                    <button
                      onClick={() => preferencesMut.mutate(prefs)}
                      disabled={preferencesMut.isPending}
                      className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save notifications
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">
                  Your data
                </p>
                <p className="text-xs text-slate-500">
                  Export a secret-free JSON archive, or permanently delete the
                  account and every stored object/version.
                </p>
                <button
                  onClick={async () => {
                    setDataBusy(true);
                    try {
                      await downloadAccountExport();
                      success("Account export downloaded");
                    } catch (e) {
                      error((e as Error).message);
                    } finally {
                      setDataBusy(false);
                    }
                  }}
                  disabled={dataBusy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download size={14} /> Export account
                </button>
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-700">
                    Delete account
                  </p>
                  <p className="mt-0.5 text-[11px] text-red-600">
                    Type DELETE {sessionQ.data?.user?.email} to confirm.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={deleteConfirmation}
                      onChange={(e) => setDeleteConfirmation(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs outline-none focus:border-red-400"
                    />
                    <button
                      onClick={async () => {
                        setDataBusy(true);
                        try {
                          await deleteAccount(deleteConfirmation);
                          window.location.assign("/");
                        } catch (e) {
                          error((e as Error).message);
                          setDataBusy(false);
                        }
                      }}
                      disabled={
                        dataBusy ||
                        deleteConfirmation !==
                          `DELETE ${sessionQ.data?.user?.email ?? ""}`
                      }
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Active sessions
                  </h3>
                  <p className="text-xs text-slate-400">
                    Sign out old devices you no longer use.
                  </p>
                </div>
                <button
                  onClick={() => revokeOthersMut.mutate()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <LogOut size={14} /> Revoke others
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {q.isLoading ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    Loading sessions…
                  </p>
                ) : (q.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    No active sessions found.
                  </p>
                ) : (
                  (q.data ?? []).map((s: SessionItem) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                        {isMobile(s.userAgent) ? (
                          <Smartphone size={17} />
                        ) : (
                          <Laptop size={17} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">
                          {deviceLabel(s.userAgent)}
                          {s.current && (
                            <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                              Current
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {s.ipAddress || "Unknown IP"} ·{" "}
                          {s.userAgent || "Unknown browser"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Last active {when(s.updatedAt)}
                        </p>
                      </div>
                      <button
                        disabled={s.current || revokeMut.isPending}
                        onClick={() => revokeMut.mutate(s.id)}
                        title={s.current ? "Current session" : "Revoke session"}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-5 flex items-center gap-2">
                <History size={15} className="text-slate-400" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Your recent activity
                  </h3>
                  <p className="text-xs text-slate-400">
                    Recent actions recorded on your account.
                  </p>
                </div>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200">
                {activityQ.isLoading ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    Loading activity…
                  </p>
                ) : (activityQ.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">
                    No recent activity yet.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {(activityQ.data ?? []).map((a: ActivityEntry) => (
                        <tr key={a.id}>
                          <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs text-slate-400">
                            {when(a.createdAt)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {actionLabel(a.action)}
                            </span>
                            {(a.detail || a.targetType) && (
                              <div className="mt-1 break-words text-xs text-slate-500">
                                {a.detail ?? a.targetType}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
