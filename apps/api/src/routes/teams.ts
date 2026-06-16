import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { nowSeconds } from "../lib/expiry"
import { requireAuth } from "../middleware/auth"
import type { Bindings, Variables } from "../types"

type TeamRole = "owner" | "admin" | "member" | "viewer" | string
type TeamListItem = typeof schema.teams.$inferSelect & { role: TeamRole }

const teams = new Hono<{ Bindings: Bindings; Variables: Variables }>()
teams.use("*", requireAuth)

async function membership(db: ReturnType<typeof getDb>, teamId: string, userId: string) {
  const team = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get().catch(() => null)
  if (!team) return null
  if (team.ownerId === userId) return { team, role: "owner" }
  const member = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId))).get().catch(() => null)
  return member ? { team, role: member.role } : null
}

teams.get("/", async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get("userId")
  const owned = await db.select().from(schema.teams).where(eq(schema.teams.ownerId, userId)).orderBy(desc(schema.teams.createdAt)).all().catch(() => [])
  const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId)).all().catch(() => [])
  const allTeams: TeamListItem[] = owned.map((t) => ({ ...t, role: "owner" }))
  for (const m of memberships) {
    const team = await db.select().from(schema.teams).where(eq(schema.teams.id, m.teamId)).get().catch(() => null)
    if (team && team.ownerId !== userId) allTeams.push({ ...team, role: m.role })
  }
  return c.json({ teams: allTeams })
})

teams.post("/", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const name = String(body.name ?? "").trim().slice(0, 120) || "Untitled team"
  const db = getDb(c.env.DB)
  const id = crypto.randomUUID()
  const now = nowSeconds()
  await db.insert(schema.teams).values({ id, name, ownerId: c.get("userId"), createdAt: now }).run()
  await db.insert(schema.teamMembers).values({ id: crypto.randomUUID(), teamId: id, userId: c.get("userId"), role: "owner", createdAt: now }).run().catch(() => {})
  return c.json({ team: { id, name, ownerId: c.get("userId"), createdAt: now, role: "owner" } })
})

teams.get("/:id", async (c) => {
  const db = getDb(c.env.DB)
  const access = await membership(db, c.req.param("id"), c.get("userId"))
  if (!access) return c.json({ error: "not found" }, 404)
  const [members, users, folders, files] = await Promise.all([
    db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, access.team.id)).all().catch(() => []),
    db.select().from(schema.user).all().catch(() => []),
    db.select().from(schema.folders).where(eq(schema.folders.teamId, access.team.id)).all().catch(() => []),
    db.select().from(schema.files).where(eq(schema.files.teamId, access.team.id)).all().catch(() => []),
  ])
  const userById = new Map(users.map((u) => [u.id, u] as const))
  return c.json({ team: { ...access.team, role: access.role }, members: members.map((m) => ({ ...m, userEmail: userById.get(m.userId)?.email ?? null, userName: userById.get(m.userId)?.name ?? null })), folders, files })
})

teams.post("/:id/members", async (c) => {
  const db = getDb(c.env.DB)
  const access = await membership(db, c.req.param("id"), c.get("userId"))
  if (!access) return c.json({ error: "not found" }, 404)
  if (!["owner", "admin"].includes(access.role)) return c.json({ error: "forbidden" }, 403)
  const body = await c.req.json<{ email?: string; role?: string }>().catch(() => ({} as { email?: string; role?: string }))
  const email = String(body.email ?? "").trim().toLowerCase()
  const user = await db.select().from(schema.user).where(eq(schema.user.email, email)).get().catch(() => null)
  if (!user) return c.json({ error: "user not found" }, 404)
  const role = ["admin", "member", "viewer"].includes(String(body.role)) ? String(body.role) : "member"
  await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, access.team.id), eq(schema.teamMembers.userId, user.id))).run().catch(() => {})
  await db.insert(schema.teamMembers).values({ id: crypto.randomUUID(), teamId: access.team.id, userId: user.id, role, createdAt: nowSeconds() }).run()
  return c.json({ ok: true })
})

teams.delete("/:id/members/:userId", async (c) => {
  const db = getDb(c.env.DB)
  const access = await membership(db, c.req.param("id"), c.get("userId"))
  if (!access) return c.json({ error: "not found" }, 404)
  if (!["owner", "admin"].includes(access.role)) return c.json({ error: "forbidden" }, 403)
  await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, access.team.id), eq(schema.teamMembers.userId, c.req.param("userId")))).run()
  return c.json({ ok: true })
})

teams.delete("/:id", async (c) => {
  const db = getDb(c.env.DB)
  const access = await membership(db, c.req.param("id"), c.get("userId"))
  if (!access) return c.json({ error: "not found" }, 404)
  if (access.team.ownerId !== c.get("userId")) return c.json({ error: "only the owner can delete a team" }, 403)
  await db.update(schema.files).set({ teamId: null }).where(eq(schema.files.teamId, access.team.id)).run().catch(() => {})
  await db.update(schema.folders).set({ teamId: null }).where(eq(schema.folders.teamId, access.team.id)).run().catch(() => {})
  await db.delete(schema.teams).where(eq(schema.teams.id, access.team.id)).run()
  return c.json({ ok: true })
})

export default teams
