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
  // Share-link protections (file links only). The server never returns the
  // password itself \u2014 only whether one is set.
  shareHasPassword?: boolean
  shareDownloadLimit?: number | null
  shareDownloadCount?: number
  shareExpiresAt?: number | null
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

// Rename a file.
export async function renameFile(id: string, filename: string) {
  const res = await fetch(`${API}/api/files/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  })
  return j<{ ok: true; filename: string }>(res)
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

// Inline (in-browser) URL for owner previews and thumbnails. Same bytes as
// download but served with an inline Content-Disposition.
export function inlineUrl(id: string) {
  return `${API}/api/files/${id}/inline`
}

// Optional protections for a file share link. Omit a field to leave it unset;
// pass null to clear it. Any provided option resets the download counter.
export type ShareOptions = {
  password?: string | null
  downloadLimit?: number | null
  expiresInDays?: number | null
}

export type ShareResult = {
  token: string
  url: string
  hasPassword?: boolean
  downloadLimit?: number | null
  shareExpiresAt?: number | null
}

// Create (or update) a public share link for a file. With no options it simply
// ensures a token exists; with options it (re)configures the link protections.
export async function createShare(id: string, options?: ShareOptions): Promise<ShareResult> {
  const res = await fetch(`${API}/api/files/${id}/share`, {
    method: "POST",
    credentials: "include",
    headers: options ? { "Content-Type": "application/json" } : undefined,
    body: options ? JSON.stringify(options) : undefined,
  })
  return j<ShareResult>(res)
}

// Revoke a file's public share link (also clears any link protections).
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

// --- Multipart upload (large files) ----------------------------------------
// Files larger than this are uploaded in parts so no single request approaches
// the Worker's ~100MB body limit.
export const MULTIPART_THRESHOLD = 90 * 1024 * 1024 // 90 MiB
// R2 requires every part except the last to be the same size (>=5MiB). 32MiB is
// a good balance of request count vs. Worker memory per part.
const PART_SIZE = 32 * 1024 * 1024

type UploadedPart = { partNumber: number; etag: string }

async function startMultipart(id: string) {
  const res = await fetch(`${API}/api/files/${id}/multipart/start`, { method: "POST", credentials: "include" })
  return j<{ uploadId: string; key: string }>(res)
}

function putPart(
  id: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  onLoaded: (loaded: number) => void,
): Promise<UploadedPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const url = `${API}/api/files/${id}/multipart/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`
    xhr.open("PUT", url)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as UploadedPart) } catch { reject(new Error("bad part response")) }
      } else {
        reject(new Error(`part ${partNumber} failed: ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error("network error during part upload"))
    xhr.send(chunk)
  })
}

async function completeMultipart(id: string, uploadId: string, parts: UploadedPart[]) {
  const res = await fetch(`${API}/api/files/${id}/multipart/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, parts }),
  })
  return j<{ ok: true }>(res)
}

async function abortMultipart(id: string, uploadId: string) {
  await fetch(`${API}/api/files/${id}/multipart/abort?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {})
}

// Orchestrates a chunked multipart upload with aggregate progress. On success
// the file is already marked ready server-side (no separate complete() call).
export async function uploadLargeFile(id: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  const { uploadId } = await startMultipart(id)
  const total = file.size
  const partCount = Math.max(1, Math.ceil(total / PART_SIZE))
  const parts: UploadedPart[] = []
  let completedBytes = 0
  try {
    for (let i = 0; i < partCount; i++) {
      const start = i * PART_SIZE
      const end = Math.min(start + PART_SIZE, total)
      const chunk = file.slice(start, end)
      const part = await putPart(id, uploadId, i + 1, chunk, (loaded) => {
        onProgress(Math.min(99, Math.round(((completedBytes + loaded) / total) * 100)))
      })
      parts.push(part)
      completedBytes = end
      onProgress(Math.min(99, Math.round((completedBytes / total) * 100)))
    }
    await completeMultipart(id, uploadId, parts)
    onProgress(100)
  } catch (e) {
    await abortMultipart(id, uploadId)
    throw e
  }
}
