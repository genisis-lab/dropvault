import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { createAuth } from "../auth"
import { getDb, schema } from "../db"
import type { Bindings, Variables } from "../types"

// Lightweight account endpoint that intentionally does NOT use requireAuth, so a
// suspended user can still learn that they are suspended (requireAuth blocks
// everything else with a 403).
const account = new Hono<{ Bindings: Bindings; Variables: Variables }>()

account.get("/me", async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "unauthorized" }, 401)
  const db = getDb(c.env.DB)
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, session.user.id))
    .get()
    .catch(() => null)
  return c.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    suspended: !!suspension,
    suspensionReason: suspension?.reason ?? null,
  })
})

export default account
