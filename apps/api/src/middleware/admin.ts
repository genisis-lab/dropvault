import { createMiddleware } from "hono/factory"
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

// True when the given email is present in the ADMIN_EMAILS allowlist.
export function isAdminEmail(env: Bindings, email: string | null | undefined): boolean {
  if (!email) return false
  return adminEmailSet(env).has(email.toLowerCase())
}

// Gate routes to admins only. MUST run AFTER requireAuth, which sets userEmail.
// Returns 403 for authenticated users who are not on the allowlist.
export const requireAdmin = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    if (!isAdminEmail(c.env, c.get("userEmail"))) {
      return c.json({ error: "forbidden" }, 403)
    }
    await next()
  },
)
