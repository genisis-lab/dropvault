const API = import.meta.env.VITE_API_URL ?? ""

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = ""
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ""
    } catch {
      detail = ""
    }
    // Cloudflare serves over HTTP/2 where statusText is always empty, and Hono's
    // default 404/500 pages are plain text (no JSON .error). Fall back to the
    // status code so failures are diagnosable instead of showing a blank error.
    throw new Error(detail || `Request failed (HTTP ${res.status})`)
  }
  return res.json() as Promise<T>
}

export type KeepForeverRequest = {
  id: string
  userId: string
  userEmail?: string | null
  userName?: string | null
  reason: string | null
  status: "pending" | "approved" | "rejected" | string
  reviewedBy: string | null
  reviewedAt: number | null
  createdAt: number
  userCanKeepForever?: boolean
}

export type KeepForeverStatus = {
  canKeepFilesForever: boolean
  keepFilesForever: boolean
  role: string | null
  pendingRequest: KeepForeverRequest | null
  requests: KeepForeverRequest[]
}

export async function keepForeverStatus(): Promise<KeepForeverStatus> {
  return j(await fetch(`${API}/api/keep-forever/status`, { credentials: "include" }))
}

export async function createKeepForeverRequest(reason?: string): Promise<{ ok: true; id: string }> {
  return j(await fetch(`${API}/api/keep-forever/request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  }))
}

export async function adminKeepForeverRequests(status = "pending"): Promise<KeepForeverRequest[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ""
  return (await j<{ requests: KeepForeverRequest[] }>(await fetch(`${API}/api/keep-forever/requests${qs}`, { credentials: "include" }))).requests
}

export async function approveKeepForeverRequest(id: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/keep-forever/requests/${id}/approve`, { method: "POST", credentials: "include" }))
}

export async function rejectKeepForeverRequest(id: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/keep-forever/requests/${id}/reject`, { method: "POST", credentials: "include" }))
}

export async function setUserKeepForever(id: string, allowed: boolean): Promise<{ ok: true; keepFilesForever: boolean }> {
  return j(await fetch(`${API}/api/keep-forever/users/${id}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed }),
  }))
}
