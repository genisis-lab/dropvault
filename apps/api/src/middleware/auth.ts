import { createMiddleware } from "hono/factory"
import { eq } from "drizzle-orm"
import { createAuth } from "../auth"
import { getDb, schema } from "../db"
import { clientIpInfo } from "../lib/rateLimit"
import { nowSeconds } from "../lib/expiry"
import type { Bindings, Variables } from "../types"

// Validates the better-auth session and attaches userId/userEmail.
// Returns 401 if there is no valid session, or 403 if the account is suspended.
export const requireAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const auth = createAuth(c.env)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) {
      return c.json({ error: "unauthorized" }, 401)
    }
    // Suspended accounts keep a (briefly) valid session so the UI can explain the
    // block and offer sign-out, but they cannot perform ANY authenticated action.
    const db = getDb(c.env.DB)
    const suspension = await db
      .select()
      .from(schema.userSuspensions)
      .where(eq(schema.userSuspensions.userId, session.user.id))
      .get()
      .catch(() => null)
    if (suspension) {
      return c.json({ error: "suspended", reason: suspension.reason ?? null }, 403)
    }
    c.set("userId", session.user.id)
    c.set("userEmail", session.user.email)

    // Store both IP families when proxy headers expose both. Better Auth's
    // session.ipAddress is a single value, so keep that as the primary display IP
    // while also saving ip_v4/ip_v6 plus an append-only observation row.
    try {
      const info = clientIpInfo(c)
      const sessionId = String((session as any)?.session?.id ?? "")
      const path = new URL(c.req.url).pathname.slice(0, 500)
      if (sessionId) {
        await c.env.DB.prepare("UPDATE session SET ipAddress = ?, ip_v4 = ?, ip_v6 = ? WHERE id = ?")
          .bind(info.primary === "unknown" ? null : info.primary, info.ipv4, info.ipv6, sessionId)
          .run()
          .catch(() => {})
      }
      await c.env.DB.prepare("INSERT INTO ip_observations (id, user_id, primary_ip, ip_v4, ip_v6, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), session.user.id, info.primary === "unknown" ? null : info.primary, info.ipv4, info.ipv6, path, nowSeconds())
        .run()
        .catch(() => {})
    } catch {}

    await next()
  },
)
