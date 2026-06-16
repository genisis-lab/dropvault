import { Hono } from "hono"
import { cors } from "hono/cors"
import { createAuth } from "./auth"
import { getDb } from "./db"
import filesRoute from "./routes/files"
import foldersRoute from "./routes/folders"
import shareRoute from "./routes/share"
import adminRoute from "./routes/admin"
import accountRoute from "./routes/account"
import uploadRequestsRoute from "./routes/uploadRequests"
import notificationsRoute from "./routes/notifications"
import sessionsRoute from "./routes/sessions"
import teamsRoute from "./routes/teams"
import portalRequestsRoute from "./routes/portalRequests"
import { isIpBanned } from "./lib/ipAccess"
import { clientIp } from "./lib/rateLimit"
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

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path === "/health" || path === "/api/health") return next()
  const banned = await isIpBanned(getDb(c.env.DB), clientIp(c)).catch(() => false)
  if (!banned) return next()
  return path.startsWith("/api/share/") ? c.text("forbidden", 403) : c.json({ error: "ip banned" }, 403)
})

app.use("/api/share/*", async (c, next) => {
  const sharePath = new URL(c.req.url).pathname.slice("/api/share/".length)
  let decoded = ""
  try { decoded = decodeURIComponent(sharePath) } catch { return c.text("not found", 404) }
  if (!/^[A-Za-z0-9/_-]*$/.test(decoded)) return c.text("not found", 404)
  await next()
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; sandbox allow-forms allow-downloads allow-popups")
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
})

app.get("/health", (c) => c.json({ ok: true, service: "dropvault-api" }))
app.get("/api/health", (c) => c.json({ ok: true, service: "dropvault-api" }))

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))

app.route("/api/share", shareRoute)
app.route("/api/files", filesRoute)
app.route("/api/folders", foldersRoute)
app.route("/api/upload-requests", uploadRequestsRoute)
app.route("/api/notifications", notificationsRoute)
app.route("/api/sessions", sessionsRoute)
app.route("/api/teams", teamsRoute)
app.route("/api/portal-requests", portalRequestsRoute)
app.route("/api/account", accountRoute)
app.route("/api/admin", adminRoute)

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(sweepExpired(env))
  },
}
