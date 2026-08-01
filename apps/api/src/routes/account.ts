import { Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { createAuth } from "../auth";
import { getDb, schema } from "../db";
import { adminRole } from "../middleware/admin";
import { requireAuth } from "../middleware/auth";
import { deleteFileObjects } from "../lib/fileObjects";
import { nowSeconds } from "../lib/expiry";
import { isSafeWebhookUrl } from "../lib/url";
import type { Bindings, Variables } from "../types";

// Lightweight account endpoint that intentionally does NOT use requireAuth, so a
// suspended user can still learn that they are suspended (requireAuth blocks
// everything else with a 403).
const account = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// /me remains available so suspended users can see why they are blocked, and
// DELETE /me remains available so they can erase their account. Every other
// account action must pass the same suspension check as the rest of the app.
account.use("/activity", requireAuth);
account.use("/export", requireAuth);
account.use("/notifications/*", requireAuth);
account.use("/portal", requireAuth);

function roleGetsForever(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

account.get("/me", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const db = getDb(c.env.DB);
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, session.user.id))
    .get()
    .catch(() => null);
  const u = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .get()
    .catch(() => null);
  // Admins and the owner have unlimited storage (no quota). Everyone else gets
  // their per-user quota, falling back to the workspace default.
  const role = await adminRole(c.env, db, session.user.email);
  let quotaBytes: number | null = null;
  if (role == null) {
    const setting = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "defaultQuotaBytes"))
      .get()
      .catch(() => null);
    const defaultQuota = Number(setting?.value) || 1073741824;
    quotaBytes = u?.quotaBytes ?? defaultQuota;
  }
  const canKeepFilesForever = roleGetsForever(role) || !!u?.keepFilesForever;
  return c.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    suspended: !!suspension,
    suspensionReason: suspension?.reason ?? null,
    quotaBytes,
    isAdmin: role != null,
    adminRole: role,
    keepFilesForever: !!u?.keepFilesForever,
    canKeepFilesForever,
  });
});

// A signed-in user's own activity trail. Scoped strictly to their userId and
// deliberately omits IP / user-agent (those stay admin-only via /api/admin).
account.get("/activity", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.userId, session.user.id))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(limit)
    .all()
    .catch(() => []);
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
      createdAt: r.createdAt,
    })),
  });
});

// A portable, intentionally secret-free export. Provider credentials, session
// tokens, share passwords, IP addresses, and delivery secrets are excluded.
account.get("/export", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const db = getDb(c.env.DB);
  const userId = session.user.id;
  const [profile, files, folders, requests, teams, activity] =
    await Promise.all([
      db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          emailVerified: schema.user.emailVerified,
          createdAt: schema.user.createdAt,
        })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .get(),
      db
        .select({
          id: schema.files.id,
          filename: schema.files.filename,
          sizeBytes: schema.files.sizeBytes,
          contentType: schema.files.contentType,
          status: schema.files.status,
          folderId: schema.files.folderId,
          teamId: schema.files.teamId,
          createdAt: schema.files.createdAt,
          expiresAt: schema.files.expiresAt,
          deletedAt: schema.files.deletedAt,
          checksum: schema.files.checksum,
          encryptionMode: schema.files.encryptionMode,
        })
        .from(schema.files)
        .where(
          and(
            eq(schema.files.ownerId, userId),
            isNull(schema.files.purgeRequestedAt),
          ),
        )
        .all(),
      db
        .select({
          id: schema.folders.id,
          name: schema.folders.name,
          parentId: schema.folders.parentId,
          color: schema.folders.color,
          createdAt: schema.folders.createdAt,
        })
        .from(schema.folders)
        .where(eq(schema.folders.ownerId, userId))
        .all(),
      db
        .select({
          id: schema.uploadRequests.id,
          title: schema.uploadRequests.title,
          status: schema.uploadRequests.status,
          uploadCount: schema.uploadRequests.uploadCount,
          createdAt: schema.uploadRequests.createdAt,
          expiresAt: schema.uploadRequests.expiresAt,
        })
        .from(schema.uploadRequests)
        .where(eq(schema.uploadRequests.ownerId, userId))
        .all(),
      db
        .select({
          id: schema.teams.id,
          name: schema.teams.name,
          createdAt: schema.teams.createdAt,
        })
        .from(schema.teams)
        .where(eq(schema.teams.ownerId, userId))
        .all(),
      db
        .select({
          action: schema.activityLog.action,
          targetType: schema.activityLog.targetType,
          targetId: schema.activityLog.targetId,
          detail: schema.activityLog.detail,
          createdAt: schema.activityLog.createdAt,
        })
        .from(schema.activityLog)
        .where(eq(schema.activityLog.userId, userId))
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(5000)
        .all(),
    ]);
  return c.json({
    format: "dropvault-export-v1",
    exportedAt: new Date().toISOString(),
    profile,
    files,
    folders,
    uploadRequests: requests,
    ownedTeams: teams,
    activity,
  });
});

account.get("/notifications/preferences", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const row = await getDb(c.env.DB)
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, session.user.id))
    .get()
    .catch(() => null);
  return c.json({
    preferences: row ?? {
      userId: session.user.id,
      emailEnabled: false,
      webhookEnabled: false,
      webhookUrl: null,
      expiryWarnings: true,
      uploadEvents: true,
      securityEvents: true,
    },
  });
});

account.patch("/notifications/preferences", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const webhookUrl = body.webhookUrl
    ? String(body.webhookUrl).trim().slice(0, 2048)
    : null;
  if (body.webhookEnabled && (!webhookUrl || !isSafeWebhookUrl(webhookUrl)))
    return c.json({ error: "a safe HTTPS webhook URL is required" }, 400);
  const values = {
    userId: session.user.id,
    emailEnabled: !!body.emailEnabled,
    webhookEnabled: !!body.webhookEnabled,
    webhookUrl,
    expiryWarnings: body.expiryWarnings !== false,
    uploadEvents: body.uploadEvents !== false,
    securityEvents: body.securityEvents !== false,
    updatedAt: nowSeconds(),
  };
  await getDb(c.env.DB)
    .insert(schema.notificationPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: schema.notificationPreferences.userId,
      set: values,
    })
    .run();
  return c.json({ ok: true, preferences: values });
});

account.get("/portal", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const brand = await getDb(c.env.DB)
    .select()
    .from(schema.portalBrands)
    .where(eq(schema.portalBrands.userId, session.user.id))
    .get()
    .catch(() => null);
  return c.json({ brand });
});

account.put("/portal", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const db = getDb(c.env.DB);
  const owner = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .get();
  const role = await adminRole(c.env, db, session.user.email);
  if (!owner?.brandedPortalApproved && role == null)
    return c.json({ error: "branded portal approval required" }, 403);
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const slug = String(body.slug ?? "")
    .trim()
    .toLowerCase();
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 80);
  const accentColor = String(body.accentColor ?? "#7c3aed").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(slug))
    return c.json(
      { error: "slug must be 3-48 lowercase letters, numbers, or hyphens" },
      400,
    );
  if (!name) return c.json({ error: "brand name required" }, 400);
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor))
    return c.json({ error: "accent color must be a hex color" }, 400);
  const logoUrl = body.logoUrl
    ? String(body.logoUrl).trim().slice(0, 2048)
    : null;
  if (logoUrl) {
    try {
      if (new URL(logoUrl).protocol !== "https:") throw new Error();
    } catch {
      return c.json({ error: "logo URL must use HTTPS" }, 400);
    }
  }
  const values = {
    userId: session.user.id,
    slug,
    name,
    logoUrl,
    accentColor,
    welcomeMessage: body.welcomeMessage
      ? String(body.welcomeMessage).slice(0, 500)
      : null,
    customDomain: null,
    updatedAt: nowSeconds(),
  };
  try {
    await db
      .insert(schema.portalBrands)
      .values(values)
      .onConflictDoUpdate({ target: schema.portalBrands.userId, set: values })
      .run();
  } catch {
    return c.json({ error: "that portal slug is already in use" }, 409);
  }
  return c.json({ ok: true, brand: values });
});

// Deletion is deliberately available to suspended users as well. R2 objects
// are erased first; foreign-key cascades remove all account-owned metadata.
account.delete("/me", async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req
    .json<{ confirmation?: string }>()
    .catch(() => ({}) as { confirmation?: string });
  if (body.confirmation !== `DELETE ${session.user.email}`)
    return c.json(
      { error: `type DELETE ${session.user.email} to confirm` },
      400,
    );
  const db = getDb(c.env.DB);
  const ownedFiles = await db
    .select({ id: schema.files.id, r2Key: schema.files.r2Key })
    .from(schema.files)
    .where(eq(schema.files.ownerId, session.user.id))
    .all();
  const ownedFolders = await db
    .select({ shareToken: schema.folders.shareToken })
    .from(schema.folders)
    .where(eq(schema.folders.ownerId, session.user.id))
    .all();
  const fileIds = ownedFiles.map((file) => file.id);
  if (fileIds.length) {
    await db
      .delete(schema.fileFlags)
      .where(inArray(schema.fileFlags.fileId, fileIds))
      .run()
      .catch(() => {});
    await db
      .delete(schema.shareEvents)
      .where(inArray(schema.shareEvents.fileId, fileIds))
      .run()
      .catch(() => {});
  }
  const shareTokens = [
    ...(await db
      .select({ shareToken: schema.files.shareToken })
      .from(schema.files)
      .where(eq(schema.files.ownerId, session.user.id))
      .all()),
    ...ownedFolders,
  ]
    .map((row) => row.shareToken)
    .filter((token): token is string => !!token);
  if (shareTokens.length) {
    await db
      .delete(schema.guestAccessCodes)
      .where(inArray(schema.guestAccessCodes.shareToken, shareTokens))
      .run()
      .catch(() => {});
    await db
      .delete(schema.guestAccessTokens)
      .where(inArray(schema.guestAccessTokens.shareToken, shareTokens))
      .run()
      .catch(() => {});
  }
  await deleteFileObjects(c.env.FILES, db, ownedFiles);
  await db
    .delete(schema.activityLog)
    .where(eq(schema.activityLog.userId, session.user.id))
    .run()
    .catch(() => {});
  await db
    .delete(schema.ipObservations)
    .where(eq(schema.ipObservations.userId, session.user.id))
    .run()
    .catch(() => {});
  await db
    .delete(schema.auditLog)
    .where(eq(schema.auditLog.actorId, session.user.id))
    .run()
    .catch(() => {});
  await db
    .delete(schema.verification)
    .where(eq(schema.verification.identifier, session.user.email))
    .run()
    .catch(() => {});
  await db
    .delete(schema.adminEmails)
    .where(eq(schema.adminEmails.email, session.user.email.toLowerCase()))
    .run()
    .catch(() => {});
  await db
    .delete(schema.user)
    .where(
      and(
        eq(schema.user.id, session.user.id),
        eq(schema.user.email, session.user.email),
      ),
    )
    .run();
  return c.json({ ok: true });
});

export default account;
