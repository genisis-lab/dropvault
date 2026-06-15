// /api is same-origin: Vite proxies it to the local Worker in dev, and the Pages
// proxy (functions/api/[[path]].ts) forwards it to the Worker in prod.
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
  favorite?: boolean
  tags?: string[]
  deletedAt?: number | null
  versionGroupId?: string | null
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
  shareHasPassword?: boolean
  shareDownloadLimit?: number | null
  shareDownloadCount?: number
  shareExpiresAt?: number | null
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

export async function listFiles(opts?: { trash?: boolean }): Promise<DriftFile[]> {
  const qs = opts?.trash ? "?trash=true" : ""
  const res = await fetch(`${API}/api/files${qs}`, { credentials: "include" })
  return (await j<{ files: DriftFile[] }>(res)).files
}

export async function presign(input: { filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number; folderId?: string | null }) {
  const res = await fetch(`${API}/api/files/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return j<{ id: string; uploadUrl: string; expiresAt: number }>(res)
}

export function uploadUrlFor(id: string) { return `${API}/api/files/${id}/upload` }
export async function complete(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/complete`, { method: "POST", credentials: "include" })) }
export async function extendFile(id: string, days: number) { return patchFile(id, { extendDays: days }) as Promise<{ ok: true; expiresAt: number }> }
export async function renameFile(id: string, filename: string) { return patchFile(id, { filename }) as Promise<{ ok: true; filename: string }> }
export async function moveFile(id: string, folderId: string | null) { return patchFile(id, { folderId }) as Promise<{ ok: true }> }
export async function updateFileMeta(id: string, input: { favorite?: boolean; tags?: string[] }) { return patchFile(id, input) }
async function patchFile(id: string, input: Record<string, unknown>) {
  const res = await fetch(`${API}/api/files/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
  return j(res)
}
export async function deleteFile(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}`, { method: "DELETE", credentials: "include" })) }
export async function restoreFile(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/restore`, { method: "POST", credentials: "include" })) }
export async function permanentDeleteFile(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/permanent`, { method: "DELETE", credentials: "include" })) }
export async function fileVersions(id: string) { return (await j<{ versions: FileVersion[] }>(await fetch(`${API}/api/files/${id}/versions`, { credentials: "include" }))).versions }
export function downloadUrl(id: string) { return `${API}/api/files/${id}/download` }
export function inlineUrl(id: string) { return `${API}/api/files/${id}/inline` }

export type ShareOptions = { password?: string | null; downloadLimit?: number | null; expiresInDays?: number | null }
export type ShareResult = { token: string; url: string; hasPassword?: boolean; downloadLimit?: number | null; shareExpiresAt?: number | null }
export async function createShare(id: string, options?: ShareOptions): Promise<ShareResult> {
  const res = await fetch(`${API}/api/files/${id}/share`, { method: "POST", credentials: "include", headers: options ? { "Content-Type": "application/json" } : undefined, body: options ? JSON.stringify(options) : undefined })
  return j<ShareResult>(res)
}
export async function revokeShare(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/share`, { method: "DELETE", credentials: "include" })) }
export function shareUrl(token: string) { const base = API || (typeof window !== "undefined" ? window.location.origin : ""); return `${base}/api/share/${token}` }

export async function listFolders(): Promise<Folder[]> { return (await j<{ folders: Folder[] }>(await fetch(`${API}/api/folders`, { credentials: "include" }))).folders }
export async function createFolder(name: string) { return j<{ id: string; name: string }>(await fetch(`${API}/api/folders`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })) }
export async function renameFolder(id: string, name: string) { return j<{ ok: true; name: string }>(await fetch(`${API}/api/folders/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })) }
export async function deleteFolder(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/folders/${id}`, { method: "DELETE", credentials: "include" })) }
export async function shareFolder(id: string, options?: ShareOptions): Promise<ShareResult> {
  const res = await fetch(`${API}/api/folders/${id}/share`, { method: "POST", credentials: "include", headers: options ? { "Content-Type": "application/json" } : undefined, body: options ? JSON.stringify(options) : undefined })
  return j<ShareResult>(res)
}
export async function revokeFolderShare(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/folders/${id}/share`, { method: "DELETE", credentials: "include" })) }
export function folderShareUrl(token: string) { const base = API || (typeof window !== "undefined" ? window.location.origin : ""); return `${base}/api/share/folder/${token}` }

export function uploadToR2(uploadUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("PUT", uploadUrl); xhr.withCredentials = true
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("network error during upload")); xhr.send(file)
  })
}
export const MULTIPART_THRESHOLD = 90 * 1024 * 1024
const PART_SIZE = 32 * 1024 * 1024
type UploadedPart = { partNumber: number; etag: string }
async function startMultipart(id: string) { return j<{ uploadId: string; key: string }>(await fetch(`${API}/api/files/${id}/multipart/start`, { method: "POST", credentials: "include" })) }
function putPart(id: string, uploadId: string, partNumber: number, chunk: Blob, onLoaded: (loaded: number) => void): Promise<UploadedPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("PUT", `${API}/api/files/${id}/multipart/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`); xhr.withCredentials = true
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded) }
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText) as UploadedPart) } catch { reject(new Error("bad part response")) } } else reject(new Error(`part ${partNumber} failed: ${xhr.status}`)) }
    xhr.onerror = () => reject(new Error("network error during part upload")); xhr.send(chunk)
  })
}
async function completeMultipart(id: string, uploadId: string, parts: UploadedPart[]) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/multipart/complete`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, parts }) })) }
async function abortMultipart(id: string, uploadId: string) { await fetch(`${API}/api/files/${id}/multipart/abort?uploadId=${encodeURIComponent(uploadId)}`, { method: "POST", credentials: "include" }).catch(() => {}) }
export async function uploadLargeFile(id: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  const { uploadId } = await startMultipart(id); const total = file.size; const partCount = Math.max(1, Math.ceil(total / PART_SIZE)); const parts: UploadedPart[] = []; let completedBytes = 0
  try { for (let i = 0; i < partCount; i++) { const start = i * PART_SIZE; const end = Math.min(start + PART_SIZE, total); const part = await putPart(id, uploadId, i + 1, file.slice(start, end), (loaded) => onProgress(Math.min(99, Math.round(((completedBytes + loaded) / total) * 100)))); parts.push(part); completedBytes = end; onProgress(Math.min(99, Math.round((completedBytes / total) * 100))) } await completeMultipart(id, uploadId, parts); onProgress(100) } catch (e) { await abortMultipart(id, uploadId); throw e }
}

export type AdminRole = "owner" | "admin" | "moderator" | "viewer"
export type AdminAlert = { id: string; label: string; count: number; level: "ok" | "low" | "medium" | "high" }
export type AdminTypeBreakdown = { category: string; count: number; bytes: number }
export type AdminTopUser = { id: string; name: string; email: string | null; totalBytes: number; fileCount: number }
export type AdminGrowthPoint = { date: string; users: number; files: number; bytes: number }
export type AdminStats = { userCount: number; fileCount: number; readyFileCount: number; pendingFileCount?: number; deletedFileCount?: number; folderCount: number; totalBytes: number; sharedFileCount: number; sharedFolderCount: number; expiringSoonCount: number; flagCount: number; adminCount: number; suspendedUserCount?: number; alerts?: AdminAlert[]; typeBreakdown: AdminTypeBreakdown[]; topUsers: AdminTopUser[]; growth: AdminGrowthPoint[] }
export type AdminUser = { id: string; name: string; email: string; image: string | null; createdAt: number; fileCount: number; totalBytes: number; quotaBytes: number | null; isAdmin: boolean; role?: AdminRole | null; suspended?: boolean; suspensionReason?: string | null }
export type AdminFile = DriftFile & { shared: boolean; ownerId: string; ownerEmail: string | null; ownerName: string | null }
export type ActivityEntry = { id: string; userId?: string | null; actorEmail: string | null; action: string; targetType: string | null; targetId: string | null; detail: string | null; ip?: string | null; userAgent?: string | null; createdAt: number }
export type AdminUserDetail = { user: AdminUser; files: AdminFile[]; activity?: ActivityEntry[] }
export type AdminFlag = { id: string; fileId: string | null; token: string | null; reason: string | null; reporterEmail: string | null; status: string; adminNote?: string | null; createdAt: number; resolvedAt: number | null; filename: string | null; ownerEmail: string | null; fileExists: boolean }
export type AdminAuditEntry = { id: string; actorEmail: string | null; action: string; targetType: string | null; targetId: string | null; detail: string | null; createdAt: number }
export type AdminEntry = { email: string; role?: AdminRole; source: "env" | "db"; addedBy: string | null; createdAt: number | null }
export type AdminSettings = Record<string, string>
export type FileVersion = { id: string; fileId: string; versionGroupId: string; versionNumber: number; r2Key: string; sizeBytes: number; createdAt: number }

export async function adminAccess(): Promise<{ isAdmin: boolean; role: AdminRole | null }> { return j(await fetch(`${API}/api/admin/access`, { credentials: "include" })) }
export async function adminStats(): Promise<AdminStats> { return j(await fetch(`${API}/api/admin/stats`, { credentials: "include" })) }
export async function adminUsers(): Promise<AdminUser[]> { return (await j<{ users: AdminUser[] }>(await fetch(`${API}/api/admin/users`, { credentials: "include" }))).users }
export async function adminUser(id: string): Promise<AdminUserDetail> { return j(await fetch(`${API}/api/admin/users/${id}`, { credentials: "include" })) }
export async function adminSetQuota(id: string, bytes: number | null): Promise<{ ok: true; quotaBytes: number | null }> { return j(await fetch(`${API}/api/admin/users/${id}/quota`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes }) })) }
export async function adminSuspendUser(id: string, reason?: string) { return j<{ ok: true }>(await fetch(`${API}/api/admin/users/${id}/suspend`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) })) }
export async function adminUnsuspendUser(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/admin/users/${id}/unsuspend`, { method: "POST", credentials: "include" })) }
export async function adminBulkUsers(action: string, ids: string[], quotaBytes?: number | null) { return j<{ ok: true; count: number }>(await fetch(`${API}/api/admin/users/bulk`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, quotaBytes }) })) }
export async function adminFiles(): Promise<AdminFile[]> { return (await j<{ files: AdminFile[] }>(await fetch(`${API}/api/admin/files`, { credentials: "include" }))).files }
export async function adminRevokeFile(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/files/${id}/revoke`, { method: "POST", credentials: "include" })) }
export async function adminExtendFile(id: string, days: number): Promise<{ ok: true; expiresAt: number }> { return j(await fetch(`${API}/api/admin/files/${id}/extend`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) })) }
export async function adminExpireFile(id: string): Promise<{ ok: true; expiresAt: number }> { return j(await fetch(`${API}/api/admin/files/${id}/expire`, { method: "POST", credentials: "include" })) }
export async function adminDeleteFile(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/files/${id}`, { method: "DELETE", credentials: "include" })) }
export async function adminRestoreFile(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/files/${id}/restore`, { method: "POST", credentials: "include" })) }
export async function adminPermanentDeleteFile(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/files/${id}/delete-permanent`, { method: "POST", credentials: "include" })) }
export async function adminBulkFiles(action: "revoke" | "delete" | "expire" | "extend" | "restore" | "permanentDelete", ids: string[], days?: number): Promise<{ ok: true; count: number }> { return j(await fetch(`${API}/api/admin/files/bulk`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, days }) })) }
export async function adminFlags(status?: string): Promise<AdminFlag[]> { const qs = status ? `?status=${encodeURIComponent(status)}` : ""; return (await j<{ flags: AdminFlag[] }>(await fetch(`${API}/api/admin/flags${qs}`, { credentials: "include" }))).flags }
export async function adminUpdateFlag(id: string, input: { status?: string; note?: string; action?: string }): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/flags/${id}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })) }
export async function adminResolveFlag(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/flags/${id}/resolve`, { method: "POST", credentials: "include" })) }
export async function adminDeleteFlag(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/flags/${id}`, { method: "DELETE", credentials: "include" })) }
export async function adminAdmins(): Promise<AdminEntry[]> { return (await j<{ admins: AdminEntry[] }>(await fetch(`${API}/api/admin/admins`, { credentials: "include" }))).admins }
export async function adminAddAdmin(email: string, role: AdminRole = "admin"): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/admins`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) })) }
export async function adminRemoveAdmin(email: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/admins/${encodeURIComponent(email)}`, { method: "DELETE", credentials: "include" })) }
export async function adminAudit(limit?: number): Promise<AdminAuditEntry[]> { const qs = limit ? `?limit=${limit}` : ""; return (await j<{ entries: AdminAuditEntry[] }>(await fetch(`${API}/api/admin/audit${qs}`, { credentials: "include" }))).entries }
export async function adminActivity(limit?: number): Promise<ActivityEntry[]> { const qs = limit ? `?limit=${limit}` : ""; return (await j<{ entries: ActivityEntry[] }>(await fetch(`${API}/api/admin/activity${qs}`, { credentials: "include" }))).entries }
export async function adminSettings(): Promise<AdminSettings> { return (await j<{ settings: AdminSettings }>(await fetch(`${API}/api/admin/settings`, { credentials: "include" }))).settings }
export async function adminSaveSettings(settings: AdminSettings): Promise<{ ok: true; settings: AdminSettings }> { return j(await fetch(`${API}/api/admin/settings`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) })) }

export type UploadRequest = { id: string; ownerId: string; folderId: string | null; token: string; title: string; instructions: string | null; maxFileSize: number | null; allowedTypes: string | null; uploadLimit: number | null; uploadCount: number; requireEmail: boolean; expiresAt: number | null; createdAt: number; revokedAt: number | null; hasPassword: boolean; url: string }
export async function listUploadRequests(): Promise<UploadRequest[]> { return (await j<{ requests: UploadRequest[] }>(await fetch(`${API}/api/upload-requests`, { credentials: "include" }))).requests }
export async function createUploadRequest(input: Partial<UploadRequest> & { password?: string | null; expiresInDays?: number | null }): Promise<UploadRequest> { return (await j<{ request: UploadRequest }>(await fetch(`${API}/api/upload-requests`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }))).request }
export async function revokeUploadRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${id}`, { method: "DELETE", credentials: "include" })) }
export async function publicUploadRequest(token: string): Promise<UploadRequest> { return (await j<{ request: UploadRequest }>(await fetch(`${API}/api/upload-requests/public/${token}`))).request }
export async function submitPublicUpload(token: string, form: FormData): Promise<{ ok: true; fileId: string }> { return j(await fetch(`${API}/api/upload-requests/public/${token}`, { method: "POST", body: form })) }
