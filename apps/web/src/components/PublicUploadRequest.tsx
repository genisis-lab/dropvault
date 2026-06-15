import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, UploadCloud } from "lucide-react"
import { publicUploadRequest, submitPublicUpload } from "../lib/api"

function tokenFromPath(): string { return window.location.pathname.split("/").filter(Boolean).pop() ?? "" }

export default function PublicUploadRequest() {
  const token = useMemo(tokenFromPath, [])
  const [file, setFile] = useState<File | null>(null)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const q = useQuery({ queryKey: ["public-upload-request", token], queryFn: () => publicUploadRequest(token), enabled: !!token })
  const mut = useMutation({ mutationFn: async () => { const form = new FormData(); if (file) form.append("file", file); form.append("email", email); form.append("name", name); form.append("password", password); return submitPublicUpload(token, form) }, onSuccess: () => setFile(null) })

  return <div className="grid min-h-screen place-items-center px-4 py-10"><div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 drive-shadow-lg"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-drift-500/10 text-drift-600"><UploadCloud size={22} /></span><div><h1 className="text-xl font-bold text-slate-800">{q.data?.title ?? "Upload files"}</h1><p className="text-sm text-slate-500">DropVault public upload request</p></div></div>{q.isLoading ? <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading...</div> : q.error ? <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{(q.error as Error).message}</p> : q.data ? <form onSubmit={(e) => { e.preventDefault(); if (file) mut.mutate() }} className="mt-6 space-y-3"><p className="whitespace-pre-wrap text-sm text-slate-600">{q.data.instructions || "Choose a file to upload."}</p>{q.data.hasPassword && <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" />}{q.data.requireEmail && <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" />}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name optional" className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-drift-400" /><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500" /><button disabled={!file || mut.isPending} className="w-full rounded-xl bg-drift-500 px-4 py-3 text-sm font-semibold text-white hover:bg-drift-600 disabled:opacity-50">{mut.isPending ? "Uploading..." : "Upload file"}</button>{mut.isSuccess && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Upload complete. Thank you!</p>}{mut.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{(mut.error as Error).message}</p>}<p className="text-xs text-slate-400">{q.data.uploadLimit ? `${q.data.uploadCount} / ${q.data.uploadLimit} uploads used` : `${q.data.uploadCount} uploads so far`}</p></form> : null}</div></div>
}
