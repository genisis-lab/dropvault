import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { isExpired, nowSeconds } from "../lib/expiry";
import { requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type TeamRole = "owner" | "admin" | "member" | "viewer" | string;
type TeamListItem = typeof schema.teams.$inferSelect & {
  role: TeamRole;
  memberCount?: number;
  fileCount?: number;
  folderCount?: number;
};
type TeamItemsBody = {
  fileIds?: unknown[];
  folderIds?: unknown[];
  removeFileIds?: unknown[];
  removeFolderIds?: unknown[];
};

const teams = new Hono<{ Bindings: Bindings; Variables: Variables }>();
teams.use("*", requireAuth);

function ids(input: unknown[] | undefined): string[] {
  return Array.isArray(input)
    ? Array.from(
        new Set(
          input.filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
          ),
        ),
      )
    : [];
}
function canManage(role: string) {
  return role === "owner" || role === "admin";
}
function isInlineTeamMedia(type: string | null): boolean {
  return !!type && (type.startsWith("image/") || type.startsWith("video/"));
}
function addInlineHeaders(headers: Headers) {
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; sandbox",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
}
async function membership(
  db: ReturnType<typeof getDb>,
  teamId: string,
  userId: string,
) {
  const team = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get()
    .catch(() => null);
  if (!team) return null;
  if (team.ownerId === userId) return { team, role: "owner" };
  const member = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId),
      ),
    )
    .get()
    .catch(() => null);
  return member ? { team, role: member.role } : null;
}
async function sharedTeamFile(
  db: ReturnType<typeof getDb>,
  teamId: string,
  fileId: string,
) {
  return db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.teamId, teamId)))
    .get()
    .catch(() => null);
}

teams.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("userId");
  const owned = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.ownerId, userId))
    .orderBy(desc(schema.teams.createdAt))
    .all()
    .catch(() => []);
  const memberships = await db
    .select()
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId))
    .all()
    .catch(() => []);
  const allTeams: TeamListItem[] = owned.map((t) => ({ ...t, role: "owner" }));
  for (const m of memberships) {
    const team = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, m.teamId))
      .get()
      .catch(() => null);
    if (team && team.ownerId !== userId)
      allTeams.push({ ...team, role: m.role });
  }
  const counts = new Map<
    string,
    { memberCount: number; fileCount: number; folderCount: number }
  >();
  await Promise.all(
    allTeams.map(async (team) => {
      const row = await c.env.DB.prepare(
        `SELECT
      (SELECT COUNT(*) FROM team_members WHERE team_id = ?) AS memberCount,
      (SELECT COUNT(*) FROM files WHERE team_id = ? AND deleted_at IS NULL) AS fileCount,
      (SELECT COUNT(*) FROM folders WHERE team_id = ?) AS folderCount
    `,
      )
        .bind(team.id, team.id, team.id)
        .first<{
          memberCount: number;
          fileCount: number;
          folderCount: number;
        }>();
      counts.set(
        team.id,
        row ?? { memberCount: 0, fileCount: 0, folderCount: 0 },
      );
    }),
  );
  return c.json({
    teams: allTeams.map((team) => ({
      ...team,
      ...(counts.get(team.id) ?? {
        memberCount: 0,
        fileCount: 0,
        folderCount: 0,
      }),
    })),
  });
});

teams.post("/", async (c) => {
  const body = await c.req
    .json<{ name?: string }>()
    .catch(() => ({}) as { name?: string });
  const name =
    String(body.name ?? "")
      .trim()
      .slice(0, 120) || "Untitled team";
  const db = getDb(c.env.DB);
  const id = crypto.randomUUID();
  const now = nowSeconds();
  await db
    .insert(schema.teams)
    .values({ id, name, ownerId: c.get("userId"), createdAt: now })
    .run();
  await db
    .insert(schema.teamMembers)
    .values({
      id: crypto.randomUUID(),
      teamId: id,
      userId: c.get("userId"),
      role: "owner",
      createdAt: now,
    })
    .run()
    .catch(() => {});
  return c.json({
    team: {
      id,
      name,
      ownerId: c.get("userId"),
      createdAt: now,
      role: "owner",
      memberCount: 1,
      fileCount: 0,
      folderCount: 0,
    },
  });
});

teams.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  const [members, folders, files] = await Promise.all([
    db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, access.team.id))
      .all()
      .catch(() => []),
    db
      .select()
      .from(schema.folders)
      .where(eq(schema.folders.teamId, access.team.id))
      .orderBy(desc(schema.folders.createdAt))
      .all()
      .catch(() => []),
    db
      .select()
      .from(schema.files)
      .where(eq(schema.files.teamId, access.team.id))
      .orderBy(desc(schema.files.createdAt))
      .all()
      .catch(() => []),
  ]);
  const userIds = Array.from(
    new Set([
      access.team.ownerId,
      ...members.map((member) => member.userId),
      ...folders.map((folder) => folder.ownerId),
      ...files.map((file) => file.ownerId),
    ]),
  );
  const users = userIds.length
    ? await db
        .select()
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
        .all()
        .catch(() => [])
    : [];
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const ownerEmailById = new Map(users.map((u) => [u.id, u.email] as const));
  return c.json({
    team: {
      ...access.team,
      role: access.role,
      memberCount: members.length,
      fileCount: files.length,
      folderCount: folders.length,
    },
    members: members.map((m) => ({
      ...m,
      userEmail: userById.get(m.userId)?.email ?? null,
      userName: userById.get(m.userId)?.name ?? null,
    })),
    folders: folders.map(({ sharePassword: _sharePassword, ...f }) => ({
      ...f,
      shareToken: null,
      ownerEmail: ownerEmailById.get(f.ownerId) ?? null,
    })),
    files: files.map(({ sharePassword: _sharePassword, ...f }) => ({
      ...f,
      shareToken: null,
      ownerEmail: ownerEmailById.get(f.ownerId) ?? null,
    })),
  });
});

teams.get("/:id/files/:fileId/inline", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  const file = await sharedTeamFile(db, access.team.id, c.req.param("fileId"));
  if (!file || file.status !== "ready" || file.deletedAt)
    return c.json({ error: "not found" }, 404);
  if (file.releaseAt && file.releaseAt > nowSeconds())
    return c.json(
      { error: "file is not available yet", releaseAt: file.releaseAt },
      423,
    );
  if (!isInlineTeamMedia(file.contentType))
    return c.json({ error: "inline preview not allowed" }, 415);
  if (isExpired(file.expiresAt)) return c.json({ error: "expired" }, 410);
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Length", String(object.size));
  headers.set(
    "Content-Disposition",
    `inline; filename=\"${file.filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("Cache-Control", "private, max-age=60");
  addInlineHeaders(headers);
  return new Response(object.body, { headers });
});

teams.get("/:id/files/:fileId/download", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  const file = await sharedTeamFile(db, access.team.id, c.req.param("fileId"));
  if (!file || file.status !== "ready" || file.deletedAt)
    return c.json({ error: "not found" }, 404);
  if (file.releaseAt && file.releaseAt > nowSeconds())
    return c.json(
      { error: "file is not available yet", releaseAt: file.releaseAt },
      423,
    );
  if (isExpired(file.expiresAt)) return c.json({ error: "expired" }, 410);
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Length", String(object.size));
  headers.set(
    "Content-Disposition",
    `attachment; filename=\"${file.filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});

teams.post("/:id/items", async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get("userId");
  const access = await membership(db, c.req.param("id"), userId);
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.role === "viewer") return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<TeamItemsBody>()
    .catch(() => ({}) as TeamItemsBody);
  const fileIds = ids(body.fileIds);
  const folderIds = ids(body.folderIds);
  const removeFileIds = ids(body.removeFileIds);
  const removeFolderIds = ids(body.removeFolderIds);
  if (
    !fileIds.length &&
    !folderIds.length &&
    !removeFileIds.length &&
    !removeFolderIds.length
  )
    return c.json({ error: "no items selected" }, 400);
  // A team role never grants access to a member's private drive. Contributors
  // may only add or remove resources they personally own.
  const contributorId = c.get("userId");
  if (fileIds.length)
    await db
      .update(schema.files)
      .set({ teamId: access.team.id })
      .where(
        and(
          inArray(schema.files.id, fileIds),
          eq(schema.files.ownerId, contributorId),
        ),
      )
      .run();
  if (folderIds.length)
    await db
      .update(schema.folders)
      .set({ teamId: access.team.id })
      .where(
        and(
          inArray(schema.folders.id, folderIds),
          eq(schema.folders.ownerId, contributorId),
        ),
      )
      .run();
  if (removeFileIds.length)
    await db
      .update(schema.files)
      .set({ teamId: null })
      .where(
        and(
          inArray(schema.files.id, removeFileIds),
          eq(schema.files.teamId, access.team.id),
          eq(schema.files.ownerId, contributorId),
        ),
      )
      .run();
  if (removeFolderIds.length)
    await db
      .update(schema.folders)
      .set({ teamId: null })
      .where(
        and(
          inArray(schema.folders.id, removeFolderIds),
          eq(schema.folders.teamId, access.team.id),
          eq(schema.folders.ownerId, contributorId),
        ),
      )
      .run();
  return c.json({ ok: true });
});

teams.post("/:id/members", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  if (!canManage(access.role)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<{ email?: string; role?: string }>()
    .catch(() => ({}) as { email?: string; role?: string });
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const user = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .get()
    .catch(() => null);
  if (!user) return c.json({ error: "user not found" }, 404);
  const role = ["admin", "member", "viewer"].includes(String(body.role))
    ? String(body.role)
    : "member";
  await db
    .delete(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, access.team.id),
        eq(schema.teamMembers.userId, user.id),
      ),
    )
    .run()
    .catch(() => {});
  await db
    .insert(schema.teamMembers)
    .values({
      id: crypto.randomUUID(),
      teamId: access.team.id,
      userId: user.id,
      role,
      createdAt: nowSeconds(),
    })
    .run();
  return c.json({ ok: true });
});

teams.delete("/:id/members/:userId", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  if (!canManage(access.role)) return c.json({ error: "forbidden" }, 403);
  await db
    .delete(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, access.team.id),
        eq(schema.teamMembers.userId, c.req.param("userId")),
      ),
    )
    .run();
  return c.json({ ok: true });
});

teams.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const access = await membership(db, c.req.param("id"), c.get("userId"));
  if (!access) return c.json({ error: "not found" }, 404);
  if (access.team.ownerId !== c.get("userId"))
    return c.json({ error: "only the owner can delete a team" }, 403);
  await db
    .update(schema.files)
    .set({ teamId: null })
    .where(eq(schema.files.teamId, access.team.id))
    .run()
    .catch(() => {});
  await db
    .update(schema.folders)
    .set({ teamId: null })
    .where(eq(schema.folders.teamId, access.team.id))
    .run()
    .catch(() => {});
  await db
    .delete(schema.teams)
    .where(eq(schema.teams.id, access.team.id))
    .run();
  return c.json({ ok: true });
});

export default teams;
