import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2, UploadCloud, X } from "lucide-react"
import { publicUploadRequest, submitPublicUpload } from "../lib/api"
import { formatBytes } from "../lib/format"

function tokenFromPath(): string { return window.location.pathname.split("/").filter(Boolean).pop() ?? "" }

export default function PublicUploadRequest() {
  const token = useMemo(tokenFromPath, [])
  const [files, setFiles] = useState<File[]>([])
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const q = useQuery({ queryKey: ["public-upload-request", token], queryFn: () => publicUploadRequest(token), enabled: !!token })
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const maxFileSize = q.data?.maxFileSize ?? null
  const totalMaxBytes = q.data?.totalMaxBytes ?? null
  const fileLimitExceeded = !!maxFileSize && files.some((f) => f.size > maxFileSize)
  const totalLimitExceeded = !!totalMaxBytes && totalBytes > totalMaxBytes
  const remainingUploads = q.data?.uploadLimit ? Math.max(0, q.data.uploadLimit - q.data.uploadCount) : null
  const tooManyFiles = remainingUploads != null && files.length > remainingUploads
  const mut = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      for (const file of files) form.append("files", file)
      form.append("email", email)
      form.append("name", name)
      form.append("password", password)
      return submitPublicUpload(token, form)
    },
    onSuccess: (res) => { setFiles([]); setMessage(res.message || (res.pending ? "Upload received and waiting for review." : "Upload complete. Thank you!")); q.refetch() },
  })

  function removeFile(index: number) { setFiles((prev) => prev.filter((_, i) => i !== index)) }
  const canSubmit = files.length > 0 && !fileLimitExceeded && !totalLimitExceeded && !tooManyFiles && !mut.isPending

  return <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"><div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 drive-shadow-lg"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-drift-500/10 text-drift-600"><UploadCloud size={22} /></span><div><h1 className="text-xl font-bold text-slate-800">{q.data?.title ?? "Upload files"}</h1><p className="text-sm text-slate-500">Dropvault public upload request</p></div></div>{q.isLoading ? <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading...</div> : q.error ? <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{(q.error as Error).message}</p> : q.data ? <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate() }} className="mt-6 space-y-3"><p className="whitespace-pre-wrap text-sm text-slate-600">{q.data.instructions || "Choose one or more files to upload."}</p>{q.data.status === "closed" && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">This upload request is closed.</p>}{q.data.hasPassword && <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" />}{q.data.requireEmail && <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" />}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name optional" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" /><label className="block rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 transition hover:border-drift-300 hover:bg-drift-50/30"><input type="file" multiple onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setMessage(null) }} className="sr-only" /><UploadCloud className="mx-auto mb-2 text-slate-400" size={28} /><span className="font-medium text-slate-700">Choose files</span><span className="block text-xs text-slate-400">Multi-file uploads supported</span></label>{files.length > 0 && <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between text-xs font-medium text-slate-500"><span>{files.length} file{files.length === 1 ? "" : "s"}</span><span>{formatBytes(totalBytes)}</span></div>{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-700">{file.name}</p><p className="text-xs text-slate-400">{formatBytes(file.size)}</p></div><button type="button" onClick={() => removeFile(index)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button></div>)}</div>}{q.data.moderationMode === "manual" && <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">Uploads will be held for owner review before appearing in the vault.</p>}{fileLimitExceeded && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">One or more files exceed the per-file limit of {formatBytes(maxFileSize || 0)}.</p>}{totalLimitExceeded && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">Selected files exceed this request's total limit of {formatBytes(totalMaxBytes || 0)}.</p>}{tooManyFiles && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">This request only has {remainingUploads} upload slot{remainingUploads === 1 ? "" : "s"} left.</p>}<button disabled={!canSubmit || q.data.status === "closed"} className="w-full rounded-xl bg-drift-500 px-4 py-3 text-sm font-semibold text-white hover:bg-drift-600 disabled:opacity-50">{mut.isPending ? "Uploading..." : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}</button>{(mut.isSuccess || message) && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 size={16} /> {message || "Upload complete. Thank you!"}</p>}{mut.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{(mut.error as Error).message}</p>}<div className="grid gap-1 text-xs text-slate-400 sm:grid-cols-2"><p>{q.data.uploadLimit ? `${q.data.uploadCount} / ${q.data.uploadLimit} uploads used` : `${q.data.uploadCount} uploads so far`}</p>{q.data.totalMaxBytes && <p className="sm:text-right">Total cap: {formatBytes(q.data.totalMaxBytes)}</p>}{q.data.maxFileSize && <p>Per-file cap: {formatBytes(q.data.maxFileSize)}</p>}{q.data.allowedTypes && <p className="sm:text-right">Allowed: {q.data.allowedTypes}</p>}</div></form> : null}</div></div>
}
