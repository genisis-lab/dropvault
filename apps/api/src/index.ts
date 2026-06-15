import { Hono } from "hono"
import { cors } from "hono/cors"
import { createAuth } from "./auth"
import filesRoute from "./routes/files"
import foldersRoute from "./routes/folders"
import shareRoute from "./routes/share"
import adminRoute from "./routes/admin"
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

// Security headers for every response. The share route can serve user-uploaded
// bytes inline for previews, so apply a restrictive CSP sandbox there to prevent
// uploaded HTML/SVG from executing as same-origin script. The allow-list also
// rejects encoded quote/control-character paths before they can be reflected in
// public HTML form actions or links.
app.use("/api/share/*", async (c, next) => {
  const sharePath = new URL(c.req.url).pathname.slice("/api/share/".length)
  let decoded = ""
  try {
    decoded = decodeURIComponent(sharePath)
  } catch {
    return c.text("not found", 404)
  }
  if (!/^[A-Za-z0-9/_-]*$/.test(decoded)) {
    return c.text("not found", 404)
  }

  await next()
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; sandbox allow-forms allow-downloads allow-popups")
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
})

app.get("/health", (c) => c.json({ ok: true, service: "dropvault-api" }))
app.get("/api/health", (c) => c.json({ ok: true, service: "dropvault-api" }))

// better-auth owns everything under /api/auth/*
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env)
  return auth.handler(c.req.raw)
})

// Public share downloads (no auth): files and folders.
app.route("/api/share", shareRoute)

// Authenticated file + folder operations
app.route("/api/files", filesRoute)
app.route("/api/folders", foldersRoute)

// Admin (gated by the effective admin allowlist)
app.route("/api/admin", adminRoute)

export default {
  fetch: app.fetch,
  // Cron Trigger: hourly storage-reclamation sweep (see wrangler.toml).
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(sweepExpired(env))
  },
}
