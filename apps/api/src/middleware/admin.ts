import { createMiddleware } from "hono/factory";
import { getDb, schema } from "../db";
import type { Bindings, Variables } from "../types";

export type AdminRole = "owner" | "admin" | "moderator" | "auditor";

const ROLE_RANK: Record<AdminRole, number> = {
  auditor: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};
const VALID_ROLES = new Set<AdminRole>([
  "owner",
  "admin",
  "moderator",
  "auditor",
]);

export function normalizeAdminRole(role: unknown): AdminRole {
  const raw = String(role ?? "admin").toLowerCase();
  // Preserve access for installations that used the former read-only name.
  const v = (raw === "viewer" ? "auditor" : raw) as AdminRole;
  return VALID_ROLES.has(v) ? v : "auditor";
}

// Parse the ADMIN_EMAILS bootstrap allowlist. Env admins are owners because they
// are the recovery path if the DB allowlist is misconfigured.
export function adminEmailSet(env: Bindings): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function effectiveAdmins(
  env: Bindings,
  db: ReturnType<typeof getDb>,
): Promise<Map<string, AdminRole>> {
  const map = new Map<string, AdminRole>();
  for (const email of adminEmailSet(env)) map.set(email, "owner");
  try {
    const rows = await db.select().from(schema.adminEmails).all();
    for (const r of rows) {
      const email = r.email?.toLowerCase();
      if (email && !map.has(email)) map.set(email, normalizeAdminRole(r.role));
    }
  } catch {}
  return map;
}

export async function effectiveAdminSet(
  env: Bindings,
  db: ReturnType<typeof getDb>,
): Promise<Set<string>> {
  return new Set((await effectiveAdmins(env, db)).keys());
}

export async function adminRole(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  email: string | null | undefined,
): Promise<AdminRole | null> {
  if (!email) return null;
  return (await effectiveAdmins(env, db)).get(email.toLowerCase()) ?? null;
}

export function isAdminEmail(
  env: Bindings,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return adminEmailSet(env).has(email.toLowerCase());
}

export async function isAdminEmailDb(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  email: string | null | undefined,
): Promise<boolean> {
  return (await adminRole(env, db, email)) != null;
}

export async function hasRole(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  email: string | null | undefined,
  minimum: AdminRole,
): Promise<boolean> {
  const role = await adminRole(env, db, email);
  return role != null && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const requireAdmin = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  const db = getDb(c.env.DB);
  if (!(await hasRole(c.env, db, c.get("userEmail"), "auditor"))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
});

export function requireAdminRole(minimum: AdminRole) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const db = getDb(c.env.DB);
      if (!(await hasRole(c.env, db, c.get("userEmail"), minimum))) {
        return c.json({ error: "forbidden" }, 403);
      }
      await next();
    },
  );
}
