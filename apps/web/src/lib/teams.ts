const API = import.meta.env.VITE_API_URL ?? ""

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json() as Promise<T>
}

export type TeamMember = {
  id: string
  teamId: string
  userId: string
  role: "owner" | "admin" | "member" | "viewer" | string
  createdAt: number
  userEmail?: string | null
  userName?: string | null
}

export type Team = {
  id: string
  name: string
  ownerId: string
  createdAt: number
  role?: string
  members?: TeamMember[]
  memberCount?: number
}

export async function listTeams(): Promise<Team[]> {
  return (await j<{ teams: Team[] }>(await fetch(`${API}/api/teams`, { credentials: "include" }))).teams
}

export async function createTeam(name: string): Promise<Team> {
  return (await j<{ team: Team }>(await fetch(`${API}/api/teams`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }))).team
}

export async function loadTeam(id: string): Promise<Team> {
  const res = await j<{ team: Team; members?: TeamMember[] }>(await fetch(`${API}/api/teams/${id}`, { credentials: "include" }))
  return { ...res.team, members: res.members ?? res.team.members ?? [], memberCount: res.members?.length ?? res.team.memberCount }
}

export async function addTeamMember(id: string, email: string, role = "member"): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/teams/${id}/members`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) }))
}

export async function removeTeamMember(id: string, userId: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/teams/${id}/members/${userId}`, { method: "DELETE", credentials: "include" }))
}

export async function deleteTeam(id: string): Promise<{ ok: true }> {
  return j(await fetch(`${API}/api/teams/${id}`, { method: "DELETE", credentials: "include" }))
}
