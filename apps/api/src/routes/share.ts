import { Hono } from "hono"
import { and, desc, eq, gt } from "drizzle-orm"
import { getDb, schema } from "../db"
import { isExpired, nowSeconds } from "../lib/expiry"
import type { Bindings, Variables } from "../types"

// Public, UNAUTHENTICATED downloads via a share token. Mounted at /api/share so
// it rides through the same Pages proxy as the rest of the API. Anyone with the
// link can fetch the file/folder until it expires or the owner revokes the token.
const share = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  )
}

function fmtBytes(n: number): string {
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

function folderPage(name: string, rowsHtml: string, count: number): string {
  const body = count
    ? `<div class="list">${rowsHtml}</div>`
    : `<div class="empty">This folder is empty, or its files have expired.</div>`
  return `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${esc(name)} \u00b7 Dropvault</title>` +
    `<style>` +
    `:root{color-scheme:light}*{box-sizing:border-box}` +
    `body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Inter,sans-serif;background:#f6f8fc;color:#1f2430}` +
    `.wrap{max-width:880px;margin:0 auto;padding:32px 20px 64px}` +
    `.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}` +
    `.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#8b5cf6,#ec4899)}` +
    `.brand b{font-size:18px}` +
    `h1{font-size:24px;margin:0 0 4px}` +
    `.muted{color:#64748b;font-size:14px;margin:0 0 24px}` +
    `.list{background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06)}` +
    `.row{display:flex;align-items:center;gap:14px;padding:14px 18px;border-top:1px solid #f1f5f9;text-decoration:none;color:inherit}` +
    `.row:first-child{border-top:none}.row:hover{background:#f8fafc}` +
    `.ic{width:40px;height:40px;border-radius:10px;background:#eef2ff;color:#6366f1;display:grid;place-items:center;font-size:18px;flex:none}` +
    `.grow{flex:1;min-width:0}` +
    `.name{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}` +
    `.meta{color:#94a3b8;font-size:13px}` +
    `.dl{color:#7c3aed;font-weight:600;font-size:13px;flex:none}` +
    `.empty{text-align:center;color:#94a3b8;padding:56px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:18px}` +
    `footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:28px}` +
    `</style></head><body><div class="wrap">` +
    `<div class="brand"><div class="logo"></div><b>Dropvault</b></div>` +
    `<h1>${esc(name)}</h1>` +
    `<p class="muted">${count} file${count === 1 ? "" : "s"} \u00b7 shared folder</p>` +
    body +
    `<footer>Files in shared folders expire automatically.</footer>` +
    `</div></body></html>`
}

// --- Folder share: public listing page -------------------------------------
share.get("/folder/:token", async (c) => {
  const token = c.req.param("token")
  const db = getDb(c.env.DB)
  const folder = await db.select().from(schema.folders).where(eq(schema.folders.shareToken, token)).get()
  if (!folder) return c.html(folderPage("Link unavailable", "", 0), 404)

  const rows = await db.select().from(schema.files)
    .where(and(eq(schema.files.folderId, folder.id), eq(schema.files.status, "ready"), gt(schema.files.expiresAt, nowSeconds())))
    .orderBy(desc(schema.files.createdAt))
    .all()

  const rowsHtml = rows.map((r) => {
    const href = `/api/share/folder/${token}/${r.id}`
    return `<a class="row" href="${href}">` +
      `<div class="ic">\u2193</div>` +
      `<div class="grow"><div class="name">${esc(r.filename)}</div><div class="meta">${fmtBytes(r.sizeBytes)}</div></div>` +
      `<div class="dl">Download</div></a>`
  }).join("")

  return c.html(folderPage(folder.name, rowsHtml, rows.length))
})

// --- Folder share: public download of one file within the shared folder -----
share.get("/folder/:token/:fileId", async (c) => {
  const token = c.req.param("token")
  const fileId = c.req.param("fileId")
  const db = getDb(c.env.DB)
  const folder = await db.select().from(schema.folders).where(eq(schema.folders.shareToken, token)).get()
  if (!folder) return c.json({ error: "not found" }, 404)

  const row = await db.select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.folderId, folder.id))).get()
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("Content-Length", String(object.size))
  headers.set("Content-Disposition", `inline; filename="${row.filename.replace(/["\\]/g, "_")}"`)
  headers.set("Cache-Control", "private, max-age=0, no-store")
  return new Response(object.body, { headers })
})

// --- Single-file share (existing) ------------------------------------------
share.get("/:token", async (c) => {
  const token = c.req.param("token")
  if (!token) return c.json({ error: "not found" }, 404)

  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.shareToken, token)).get()
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("Content-Length", String(object.size))
  headers.set("Content-Disposition", `inline; filename="${row.filename.replace(/["\\]/g, "_")}"`)
  headers.set("Cache-Control", "private, max-age=0, no-store")
  return new Response(object.body, { headers })
})

export default share
