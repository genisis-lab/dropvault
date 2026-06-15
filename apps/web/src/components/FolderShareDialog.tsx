import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CalendarClock, Check, Copy, Hash, Link2, Lock, Trash2, X } from "lucide-react"
import { shareFolder, revokeFolderShare, folderShareUrl, type Folder } from "../lib/api"
import { useToast } from "./Toast"

const EXPIRY_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: "No expiry" },
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
]

const backdrop = { hidden: { opacity: 0 }, show: { opacity: 1 } }
const panelInitial = { opacity: 0, scale: 0.96, y: 10 }
const panelAnimate = { opacity: 1, scale: 1, y: 0 }
const panelExit = { opacity: 0, scale: 0.96, y: 10 }

// Configure a folder's public share link: optional password, download limit, and
// link-specific expiry. Mirrors ShareDialog. Render with key={folder?.id} so the
// internal state resets when a different folder is opened.
export default function FolderShareDialog({
  folder,
  onClose,
  onChanged,
}: {
  folder: Folder | null
  onClose: () => void
  onChanged: () => void
}) {
  const { success, error } = useToast()
  const [password, setPassword] = useState("")
  const [limit, setLimit] = useState(folder?.shareDownloadLimit ? String(folder.shareDownloadLimit) : "")
  const [expiry, setExpiry] = useState(0)
  const [url, setUrl] = useState<string | null>(folder?.shareToken ? folderShareUrl(folder.shareToken) : null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const hasLink = !!url

  async function submit() {
    if (!folder) return
    setBusy(true)
    try {
      const res = await shareFolder(folder.id, {
        password: password.trim() ? password.trim() : null,
        downloadLimit: limit.trim() ? Math.max(1, Math.floor(Number(limit))) : null,
        expiresInDays: expiry || null,
      })
      setUrl(res.url)
      try { await navigator.clipboard.writeText(res.url) } catch {}
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      success("Folder link ready & copied")
      onChanged()
    } catch (e) {
      error((e as Error)?.message || "Couldn't create link")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  async function revoke() {
    if (!folder) return
    setBusy(true)
    try {
      await revokeFolderShare(folder.id)
      success("Folder link revoked")
      onChanged()
      onClose()
    } catch (e) {
      error((e as Error)?.message || "Couldn't revoke link")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {folder && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white drive-shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-drift-50 text-drift-600">
                  <Link2 size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">Share folder</h2>
                  <p className="truncate text-xs text-slate-400" title={folder.name}>{folder.name}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Lock size={13} /> Password <span className="text-slate-400">(optional)</span>
                </span>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={folder.shareHasPassword ? "Set \u2014 type to change" : "No password"}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                />
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <Hash size={13} /> Download limit <span className="text-slate-400">(optional)</span>
                </span>
                <input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                />
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <CalendarClock size={13} /> Link expires
                </span>
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-drift-400"
                >
                  {EXPIRY_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              {url && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center gap-2">
                    <input readOnly value={url} className="min-w-0 flex-1 bg-transparent px-1 text-xs text-slate-600 outline-none" />
                    <button
                      onClick={copy}
                      className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-drift-600 ring-1 ring-slate-200 hover:bg-drift-50"
                    >
                      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-400">Anyone with the link can browse and download this folder's files until it expires or you revoke it.</p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
              {hasLink ? (
                <button
                  onClick={revoke}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Revoke
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={submit}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-drift-600 via-glow-500 to-blush-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-60"
              >
                <Link2 size={15} /> {hasLink ? "Update link" : "Create link"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
