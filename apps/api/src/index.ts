import { Hono } from "hono"
import { cors } from "hono/cors"
import { createAuth } from "./auth"
import filesRoute from "./routes/files"
import shareRoute from "./routes/share"
import { sweepExpired } from "./lib/sweep"
import type { Bindings, Variables } from "./types"

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use("*", async (c, next) => {
  const handler = cors({
    origin: c.env.PUBLIC_APP_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
  return handler(c, next)
})

app.get("/health", (c) => c.json({ ok: true, service: "dropvault-api" }))
app.get("/api/health", (c) => c.json({ ok: true, service: "dropvault-api" }))

// better-auth owns everything under /api/auth/*
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env)
  return auth.handler(c.req.raw)
})

// Public share downloads (no auth).
app.route("/api/share", shareRoute)

// Authenticated file operations
app.route("/api/files", filesRoute)

export default {
  fetch: app.fetch,
  // Cron Trigger: hourly storage-reclamation sweep (see wrangler.toml).
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(sweepExpired(env))
  },
}
