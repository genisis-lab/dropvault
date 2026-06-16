import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { Brush, Check, Copy, KeyRound, Laptop, LogOut, ShieldCheck, Smartphone, Trash2, X } from "lucide-react"
import { adminAccess, listSessions, revokeOtherSessions, revokeSession, type SessionItem } from "../lib/api"
import { authClient, useSession } from "../lib/auth-client"
import { adminPortalRequests, approvePortalRequest, createPortalRequest, myPortalRequests, rejectPortalRequest } from "../lib/portalRequests"
import { useToast } from "./Toast"

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } }
const panelInitial = { opacity: 0, scale: 0.96, y: 10 }
const panelAnimate = { opacity: 1, scale: 1, y: 0 }
const panelExit = { opacity: 0, scale: 0.96, y: 10 }
function when(value: string | number | Date) { const d = typeof value === "number" ? new Date(value * 1000) : new Date(value); return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }
function deviceLabel(ua?: string | null) { const v = (ua || "").toLowerCase(); if (v.includes("iphone") || v.includes("android")) return "Mobile device"; if (v.includes("ipad") || v.includes("tablet")) return "Tablet"; if (v.includes("mac")) return "Mac"; if (v.includes("windows")) return "Windows PC"; return "Device" }
function isMobile(ua?: string | null) { const v = (ua || "").toLowerCase(); return v.includes("iphone") || v.includes("android") || v.includes("ipad") }
function secretFromUri(uri?: string | null) { if (!uri) return ""; try { return new URL(uri).searchParams.get("secret") || "" } catch { return "" } }

export default function AccountSecurityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { success, error } = useToast()
  const sessionQ = useSession()
  const q = useQuery({ queryKey: ["sessions"], queryFn: listSessions, enabled: open })
  const accessQ = useQuery({ queryKey: ["admin-access"], queryFn: adminAccess, enabled: open })
  const isAdmin = !!accessQ.data?.isAdmin
  const portalQ = useQuery({ queryKey: ["portal-requests", "mine"], queryFn: myPortalRequests, enabled: open })
  const adminPortalQ = useQuery({ queryKey: ["portal-requests", "admin", "pending"], queryFn: () => adminPortalRequests("pending"), enabled: open && isAdmin })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sessions"] })
  const invalidatePortal = () => { qc.invalidateQueries({ queryKey: ["portal-requests"] }); qc.invalidateQueries({ queryKey: ["notifications"] }) }
  const revokeMut = useMutation({ mutationFn: revokeSession, onSuccess: () => { success("Session revoked"); invalidate() }, onError: (e) => error((e as Error)?.message || "Couldn't revoke session") })
  const revokeOthersMut = useMutation({ mutationFn: revokeOtherSessions, onSuccess: (res) => { success(`Revoked ${res.count} other session${res.count === 1 ? "" : "s"}`); invalidate() }, onError: (e) => error((e as Error)?.message || "Couldn't revoke sessions") })
  const portalMut = useMutation({ mutationFn: createPortalRequest, onSuccess: () => { success("Branded portal request sent"); invalidatePortal() }, onError: (e) => error((e as Error)?.message || "Couldn't send request") })
  const approvePortalMut = useMutation({ mutationFn: approvePortalRequest, onSuccess: () => { success("Portal access approved"); invalidatePortal() }, onError: (e) => error((e as Error)?.message || "Couldn't approve request") })
  const rejectPortalMut = useMutation({ mutationFn: rejectPortalRequest, onSuccess: () => { success("Portal request rejected"); invalidatePortal() }, onError: (e) => error((e as Error)?.message || "Couldn't reject request") })
  const [brand, setBrand] = useState("")
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [totpUri, setTotpUri] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const pendingPortal = (portalQ.data?.requests ?? []).find((r) => r.status === "pending")
  const approvedPortal = portalQ.data?.approved
  const twoFactorEnabled = !!(sessionQ.data?.user as any)?.twoFactorEnabled
  async function start2FA() {
    setTwoFactorBusy(true)
    try {
      const res = await (authClient as any).twoFactor.enable({ password, issuer: "Dropvault" })
      if (res?.error) throw new Error(res.error.message || "Couldn't start 2FA setup")
      setTotpUri(res?.data?.totpURI || "")
      setBackupCodes(res?.data?.backupCodes || [])
      success("Authenticator setup started")
    } catch (e) { error((e as Error)?.message || "Couldn't start 2FA setup") } finally { setTwoFactorBusy(false) }
  }
  async function verify2FA() {
    setTwoFactorBusy(true)
    try {
      const res = await (authClient as any).twoFactor.verifyTotp({ code: totpCode.trim(), trustDevice: true })
      if (res?.error) throw new Error(res.error.message || "Invalid code")
      success("Two-factor authentication enabled")
      setPassword(""); setTotpUri(""); setTotpCode("")
      window.location.reload()
    } catch (e) { error((e as Error)?.message || "Invalid code") } finally { setTwoFactorBusy(false) }
  }
  async function disable2FA() {
    setTwoFactorBusy(true)
    try {
      const res = await (authClient as any).twoFactor.disable({ password })
      if (res?.error) throw new Error(res.error.message || "Couldn't disable 2FA")
      success("Two-factor authentication disabled")
      setPassword(""); setBackupCodes([])
      window.location.reload()
    } catch (e) { error((e as Error)?.message || "Couldn't disable 2FA") } finally { setTwoFactorBusy(false) }
  }
  async function regenerateBackups() {
    setTwoFactorBusy(true)
    try {
      const res = await (authClient as any).twoFactor.generateBackupCodes({ password })
      if (res?.error) throw new Error(res.error.message || "Couldn't generate backup codes")
      setBackupCodes(res?.data?.backupCodes || [])
      success("New backup codes generated")
    } catch (e) { error((e as Error)?.message || "Couldn't generate backup codes") } finally { setTwoFactorBusy(false) }
  }
  const manualSecret = secretFromUri(totpUri)
  return <AnimatePresence>{open && <motion.div variants={backdrop} initial="hidden" animate="show" exit="hidden" onClick={onClose} className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"><motion.div initial={panelInitial} animate={panelAnimate} exit={panelExit} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600"><ShieldCheck size={18} /></div><div><h2 className="text-sm font-semibold text-slate-800">Account security</h2><p className="text-xs text-slate-400">Sessions, devices, and account protection</p></div></div><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button></div><div className="max-h-[70vh] overflow-y-auto px-5 py-4"><div className="rounded-xl border border-slate-200 p-3"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><KeyRound size={17} /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">Two-factor authentication</p><p className="text-xs text-slate-500">{twoFactorEnabled ? "Enabled for password sign-ins." : "Add an authenticator app code to password sign-ins."}</p></div><span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + (twoFactorEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{twoFactorEnabled ? "On" : "Off"}</span></div><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400" />{!twoFactorEnabled && !totpUri && <button onClick={start2FA} disabled={twoFactorBusy || !password} className="mt-2 rounded-lg bg-drift-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-drift-600 disabled:opacity-50">Set up 2FA</button>}{totpUri && <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs font-medium text-slate-600">Add this setup key to your authenticator app, then enter the 6-digit code.</p><div className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs font-mono text-slate-700"><span className="min-w-0 flex-1 truncate">{manualSecret || totpUri}</span><button onClick={() => navigator.clipboard.writeText(manualSecret || totpUri)} className="text-slate-400 hover:text-slate-700"><Copy size={14} /></button></div><input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400" /><button onClick={verify2FA} disabled={twoFactorBusy || !totpCode.trim()} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">Verify and enable</button></div>}{twoFactorEnabled && <div className="mt-2 flex flex-wrap gap-2"><button onClick={regenerateBackups} disabled={twoFactorBusy || !password} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">New backup codes</button><button onClick={disable2FA} disabled={twoFactorBusy || !password} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Disable 2FA</button></div>}{backupCodes.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-800">Save these backup codes now. They are shown only once.</p><div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-amber-900">{backupCodes.map((c) => <span key={c} className="rounded bg-white/70 px-2 py-1">{c}</span>)}</div></div>}</div></div></div><div className="mt-4 rounded-xl border border-slate-200 p-3"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-50 text-purple-600"><Brush size={17} /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">Branded portal access</p><p className="text-xs text-slate-500">The portal itself is saved for later. This request only lets admins approve who can use it when it ships.</p>{approvedPortal ? <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">Approved for future branded portal access.</p> : pendingPortal ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Request pending admin approval.</p> : <div className="mt-3 space-y-2"><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand / business name optional" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400" /><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need a branded portal?" rows={2} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-drift-400" /><button onClick={() => portalMut.mutate({ requestedBrand: brand || null, reason: reason || null })} disabled={portalMut.isPending} className="rounded-lg bg-drift-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-drift-600 disabled:opacity-50">Request access</button></div>}</div></div>{isAdmin && <div className="mt-3 rounded-xl bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending portal approvals</p><span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">{adminPortalQ.data?.length ?? 0}</span></div>{adminPortalQ.isLoading ? <p className="py-3 text-center text-xs text-slate-400">Loading…</p> : (adminPortalQ.data ?? []).length === 0 ? <p className="py-3 text-center text-xs text-slate-400">No pending portal requests.</p> : <div className="space-y-2">{(adminPortalQ.data ?? []).map((r) => <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-700">{r.userEmail ?? r.userName ?? r.userId}</p><p className="text-xs text-slate-400">{r.requestedBrand || "No brand name"} · {when(r.createdAt)}</p>{r.reason && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.reason}</p>}</div><div className="flex shrink-0 gap-1"><button title="Approve" onClick={() => approvePortalMut.mutate(r.id)} className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><Check size={14} /></button><button title="Reject" onClick={() => rejectPortalMut.mutate(r.id)} className="grid h-7 w-7 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"><X size={14} /></button></div></div></div>)}</div>}</div>}</div><div className="mt-4 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-800">Active sessions</h3><p className="text-xs text-slate-400">Sign out old devices you no longer use.</p></div><button onClick={() => revokeOthersMut.mutate()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><LogOut size={14} /> Revoke others</button></div><div className="mt-3 space-y-2">{q.isLoading ? <p className="py-6 text-center text-sm text-slate-400">Loading sessions…</p> : (q.data ?? []).length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No active sessions found.</p> : (q.data ?? []).map((s: SessionItem) => <div key={s.id} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">{isMobile(s.userAgent) ? <Smartphone size={17} /> : <Laptop size={17} />}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{deviceLabel(s.userAgent)}{s.current && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">Current</span>}</p><p className="truncate text-xs text-slate-500">{s.ipAddress || "Unknown IP"} · {s.userAgent || "Unknown browser"}</p><p className="mt-0.5 text-xs text-slate-400">Last active {when(s.updatedAt)}</p></div><button disabled={s.current || revokeMut.isPending} onClick={() => revokeMut.mutate(s.id)} title={s.current ? "Current session" : "Revoke session"} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={15} /></button></div>)}</div></div></motion.div></motion.div>}</AnimatePresence>
}
