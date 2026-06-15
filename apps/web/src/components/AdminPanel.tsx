import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react"
import {
  adminStats,
  adminUsers,
  adminUser,
  adminSetQuota,
  adminFiles,
  adminRevokeFile,
  adminExtendFile,
  adminExpireFile,
  adminDeleteFile,
  adminBulkFiles,
  adminFlags,
  adminResolveFlag,
  adminDeleteFlag,
  adminAdmins,
  adminAddAdmin,
  adminRemoveAdmin,
  adminAudit,
  shareUrl,
  type AdminFile,
  type AdminGrowthPoint,
} from "../lib/api"
import { formatBytes } from "../lib/format"
import { useToast } from "./Toast"

type Tab = "overview" | "users" | "files" | "flags" | "admins" | "audit" | "notifications"
type FileFilter = "all" | "shared" | "expiring"
type SortDir = "asc" | "desc"

const DAY = 86400
const GIB = 1024 * 1024 * 1024

const CATEGORY_COLOR: Record<string, string> = {
  images: "bg-emerald-400",
  videos: "bg-rose-400",
  audio: "bg-violet-400",
  pdf: "bg-red-400",
  archives: "bg-amber-400",
  other: "bg-slate-400",
}

function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function fmtDateTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { success: toastOk, error: toastErr } = useToast()
  const [tab, setTab] = useState<Tab>("overview")
  const [userQuery, setUserQuery] = useState("")
  const [fileQuery, setFileQuery] = useState("")
  const [fileFilter, setFileFilter] = useState<FileFilter>("all")
  const [fileFrom, setFileFrom] = useState("")
  const [fileTo, setFileTo] = useState("")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fileSort, setFileSort] = useState<{ key: string; dir: SortDir }>({ key: "created", dir: "desc" })
  const [userSort, setUserSort] = useState<{ key: string; dir: SortDir }>({ key: "storage", dir: "desc" })
  const [flagStatus, setFlagStatus] = useState<"open" | "resolved" | "all">("open")
  const [newAdmin, setNewAdmin] = useState("")

  const statsQ = useQuery({ queryKey: ["admin-stats"], queryFn: adminStats, enabled: open })
  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: adminUsers, enabled: open && tab === "users" })
  const filesQ = useQuery({ queryKey: ["admin-files"], queryFn: adminFiles, enabled: open && tab === "files" })
  const flagsQ = useQuery({
    queryKey: ["admin-flags", flagStatus],
    queryFn: () => adminFlags(flagStatus === "all" ? undefined : flagStatus),
    enabled: open && tab === "flags",
  })
  const adminsQ = useQuery({ queryKey: ["admin-admins"], queryFn: adminAdmins, enabled: open && tab === "admins" })
  const auditQ = useQuery({ queryKey: ["admin-audit"], queryFn: () => adminAudit(200), enabled: open && tab === "audit" })

  const refreshing =
    statsQ.isFetching ||
    usersQ.isFetching ||
    filesQ.isFetching ||
    flagsQ.isFetching ||
    adminsQ.isFetching ||
    auditQ.isFetching

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-stats"] })
    qc.invalidateQueries({ queryKey: ["admin-users"] })
    qc.invalidateQueries({ queryKey: ["admin-files"] })
    qc.invalidateQueries({ queryKey: ["admin-flags"] })
    qc.invalidateQueries({ queryKey: ["admin-admins"] })
    qc.invalidateQueries({ queryKey: ["admin-audit"] })
  }

  const revokeMut = useMutation({
    mutationFn: (id: string) => adminRevokeFile(id),
    onSuccess: () => { toastOk("Share link revoked"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't revoke link"),
  })
  const extendMut = useMutation({
    mutationFn: (id: string) => adminExtendFile(id, 7),
    onSuccess: () => { toastOk("Extended by 7 days"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't extend file"),
  })
  const expireMut = useMutation({
    mutationFn: (id: string) => adminExpireFile(id),
    onSuccess: () => { toastOk("File expired"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't expire file"),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFile(id),
    onSuccess: () => { toastOk("File deleted"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't delete file"),
  })
  const bulkMut = useMutation({
    mutationFn: (v: { action: "revoke" | "delete" | "expire" | "extend"; ids: string[]; days?: number }) =>
      adminBulkFiles(v.action, v.ids, v.days),
    onSuccess: (r) => { toastOk(`Updated ${r.count} file${r.count === 1 ? "" : "s"}`); setSelected(new Set()); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Bulk action failed"),
  })
  const resolveFlagMut = useMutation({
    mutationFn: (id: string) => adminResolveFlag(id),
    onSuccess: () => { toastOk("Flag resolved"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't resolve flag"),
  })
  const deleteFlagMut = useMutation({
    mutationFn: (id: string) => adminDeleteFlag(id),
    onSuccess: () => { toastOk("Flag deleted"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't delete flag"),
  })
  const addAdminMut = useMutation({
    mutationFn: (email: string) => adminAddAdmin(email),
    onSuccess: () => { toastOk("Admin added"); setNewAdmin(""); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't add admin"),
  })
  const removeAdminMut = useMutation({
    mutationFn: (email: string) => adminRemoveAdmin(email),
    onSuccess: () => { toastOk("Admin removed"); refresh() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't remove admin"),
  })

  const now = Math.floor(Date.now() / 1000)
  const fromSec = fileFrom ? Math.floor(new Date(fileFrom).getTime() / 1000) : null
  const toSec = fileTo ? Math.floor(new Date(fileTo).getTime() / 1000) + DAY : null

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    let rows = [...(usersQ.data ?? [])]
    if (q) rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    const dir = userSort.dir === "asc" ? 1 : -1
    rows.sort((a, b) => {
      if (userSort.key === "name") return a.name.localeCompare(b.name) * dir
      if (userSort.key === "files") return (a.fileCount - b.fileCount) * dir
      if (userSort.key === "joined") return (a.createdAt - b.createdAt) * dir
      return (a.totalBytes - b.totalBytes) * dir
    })
    return rows
  }, [usersQ.data, userQuery, userSort])

  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    let rows = [...(filesQ.data ?? [])]
    if (fileFilter === "shared") rows = rows.filter((f) => f.shared)
    else if (fileFilter === "expiring") rows = rows.filter((f) => f.status === "ready" && f.expiresAt - now < DAY)
    if (fromSec != null) rows = rows.filter((f) => f.createdAt >= fromSec)
    if (toSec != null) rows = rows.filter((f) => f.createdAt <= toSec)
    if (q) rows = rows.filter((f) => f.filename.toLowerCase().includes(q) || (f.ownerEmail ?? "").toLowerCase().includes(q))
    const dir = fileSort.dir === "asc" ? 1 : -1
    rows.sort((a, b) => {
      if (fileSort.key === "name") return a.filename.localeCompare(b.filename) * dir
      if (fileSort.key === "size") return (a.sizeBytes - b.sizeBytes) * dir
      if (fileSort.key === "owner") return (a.ownerEmail ?? "").localeCompare(b.ownerEmail ?? "") * dir
      if (fileSort.key === "expires") return (a.expiresAt - b.expiresAt) * dir
      return (a.createdAt - b.createdAt) * dir
    })
    return rows
  }, [filesQ.data, fileQuery, fileFilter, fromSec, toSec, fileSort, now])

  if (!open) return null

  function toggleSel(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === filteredFiles.length && filteredFiles.length > 0 ? new Set() : new Set(filteredFiles.map((f) => f.id)),
    )
  }
  const selIds = Array.from(selected)
  const bulkBusy = bulkMut.isPending
  const rowBusy = revokeMut.isPending || extendMut.isPending || expireMut.isPending || deleteMut.isPending

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "files", label: "Files" },
    { id: "flags", label: "Flags" },
    { id: "admins", label: "Admins" },
    { id: "audit", label: "Audit" },
    { id: "notifications", label: "Notifications" },
  ]

  const s = statsQ.data
  const typeBreakdown = s?.typeBreakdown ?? []
  const topUsers = s?.topUsers ?? []
  const growth = s?.growth ?? []
  const maxTypeBytes = Math.max(1, ...typeBreakdown.map((t) => t.bytes))
  const maxUserBytes = Math.max(1, ...topUsers.map((u) => u.totalBytes))

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8">
      <button className="fixed inset-0 -z-10 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="mt-6 w-full max-w-4xl rounded-3xl border border-slate-200 bg-white drive-shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-drift-500/10 text-drift-600">
              <Shield size={18} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Admin console</h2>
              <p className="text-xs text-slate-500">Manage users, files, share links, and abuse reports</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-default disabled:opacity-60"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
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
                (tab === t.id ? "border-drift-500 text-drift-700" : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              {t.label}
              {t.id === "flags" && s && s.flagCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {s.flagCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "overview" &&
            (statsQ.isLoading ? (
              <Loading />
            ) : statsQ.error ? (
              <ErrorNote message={(statsQ.error as Error).message} />
            ) : s ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat icon={<Users size={16} />} label="Users" value={String(s.userCount)} />
                  <Stat icon={<FileText size={16} />} label="Files" value={String(s.fileCount)} />
                  <Stat icon={<HardDrive size={16} />} label="Storage" value={formatBytes(s.totalBytes)} />
                  <Stat icon={<FileText size={16} />} label="Folders" value={String(s.folderCount)} />
                  <Stat label="Ready files" value={String(s.readyFileCount)} />
                  <Stat label="Shared files" value={String(s.sharedFileCount)} />
                  <Stat icon={<Flag size={16} />} label="Open flags" value={String(s.flagCount)} />
                  <Stat icon={<Shield size={16} />} label="Admins" value={String(s.adminCount)} />
                </div>

                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Files uploaded (last 30 days)</h3>
                  <GrowthChart data={growth} />
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Storage by type</h3>
                    {typeBreakdown.length === 0 ? (
                      <Empty label="No stored files yet." />
                    ) : (
                      <div className="space-y-2.5">
                        {typeBreakdown.map((t) => (
                          <div key={t.category}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-600">{cap(t.category)}</span>
                              <span className="text-slate-400">
                                {formatBytes(t.bytes)} · {t.count}
                              </span>
                            </div>
                            <Bar pct={(t.bytes / maxTypeBytes) * 100} className={CATEGORY_COLOR[t.category] ?? "bg-slate-400"} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Top users by storage</h3>
                    {topUsers.length === 0 ? (
                      <Empty label="No users with files yet." />
                    ) : (
                      <div className="space-y-2.5">
                        {topUsers.map((u) => (
                          <div key={u.id}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="truncate font-medium text-slate-600">{u.email ?? u.name}</span>
                              <span className="shrink-0 text-slate-400">
                                {formatBytes(u.totalBytes)} · {u.fileCount}
                              </span>
                            </div>
                            <Bar pct={(u.totalBytes / maxUserBytes) * 100} className="bg-drift-400" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null)}

          {tab === "users" &&
            (selectedUserId ? (
              <UserDetail id={selectedUserId} onBack={() => setSelectedUserId(null)} onChanged={refresh} />
            ) : usersQ.isLoading ? (
              <Loading />
            ) : usersQ.error ? (
              <ErrorNote message={(usersQ.error as Error).message} />
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <SearchBox value={userQuery} onChange={setUserQuery} placeholder="Search users" />
                  </div>
                  <button
                    onClick={() =>
                      downloadCsv("dropvault-users.csv", [
                        ["Name", "Email", "Files", "Bytes", "Quota bytes", "Joined", "Admin"],
                        ...filteredUsers.map((u) => [
                          u.name,
                          u.email,
                          u.fileCount,
                          u.totalBytes,
                          u.quotaBytes ?? "",
                          fmtDate(u.createdAt),
                          u.isAdmin ? "yes" : "no",
                        ]),
                      ])
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <Download size={14} /> Export
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <SortTh label="User" k="name" sort={userSort} setSort={setUserSort} />
                        <SortTh label="Files" k="files" sort={userSort} setSort={setUserSort} />
                        <SortTh label="Storage" k="storage" sort={userSort} setSort={setUserSort} />
                        <th className="px-3 py-2">Quota</th>
                        <SortTh label="Joined" k="joined" sort={userSort} setSort={setUserSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => (
                        <tr
                          key={u.id}
                          onClick={() => setSelectedUserId(u.id)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 font-medium text-slate-700">
                              {u.name}
                              {u.isAdmin && (
                                <span className="rounded-full bg-drift-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-drift-600">
                                  Admin
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">{u.email}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{u.fileCount}</td>
                          <td className="px-3 py-2.5 text-slate-600">{formatBytes(u.totalBytes)}</td>
                          <td className="px-3 py-2.5 text-slate-500">{u.quotaBytes == null ? "Unlimited" : formatBytes(u.quotaBytes)}</td>
                          <td className="px-3 py-2.5 text-slate-500">{fmtDate(u.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredUsers.length === 0 && <Empty label="No matching users." />}
                </div>
              </div>
            ))}

          {tab === "files" &&
            (filesQ.isLoading ? (
              <Loading />
            ) : filesQ.error ? (
              <ErrorNote message={(filesQ.error as Error).message} />
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <SearchBox value={fileQuery} onChange={setFileQuery} placeholder="Search files or owners" />
                  </div>
                  <select
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value as FileFilter)}
                    aria-label="Filter files"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 outline-none transition focus:border-drift-400"
                  >
                    <option value="all">All files</option>
                    <option value="shared">Shared</option>
                    <option value="expiring">Expiring &lt; 24h</option>
                  </select>
                  <button
                    onClick={() =>
                      downloadCsv("dropvault-files.csv", [
                        ["Filename", "Owner", "Bytes", "Status", "Shared", "Created", "Expires"],
                        ...filteredFiles.map((f) => [
                          f.filename,
                          f.ownerEmail ?? f.ownerId,
                          f.sizeBytes,
                          f.status,
                          f.shared ? "yes" : "no",
                          fmtDate(f.createdAt),
                          fmtDate(f.expiresAt),
                        ]),
                      ])
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <Download size={14} /> Export
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Created between</span>
                  <input
                    type="date"
                    value={fileFrom}
                    onChange={(e) => setFileFrom(e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-drift-400"
                  />
                  <span>and</span>
                  <input
                    type="date"
                    value={fileTo}
                    onChange={(e) => setFileTo(e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-drift-400"
                  />
                  {(fileFrom || fileTo) && (
                    <button onClick={() => { setFileFrom(""); setFileTo("") }} className="text-drift-600 hover:underline">
                      Clear
                    </button>
                  )}
                </div>

                {selected.size > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-drift-200 bg-drift-50 px-3 py-2 text-sm">
                    <span className="font-medium text-drift-700">{selected.size} selected</span>
                    <div className="flex-1" />
                    <button
                      disabled={bulkBusy}
                      onClick={() => bulkMut.mutate({ action: "extend", ids: selIds, days: 7 })}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Extend 7d
                    </button>
                    <button
                      disabled={bulkBusy}
                      onClick={() => bulkMut.mutate({ action: "revoke", ids: selIds })}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Revoke links
                    </button>
                    <button
                      disabled={bulkBusy}
                      onClick={() => bulkMut.mutate({ action: "expire", ids: selIds })}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Expire now
                    </button>
                    <button
                      disabled={bulkBusy}
                      onClick={() => {
                        if (window.confirm(`Delete ${selIds.length} file(s)? This cannot be undone.`)) {
                          bulkMut.mutate({ action: "delete", ids: selIds })
                        }
                      }}
                      className="rounded-lg bg-red-500 px-2.5 py-1.5 font-medium text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-slate-600">
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
                            aria-label="Select all"
                            checked={selected.size > 0 && selected.size === filteredFiles.length}
                            onChange={toggleAll}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </th>
                        <SortTh label="File" k="name" sort={fileSort} setSort={setFileSort} />
                        <SortTh label="Owner" k="owner" sort={fileSort} setSort={setFileSort} />
                        <SortTh label="Size" k="size" sort={fileSort} setSort={setFileSort} />
                        <SortTh label="Expires" k="expires" sort={fileSort} setSort={setFileSort} />
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFiles.map((f) => (
                        <FileRow
                          key={f.id}
                          file={f}
                          now={now}
                          busy={rowBusy}
                          selected={selected.has(f.id)}
                          onToggle={() => toggleSel(f.id)}
                          onRevoke={() => revokeMut.mutate(f.id)}
                          onExtend={() => extendMut.mutate(f.id)}
                          onExpire={() => expireMut.mutate(f.id)}
                          onDelete={() => {
                            if (window.confirm(`Delete \u201c${f.filename}\u201d? This removes it for its owner and cannot be undone.`)) {
                              deleteMut.mutate(f.id)
                            }
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                  {filteredFiles.length === 0 && <Empty label="No matching files." />}
                </div>
              </div>
            ))}

          {tab === "flags" &&
            (flagsQ.isLoading ? (
              <Loading />
            ) : flagsQ.error ? (
              <ErrorNote message={(flagsQ.error as Error).message} />
            ) : (
              <div>
                <div className="flex items-center gap-1">
                  {(["open", "resolved", "all"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setFlagStatus(st)}
                      className={
                        "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                        (flagStatus === st ? "bg-drift-500/10 text-drift-700" : "text-slate-500 hover:bg-slate-100")
                      }
                    >
                      {cap(st)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {(flagsQ.data ?? []).map((fl) => (
                    <div key={fl.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <Flag size={14} className="text-red-500" />
                            <span className="truncate">{fl.filename ?? "(file removed)"}</span>
                            {!fl.fileExists && (
                              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                                Gone
                              </span>
                            )}
                            {fl.status === "resolved" && (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600">
                                Resolved
                              </span>
                            )}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{fl.reason}</p>
                          <div className="mt-1 text-xs text-slate-400">
                            {fl.reporterEmail ? fl.reporterEmail + " · " : ""}
                            {fmtDateTime(fl.createdAt)}
                            {fl.ownerEmail ? " · owner " + fl.ownerEmail : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {fl.token && (
                            <a
                              href={shareUrl(fl.token)}
                              target="_blank"
                              rel="noopener"
                              title="Open share link"
                              aria-label="Open share link"
                              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          {fl.status !== "resolved" && (
                            <button
                              onClick={() => resolveFlagMut.mutate(fl.id)}
                              disabled={resolveFlagMut.isPending}
                              title="Mark resolved"
                              aria-label="Mark resolved"
                              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                            >
                              <Check size={15} />
                            </button>
                          )}
                          <button
                            onClick={() => deleteFlagMut.mutate(fl.id)}
                            disabled={deleteFlagMut.isPending}
                            title="Delete report"
                            aria-label="Delete report"
                            className="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(flagsQ.data ?? []).length === 0 && <Empty label="No reports here." />}
                </div>
              </div>
            ))}

          {tab === "admins" &&
            (adminsQ.isLoading ? (
              <Loading />
            ) : adminsQ.error ? (
              <ErrorNote message={(adminsQ.error as Error).message} />
            ) : (
              <div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const email = newAdmin.trim()
                    if (email) addAdminMut.mutate(email)
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
                  <button
                    type="submit"
                    disabled={addAdminMut.isPending || !newAdmin.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-drift-500 px-3 py-2 text-sm font-medium text-white hover:bg-drift-600 disabled:opacity-50"
                  >
                    <Plus size={15} /> Add admin
                  </button>
                </form>
                <p className="mt-2 text-xs text-slate-400">
                  Admins set in the ADMIN_EMAILS environment variable are permanent and managed in your deploy config.
                </p>
                <div className="mt-3 space-y-2">
                  {(adminsQ.data ?? []).map((a) => (
                    <div key={a.email} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <span className="truncate">{a.email}</span>
                          <span
                            className={
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
                              (a.source === "env" ? "bg-slate-100 text-slate-500" : "bg-drift-500/10 text-drift-600")
                            }
                          >
                            {a.source === "env" ? "Env" : "Added"}
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
                        disabled={a.source === "env" || removeAdminMut.isPending}
                        title={a.source === "env" ? "Managed via environment variable" : "Remove admin"}
                        aria-label="Remove admin"
                        className="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {(adminsQ.data ?? []).length === 0 && <Empty label="No admins configured." />}
                </div>
              </div>
            ))}

          {tab === "audit" &&
            (auditQ.isLoading ? (
              <Loading />
            ) : auditQ.error ? (
              <ErrorNote message={(auditQ.error as Error).message} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Admin</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(auditQ.data ?? []).map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{fmtDateTime(a.createdAt)}</td>
                        <td className="px-3 py-2.5 text-slate-600">{a.actorEmail ?? "\u2014"}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{a.action}</span>
                        </td>
                        <td className="max-w-[18rem] truncate px-3 py-2.5 text-slate-500" title={a.detail ?? a.targetId ?? ""}>
                          {a.detail ?? (a.targetType ? a.targetType + " " + (a.targetId ?? "") : "\u2014")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(auditQ.data ?? []).length === 0 && <Empty label="No admin activity yet." />}
              </div>
            ))}

          {tab === "notifications" && <NotificationsPlaceholder />}
        </div>
      </div>
    </div>
  )
}

function UserDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { success: toastOk, error: toastErr } = useToast()
  const q = useQuery({ queryKey: ["admin-user", id], queryFn: () => adminUser(id) })
  const [gb, setGb] = useState("")
  const quotaMut = useMutation({
    mutationFn: (bytes: number | null) => adminSetQuota(id, bytes),
    onSuccess: () => { toastOk("Quota updated"); setGb(""); q.refetch(); onChanged() },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't update quota"),
  })

  return (
    <div>
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ChevronLeft size={15} /> Back to users
      </button>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : q.data ? (
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800">{q.data.user.name}</h3>
              {q.data.user.isAdmin && (
                <span className="rounded-full bg-drift-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-drift-600">
                  Admin
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">{q.data.user.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              Joined {fmtDate(q.data.user.createdAt)} · {q.data.user.fileCount} files · {formatBytes(q.data.user.totalBytes)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Storage quota</h4>
            <p className="mt-1 text-sm text-slate-600">
              Current: {q.data.user.quotaBytes == null ? "Unlimited" : formatBytes(q.data.user.quotaBytes)}
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
                  const n = parseFloat(gb)
                  if (!isNaN(n) && n >= 0) quotaMut.mutate(Math.round(n * GIB))
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

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Files</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.files.map((f) => (
                    <tr key={f.id}>
                      <td className="max-w-[18rem] truncate px-3 py-2.5 text-slate-700" title={f.filename}>
                        {f.filename}
                        {f.shared && <span className="ml-1.5 text-xs text-drift-600">· shared</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{formatBytes(f.sizeBytes)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{fmtDate(f.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {q.data.files.length === 0 && <Empty label="No files." />}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotificationsPlaceholder() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-drift-200 bg-drift-50 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-drift-500/10 text-drift-600">
          <Bell size={18} />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
            <span className="rounded-full bg-drift-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-drift-600">
              Coming soon
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Get alerted when something needs attention — new abuse reports, storage spikes, or files about to expire.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4 opacity-70">
          <h4 className="text-sm font-semibold text-slate-700">Email digests</h4>
          <p className="mt-1 text-sm text-slate-500">A daily or weekly summary of activity and open flags, sent to admins.</p>
          <input
            disabled
            placeholder="admin@example.com"
            className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
          />
        </div>
        <div className="rounded-2xl border border-slate-200 p-4 opacity-70">
          <h4 className="text-sm font-semibold text-slate-700">Webhooks</h4>
          <p className="mt-1 text-sm text-slate-500">POST events (new flag, file deleted, quota exceeded) to a URL of your choice.</p>
          <input
            disabled
            placeholder="https://hooks.example.com/dropvault"
            className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
          />
        </div>
      </div>
      <p className="text-center text-xs text-slate-400">These integrations aren't wired up yet — the UI is here so it's ready to flip on.</p>
    </div>
  )
}

function FileRow({
  file,
  now,
  busy,
  selected,
  onToggle,
  onRevoke,
  onExtend,
  onExpire,
  onDelete,
}: {
  file: AdminFile
  now: number
  busy: boolean
  selected: boolean
  onToggle: () => void
  onRevoke: () => void
  onExtend: () => void
  onExpire: () => void
  onDelete: () => void
}) {
  const expiringSoon = file.status === "ready" && file.expiresAt - now < DAY
  return (
    <tr className={selected ? "bg-drift-500/5" : ""}>
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label="Select file"
          className="h-4 w-4 rounded border-slate-300"
        />
      </td>
      <td className="max-w-[16rem] px-3 py-2.5">
        <div className="truncate font-medium text-slate-700" title={file.filename}>
          {file.filename}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          {file.status}
          {file.shared && <span className="text-drift-600">· shared</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-slate-500">{file.ownerEmail ?? file.ownerId}</td>
      <td className="px-3 py-2.5 text-slate-600">{formatBytes(file.sizeBytes)}</td>
      <td className={"px-3 py-2.5 " + (expiringSoon ? "text-red-600" : "text-slate-500")}>{fmtDate(file.expiresAt)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {file.shareToken && (
            <a
              href={shareUrl(file.shareToken)}
              target="_blank"
              rel="noopener"
              title="Open share link"
              aria-label="Open share link"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <ExternalLink size={15} />
            </a>
          )}
          <button
            onClick={onExtend}
            disabled={busy}
            title="Extend 7 days"
            aria-label="Extend 7 days"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <Clock size={15} />
          </button>
          <button
            onClick={onExpire}
            disabled={busy}
            title="Expire now"
            aria-label="Expire now"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-amber-600 disabled:opacity-40"
          >
            <Ban size={15} />
          </button>
          <button
            onClick={onRevoke}
            disabled={busy || !file.shared}
            title={file.shared ? "Revoke share link" : "Not shared"}
            aria-label="Revoke share link"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
          >
            <Link2 size={15} />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            title="Delete file"
            aria-label="Delete file"
            className="grid h-8 w-8 place-items-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function SortTh({
  label,
  k,
  sort,
  setSort,
}: {
  label: string
  k: string
  sort: { key: string; dir: SortDir }
  setSort: (v: { key: string; dir: SortDir }) => void
}) {
  const active = sort.key === k
  return (
    <th className="px-3 py-2">
      <button
        onClick={() => setSort({ key: k, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
        className="flex items-center gap-1 uppercase tracking-wide hover:text-slate-600"
      >
        {label}
        {active && <span className="text-[10px]">{sort.dir === "asc" ? "\u2191" : "\u2193"}</span>}
      </button>
    </th>
  )
}

function GrowthChart({ data }: { data: AdminGrowthPoint[] }) {
  const points = data ?? []
  if (points.length === 0) return <Empty label="No activity yet." />
  const maxFiles = Math.max(1, ...points.map((p) => p.files))
  return (
    <div>
      <div className="flex h-28 items-end gap-1">
        {points.map((p) => (
          <div
            key={p.date}
            className="flex-1 rounded-t bg-drift-400"
            style={barStyle((p.files / maxFiles) * 100)}
            title={`${p.date}: ${p.files} file${p.files === 1 ? "" : "s"}, ${p.users} new user${p.users === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function barStyle(pct: number): React.CSSProperties {
  return { height: `${Math.max(3, Math.min(100, pct))}%` }
}

function Bar({ pct, className }: { pct: number; className: string }) {
  const style = { width: `${Math.max(2, Math.min(100, pct))}%` }
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={"h-full rounded-full " + className} style={style} />
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-drift-400"
      />
    </div>
  )
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-800">{value}</div>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" /> Loading\u2026
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
}

function Empty({ label }: { label: string }) {
  return <p className="py-10 text-center text-sm text-slate-400">{label}</p>
}
