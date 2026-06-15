import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, HardDrive, Loader2, Shield, Users, X } from "lucide-react"
import { adminStats, adminUsers, adminFiles } from "../lib/api"
import { formatBytes } from "../lib/format"

type Tab = "overview" | "users" | "files"

function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview")

  const statsQ = useQuery({ queryKey: ["admin-stats"], queryFn: adminStats, enabled: open })
  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: adminUsers, enabled: open && tab === "users" })
  const filesQ = useQuery({ queryKey: ["admin-files"], queryFn: adminFiles, enabled: open && tab === "files" })

  if (!open) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "files", label: "Files" },
  ]

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
              <h2 className="text-lg font-bold text-slate-800">Admin</h2>
              <p className="text-xs text-slate-500">Read-only workspace overview</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
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
            ) : null)}

          {tab === "users" &&
            (usersQ.isLoading ? (
              <Loading />
            ) : usersQ.error ? (
              <ErrorNote message={(usersQ.error as Error).message} />
            ) : (
              <div className="overflow-x-auto">
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
                    {(usersQ.data ?? []).map((u) => (
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
                {(usersQ.data ?? []).length === 0 && <Empty label="No users yet." />}
              </div>
            ))}

          {tab === "files" &&
            (filesQ.isLoading ? (
              <Loading />
            ) : filesQ.error ? (
              <ErrorNote message={(filesQ.error as Error).message} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Owner</th>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(filesQ.data ?? []).map((f) => (
                      <tr key={f.id}>
                        <td className="max-w-[16rem] px-3 py-2.5">
                          <div className="truncate font-medium text-slate-700">{f.filename}</div>
                          {f.shared && <span className="text-xs text-drift-600">shared</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{f.ownerEmail ?? f.ownerId}</td>
                        <td className="px-3 py-2.5 text-slate-600">{formatBytes(f.sizeBytes)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{f.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(filesQ.data ?? []).length === 0 && <Empty label="No files yet." />}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
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
