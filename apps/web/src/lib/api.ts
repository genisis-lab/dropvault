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
  teamId?: string | null
  contentHash?: string | null
  createdAt: number
  expiresAt: number
  keepForever?: boolean
  favorite?: boolean
  tags?: string[]
  deletedAt?: number | null
  versionGroupId?: string | null
  shareHasPassword?: boolean
  shareDownloadLimit?: number | null
  shareDownloadCount?: number
  shareExpiresAt?: number | null
  shareAccessMode?: "download" | "preview" | "disabled"
  shareOneTime?: boolean
  shareAllowlist?: string | null
  shareIpAllowlist?: string | null
  shareCountryAllowlist?: string | null
}

export type Folder = {
  id: string
  name: string
  shareToken: string | null
  createdAt: number
  fileCount: number
  parentId?: string | null
  color?: string | null
  teamId?: string | null
  shareHasPassword?: boolean
  shareDownloadLimit?: number | null
  shareDownloadCount?: number
  shareExpiresAt?: number | null
  shareAccessMode?: "download" | "preview" | "disabled"
  shareOneTime?: boolean
  shareAllowlist?: string | null
  shareIpAllowlist?: string | null
  shareCountryAllowlist?: string | null
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

async function sha256Hex(file: File): Promise<string | null> {
  if (!crypto?.subtle || file.size > 512 * 1024 * 1024) return null
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
export async function fileContentHash(file: File) { return sha256Hex(file) }

// Generate a small JPEG thumbnail for an image entirely in the browser so the
// dashboard never has to download full-resolution images just to show previews.
// Returns null for non-images or when the browser can't decode the file.
export async function generateImageThumbnail(file: File, maxSize = 400): Promise<Blob | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, w, h)
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 })
    }
    const canvas = document.createElement("canvas")
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72))
  } catch {
    return null
  } finally {
    bitmap?.close?.()
  }
}

export async function uploadThumbnail(id: string, blob: Blob): Promise<void> {
  await fetch(`${API}/api/files/${id}/thumbnail`, { method: "PUT", credentials: "include", headers: { "Content-Type": "image/jpeg" }, body: blob })
}

// Best-effort: build a thumbnail and upload it. Never throws — a missing thumbnail
// just falls back to the full image on the server side.
export async function generateAndUploadThumbnail(id: string, file: File): Promise<void> {
  try { const thumb = await generateImageThumbnail(file); if (thumb && thumb.size > 0) await uploadThumbnail(id, thumb) } catch {}
}

export async function listFiles(opts?: { trash?: boolean }): Promise<DriftFile[]> {
  const qs = opts?.trash ? "?trash=true" : ""
  const res = await fetch(`${API}/api/files${qs}`, { credentials: "include" })
  return (await j<{ files: DriftFile[] }>(res)).files
}

export async function presign(input: { filename: string; contentType?: string; sizeBytes?: number; expiryDays?: number; keepForever?: boolean; folderId?: string | null; contentHash?: string | null }) {
  const res = await fetch(`${API}/api/files/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return j<{ id: string; uploadUrl: string; expiresAt: number; keepForever?: boolean; duplicateOf?: string | null }>(res)
}

export function uploadUrlFor(id: string) { return `${API}/api/files/${id}/upload` }
export async function complete(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/complete`, { method: "POST", credentials: "include" })) }
export async function extendFile(id: string, days: number) { return patchFile(id, { extendDays: days }) as Promise<{ ok: true; expiresAt: number }> }
export async function keepFileForever(id: string) { return patchFile(id, { keepForever: true }) as Promise<{ ok: true; expiresAt: number; file?: DriftFile | null }> }
export async function unkeepFileForever(id: string) { return patchFile(id, { keepForever: false }) as Promise<{ ok: true; expiresAt: number; file?: DriftFile | null }> }
export async function bulkKeepForever(ids: string[], keepForever: boolean) { return j<{ ok: true; count: number }>(await fetch(`${API}/api/files/bulk-keep-forever`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, keepForever }) })) }
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
export function thumbUrl(id: string) { return `${API}/api/files/${id}/thumbnail` }
export function versionDownloadUrl(id: string, versionId: string) { return `${API}/api/files/${id}/versions/${versionId}/download` }
export async function restoreFileVersion(id: string, versionId: string) { return j<{ ok: true; versionNumber: number }>(await fetch(`${API}/api/files/${id}/versions/${versionId}/restore`, { method: "POST", credentials: "include" })) }

export type ShareOptions = {
  password?: string | null
  downloadLimit?: number | null
  expiresInDays?: number | null
  accessMode?: "download" | "preview" | "disabled"
  oneTime?: boolean
  allowlist?: string[] | string | null
  ipAllowlist?: string[] | string | null
  countryAllowlist?: string[] | string | null
}
export type ShareResult = { token: string; url: string; hasPassword?: boolean; downloadLimit?: number | null; shareExpiresAt?: number | null; accessMode?: string; oneTime?: boolean }
export type ShareEvent = { id: string; token: string; fileId?: string | null; folderId?: string | null; event: string; ip?: string | null; country?: string | null; userAgent?: string | null; referer?: string | null; createdAt: number }
export async function createShare(id: string, options?: ShareOptions): Promise<ShareResult> {
  const res = await fetch(`${API}/api/files/${id}/share`, { method: "POST", credentials: "include", headers: options ? { "Content-Type": "application/json" } : undefined, body: options ? JSON.stringify(options) : undefined })
  return j<ShareResult>(res)
}
export async function revokeShare(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/files/${id}/share`, { method: "DELETE", credentials: "include" })) }
export async function fileShareEvents(id: string) { return j<{ events: ShareEvent[]; summary: Record<string, number> }>(await fetch(`${API}/api/files/${id}/share/events`, { credentials: "include" })) }
export function shareUrl(token: string) { const base = API || (typeof window !== "undefined" ? window.location.origin : ""); return `${base}/api/share/${token}` }

export async function listFolders(opts?: unknown): Promise<Folder[]> {
  const parentId = opts && typeof opts === "object" && "parentId" in opts ? (opts as { parentId?: string | null }).parentId : undefined
  const qs = parentId !== undefined ? `?parentId=${encodeURIComponent(parentId ?? "")}` : ""
  return (await j<{ folders: Folder[] }>(await fetch(`${API}/api/folders${qs}`, { credentials: "include" }))).folders
}
export async function createFolder(name: string, input?: { parentId?: string | null; color?: string | null }) { return j<{ id: string; name: string; parentId?: string | null }>(await fetch(`${API}/api/folders`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...input }) })) }
export async function renameFolder(id: string, name: string) { return updateFolder(id, { name }) as Promise<{ ok: true; name: string }> }
export async function updateFolder(id: string, input: { name?: string; parentId?: string | null; color?: string | null }) { return j<{ ok: true } & Partial<Folder>>(await fetch(`${API}/api/folders/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })) }
export async function deleteFolder(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/folders/${id}`, { method: "DELETE", credentials: "include" })) }
export async function shareFolder(id: string, options?: ShareOptions): Promise<ShareResult> {
  const res = await fetch(`${API}/api/folders/${id}/share`, { method: "POST", credentials: "include", headers: options ? { "Content-Type": "application/json" } : undefined, body: options ? JSON.stringify(options) : undefined })
  return j<ShareResult>(res)
}
export async function revokeFolderShare(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/folders/${id}/share`, { method: "DELETE", credentials: "include" })) }
export async function folderShareEvents(id: string) { return j<{ events: ShareEvent[]; summary: Record<string, number> }>(await fetch(`${API}/api/folders/${id}/share/events`, { credentials: "include" })) }
export function folderShareUrl(token: string) { const base = API || (typeof window !== "undefined" ? window.location.origin : ""); return `${base}/api/share/folder/${token}` }
export function folderZipUrl(id: string) { return `${API}/api/folders/${id}/download-zip` }

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
export type AdminStats = { userCount: number; fileCount: number; readyFileCount: number; pendingFileCount?: number; deletedFileCount?: number; folderCount: number; totalBytes: number; sharedFileCount: number; sharedFolderCount: number; expiringSoonCount: number; flagCount: number; adminCount: number; suspendedUserCount?: number; pendingApprovalCount?: number; alerts?: AdminAlert[]; typeBreakdown: AdminTypeBreakdown[]; topUsers: AdminTopUser[]; growth: AdminGrowthPoint[] }
export type AdminUser = { id: string; name: string; email: string; image: string | null; createdAt: number; fileCount: number; totalBytes: number; quotaBytes: number | null; isAdmin: boolean; role?: AdminRole | null; keepFilesForever?: boolean; keepFilesForeverGranted?: boolean; suspended?: boolean; suspensionReason?: string | null; pendingApproval?: boolean; lastIp?: string | null; recentIps?: string[] }
export type AdminFile = DriftFile & { shared: boolean; ownerId: string; ownerEmail: string | null; ownerName: string | null }
export type ActivityEntry = { id: string; userId?: string | null; actorEmail: string | null; action: string; targetType: string | null; targetId: string | null; detail: string | null; ip?: string | null; userAgent?: string | null; createdAt: number }
export type AdminUserDetail = { user: AdminUser; files: AdminFile[]; activity?: ActivityEntry[] }
export type AdminFlag = { id: string; fileId: string | null; token: string | null; reason: string | null; reporterEmail: string | null; status: string; adminNote?: string | null; createdAt: number; resolvedAt: number | null; filename: string | null; ownerEmail: string | null; fileExists: boolean }
export type AdminAuditEntry = { id: string; actorEmail: string | null; action: string; targetType: string | null; targetId: string | null; detail: string | null; createdAt: number }
export type AdminEntry = { email: string; role?: AdminRole; source: "env" | "db"; addedBy: string | null; createdAt: number | null }
export type AdminSettings = Record<string, string>
export type IpBanEntry = { ip: string; note: string | null; createdAt: number; createdBy: string | null }
export type FileVersion = { id: string; fileId: string; versionGroupId: string; versionNumber: number; r2Key: string; sizeBytes: number; createdAt: number }

export async function adminAccess(): Promise<{ isAdmin: boolean; role: AdminRole | null }> { return j(await fetch(`${API}/api/admin/access`, { credentials: "include" })) }
export async function adminStats(): Promise<AdminStats> { return j(await fetch(`${API}/api/admin/stats`, { credentials: "include" })) }
export async function adminUsers(): Promise<AdminUser[]> { return (await j<{ users: AdminUser[] }>(await fetch(`${API}/api/admin/users`, { credentials: "include" }))).users }
export async function adminUser(id: string): Promise<AdminUserDetail> { return j(await fetch(`${API}/api/admin/users/${id}`, { credentials: "include" })) }
export async function adminSetQuota(id: string, bytes: number | null): Promise<{ ok: true; quotaBytes: number | null }> { return j(await fetch(`${API}/api/admin/users/${id}/quota`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bytes }) })) }
export async function adminSuspendUser(id: string, reason?: string) { return j<{ ok: true }>(await fetch(`${API}/api/admin/users/${id}/suspend`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) })) }
export async function adminUnsuspendUser(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/admin/users/${id}/unsuspend`, { method: "POST", credentials: "include" })) }
export async function adminApproveUser(id: string) { return j<{ ok: true }>(await fetch(`${API}/api/admin/users/${id}/approve`, { method: "POST", credentials: "include" })) }
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
export async function adminIpBans(): Promise<IpBanEntry[]> { return (await j<{ bans: IpBanEntry[] }>(await fetch(`${API}/api/admin/ip-bans`, { credentials: "include" }))).bans }
export async function adminBanIp(ip: string, note?: string | null): Promise<{ ok: true; bans: IpBanEntry[] }> { return j(await fetch(`${API}/api/admin/ip-bans`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip, note }) })) }
export async function adminUnbanIp(ip: string): Promise<{ ok: true; bans: IpBanEntry[] }> { return j(await fetch(`${API}/api/admin/ip-bans/${encodeURIComponent(ip)}`, { method: "DELETE", credentials: "include" })) }
export async function adminAudit(limit?: number): Promise<AdminAuditEntry[]> { const qs = limit ? `?limit=${limit}` : ""; return (await j<{ entries: AdminAuditEntry[] }>(await fetch(`${API}/api/admin/audit${qs}`, { credentials: "include" }))).entries }
export async function adminActivity(limit?: number): Promise<ActivityEntry[]> { const qs = limit ? `?limit=${limit}` : ""; return (await j<{ entries: ActivityEntry[] }>(await fetch(`${API}/api/admin/activity${qs}`, { credentials: "include" }))).entries }
export async function adminSettings(): Promise<AdminSettings> { return (await j<{ settings: AdminSettings }>(await fetch(`${API}/api/admin/settings`, { credentials: "include" }))).settings }
export async function adminSaveSettings(settings: AdminSettings): Promise<{ ok: true; settings: AdminSettings }> { return j(await fetch(`${API}/api/admin/settings`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) })) }

export type UploadRequest = { id: string; ownerId: string; folderId: string | null; token: string; title: string; instructions: string | null; maxFileSize: number | null; totalMaxBytes?: number | null; allowedTypes: string | null; uploadLimit: number | null; uploadCount: number; requireEmail: boolean; expiresAt: number | null; createdAt: number; revokedAt: number | null; hasPassword: boolean; url: string; status?: "open" | "closed"; moderationMode?: "auto" | "manual"; thankYouMessage?: string | null; closeAfterFirstUpload?: boolean; submissionCount?: number; pendingCount?: number; totalUploadedBytes?: number }
export type PublicUpload = { id: string; requestId: string; fileId: string | null; uploaderEmail: string | null; uploaderName: string | null; status: "pending" | "approved" | "rejected"; filename?: string | null; sizeBytes?: number | null; contentType?: string | null; reviewedBy?: string | null; reviewedAt?: number | null; createdAt: number }
export async function listUploadRequests(): Promise<UploadRequest[]> { return (await j<{ requests: UploadRequest[] }>(await fetch(`${API}/api/upload-requests`, { credentials: "include" }))).requests }
export async function createUploadRequest(input: Partial<UploadRequest> & { password?: string | null; expiresInDays?: number | null }): Promise<UploadRequest> { return (await j<{ request: UploadRequest }>(await fetch(`${API}/api/upload-requests`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }))).request }
export async function updateUploadRequest(id: string, input: Partial<UploadRequest> & { password?: string | null; expiresInDays?: number | null }): Promise<UploadRequest> { return (await j<{ request: UploadRequest }>(await fetch(`${API}/api/upload-requests/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }))).request }
export async function closeUploadRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${id}/close`, { method: "POST", credentials: "include" })) }
export async function reopenUploadRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${id}/reopen`, { method: "POST", credentials: "include" })) }
export async function revokeUploadRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${id}`, { method: "DELETE", credentials: "include" })) }
export async function uploadRequestSubmissions(id: string): Promise<PublicUpload[]> { return (await j<{ uploads: PublicUpload[] }>(await fetch(`${API}/api/upload-requests/${id}/submissions`, { credentials: "include" }))).uploads }
export async function approvePublicUpload(requestId: string, uploadId: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${requestId}/submissions/${uploadId}/approve`, { method: "POST", credentials: "include" })) }
export async function rejectPublicUpload(requestId: string, uploadId: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/upload-requests/${requestId}/submissions/${uploadId}/reject`, { method: "POST", credentials: "include" })) }
export async function publicUploadRequest(token: string): Promise<UploadRequest> { return (await j<{ request: UploadRequest }>(await fetch(`${API}/api/upload-requests/public/${token}`))).request }
export async function submitPublicUpload(token: string, form: FormData): Promise<{ ok: true; fileIds: string[]; fileId?: string; pending?: boolean; message?: string | null }> { return j(await fetch(`${API}/api/upload-requests/public/${token}`, { method: "POST", body: form })) }

export type NotificationItem = { id: string; userId: string; type: string; title: string; message: string | null; targetType: string | null; targetId: string | null; readAt: number | null; createdAt: number }
export async function listNotifications(): Promise<NotificationItem[]> { return (await j<{ notifications: NotificationItem[] }>(await fetch(`${API}/api/notifications`, { credentials: "include" }))).notifications }
export async function markNotificationRead(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/notifications/${id}/read`, { method: "POST", credentials: "include" })) }
export async function markAllNotificationsRead(): Promise<{ ok: true }> { return j(await fetch(`${API}/api/notifications/read`, { method: "POST", credentials: "include" })) }
export async function deleteNotification(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/notifications/${id}`, { method: "DELETE", credentials: "include" })) }

export type SessionItem = { id: string; userId: string; token: string; ipAddress?: string | null; userAgent?: string | null; expiresAt: Date | string | number; createdAt: Date | string | number; updatedAt: Date | string | number; current?: boolean }
export async function listSessions(): Promise<SessionItem[]> { return (await j<{ sessions: SessionItem[] }>(await fetch(`${API}/api/sessions`, { credentials: "include" }))).sessions }
export async function revokeSession(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/sessions/${id}`, { method: "DELETE", credentials: "include" })) }
export async function revokeOtherSessions(): Promise<{ ok: true; count: number }> { return j(await fetch(`${API}/api/sessions/revoke-others`, { method: "POST", credentials: "include" })) }

export type Team = { id: string; name: string; ownerId: string; createdAt: number; members?: TeamMember[]; memberCount?: number }
export type TeamMember = { id: string; teamId: string; userId: string; role: "owner" | "admin" | "member" | string; createdAt: number; userEmail?: string | null; userName?: string | null }
export async function listTeams(): Promise<Team[]> { return (await j<{ teams: Team[] }>(await fetch(`${API}/api/teams`, { credentials: "include" }))).teams }
export async function createTeam(name: string): Promise<Team> { return (await j<{ team: Team }>(await fetch(`${API}/api/teams`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }))).team }
export async function loadTeam(id: string): Promise<Team> { return (await j<{ team: Team }>(await fetch(`${API}/api/teams/${id}`, { credentials: "include" }))).team }
export async function addTeamMember(id: string, email: string, role = "member"): Promise<{ ok: true }> { return j(await fetch(`${API}/api/teams/${id}/members`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) })) }
export async function removeTeamMember(id: string, userId: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/teams/${id}/members/${userId}`, { method: "DELETE", credentials: "include" })) }
export async function deleteTeam(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/teams/${id}`, { method: "DELETE", credentials: "include" })) }

export type LimitRequest = { id: string; userId: string; userEmail?: string | null; requestedBytes: number; reason: string | null; status: string; approvedBy: string | null; approvedAt: number | null; createdAt: number }
export async function listLimitRequests(): Promise<LimitRequest[]> { return (await j<{ requests: LimitRequest[] }>(await fetch(`${API}/api/admin/limit-requests`, { credentials: "include" }))).requests }
export async function listMyLimitRequests(): Promise<LimitRequest[]> { return (await j<{ requests: LimitRequest[] }>(await fetch(`${API}/api/admin/limit-requests/mine`, { credentials: "include" }))).requests }
export async function createLimitRequest(requestedBytes: number, reason?: string): Promise<{ ok: true; id: string }> { return j(await fetch(`${API}/api/admin/limit-requests`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBytes, reason }) })) }
export async function approveLimitRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/limit-requests/${id}/approve`, { method: "POST", credentials: "include" })) }
export async function rejectLimitRequest(id: string): Promise<{ ok: true }> { return j(await fetch(`${API}/api/admin/limit-requests/${id}/reject`, { method: "POST", credentials: "include" })) }
