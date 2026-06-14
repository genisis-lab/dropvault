// In dev, Vite proxies /api to the local Worker, so same-origin ("") is correct.
// In prod the API lives on the Worker; default to it so no build var is required.
// Override anytime with VITE_API_URL.
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "https://dropvault-api.neil27.workers.dev" : "")

export type DriftFile = {
  id: string
  filename: string
  sizeBytes: number
  contentType: string | null
  status: string
  createdAt: number
  expiresAt: number
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

export async function listFiles(): Promise<DriftFile[]> {
  const res = await fetch(`${API}/api/files`, { credentials: "include" })
  return (await j<{ files: DriftFile[] }>(res)).files
}

export async function presign(input: { filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number }) {
  const res = await fetch(`${API}/api/files/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return j<{ id: string; uploadUrl: string; expiresAt: number }>(res)
}

export async function complete(id: string) {
  const res = await fetch(`${API}/api/files/${id}/complete`, { method: "POST", credentials: "include" })
  return j<{ ok: true }>(res)
}

export async function extendFile(id: string, expiryDays: number) {
  const res = await fetch(`${API}/api/files/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiryDays }),
  })
  return j<{ ok: true; expiresAt: number }>(res)
}

export async function deleteFile(id: string) {
  const res = await fetch(`${API}/api/files/${id}`, { method: "DELETE", credentials: "include" })
  return j<{ ok: true }>(res)
}

export function downloadUrl(id: string) {
  return `${API}/api/files/${id}/download`
}

// Direct browser -> R2 upload via the presigned PUT URL, with progress.
export function uploadToR2(uploadUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl)
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("network error during upload"))
    xhr.send(file)
  })
}
