import { createMiddleware } from "hono/factory"
import { getDb, schema } from "../db"
import type { Bindings, Variables } from "../types"

// Parse the ADMIN_EMAILS allowlist (comma- or whitespace-separated) into a
// lowercased Set for case-insensitive comparison.
export function adminEmailSet(env: Bindings): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

// True when the given email is on the ENV allowlist only (sync; no DB).
export function isAdminEmail(env: Bindings, email: string | null | undefined): boolean {
  if (!email) return false
  return adminEmailSet(env).has(email.toLowerCase())
}

// The EFFECTIVE admin set: env allowlist UNION the DB-managed admin_emails table.
export async function effectiveAdminSet(
  env: Bindings,
  db: ReturnType<typeof getDb>,
): Promise<Set<string>> {
  const set = adminEmailSet(env)
  try {
    const rows = await db.select().from(schema.adminEmails).all()
    for (const r of rows) if (r.email) set.add(r.email.toLowerCase())
  } catch {}
  return set
}

// True when the email is an admin via either the env allowlist or the DB table.
export async function isAdminEmailDb(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false
  return (await effectiveAdminSet(env, db)).has(email.toLowerCase())
}

// Gate routes to admins only. MUST run AFTER requireAuth, which sets userEmail.
// Returns 403 for authenticated users who are not admins.
export const requireAdmin = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const db = getDb(c.env.DB)
    if (!(await isAdminEmailDb(c.env, db, c.get("userEmail")))) {
      return c.json({ error: "forbidden" }, 403)
    }
    await next()
  },
)
