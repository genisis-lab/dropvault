import { createMiddleware } from "hono/factory"
import { createAuth } from "../auth"
import type { Bindings, Variables } from "../types"

// Validates the better-auth session and attaches userId/userEmail.
// Returns 401 if there is no valid session.
export const requireAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const auth = createAuth(c.env)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) {
      return c.json({ error: "unauthorized" }, 401)
    }
    c.set("userId", session.user.id)
    c.set("userEmail", session.user.email)
    await next()
  },
)
