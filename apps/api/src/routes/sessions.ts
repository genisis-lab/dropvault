import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { createAuth } from "../auth";
import { getDb, schema } from "../db";
import { requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

const sessions = new Hono<{ Bindings: Bindings; Variables: Variables }>();
sessions.use("*", requireAuth);

async function currentSessionId(c: any): Promise<string | null> {
  const auth = createAuth(c.env);
  const session = await auth.api
    .getSession({ headers: c.req.raw.headers })
    .catch(() => null);
  return String((session as any)?.session?.id ?? "") || null;
}

sessions.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const currentId = await currentSessionId(c);
  const rows = await db
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, c.get("userId")))
    .orderBy(desc(schema.session.updatedAt))
    .all()
    .catch(() => []);
  return c.json({
    sessions: rows.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: Math.floor(s.createdAt.getTime() / 1000),
      updatedAt: Math.floor(s.updatedAt.getTime() / 1000),
      expiresAt: Math.floor(s.expiresAt.getTime() / 1000),
      current: s.id === currentId,
    })),
  });
});

sessions.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  // Session ids are opaque but are not authorization credentials. Always
  // scope revocation to the signed-in user so a leaked/guessed id cannot be
  // used to sign another account out.
  await db
    .delete(schema.session)
    .where(
      and(
        eq(schema.session.id, id),
        eq(schema.session.userId, c.get("userId")),
      ),
    )
    .run();
  return c.json({ ok: true });
});

sessions.post("/revoke-others", async (c) => {
  const db = getDb(c.env.DB);
  const currentId = await currentSessionId(c);
  const rows = await db
    .select()
    .from(schema.session)
    .where(eq(schema.session.userId, c.get("userId")))
    .all()
    .catch(() => []);
  for (const row of rows)
    if (row.id !== currentId)
      await db
        .delete(schema.session)
        .where(eq(schema.session.id, row.id))
        .run()
        .catch(() => {});
  return c.json({ ok: true, count: Math.max(0, rows.length - 1) });
});

export default sessions;
