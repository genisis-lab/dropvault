// Account status lives outside lib/api.ts because /api/account/me is one of the
// few endpoints that works even when the user is suspended (suspended users are
// blocked from every requireAuth route).
const API = import.meta.env.VITE_API_URL ?? ""

export type AccountStatus = {
  user: { id: string; name: string; email: string }
  suspended: boolean
  suspensionReason: string | null
}

export async function accountStatus(): Promise<AccountStatus> {
  const res = await fetch(`${API}/api/account/me`, { credentials: "include" })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<AccountStatus>
}
