import { Hono } from "hono"
import { and, desc, eq, gt, sql } from "drizzle-orm"
import { getCookie, setCookie } from "hono/cookie"
import { getDb, schema } from "../db"
import { isExpired, nowSeconds } from "../lib/expiry"
import { sha256Hex } from "../lib/hash"
import type { Bindings, Variables } from "../types"

type FileRow = typeof schema.files.$inferSelect
type FolderRow = typeof schema.folders.$inferSelect

// Public, UNAUTHENTICATED downloads via a share token. Mounted at /api/share so
// it rides through the same Pages proxy as the rest of the API. Anyone with the
// link can fetch the file/folder until it expires or the owner revokes the token.
// Both file and folder links may additionally be protected with a password, a
// download limit, and/or a link-specific expiry.
const share = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function esc(s: string): string {
  return s.replace(/[&<>\"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '\"' ? "&quot;" : "&#39;",
  )
}

function fmtBytes(n: number): string {
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

function humanLeft(expiresAt: number): string {
  const secs = expiresAt - nowSeconds()
  if (secs <= 0) return "Expired"
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  if (d >= 1) return `Expires in ${d} day${d === 1 ? "" : "s"}`
  if (h >= 1) return `Expires in ${h} hour${h === 1 ? "" : "s"}`
  const m = Math.max(1, Math.floor((secs % 3600) / 60))
  return `Expires in ${m} minute${m === 1 ? "" : "s"}`
}

const STYLE =
  `:root{color-scheme:light}*{box-sizing:border-box}` +
  `body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Inter,sans-serif;background:#f6f8fc;color:#1f2430}` +
  `.wrap{max-width:760px;margin:0 auto;padding:32px 20px 64px}` +
  `.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}` +
  `.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#8b5cf6,#ec4899)}` +
  `.brand b{font-size:18px}` +
  `h1{font-size:24px;margin:0 0 4px;word-break:break-word}` +
  `.muted{color:#64748b;font-size:14px;margin:0 0 24px}` +
  `.list{background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06)}` +
  `.row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #f1f5f9}` +
  `.row:first-child{border-top:none}.row:hover{background:#f8fafc}` +
  `.rowmain{display:flex;align-items:center;gap:14px;flex:1;min-width:0;text-decoration:none;color:inherit}` +
  `.ic{width:40px;height:40px;border-radius:10px;background:#eef2ff;color:#6366f1;display:grid;place-items:center;font-size:18px;flex:none}` +
  `.grow{flex:1;min-width:0}` +
  `.name{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` +
  `.meta{color:#94a3b8;font-size:13px}` +
  `.dl{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:9px;background:#eef2ff;color:#6d28d9;font-weight:600;font-size:13px;text-decoration:none;flex:none}` +
  `.dl:hover{background:#e0e7ff}` +
  `.empty{text-align:center;color:#94a3b8;padding:56px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:18px}` +
  `.card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:34px 28px;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06)}` +
  `.fic{width:72px;height:72px;border-radius:20px;margin:0 auto 18px;display:grid;place-items:center;font-size:32px;background:linear-gradient(135deg,#eef2ff,#f5f3ff);color:#7c3aed}` +
  `.btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}` +
  `.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:12px;font-weight:600;font-size:15px;text-decoration:none;border:1px solid transparent;cursor:pointer}` +
  `.btn.primary{background:linear-gradient(135deg,#7c3aed,#8b5cf6,#ec4899);color:#fff;box-shadow:0 8px 20px rgba(124,58,237,.28)}` +
  `.btn.primary:hover{filter:brightness(1.05)}` +
  `.btn.ghost{background:#fff;border-color:#e2e8f0;color:#475569}` +
  `.btn.ghost:hover{background:#f8fafc}` +
  `.pwform{display:flex;flex-direction:column;gap:12px;max-width:320px;margin:22px auto 0}` +
  `.pwin{padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;font-size:15px;outline:none;width:100%;font-family:inherit}` +
  `.pwin:focus{border-color:#a78bfa}` +
  `.badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 6px}` +
  `.badge{display:inline-block;padding:4px 11px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:600}` +
  `.err{color:#dc2626;font-size:14px;margin:0}` +
  `footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:28px}`

function pageShell(title: string, inner: string): string {
  return `<!doctype html><html lang=\"en\"><head>` +
    `<meta charset=\"utf-8\"/>` +
    `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>` +
    `<title>${esc(title)} \u00b7 Dropvault</title>` +
    `<style>${STYLE}</style></head><body><div class=\"wrap\">` +
    `<div class=\"brand\"><div class=\"logo\"></div><b>Dropvault</b></div>` +
    inner +
    `<footer>Shared securely with Dropvault \u00b7 links expire automatically.</footer>` +
    `</div></body></html>`
}

function filePage(name: string, meta: string, token: string, notes: string): string {
  const inner =
    `<div class=\"card\">` +
    `<div class=\"fic\">\u2913</div>` +
    `<h1>${esc(name)}</h1>` +
    `<p class=\"muted\">${esc(meta)}</p>` +
    notes +
    `<div class=\"btns\">` +
    `<a class=\"btn primary\" href=\"/api/share/${token}?dl=1\">\u2193 Download</a>` +
    `<a class=\"btn ghost\" href=\"/api/share/${token}?raw=1\" target=\"_blank\" rel=\"noopener\">Preview</a>` +
    `<a class=\"btn ghost\" href=\"/api/share/${token}/report\">Report</a>` +
    `</div></div>`
  return pageShell(name, inner)
}

// Public abuse/takedown report page for a single-file share link. Shown via GET
// (the form) and again after a successful POST (the thank-you state).
function reportPage(token: string, done: boolean): string {
  if (done) {
    const inner =
      `<div class=\"card\">` +
      `<div class=\"fic\">\u2713</div>` +
      `<h1>Report received</h1>` +
      `<p class=\"muted\">Thanks \u2014 our admins will review this file shortly. You can close this page.</p>` +
      `</div>`
    return pageShell("Report received", inner)
  }
  const inner =
    `<div class=\"card\">` +
    `<div class=\"fic\">\u2691</div>` +
    `<h1>Report this file</h1>` +
    `<p class=\"muted\">Tell us why this file should be reviewed. Your report goes to the workspace admins.</p>` +
    `<form method=\"post\" action=\"/api/share/${token}/flag\" class=\"pwform\">` +
    `<textarea class=\"pwin\" name=\"reason\" rows=\"4\" placeholder=\"What\u2019s wrong with this file?\" required></textarea>` +
    `<input class=\"pwin\" type=\"email\" name=\"email\" placeholder=\"Your email (optional)\"/>` +
    `<button type=\"submit\" class=\"btn primary\" style=\"justify-content:center\">Submit report</button>` +
    `</form></div>`
  return pageShell("Report this file", inner)
}

// Password gate page. Takes the unlock action path so both file and folder links
// can reuse it.
function passwordPage(actionPath: string, error: boolean): string {
  const err = error ? `<p class=\"err\">Incorrect password. Please try again.</p>` : ``
  const inner =
    `<div class=\"card\">` +
    `<div class=\"fic\">\uD83D\uDD12</div>` +
    `<h1>Password required</h1>` +
    `<p class=\"muted\">This link is protected. Enter the password to continue.</p>` +
    `<form method=\"post\" action=\"${actionPath}\" class=\"pwform\">` +
    err +
    `<input class=\"pwin\" type=\"password\" name=\"password\" placeholder=\"Password\" autofocus required/>` +
    `<button type=\"submit\" class=\"btn primary\" style=\"justify-content:center\">Unlock</button>` +
    `</form></div>`
  return pageShell("Password required", inner)
}

function infoPage(title: string, msg: string): string {
  const inner = `<div class=\"card\"><div class=\"fic\">\u2298</div><h1>${esc(title)}</h1><p class=\"muted\">${esc(msg)}</p></div>`
  return pageShell(title, inner)
}

function folderPage(name: string, rowsHtml: string, count: number, notes: string = ""): string {
  const body = count
    ? `<div class=\"list\">${rowsHtml}</div>`
    : `<div class=\"empty\">This folder is empty, or its files have expired.</div>`
  const inner =
    `<h1>${esc(name)}</h1><p class=\"muted\">${count} file${count === 1 ? "" : "s"} \u00b7 shared folder</p>` + notes + body
  return pageShell(name, inner)
}

function streamObject(object: R2ObjectBody, filename: string, attachment: boolean): Response {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("Content-Length", String(object.size))
  const safe = filename.replace(/[\"\\]/g, "_")
  headers.set("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename=\"${safe}\"`)
  headers.set("Cache-Control", "private, max-age=0, no-store")
  return new Response(object.body, { headers })
}

// Cookie that proves a visitor entered the correct password for a FILE link.
function pwCookieName(token: string): string {
  return `dvpw_${token}`
}

function pwUnlocked(c: any, row: FileRow, token: string): boolean {
  if (!row.sharePassword) return true
  return getCookie(c, pwCookieName(token)) === row.sharePassword
}

// Cookie that proves a visitor entered the correct password for a FOLDER link.
function pwfCookieName(token: string): string {
  return `dvpwf_${token}`
}

function folderPwUnlocked(c: any, folder: FolderRow, token: string): boolean {
  if (!folder.sharePassword) return true
  return getCookie(c, pwfCookieName(token)) === folder.sharePassword
}

// Link-level gate (separate from the file's own auto-expiry): link expiry hit or
// the download limit reached. Returns an info reason or null when the link is open.
function shareClosed(row: FileRow): { title: string; msg: string } | null {
  if (row.shareExpiresAt && row.shareExpiresAt <= nowSeconds()) {
    return { title: "Link expired", msg: "This share link has expired. Ask the owner for a new one." }
  }
  if (row.shareDownloadLimit != null && row.shareDownloadCount >= row.shareDownloadLimit) {
    return { title: "Link unavailable", msg: "This share link has reached its download limit." }
  }
  return null
}

function folderShareClosed(folder: FolderRow): { title: string; msg: string } | null {
  if (folder.shareExpiresAt && folder.shareExpiresAt <= nowSeconds()) {
    return { title: "Link expired", msg: "This shared folder link has expired. Ask the owner for a new one." }
  }
  if (folder.shareDownloadLimit != null && folder.shareDownloadCount >= folder.shareDownloadLimit) {
    return { title: "Link unavailable", msg: "This shared folder link has reached its download limit." }
  }
  return null
}

// --- Folder share: public listing page -------------------------------------
share.get("/folder/:token", async (c) => {
  const token = c.req.param("token")
  const db = getDb(c.env.DB)
  const folder = await db.select().from(schema.folders).where(eq(schema.folders.shareToken, token)).get()
  if (!folder) return c.html(infoPage("Link unavailable", "This shared folder link is invalid or has been revoked."), 404)

  const closed = folderShareClosed(folder)
  if (closed) return c.html(infoPage(closed.title, closed.msg), 410)

  if (folder.sharePassword && !folderPwUnlocked(c, folder, token)) {
    return c.html(passwordPage(`/api/share/folder/${token}/unlock`, false), 401)
  }

  const rows = await db.select().from(schema.files)
    .where(and(eq(schema.files.folderId, folder.id), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds())))
    .orderBy(desc(schema.files.createdAt))
    .all()

  const rowsHtml = rows.map((r) => {
    const base = `/api/share/folder/${token}/${r.id}`
    return `<div class=\"row\">` +
      `<a class=\"rowmain\" href=\"${base}?raw=1\" target=\"_blank\" rel=\"noopener\">` +
      `<div class=\"ic\">\uD83D\uDCC4</div>` +
      `<div class=\"grow\"><div class=\"name\">${esc(r.filename)}</div><div class=\"meta\">${fmtBytes(r.sizeBytes)}</div></div>` +
      `</a>` +
      `<a class=\"dl\" href=\"${base}?dl=1\">\u2193 Download</a></div>`
  }).join("")

  const badges: string[] = []
  if (folder.shareDownloadLimit != null) {
    const left = Math.max(0, folder.shareDownloadLimit - folder.shareDownloadCount)
    badges.push(`<span class=\"badge\">${left} download${left === 1 ? "" : "s"} left</span>`)
  }
  if (folder.shareExpiresAt) badges.push(`<span class=\"badge\">${esc(humanLeft(folder.shareExpiresAt))}</span>`)
  if (folder.sharePassword) badges.push(`<span class=\"badge\">\uD83D\uDD13 Unlocked</span>`)
  const notes = badges.length ? `<div class=\"badges\">${badges.join("")}</div>` : ""

  return c.html(folderPage(folder.name, rowsHtml, rows.length, notes))
})

// --- Folder share: unlock a password-protected folder link ------------------
share.post("/folder/:token/unlock", async (c) => {
  const token = c.req.param("token")
  const db = getDb(c.env.DB)
  const folder = await db.select().from(schema.folders).where(eq(schema.folders.shareToken, token)).get()
  if (!folder) return c.html(infoPage("Link unavailable", "This shared folder link is invalid or has been revoked."), 404)
  if (!folder.sharePassword) return c.redirect(`/api/share/folder/${token}`, 302)

  const form = await c.req.parseBody()
  const submitted = String(form?.password ?? "")
  const ok = (await sha256Hex(submitted)) === folder.sharePassword
  if (!ok) return c.html(passwordPage(`/api/share/folder/${token}/unlock`, true), 401)

  setCookie(c, pwfCookieName(token), folder.sharePassword, {
    path: `/api/share/folder/${token}`,
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 86400,
  })
  return c.redirect(`/api/share/folder/${token}`, 302)
})

// --- Folder share: public fetch of one file within the shared folder --------
share.get("/folder/:token/:fileId", async (c) => {
  const token = c.req.param("token")
  const fileId = c.req.param("fileId")
  const wantDownload = c.req.query("dl") === "1"
  const db = getDb(c.env.DB)
  const folder = await db.select().from(schema.folders).where(eq(schema.folders.shareToken, token)).get()
  if (!folder) return c.json({ error: "not found" }, 404)

  const closed = folderShareClosed(folder)
  if (closed) return c.json({ error: closed.title }, 410)

  if (folder.sharePassword && !folderPwUnlocked(c, folder, token)) {
    return c.json({ error: "password required" }, 401)
  }

  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.folderId, folder.id))).get()
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)

  // Count actual downloads toward the folder link's limit (previews via ?raw=1 do not).
  if (wantDownload) {
    await db.update(schema.folders)
      .set({ shareDownloadCount: sql`${schema.folders.shareDownloadCount} + 1` })
      .where(eq(schema.folders.id, folder.id)).run()
  }
  return streamObject(object, row.filename, wantDownload)
})

// --- Single-file share: unlock a password-protected link --------------------
share.post("/:token/unlock", async (c) => {
  const token = c.req.param("token")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.shareToken, token)).get()
  if (!row || row.status !== "ready") {
    return c.html(infoPage("Link unavailable", "This share link is invalid or has been revoked."), 404)
  }
  if (!row.sharePassword) return c.redirect(`/api/share/${token}`, 302)

  const form = await c.req.parseBody()
  const submitted = String(form?.password ?? "")
  const ok = (await sha256Hex(submitted)) === row.sharePassword
  if (!ok) return c.html(passwordPage(`/api/share/${token}/unlock`, true), 401)

  setCookie(c, pwCookieName(token), row.sharePassword, {
    path: `/api/share/${token}`,
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 86400,
  })
  return c.redirect(`/api/share/${token}`, 302)
})

// --- Single-file share: public abuse/takedown report ------------------------
// Two-segment paths (/:token/report, /:token/flag) never collide with the
// one-segment landing route (/:token).
share.get("/:token/report", (c) => c.html(reportPage(c.req.param("token"), false)))

share.post("/:token/flag", async (c) => {
  const token = c.req.param("token")
  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.shareToken, token)).get()
  const form = await c.req.parseBody()
  const reason = String(form?.reason ?? "").trim().slice(0, 2000)
  const email = String(form?.email ?? "").trim().slice(0, 320) || null
  if (!reason) return c.html(reportPage(token, false), 400)
  await db.insert(schema.fileFlags).values({
    id: crypto.randomUUID(),
    fileId: row?.id ?? null,
    token,
    reason,
    reporterEmail: email,
    status: "open",
    createdAt: nowSeconds(),
    resolvedAt: null,
  }).run()
  return c.html(reportPage(token, true))
})

// --- Single-file share: landing page (default) + download / preview ---------
share.get("/:token", async (c) => {
  const token = c.req.param("token")
  if (!token) return c.json({ error: "not found" }, 404)
  const wantDownload = c.req.query("dl") === "1"
  const wantRaw = c.req.query("raw") === "1"
  const wantsBytes = wantDownload || wantRaw

  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.shareToken, token)).get()
  if (!row || row.status !== "ready") {
    return wantsBytes
      ? c.json({ error: "not found" }, 404)
      : c.html(infoPage("Link unavailable", "This share link is invalid or has been revoked."), 404)
  }

  if (isExpired(row.expiresAt)) {
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    return wantsBytes
      ? c.json({ error: "expired" }, 410)
      : c.html(infoPage("Link expired", "This file has expired and is no longer available."), 410)
  }

  const closed = shareClosed(row)
  if (closed) {
    return wantsBytes ? c.json({ error: closed.title }, 410) : c.html(infoPage(closed.title, closed.msg), 410)
  }

  if (row.sharePassword && !pwUnlocked(c, row, token)) {
    return wantsBytes ? c.json({ error: "password required" }, 401) : c.html(passwordPage(`/api/share/${token}/unlock`, false), 401)
  }

  if (wantsBytes) {
    const object = await c.env.FILES.get(row.r2Key)
    if (!object) return c.json({ error: "not found" }, 404)
    if (wantDownload) {
      await db.update(schema.files)
        .set({ shareDownloadCount: sql`${schema.files.shareDownloadCount} + 1` })
        .where(eq(schema.files.id, row.id)).run()
    }
    return streamObject(object, row.filename, wantDownload)
  }

  const badges: string[] = []
  if (row.shareDownloadLimit != null) {
    const left = Math.max(0, row.shareDownloadLimit - row.shareDownloadCount)
    badges.push(`<span class=\"badge\">${left} download${left === 1 ? "" : "s"} left</span>`)
  }
  if (row.shareExpiresAt) badges.push(`<span class=\"badge\">${esc(humanLeft(row.shareExpiresAt))}</span>`)
  if (row.sharePassword) badges.push(`<span class=\"badge\">\uD83D\uDD13 Unlocked</span>`)
  const notesHtml = badges.length ? `<div class=\"badges\">${badges.join("")}</div>` : ""

  const effExpiry = row.shareExpiresAt && row.shareExpiresAt < row.expiresAt ? row.shareExpiresAt : row.expiresAt
  const meta = `${fmtBytes(row.sizeBytes)} \u00b7 ${humanLeft(effExpiry)}`
  return c.html(filePage(row.filename, meta, token, notesHtml))
})

export default share
