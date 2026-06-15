import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Clock, FileText, HardDrive, Link2, Loader2, RefreshCw, Search, Shield, Trash2, Users, X } from "lucide-react"
import {
  adminStats,
  adminUsers,
  adminFiles,
  adminRevokeFile,
  adminExtendFile,
  adminDeleteFile,
  type AdminFile,
} from "../lib/api"
import { formatBytes } from "../lib/format"
import { useToast } from "./Toast"

type Tab = "overview" | "users" | "files"
type FileFilter = "all" | "shared" | "expiring"

const DAY = 86400

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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { success: toastOk, error: toastErr } = useToast()
  const [tab, setTab] = useState<Tab>("overview")
  const [userQuery, setUserQuery] = useState("")
  const [fileQuery, setFileQuery] = useState("")
  const [fileFilter, setFileFilter] = useState<FileFilter>("all")

  const statsQ = useQuery({ queryKey: ["admin-stats"], queryFn: adminStats, enabled: open })
  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: adminUsers, enabled: open && tab === "users" })
  const filesQ = useQuery({ queryKey: ["admin-files"], queryFn: adminFiles, enabled: open && tab === "files" })

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-stats"] })
    qc.invalidateQueries({ queryKey: ["admin-users"] })
    qc.invalidateQueries({ queryKey: ["admin-files"] })
  }

  const revokeMut = useMutation({
    mutationFn: (id: string) => adminRevokeFile(id),
    onSuccess: () => {
      toastOk("Share link revoked")
      refresh()
    },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't revoke link"),
  })
  const extendMut = useMutation({
    mutationFn: (id: string) => adminExtendFile(id, 7),
    onSuccess: () => {
      toastOk("Extended by 7 days")
      refresh()
    },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't extend file"),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => adminDeleteFile(id),
    onSuccess: () => {
      toastOk("File deleted")
      refresh()
    },
    onError: (e: unknown) => toastErr((e as Error)?.message || "Couldn't delete file"),
  })

  const now = Math.floor(Date.now() / 1000)

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    const rows = usersQ.data ?? []
    if (!q) return rows
    return rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [usersQ.data, userQuery])

  const filteredFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    let rows = filesQ.data ?? []
    if (fileFilter === "shared") rows = rows.filter((f) => f.shared)
    else if (fileFilter === "expiring") rows = rows.filter((f) => f.status === "ready" && f.expiresAt - now < DAY)
    if (q) {
      rows = rows.filter(
        (f) => f.filename.toLowerCase().includes(q) || (f.ownerEmail ?? "").toLowerCase().includes(q),
      )
    }
    return rows
  }, [filesQ.data, fileQuery, fileFilter, now])

  if (!open) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "files", label: "Files" },
  ]

  const typeBreakdown = statsQ.data?.typeBreakdown ?? []
  const topUsers = statsQ.data?.topUsers ?? []
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
              <p className="text-xs text-slate-500">Manage users, files, and share links</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              aria-label="Refresh"
              title="Refresh"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <RefreshCw size={16} />
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

        <div className="flex gap-1 border-b border-slate-200 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "border-b-2 px-4 py-2.5 text-sm font-medium transition " +
                (tab === t.id ? "border-drift-500 text-drift-700" : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "overview" &&
            (statsQ.isLoading ? (
              <Loading />
            ) : statsQ.error ? (
              <ErrorNote message={(statsQ.error as Error).message} />
            ) : statsQ.data ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat icon={<Users size={16} />} label="Users" value={String(statsQ.data.userCount)} />
                  <Stat icon={<FileText size={16} />} label="Files" value={String(statsQ.data.fileCount)} />
                  <Stat icon={<HardDrive size={16} />} label="Storage" value={formatBytes(statsQ.data.totalBytes)} />
                  <Stat icon={<FileText size={16} />} label="Folders" value={String(statsQ.data.folderCount)} />
                  <Stat label="Ready files" value={String(statsQ.data.readyFileCount)} />
                  <Stat label="Shared files" value={String(statsQ.data.sharedFileCount)} />
                  <Stat label="Shared folders" value={String(statsQ.data.sharedFolderCount)} />
                  <Stat label="Expiring < 24h" value={String(statsQ.data.expiringSoonCount)} />
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
            (usersQ.isLoading ? (
              <Loading />
            ) : usersQ.error ? (
              <ErrorNote message={(usersQ.error as Error).message} />
            ) : (
              <div>
                <SearchBox value={userQuery} onChange={setUserQuery} placeholder="Search users" />
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2">User</th>
                        <th className="px-3 py-2">Files</th>
                        <th className="px-3 py-2">Storage</th>
                        <th className="px-3 py-2">Joined</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => (
                        <tr key={u.id}>
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
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2">File</th>
                        <th className="px-3 py-2">Owner</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2">Expires</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFiles.map((f) => (
                        <FileRow
                          key={f.id}
                          file={f}
                          now={now}
                          busy={revokeMut.isPending || extendMut.isPending || deleteMut.isPending}
                          onRevoke={() => revokeMut.mutate(f.id)}
                          onExtend={() => extendMut.mutate(f.id)}
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
        </div>
      </div>
    </div>
  )
}

function FileRow({
  file,
  now,
  busy,
  onRevoke,
  onExtend,
  onDelete,
}: {
  file: AdminFile
  now: number
  busy: boolean
  onRevoke: () => void
  onExtend: () => void
  onDelete: () => void
}) {
  const expiringSoon = file.status === "ready" && file.expiresAt - now < DAY
  return (
    <tr>
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
      <Loader2 size={16} className="animate-spin" /> Loading…
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
}

function Empty({ label }: { label: string }) {
  return <p className="py-10 text-center text-sm text-slate-400">{label}</p>
}
