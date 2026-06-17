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
import keepForeverRoute from "./routes/keepForever"
import { isIpBanned } from "./lib/ipAccess"
import { clientIp } from "./lib/rateLimit"
import { sweepExpired, reconcileOrphans } from "./lib/sweep"
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
  // Do not add a CSP sandbox at the share middleware level.
  //
  // The browser's native video/PDF/media viewer needs to run its own control
  // scripts. A response-level `sandbox` directive without allow-scripts breaks
  // both inline <video> and top-level ?raw=1 playback with:
  // "Blocked script execution ... because the document's frame is sandboxed".
  //
  // The generated share pages are server-rendered by us (filenames are escaped;
  // no user-provided HTML is executed) and already have a strict CSP with no
  // script sources. Raw bytes are served with an explicit Content-Type and
  // nosniff, so they cannot be reinterpreted as HTML. Therefore a sandbox here
  // is unnecessary and harmful. Keep the rest of the hardening headers.
  if (!c.res.headers.get("Content-Security-Policy")) {
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  }
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
})

// Deep health check: round-trips D1 and R2 so monitoring catches a broken
// binding or missing migration instead of a static ok. Returns 503 when any
// dependency is unreachable.
async function healthCheck(c: { env: Bindings; json: (body: unknown, status?: number) => Response }): Promise<Response> {
  const checks: Record<string, "ok" | "error"> = { d1: "ok", r2: "ok" }
  let ok = true
  try { await c.env.DB.prepare("SELECT 1").first() } catch { checks.d1 = "error"; ok = false }
  try { await c.env.FILES.head("__healthcheck__") } catch { checks.r2 = "error"; ok = false }
  return c.json({ ok, service: "dropvault-api", checks }, ok ? 200 : 503)
}
app.get("/health", (c) => healthCheck(c))
app.get("/api/health", (c) => healthCheck(c))

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))

app.route("/api/share", shareRoute)
app.route("/api/files", filesRoute)
app.route("/api/folders", foldersRoute)
app.route("/api/upload-requests", uploadRequestsRoute)
app.route("/api/notifications", notificationsRoute)
app.route("/api/sessions", sessionsRoute)
app.route("/api/teams", teamsRoute)
app.route("/api/portal-requests", portalRequestsRoute)
app.route("/api/keep-forever", keepForeverRoute)
app.route("/api/account", accountRoute)
app.route("/api/admin", adminRoute)

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil((async () => {
      try { await sweepExpired(env) } catch (err) { console.error("[cron] sweepExpired failed", err) }
      try { await reconcileOrphans(env) } catch (err) { console.error("[cron] reconcileOrphans failed", err) }
    })())
  },
}
