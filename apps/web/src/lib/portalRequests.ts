const API = import.meta.env.VITE_API_URL ?? ""

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

export type BrandedPortalRequest = {
  id: string
  userId: string
  requestedBrand: string | null
  reason: string | null
  status: "pending" | "approved" | "rejected" | string
  reviewedBy: string | null
  reviewedAt: number | null
  createdAt: number
  userEmail?: string | null
  userName?: string | null
  approved?: boolean
}

export async function myPortalRequests(): Promise<{ approved: boolean; requests: BrandedPortalRequest[] }> {
  return j(await fetch(`${API}/api/portal-requests/mine`, { credentials: "include" }))
}

export async function createPortalRequest(input: { requestedBrand?: string | null; reason?: string | null }): Promise<{ ok: true; id: string }> {
  return j(await fetch(`${API}/api/portal-requests`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }))
}

export async function adminPortalRequests(status?: string): Promise<BrandedPortalRequest[]> {
  const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""
  return (await j<{ requests: BrandedPortalRequest[] }>(await fetch(`${API}/api/portal-requests/admin${qs}`, { credentials: "include" }))).requests
}

export async function approvePortalRequest(id: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/portal-requests/admin/${id}/approve`, { method: "POST", credentials: "include" }))
}

export async function rejectPortalRequest(id: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/portal-requests/admin/${id}/reject`, { method: "POST", credentials: "include" }))
}
