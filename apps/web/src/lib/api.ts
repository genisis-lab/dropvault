// /api is same-origin: Vite proxies it to the local Worker in dev, and the Pages
// proxy (functions/api/[[path]].ts) forwards it to the Worker in prod. So the
// default base is "" (current origin). Override with VITE_API_URL if you point
// the web app directly at the Worker.
const API = import.meta.env.VITE_API_URL ?? ""

export type DriftFile = {
  id: string
  filename: string
  sizeBytes: number
  contentType: string | null
  status: string
  shareToken: string | null
  folderId: string | null
  createdAt: number
  expiresAt: number
}

export type Folder = {
  id: string
  name: string
  shareToken: string | null
  createdAt: number
  fileCount: number
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

// --- Files -----------------------------------------------------------------
export async function listFiles(): Promise<DriftFile[]> {
  const res = await fetch(`${API}/api/files`, { credentials: "include" })
  return (await j<{ files: DriftFile[] }>(res)).files
}

export async function presign(input: {
  filename: string
  contentType?: string
  sizeBytes?: number
  expiryDays?: number
  folderId?: string | null
}) {
  const res = await fetch(`${API}/api/files/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return j<{ id: string; uploadUrl: string; expiresAt: number }>(res)
}

// Build the upload URL on OUR origin from the id. The Pages proxy forwards it to
// the Worker, so the session cookie is sent.
export function uploadUrlFor(id: string) {
  return `${API}/api/files/${id}/upload`
}

export async function complete(id: string) {
  const res = await fetch(`${API}/api/files/${id}/complete`, { method: "POST", credentials: "include" })
  return j<{ ok: true }>(res)
}

// Adds `days` to the file's current expiry (server-side), capped at the max lifetime.
export async function extendFile(id: string, days: number) {
  const res = await fetch(`${API}/api/files/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extendDays: days }),
  })
  return j<{ ok: true; expiresAt: number }>(res)
}

// Move a file into a folder (folderId) or back to the root (null).
export async function moveFile(id: string, folderId: string | null) {
  const res = await fetch(`${API}/api/files/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  })
  return j<{ ok: true }>(res)
}

export async function deleteFile(id: string) {
  const res = await fetch(`${API}/api/files/${id}`, { method: "DELETE", credentials: "include" })
  return j<{ ok: true }>(res)
}

export function downloadUrl(id: string) {
  return `${API}/api/files/${id}/download`
}

// Create (or fetch existing) a public share link for a file.
export async function createShare(id: string) {
  const res = await fetch(`${API}/api/files/${id}/share`, { method: "POST", credentials: "include" })
  return j<{ token: string; url: string }>(res)
}

// Revoke a file's public share link.
export async function revokeShare(id: string) {
  const res = await fetch(`${API}/api/files/${id}/share`, { method: "DELETE", credentials: "include" })
  return j<{ ok: true }>(res)
}

// Public share URL for a file token (same-origin; the Pages proxy forwards to the Worker).
export function shareUrl(token: string) {
  const base = API || (typeof window !== "undefined" ? window.location.origin : "")
  return `${base}/api/share/${token}`
}

// --- Folders ---------------------------------------------------------------
export async function listFolders(): Promise<Folder[]> {
  const res = await fetch(`${API}/api/folders`, { credentials: "include" })
  return (await j<{ folders: Folder[] }>(res)).folders
}

export async function createFolder(name: string) {
  const res = await fetch(`${API}/api/folders`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
  return j<{ id: string; name: string }>(res)
}

export async function renameFolder(id: string, name: string) {
  const res = await fetch(`${API}/api/folders/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
  return j<{ ok: true; name: string }>(res)
}

export async function deleteFolder(id: string) {
  const res = await fetch(`${API}/api/folders/${id}`, { method: "DELETE", credentials: "include" })
  return j<{ ok: true }>(res)
}

// Create (or fetch existing) a public share link for a folder.
export async function shareFolder(id: string) {
  const res = await fetch(`${API}/api/folders/${id}/share`, { method: "POST", credentials: "include" })
  return j<{ token: string; url: string }>(res)
}

// Revoke a folder's public share link.
export async function revokeFolderShare(id: string) {
  const res = await fetch(`${API}/api/folders/${id}/share`, { method: "DELETE", credentials: "include" })
  return j<{ ok: true }>(res)
}

// Public share URL for a folder token (same-origin; the Pages proxy forwards to the Worker).
export function folderShareUrl(token: string) {
  const base = API || (typeof window !== "undefined" ? window.location.origin : "")
  return `${base}/api/share/folder/${token}`
}

// --- Upload (XHR for progress) ---------------------------------------------
// Upload the bytes via the Worker (XHR so we get progress events). The URL is
// same-origin, so withCredentials lets the session cookie ride along.
export function uploadToR2(uploadUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl)
    xhr.withCredentials = true
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("network error during upload"))
    xhr.send(file)
  })
}
