import { createMiddleware } from "hono/factory"
import { eq } from "drizzle-orm"
import { createAuth } from "../auth"
import { getDb, schema } from "../db"
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
    await next()
  },
)
