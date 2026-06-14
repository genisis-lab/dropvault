import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { getDb, schema } from "../db"
import { isExpired } from "../lib/expiry"
import type { Bindings, Variables } from "../types"

// Public, UNAUTHENTICATED downloads via a share token. Mounted at /api/share so
// it rides through the same Pages proxy as the rest of the API. Anyone with the
// link can fetch the file until it expires or the owner revokes the token.
const share = new Hono<{ Bindings: Bindings; Variables: Variables }>()

share.get("/:token", async (c) => {
  const token = c.req.param("token")
  if (!token) return c.json({ error: "not found" }, 404)

  const db = getDb(c.env.DB)
  const row = await db.select().from(schema.files).where(eq(schema.files.shareToken, token)).get()
  if (!row || row.status !== "ready") return c.json({ error: "not found" }, 404)

  if (isExpired(row.expiresAt)) {
    // Expired files are never served; clean up opportunistically.
    try { await c.env.FILES.delete(row.r2Key) } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run()
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.FILES.get(row.r2Key)
  if (!object) return c.json({ error: "not found" }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("Content-Length", String(object.size))
  // inline so images/PDFs preview in the browser; downloads keep the filename.
  headers.set("Content-Disposition", `inline; filename="${row.filename.replace(/["\\]/g, "_")}"`)
  headers.set("Cache-Control", "private, max-age=0, no-store")
  return new Response(object.body, { headers })
})

export default share
