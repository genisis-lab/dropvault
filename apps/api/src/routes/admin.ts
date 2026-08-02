import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { FileRow } from "../db/schema";
import {
  clampExtension,
  DAY_SECONDS,
  isExpired,
  nowSeconds,
} from "../lib/expiry";
import {
  addIpBan,
  getIpBans,
  normalizeIp,
  recentIpsFrom,
  removeIpBan,
} from "../lib/ipAccess";
import { notifyAdmins, notifyOwners, notifyUser } from "../lib/notifications";
import { requireAuth } from "../middleware/auth";
import {
  adminEmailSet,
  adminRole,
  effectiveAdmins,
  hasRole,
  normalizeAdminRole,
  requireAdmin,
  type AdminRole,
} from "../middleware/admin";
import { isSafeWebhookUrl } from "../lib/url";
import { normalizeTheme } from "../lib/theme";
import { deleteFileObjects, deleteOneFileObjects } from "../lib/fileObjects";
import {
  applyRequestedSettingChanges,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "../lib/settings";
import type { Bindings, Variables } from "../types";

type SettingsKey =
  | "defaultExpiryDays"
  | "maxExpiryDays"
  | "maxUploadBytes"
  | "allowedTypes"
  | "defaultQuotaBytes"
  | "adminMaxQuotaBytes"
  | "requirePasswordForShares"
  | "publicSharingEnabled"
  | "defaultTheme"
  | "signupMode"
  | "trashRetentionDays"
  | "notifyEmail"
  | "notifyWebhookUrl"
  | "notifyOnFlag"
  | "notifyOnSignup"
  | "notifyOnLimitRequest"
  | "rolePermissions";
type SettingsBody = Partial<
  Record<SettingsKey, string | number | boolean | null>
>;
type BulkUserBody = {
  action?: string;
  ids?: unknown[];
  quotaBytes?: number | null;
  confirmation?: string;
};
type BulkFileBody = {
  action?: string;
  ids?: unknown[];
  days?: number;
  confirmation?: string;
};

type Capability =
  | "manageUsers"
  | "manageFiles"
  | "manageFlags"
  | "viewFileContent"
  | "viewActivity";
const capabilityRoles: Record<Capability, AdminRole[]> = {
  manageUsers: ["owner", "admin"],
  manageFiles: ["owner", "admin"],
  manageFlags: ["owner", "admin", "moderator"],
  viewFileContent: ["owner", "admin"],
  viewActivity: ["owner", "admin", "auditor"],
};
const SECURITY_SETTING_KEYS = new Set<SettingsKey>([
  "defaultExpiryDays",
  "maxExpiryDays",
  "maxUploadBytes",
  "allowedTypes",
  "defaultQuotaBytes",
  "adminMaxQuotaBytes",
  "requirePasswordForShares",
  "publicSharingEnabled",
  "signupMode",
  "trashRetentionDays",
  "rolePermissions",
]);

const MAX_PENDING_LIMIT_REQUESTS = 2;
const PENDING_APPROVAL_REASON = "Awaiting admin approval";

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const settingsKeys: SettingsKey[] = [
  "defaultExpiryDays",
  "maxExpiryDays",
  "maxUploadBytes",
  "allowedTypes",
  "defaultQuotaBytes",
  "adminMaxQuotaBytes",
  "requirePasswordForShares",
  "publicSharingEnabled",
  "defaultTheme",
  "signupMode",
  "trashRetentionDays",
  "notifyEmail",
  "notifyWebhookUrl",
  "notifyOnFlag",
  "notifyOnSignup",
  "notifyOnLimitRequest",
  "rolePermissions",
];

admin.use("*", requireAuth);
admin.get("/access", async (c) => {
  const db = getDb(c.env.DB);
  const role = await adminRole(c.env, db, c.get("userEmail"));
  return c.json({ isAdmin: role != null, role });
});
admin.post("/limit-requests", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ requestedBytes?: number; reason?: string }>()
    .catch(() => ({}) as { requestedBytes?: number; reason?: string });
  if (!body.requestedBytes || body.requestedBytes < 1073741824)
    return c.json({ error: "requestedBytes must be at least 1GB" }, 400);
  const db = getDb(c.env.DB);
  const pending = await db
    .select()
    .from(schema.uploadLimitRequests)
    .where(
      and(
        eq(schema.uploadLimitRequests.userId, userId),
        eq(schema.uploadLimitRequests.status, "pending"),
      ),
    )
    .all()
    .catch(() => []);
  if (pending.length >= MAX_PENDING_LIMIT_REQUESTS)
    return c.json(
      {
        error: `You already have ${MAX_PENDING_LIMIT_REQUESTS} pending upload limit requests. Please wait for an admin to review them.`,
      },
      429,
    );
  const id = crypto.randomUUID();
  await db
    .insert(schema.uploadLimitRequests)
    .values({
      id,
      userId,
      requestedBytes: Math.floor(body.requestedBytes),
      reason: body.reason?.slice(0, 500) ?? null,
      status: "pending",
      approvedBy: null,
      approvedAt: null,
      createdAt: nowSeconds(),
    })
    .run();
  await logAction(
    c,
    db,
    "limit_request.create",
    "user",
    userId,
    `${body.requestedBytes} bytes`,
  );
  const message = `Upload limit request: ${c.get("userEmail") ?? userId} asked for ${body.requestedBytes} bytes`;
  await notify(c, db, message, "notifyOnLimitRequest", "limit_request");
  await notifyAdmins(c.env, db, {
    type: "limit_request",
    title: "New limit increase request",
    message,
    targetType: "limit_request",
    targetId: id,
  });
  return c.json({ ok: true, id });
});
admin.get("/limit-requests/mine", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.uploadLimitRequests)
    .where(eq(schema.uploadLimitRequests.userId, userId))
    .orderBy(desc(schema.uploadLimitRequests.createdAt))
    .all()
    .catch(() => []);
  return c.json({ requests: rows });
});
admin.use("*", requireAdmin);

async function forbidUnless(c: any, minimum: AdminRole) {
  const db = getDb(c.env.DB);
  if (!(await hasRole(c.env, db, c.get("userEmail"), minimum)))
    return c.json({ error: "forbidden" }, 403);
  return null;
}
async function forbidUnlessCan(c: any, cap: Capability) {
  const db = getDb(c.env.DB);
  const role = await adminRole(c.env, db, c.get("userEmail"));
  if (!role || !capabilityRoles[cap].includes(role))
    return c.json({ error: "forbidden" }, 403);
  return null;
}

async function requireOwnerConfirmation(
  c: any,
  confirmation: unknown,
  expected: string,
) {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  if (String(confirmation ?? "") !== expected)
    return c.json(
      { error: `Owner confirmation required. Type ${expected}.` },
      400,
    );
  return null;
}
function idsFrom(input: unknown[] | undefined): string[] {
  return Array.isArray(input)
    ? input.filter((x: unknown): x is string => typeof x === "string")
    : [];
}
function categoryOf(type: string | null): string {
  if (!type) return "other";
  if (type.startsWith("image/")) return "images";
  if (type.startsWith("video/")) return "videos";
  if (type.startsWith("audio/")) return "audio";
  if (type.includes("pdf")) return "pdf";
  if (
    type.includes("zip") ||
    type.includes("compressed") ||
    type.includes("tar")
  )
    return "archives";
  if (type.includes("text") || type.includes("csv") || type.includes("json"))
    return "docs";
  return "other";
}
function dayKey(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}
function parseTags(raw: string | null): string[] {
  try {
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter((x: unknown): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function buildRecentIpMap(
  sessions: Array<{
    userId: string;
    ipAddress: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>,
  activity: Array<{
    userId: string | null;
    ip: string | null;
    createdAt: number;
  }>,
): Map<string, string[]> {
  const events = new Map<
    string,
    Array<{ ip: string | null; createdAt: number }>
  >();
  for (const session of sessions) {
    const list = events.get(session.userId) ?? [];
    list.push({
      ip: session.ipAddress,
      createdAt: Math.floor(
        (session.updatedAt ?? session.createdAt).getTime() / 1000,
      ),
    });
    events.set(session.userId, list);
  }
  for (const row of activity) {
    if (!row.userId) continue;
    const list = events.get(row.userId) ?? [];
    list.push({ ip: row.ip, createdAt: row.createdAt });
    events.set(row.userId, list);
  }
  const out = new Map<string, string[]>();
  for (const [userId, rows] of events) out.set(userId, recentIpsFrom(rows, 5));
  return out;
}
async function logAction(
  c: any,
  db: ReturnType<typeof getDb>,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: string | null,
) {
  try {
    await db
      .insert(schema.auditLog)
      .values({
        id: crypto.randomUUID(),
        actorId: c.get("userId") ?? null,
        actorEmail: c.get("userEmail") ?? null,
        action,
        targetType,
        targetId,
        detail,
        createdAt: nowSeconds(),
      })
      .run();
  } catch {}
}
async function notify(
  c: any,
  db: ReturnType<typeof getDb>,
  message: string,
  toggleKey: SettingsKey,
  event: string,
) {
  try {
    const settings = await settingsMap(db);
    if (settings[toggleKey] !== "true") return;
    const url = settings.notifyWebhookUrl;
    if (!isSafeWebhookUrl(url)) return;
    const p = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, message, at: nowSeconds() }),
    })
      .then(() => {})
      .catch(() => {});
    try {
      c.executionCtx?.waitUntil(p);
    } catch {
      await p;
    }
  } catch {}
}
function fileRow(
  f: FileRow,
  emailById: Map<string, string>,
  nameById: Map<string, string>,
) {
  return {
    id: f.id,
    filename: f.filename,
    sizeBytes: f.sizeBytes,
    contentType: f.contentType,
    status: f.status,
    shared: !!f.shareToken,
    shareToken: f.shareToken ?? null,
    folderId: f.folderId ?? null,
    favorite: !!f.favorite,
    tags: parseTags(f.tags ?? null),
    deletedAt: f.deletedAt ?? null,
    versionGroupId: f.versionGroupId ?? null,
    createdAt: f.createdAt,
    expiresAt: f.expiresAt,
    keepForever: !!f.keepForever,
    contentHash: f.contentHash ?? f.checksum ?? null,
    checksumAlgorithm: f.checksumAlgorithm ?? "sha-256",
    encryptionMode: f.encryptionMode ?? "none",
    encrypted: f.encryptionMode === "aes-gcm",
    adminContentAccessible: f.encryptionMode !== "aes-gcm",
    scanStatus: f.scanStatus ?? null,
    ownerId: f.ownerId,
    ownerEmail: emailById.get(f.ownerId) ?? null,
    ownerName: nameById.get(f.ownerId) ?? null,
  };
}
async function settingsMap(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .all()
    .catch(() => []);
  const out: Record<SettingsKey, string> = {
    defaultExpiryDays: "7",
    maxExpiryDays: "30",
    maxUploadBytes: String(DEFAULT_MAX_UPLOAD_BYTES),
    allowedTypes: "",
    defaultQuotaBytes: "1073741824",
    adminMaxQuotaBytes: "10737418240",
    requirePasswordForShares: "false",
    publicSharingEnabled: "true",
    defaultTheme: "neubrutalism",
    signupMode: "open",
    trashRetentionDays: "30",
    notifyEmail: "",
    notifyWebhookUrl: "",
    notifyOnFlag: "true",
    notifyOnSignup: "false",
    notifyOnLimitRequest: "true",
    rolePermissions: "",
  };
  for (const row of rows)
    if (settingsKeys.includes(row.key as SettingsKey))
      out[row.key as SettingsKey] = row.value;
  return out;
}

type PolicyChange = { key: SettingsKey; before: string; after: string };

function policyChanges(
  before: Record<SettingsKey, string>,
  after: Record<SettingsKey, string>,
): PolicyChange[] {
  return settingsKeys
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, before: before[key], after: after[key] }));
}

function normalizeSettingValue(key: SettingsKey, input: unknown): string {
  let value = String(input ?? "");
  if (key === "signupMode") value = value === "approval" ? "approval" : "open";
  if (key === "defaultTheme") value = normalizeTheme(value);
  if (key === "rolePermissions")
    value = JSON.stringify({
      manageUsers: "admin",
      manageFiles: "admin",
      manageFlags: "moderator",
    });
  return value;
}

async function latestPolicyRevision(db: ReturnType<typeof getDb>) {
  const row = await db
    .select({ id: schema.policyVersions.id })
    .from(schema.policyVersions)
    .orderBy(desc(schema.policyVersions.createdAt))
    .limit(1)
    .get()
    .catch(() => null);
  return row?.id ?? null;
}

async function persistPolicy(
  c: any,
  db: ReturnType<typeof getDb>,
  before: Record<SettingsKey, string>,
  after: Record<SettingsKey, string>,
  source: "update" | "rollback",
) {
  const changes = policyChanges(before, after);
  if (!changes.length)
    return { changes, revision: await latestPolicyRevision(db) };
  const now = nowSeconds();
  for (const change of changes) {
    await db
      .insert(schema.appSettings)
      .values({
        key: change.key,
        value: change.after,
        updatedBy: c.get("userEmail") ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: {
          value: change.after,
          updatedBy: c.get("userEmail") ?? null,
          updatedAt: now,
        },
      })
      .run();
  }
  const revision = crypto.randomUUID();
  await db
    .insert(schema.policyVersions)
    .values({
      id: revision,
      actorId: c.get("userId") ?? null,
      actorEmail: c.get("userEmail") ?? null,
      source,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
      changesJson: JSON.stringify(changes),
      createdAt: now,
    })
    .run();
  await logAction(
    c,
    db,
    source === "rollback" ? "settings.rollback" : "settings.update",
    "settings",
    revision,
    changes.map((change) => change.key).join(", "),
  );
  if (changes.some((change) => SECURITY_SETTING_KEYS.has(change.key)))
    await notifyOwners(c.env, db, {
      type: "security.policy_changed",
      title:
        source === "rollback"
          ? "Security policy restored"
          : "Security policy changed",
      message: `${c.get("userEmail") ?? "The owner"} ${
        source === "rollback" ? "restored" : "changed"
      } ${changes.map((change) => change.key).join(", ")}.`,
      targetType: "policy_version",
      targetId: revision,
    });
  return { changes, revision };
}

admin.get("/stats", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const db = getDb(c.env.DB);
  const [users, files, folders, openFlags, suspensions] = await Promise.all([
    db.select().from(schema.user).all(),
    db
      .select()
      .from(schema.files)
      .where(isNull(schema.files.purgeRequestedAt))
      .all(),
    db.select().from(schema.folders).all(),
    db
      .select()
      .from(schema.fileFlags)
      .where(eq(schema.fileFlags.status, "open"))
      .all()
      .catch(() => []),
    db
      .select()
      .from(schema.userSuspensions)
      .all()
      .catch(() => []),
  ]);
  const now = nowSeconds();
  const readyFiles = files.filter((f) => f.status === "ready" && !f.deletedAt);
  const pendingFiles = files.filter((f) => f.status === "pending");
  const deletedFiles = files.filter((f) => !!f.deletedAt);
  const typeMap = new Map<string, { count: number; bytes: number }>();
  const bytesByUser = new Map<string, number>();
  const countByUser = new Map<string, number>();
  for (const f of readyFiles) {
    const cat = categoryOf(f.contentType);
    const typeEntry = typeMap.get(cat) ?? { count: 0, bytes: 0 };
    typeEntry.count += 1;
    typeEntry.bytes += f.sizeBytes || 0;
    typeMap.set(cat, typeEntry);
    bytesByUser.set(
      f.ownerId,
      (bytesByUser.get(f.ownerId) ?? 0) + (f.sizeBytes || 0),
    );
    countByUser.set(f.ownerId, (countByUser.get(f.ownerId) ?? 0) + 1);
  }
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  const emailById = new Map(users.map((u) => [u.id, u.email] as const));
  const topUsers = Array.from(bytesByUser, ([id, bytes]) => ({
    id,
    name: nameById.get(id) ?? "Unknown",
    email: emailById.get(id) ?? null,
    totalBytes: bytes,
    fileCount: countByUser.get(id) ?? 0,
  }))
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 5);
  const growthMap = new Map<
    string,
    { users: number; files: number; bytes: number }
  >();
  const keys: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(now - i * 86400);
    keys.push(key);
    growthMap.set(key, { users: 0, files: 0, bytes: 0 });
  }
  for (const u of users) {
    const entry = growthMap.get(
      dayKey(Math.floor(u.createdAt.getTime() / 1000)),
    );
    if (entry) entry.users += 1;
  }
  for (const f of files) {
    const entry = growthMap.get(dayKey(f.createdAt));
    if (entry) {
      entry.files += 1;
      if (f.status === "ready") entry.bytes += f.sizeBytes || 0;
    }
  }
  const admins = await effectiveAdmins(c.env, db);
  const usersNearQuota = users.filter(
    (u) =>
      u.quotaBytes != null &&
      u.quotaBytes > 0 &&
      (bytesByUser.get(u.id) ?? 0) / u.quotaBytes >= 0.85,
  ).length;
  const unprotectedLinks = readyFiles.filter(
    (f) => f.shareToken && !f.sharePassword,
  ).length;
  const unlimitedLinks = readyFiles.filter(
    (f) => f.shareToken && f.shareDownloadLimit == null,
  ).length;
  const inactiveCutoff = now - 30 * DAY_SECONDS;
  const pendingApprovalCount = suspensions.filter(
    (s) => s.reason === PENDING_APPROVAL_REASON,
  ).length;
  return c.json({
    userCount: users.length,
    fileCount: files.length,
    readyFileCount: readyFiles.length,
    pendingFileCount: pendingFiles.length,
    deletedFileCount: deletedFiles.length,
    folderCount: folders.length,
    totalBytes: readyFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0),
    sharedFileCount: readyFiles.filter((f) => f.shareToken).length,
    sharedFolderCount: folders.filter((f) => f.shareToken).length,
    expiringSoonCount: readyFiles.filter((f) => f.expiresAt - now < DAY_SECONDS)
      .length,
    flagCount: openFlags.length,
    adminCount: admins.size,
    suspendedUserCount: suspensions.length,
    pendingApprovalCount,
    typeBreakdown: Array.from(typeMap, ([category, v]) => ({
      category,
      count: v.count,
      bytes: v.bytes,
    })).sort((a, b) => b.bytes - a.bytes),
    topUsers,
    growth: keys.map((key) => ({
      date: key,
      ...(growthMap.get(key) ?? { users: 0, files: 0, bytes: 0 }),
    })),
    alerts: [
      {
        id: "flags",
        label: "Open abuse reports",
        count: openFlags.length,
        level: openFlags.length ? "high" : "ok",
      },
      {
        id: "approval",
        label: "Users awaiting approval",
        count: pendingApprovalCount,
        level: pendingApprovalCount ? "medium" : "ok",
      },
      {
        id: "quota",
        label: "Users near quota",
        count: usersNearQuota,
        level: usersNearQuota ? "medium" : "ok",
      },
      {
        id: "unprotected",
        label: "Public links without passwords",
        count: unprotectedLinks,
        level: unprotectedLinks ? "medium" : "ok",
      },
      {
        id: "unlimited",
        label: "Public links with unlimited downloads",
        count: unlimitedLinks,
        level: "low",
      },
      {
        id: "pending",
        label: "Stuck/pending uploads",
        count: pendingFiles.filter((f) => f.createdAt < now - 3600).length,
        level: "low",
      },
      {
        id: "large",
        label: "Large files",
        count: readyFiles.filter((f) => f.sizeBytes > 100 * 1024 * 1024).length,
        level: "low",
      },
      {
        id: "inactive",
        label: "Inactive users (30d+ no files)",
        count: users.filter(
          (u) =>
            !files.some(
              (f) => f.ownerId === u.id && f.createdAt > inactiveCutoff,
            ),
        ).length,
        level: "low",
      },
    ],
  });
});

admin.get("/users", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const db = getDb(c.env.DB);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 250, 1), 500);
  const cursor = Number(c.req.query("cursor")) || null;
  const viewerRole = await adminRole(c.env, db, c.get("userEmail"));
  const canSeeIps = viewerRole === "owner";
  const users = await db
    .select()
    .from(schema.user)
    .where(
      cursor ? lt(schema.user.createdAt, new Date(cursor * 1000)) : undefined,
    )
    .orderBy(desc(schema.user.createdAt))
    .limit(limit + 1)
    .all();
  const hasMore = users.length > limit;
  if (hasMore) users.pop();
  const userIds = users.map((user) => user.id);
  const [admins, suspensions, sessions, activity] = await Promise.all([
    effectiveAdmins(c.env, db),
    userIds.length
      ? db
          .select()
          .from(schema.userSuspensions)
          .where(inArray(schema.userSuspensions.userId, userIds))
          .all()
          .catch(() => [])
      : Promise.resolve([]),
    canSeeIps && userIds.length
      ? db
          .select()
          .from(schema.session)
          .where(inArray(schema.session.userId, userIds))
          .all()
          .catch(() => [])
      : Promise.resolve([]),
    canSeeIps && userIds.length
      ? db
          .select()
          .from(schema.activityLog)
          .where(inArray(schema.activityLog.userId, userIds))
          .orderBy(desc(schema.activityLog.createdAt))
          .limit(5000)
          .all()
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const suspended = new Set(suspensions.map((s) => s.userId));
  const reasonByUser = new Map(
    suspensions.map((s) => [s.userId, s.reason] as const),
  );
  const countByUser = new Map<string, number>();
  const bytesByUser = new Map<string, number>();
  if (userIds.length) {
    const placeholders = userIds.map(() => "?").join(",");
    const aggregates = await c.env.DB.prepare(
      `SELECT owner_id, COUNT(*) AS file_count, COALESCE(SUM(CASE WHEN status = 'ready' THEN size_bytes ELSE 0 END), 0) AS total_bytes FROM files WHERE deleted_at IS NULL AND purge_requested_at IS NULL AND owner_id IN (${placeholders}) GROUP BY owner_id`,
    )
      .bind(...userIds)
      .all<{ owner_id: string; file_count: number; total_bytes: number }>();
    for (const row of aggregates.results) {
      countByUser.set(row.owner_id, Number(row.file_count));
      bytesByUser.set(row.owner_id, Number(row.total_bytes));
    }
  }
  const settings = await settingsMap(db);
  const defaultQuota = Number(settings.defaultQuotaBytes) || 1073741824;
  const recentIpByUser = canSeeIps
    ? buildRecentIpMap(
        sessions as Array<{
          userId: string;
          ipAddress: string | null;
          createdAt: Date;
          updatedAt: Date;
        }>,
        activity as Array<{
          userId: string | null;
          ip: string | null;
          createdAt: number;
        }>,
      )
    : new Map<string, string[]>();
  return c.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: Math.floor(u.createdAt.getTime() / 1000),
      fileCount: countByUser.get(u.id) ?? 0,
      totalBytes: bytesByUser.get(u.id) ?? 0,
      quotaBytes: u.quotaBytes ?? defaultQuota,
      isAdmin: admins.has(u.email.toLowerCase()),
      role: admins.get(u.email.toLowerCase()) ?? null,
      keepFilesForever:
        !!u.keepFilesForever ||
        ["owner", "admin"].includes(admins.get(u.email.toLowerCase()) ?? ""),
      keepFilesForeverGranted: !!u.keepFilesForever,
      suspended: suspended.has(u.id),
      pendingApproval: reasonByUser.get(u.id) === PENDING_APPROVAL_REASON,
      lastIp: canSeeIps ? (recentIpByUser.get(u.id)?.[0] ?? null) : null,
      recentIps: canSeeIps ? (recentIpByUser.get(u.id) ?? []) : [],
    })),
    nextCursor:
      hasMore && users.length
        ? Math.floor(users[users.length - 1].createdAt.getTime() / 1000)
        : null,
  });
});
admin.get("/users/:id", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const u = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .get();
  if (!u) return c.json({ error: "not found" }, 404);
  const viewerRole = await adminRole(c.env, db, c.get("userEmail"));
  const canSeeIps = viewerRole === "owner";
  const [files, allUsers, admins, suspension, activity, sessions] =
    await Promise.all([
      db
        .select()
        .from(schema.files)
        .where(
          and(
            eq(schema.files.ownerId, id),
            isNull(schema.files.purgeRequestedAt),
          ),
        )
        .orderBy(desc(schema.files.createdAt))
        .all(),
      db.select().from(schema.user).all(),
      effectiveAdmins(c.env, db),
      db
        .select()
        .from(schema.userSuspensions)
        .where(eq(schema.userSuspensions.userId, id))
        .get()
        .catch(() => null),
      db
        .select()
        .from(schema.activityLog)
        .where(eq(schema.activityLog.userId, id))
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(50)
        .all()
        .catch(() => []),
      canSeeIps
        ? db
            .select()
            .from(schema.session)
            .where(eq(schema.session.userId, id))
            .all()
            .catch(() => [])
        : Promise.resolve([]),
    ]);
  const emailById = new Map(allUsers.map((x) => [x.id, x.email] as const));
  const nameById = new Map(allUsers.map((x) => [x.id, x.name] as const));
  const ready = files.filter((f) => f.status === "ready" && !f.deletedAt);
  const settings = await settingsMap(db);
  const defaultQuota = Number(settings.defaultQuotaBytes) || 1073741824;
  const recentIps = canSeeIps
    ? recentIpsFrom(
        [
          ...(activity as Array<{ ip: string | null; createdAt: number }>).map(
            (row) => ({ ip: row.ip, createdAt: row.createdAt }),
          ),
          ...(
            sessions as Array<{
              ipAddress: string | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          ).map((row) => ({
            ip: row.ipAddress,
            createdAt: Math.floor(
              (row.updatedAt ?? row.createdAt).getTime() / 1000,
            ),
          })),
        ],
        8,
      )
    : [];
  const targetRole = admins.get(u.email.toLowerCase()) ?? null;
  return c.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      createdAt: Math.floor(u.createdAt.getTime() / 1000),
      fileCount: files.filter((f) => !f.deletedAt).length,
      totalBytes: ready.reduce((s, f) => s + (f.sizeBytes || 0), 0),
      quotaBytes: u.quotaBytes ?? defaultQuota,
      isAdmin: admins.has(u.email.toLowerCase()),
      role: targetRole,
      keepFilesForever:
        !!u.keepFilesForever || ["owner", "admin"].includes(targetRole ?? ""),
      keepFilesForeverGranted: !!u.keepFilesForever,
      suspended: !!suspension,
      suspensionReason: suspension?.reason ?? null,
      pendingApproval: suspension?.reason === PENDING_APPROVAL_REASON,
      lastIp: canSeeIps ? (recentIps[0] ?? null) : null,
      recentIps,
    },
    files: files.map((f) => fileRow(f, emailById, nameById)),
    activity: activity.map((row) => ({
      ...row,
      ip: canSeeIps ? normalizeIp(row.ip) : null,
      userAgent: canSeeIps ? (row.userAgent ?? null) : null,
    })),
  });
});
admin.post("/users/:id/quota", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ bytes?: number | null }>()
    .catch(() => ({}) as { bytes?: number | null });
  const db = getDb(c.env.DB);
  const u = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .get();
  if (!u) return c.json({ error: "not found" }, 404);
  const targetRole = await adminRole(c.env, db, u.email);
  if (targetRole === "owner" || targetRole === "admin")
    return c.json(
      {
        error:
          "Owners and administrators have unlimited storage and can't be assigned a limit.",
      },
      400,
    );
  const bytes =
    body.bytes == null ? null : Math.max(0, Math.floor(Number(body.bytes)));
  const actorRole = await adminRole(c.env, db, c.get("userEmail"));
  const policy = await settingsMap(db);
  const adminMaxQuotaBytes = Math.max(
    0,
    Number(policy.adminMaxQuotaBytes) || 10737418240,
  );
  if (actorRole === "admin" && bytes != null && bytes > adminMaxQuotaBytes)
    return c.json(
      {
        error: `Admin quota changes are capped at ${adminMaxQuotaBytes} bytes by the owner.`,
      },
      403,
    );
  await db
    .update(schema.user)
    .set({ quotaBytes: bytes })
    .where(eq(schema.user.id, id))
    .run();
  await logAction(
    c,
    db,
    "user.quota",
    "user",
    id,
    bytes == null ? "cleared quota" : `quota=${bytes} bytes`,
  );
  return c.json({ ok: true, quotaBytes: bytes });
});
admin.post("/users/:id/suspend", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ reason?: string }>()
    .catch(() => ({}) as { reason?: string });
  const db = getDb(c.env.DB);
  if (id === c.get("userId"))
    return c.json({ error: "You can't suspend your own account." }, 400);
  const target = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, id))
    .get();
  if (!target) return c.json({ error: "not found" }, 404);
  const targetRole = await adminRole(c.env, db, target.email);
  if (targetRole === "owner")
    return c.json(
      { error: "The owner account is root and can't be suspended." },
      403,
    );
  const actorRole = await adminRole(c.env, db, c.get("userEmail"));
  if (targetRole != null && actorRole !== "owner")
    return c.json(
      { error: "Only the owner can suspend another privileged account." },
      403,
    );
  await db
    .delete(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, id))
    .run()
    .catch(() => {});
  await db
    .insert(schema.userSuspensions)
    .values({
      userId: id,
      reason: body.reason?.slice(0, 500) ?? null,
      createdBy: c.get("userEmail"),
      createdAt: nowSeconds(),
    })
    .run();
  await db
    .delete(schema.session)
    .where(eq(schema.session.userId, id))
    .run()
    .catch(() => {});
  await logAction(c, db, "user.suspend", "user", id, body.reason ?? null);
  return c.json({ ok: true });
});
admin.post("/users/:id/unsuspend", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  await db
    .delete(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, id))
    .run();
  await logAction(c, db, "user.unsuspend", "user", id, null);
  return c.json({ ok: true });
});
admin.post("/users/:id/approve", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, id))
    .get()
    .catch(() => null);
  if (!suspension) return c.json({ error: "not found" }, 404);
  await db
    .delete(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, id))
    .run();
  await logAction(c, db, "user.approve", "user", id, null);
  return c.json({ ok: true });
});
admin.post("/users/bulk", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const body = await c.req
    .json<BulkUserBody>()
    .catch(() => ({}) as BulkUserBody);
  const ids = idsFrom(body.ids);
  const db = getDb(c.env.DB);
  if (!ids.length) return c.json({ error: "no ids" }, 400);
  if (body.action === "setQuota") {
    const bytes =
      body.quotaBytes == null
        ? null
        : Math.max(0, Math.floor(Number(body.quotaBytes)));
    const actorRole = await adminRole(c.env, db, c.get("userEmail"));
    const policy = await settingsMap(db);
    const adminMaxQuotaBytes = Math.max(
      0,
      Number(policy.adminMaxQuotaBytes) || 10737418240,
    );
    if (actorRole === "admin" && bytes != null && bytes > adminMaxQuotaBytes)
      return c.json(
        {
          error: `Admin quota changes are capped at ${adminMaxQuotaBytes} bytes by the owner.`,
        },
        403,
      );
    const admins = await effectiveAdmins(c.env, db);
    const targets = await db
      .select()
      .from(schema.user)
      .where(inArray(schema.user.id, ids))
      .all();
    const settable = targets
      .filter((u) => {
        const role = admins.get(u.email.toLowerCase());
        return role !== "owner" && role !== "admin";
      })
      .map((u) => u.id);
    if (settable.length)
      await db
        .update(schema.user)
        .set({ quotaBytes: bytes })
        .where(inArray(schema.user.id, settable))
        .run();
  } else if (body.action === "revokeLinks") {
    await db
      .update(schema.files)
      .set({
        shareToken: null,
        sharePassword: null,
        shareDownloadLimit: null,
        shareDownloadCount: 0,
        shareExpiresAt: null,
      })
      .where(inArray(schema.files.ownerId, ids))
      .run();
  } else if (body.action === "expireFiles") {
    const confirmationDenied = await requireOwnerConfirmation(
      c,
      body.confirmation,
      "EXPIRE USER FILES",
    );
    if (confirmationDenied) return confirmationDenied;
    await db
      .update(schema.files)
      .set({ expiresAt: nowSeconds() })
      .where(inArray(schema.files.ownerId, ids))
      .run();
  } else if (body.action === "approve") {
    await db
      .delete(schema.userSuspensions)
      .where(inArray(schema.userSuspensions.userId, ids))
      .run()
      .catch(() => {});
  } else return c.json({ error: "bad action" }, 400);
  await logAction(
    c,
    db,
    `user.bulk.${body.action}`,
    "user",
    null,
    `${ids.length} users`,
  );
  return c.json({ ok: true, count: ids.length });
});

admin.get("/files", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const db = getDb(c.env.DB);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 250, 1), 500);
  const cursor = Number(c.req.query("cursor")) || null;
  const files = await db
    .select()
    .from(schema.files)
    .where(
      cursor
        ? and(
            lt(schema.files.createdAt, cursor),
            isNull(schema.files.purgeRequestedAt),
          )
        : isNull(schema.files.purgeRequestedAt),
    )
    .orderBy(desc(schema.files.createdAt))
    .limit(limit + 1)
    .all();
  const hasMore = files.length > limit;
  if (hasMore) files.pop();
  const ownerIds = Array.from(new Set(files.map((file) => file.ownerId)));
  const users = ownerIds.length
    ? await db
        .select()
        .from(schema.user)
        .where(inArray(schema.user.id, ownerIds))
        .all()
    : [];
  const emailById = new Map(users.map((u) => [u.id, u.email] as const));
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  return c.json({
    files: files.map((f) => fileRow(f, emailById, nameById)),
    nextCursor:
      hasMore && files.length ? files[files.length - 1].createdAt : null,
  });
});

async function serveOwnerFileContent(
  c: any,
  db: ReturnType<typeof getDb>,
  file: FileRow,
  disposition: "inline" | "attachment",
  action: "file.content_view" | "file.content_download",
): Promise<Response> {
  if (file.encryptionMode === "aes-gcm")
    return c.json(
      {
        error:
          "This file is client-side encrypted. The owner does not have the decryption key.",
        code: "e2e_admin_inaccessible",
      },
      409,
    );
  if (!["ready", "quarantined"].includes(file.status))
    return c.json({ error: "file is not ready" }, 409);
  if (file.deletedAt != null)
    return c.json({ error: "file is in trash" }, 410);
  if (file.releaseAt && file.releaseAt > nowSeconds())
    return c.json(
      { error: "file is not available yet", releaseAt: file.releaseAt },
      423,
    );
  if (isExpired(file.expiresAt))
    return c.json({ error: "file expired" }, 410);

  const object = await c.env.FILES.get(file.r2Key);
  if (!object) return c.json({ error: "stored object not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", file.contentType || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (disposition === "inline")
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox",
    );
  await logAction(c, db, action, "file", file.id, file.filename);
  return new Response(object.body, { headers });
}

// Workspace-wide file access is intentionally owner-only. Admins retain the
// narrower report-review route below for unencrypted flagged files.
admin.get("/files/:id/preview", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const file = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!file) return c.json({ error: "file not found" }, 404);
  return serveOwnerFileContent(c, db, file, "inline", "file.content_view");
});

admin.get("/files/:id/download", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const file = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!file) return c.json({ error: "file not found" }, 404);
  return serveOwnerFileContent(
    c,
    db,
    file,
    "attachment",
    "file.content_download",
  );
});

admin.get("/activity", async (c) => {
  const denied = await forbidUnlessCan(c, "viewActivity");
  if (denied) return denied;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const db = getDb(c.env.DB);
  const viewerRole = await adminRole(c.env, db, c.get("userEmail"));
  const canSeeIps = viewerRole === "owner";
  const rows = await db
    .select()
    .from(schema.activityLog)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(limit)
    .all()
    .catch(() => []);
  return c.json({
    entries: rows.map((row) => ({
      ...row,
      ip: canSeeIps ? normalizeIp(row.ip) : null,
      userAgent: canSeeIps ? (row.userAgent ?? null) : null,
    })),
  });
});
admin.post("/files/:id/revoke", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.files)
    .set({
      shareToken: null,
      sharePassword: null,
      shareDownloadLimit: null,
      shareDownloadCount: 0,
      shareExpiresAt: null,
    })
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .run();
  await logAction(c, db, "file.revoke", "file", id, row.filename);
  return c.json({ ok: true });
});
admin.post("/files/:id/extend", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ days?: number }>()
    .catch(() => ({}) as { days?: number });
  const days = Math.max(Number(body.days) || 0, 0);
  if (days <= 0) return c.json({ error: "days must be positive" }, 400);
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const expiresAt = clampExtension(
    c.env,
    row.createdAt,
    Math.max(row.expiresAt, nowSeconds()) + Math.round(days * DAY_SECONDS),
  );
  await db
    .update(schema.files)
    .set({ expiresAt, keepForever: false })
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .run();
  await logAction(
    c,
    db,
    "file.extend",
    "file",
    id,
    `${row.filename} +${days}d`,
  );
  return c.json({ ok: true, expiresAt });
});
admin.post("/files/:id/expire", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const expiresAt = nowSeconds();
  await db
    .update(schema.files)
    .set({ expiresAt, keepForever: false })
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .run();
  await logAction(c, db, "file.expire", "file", id, row.filename);
  return c.json({ ok: true, expiresAt });
});
admin.delete("/files/:id", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.files)
    .set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null })
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .run();
  await logAction(c, db, "file.trash", "file", id, row.filename);
  return c.json({ ok: true });
});
admin.post("/files/:id/delete-permanent", async (c) => {
  const body = await c.req
    .json<{ confirmation?: string }>()
    .catch(() => ({}) as { confirmation?: string });
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "PERMANENTLY DELETE",
  );
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await deleteOneFileObjects(c.env.FILES, db, row);
  await db.delete(schema.files).where(eq(schema.files.id, id)).run();
  await logAction(c, db, "file.delete", "file", id, row.filename);
  return c.json({ ok: true });
});
admin.post("/files/:id/restore", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  await db
    .update(schema.files)
    .set({ deletedAt: null })
    .where(
      and(
        eq(schema.files.id, id),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .run();
  await logAction(c, db, "file.restore", "file", id, null);
  return c.json({ ok: true });
});
admin.post("/files/bulk", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFiles");
  if (denied) return denied;
  const body = await c.req
    .json<BulkFileBody>()
    .catch(() => ({}) as BulkFileBody);
  const action = String(body.action ?? "");
  const ids = idsFrom(body.ids);
  if (!ids.length) return c.json({ error: "no ids" }, 400);
  if (
    ![
      "revoke",
      "delete",
      "expire",
      "extend",
      "restore",
      "permanentDelete",
    ].includes(action)
  )
    return c.json({ error: "bad action" }, 400);
  if (action === "permanentDelete") {
    const denied = await requireOwnerConfirmation(
      c,
      body.confirmation,
      "PERMANENTLY DELETE",
    );
    if (denied) return denied;
  }
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.files)
    .where(
      and(
        inArray(schema.files.id, ids),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .all();
  if (!rows.length) return c.json({ ok: true, count: 0 });
  const now = nowSeconds();
  const allIds = rows.map((r) => r.id);
  const scope = inArray(schema.files.id, allIds);
  if (action === "revoke") {
    await db
      .update(schema.files)
      .set({
        shareToken: null,
        sharePassword: null,
        shareDownloadLimit: null,
        shareDownloadCount: 0,
        shareExpiresAt: null,
      })
      .where(scope)
      .run();
  } else if (action === "expire") {
    await db
      .update(schema.files)
      .set({ expiresAt: now, keepForever: false })
      .where(scope)
      .run();
  } else if (action === "delete") {
    await db
      .update(schema.files)
      .set({ deletedAt: now, shareToken: null, sharePassword: null })
      .where(scope)
      .run();
  } else if (action === "restore") {
    await db.update(schema.files).set({ deletedAt: null }).where(scope).run();
  } else if (action === "permanentDelete") {
    await deleteFileObjects(c.env.FILES, db, rows);
    await db.delete(schema.files).where(scope).run();
  } else if (action === "extend") {
    for (const row of rows)
      await db
        .update(schema.files)
        .set({
          expiresAt: clampExtension(
            c.env,
            row.createdAt,
            Math.max(row.expiresAt, now) +
              Math.round((body.days || 7) * DAY_SECONDS),
          ),
          keepForever: false,
        })
        .where(eq(schema.files.id, row.id))
        .run();
  }
  await logAction(
    c,
    db,
    `file.bulk.${action}`,
    "file",
    null,
    `${rows.length} files`,
  );
  return c.json({ ok: true, count: rows.length });
});

admin.get("/flags", async (c) => {
  const status = c.req.query("status");
  const db = getDb(c.env.DB);
  const [flags, files, users] = await Promise.all([
    db
      .select()
      .from(schema.fileFlags)
      .orderBy(desc(schema.fileFlags.createdAt))
      .all()
      .catch(() => []),
    db
      .select()
      .from(schema.files)
      .where(isNull(schema.files.purgeRequestedAt))
      .all(),
    db.select().from(schema.user).all(),
  ]);
  const fileById = new Map(files.map((f) => [f.id, f] as const));
  const emailById = new Map(users.map((u) => [u.id, u.email] as const));
  const filtered = status ? flags.filter((f) => f.status === status) : flags;
  return c.json({
    flags: filtered.map((fl) => {
      const file = fl.fileId ? fileById.get(fl.fileId) : undefined;
      return {
        id: fl.id,
        fileId: fl.fileId,
        token: fl.token,
        reason: fl.reason,
        reporterEmail: fl.reporterEmail,
        status: fl.status,
        adminNote: fl.adminNote ?? null,
        createdAt: fl.createdAt,
        resolvedAt: fl.resolvedAt,
        filename: file?.filename ?? null,
        ownerEmail: file ? (emailById.get(file.ownerId) ?? null) : null,
        fileExists: !!file,
        sizeBytes: file?.sizeBytes ?? null,
        contentType: file?.contentType ?? null,
        contentHash: file?.contentHash ?? file?.checksum ?? null,
        checksumAlgorithm: file?.checksumAlgorithm ?? "sha-256",
        encryptionMode: file?.encryptionMode ?? null,
        adminContentAccessible: !!file && file.encryptionMode !== "aes-gcm",
        fileStatus: file?.status ?? null,
        deletedAt: file?.deletedAt ?? null,
        expiresAt: file?.expiresAt ?? null,
      };
    }),
  });
});
admin.get("/flags/:id/content", async (c) => {
  const denied = await forbidUnlessCan(c, "viewFileContent");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const flag = await db
    .select()
    .from(schema.fileFlags)
    .where(eq(schema.fileFlags.id, id))
    .get();
  if (!flag?.fileId) return c.json({ error: "reported file not found" }, 404);
  const file = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, flag.fileId),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!file) return c.json({ error: "reported file not found" }, 404);
  if (file.encryptionMode === "aes-gcm")
    return c.json(
      {
        error:
          "This file is client-side encrypted. Administrators do not have the decryption key.",
        code: "e2e_admin_inaccessible",
      },
      409,
    );
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) return c.json({ error: "stored object not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", file.contentType || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox");
  await logAction(c, db, "flag.content_view", "flag", id, file.filename);
  return new Response(object.body, { headers });
});
admin.post("/flags/:id", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFlags");
  if (denied) return denied;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ status?: string; note?: string; action?: string }>()
    .catch(() => ({}) as { status?: string; note?: string; action?: string });
  const db = getDb(c.env.DB);
  const flag = await db
    .select()
    .from(schema.fileFlags)
    .where(eq(schema.fileFlags.id, id))
    .get();
  if (!flag) return c.json({ error: "not found" }, 404);
  const actorRole = await adminRole(c.env, db, c.get("userEmail"));
  const operationalActions = new Set([
    "revoke",
    "expire",
    "delete",
    "restore",
    "quarantine",
  ]);
  if (
    body.action &&
    (!operationalActions.has(body.action) ||
      (actorRole === "moderator" && body.action !== "quarantine") ||
      actorRole === "auditor")
  )
    return c.json({ error: "forbidden for this role" }, 403);
  if (body.action === "revoke" && flag.fileId)
    await db
      .update(schema.files)
      .set({ shareToken: null, sharePassword: null })
      .where(eq(schema.files.id, flag.fileId))
      .run();
  if (body.action === "expire" && flag.fileId)
    await db
      .update(schema.files)
      .set({ expiresAt: nowSeconds(), keepForever: false })
      .where(eq(schema.files.id, flag.fileId))
      .run();
  if (body.action === "delete" && flag.fileId)
    await db
      .update(schema.files)
      .set({ deletedAt: nowSeconds(), shareToken: null, sharePassword: null })
      .where(eq(schema.files.id, flag.fileId))
      .run();
  if (body.action === "restore" && flag.fileId)
    await db
      .update(schema.files)
      .set({ deletedAt: null })
      .where(eq(schema.files.id, flag.fileId))
      .run();
  if (body.action === "quarantine" && flag.fileId)
    await db
      .update(schema.files)
      .set({
        status: "quarantined",
        shareToken: null,
        sharePassword: null,
        shareExpiresAt: null,
      })
      .where(eq(schema.files.id, flag.fileId))
      .run();
  const nextStatus = [
    "open",
    "investigating",
    "resolved",
    "dismissed",
  ].includes(String(body.status))
    ? String(body.status)
    : flag.status;
  await db
    .update(schema.fileFlags)
    .set({
      status: nextStatus,
      adminNote: body.note?.slice(0, 2000) ?? flag.adminNote ?? null,
      resolvedAt: ["resolved", "dismissed"].includes(nextStatus)
        ? nowSeconds()
        : null,
    })
    .where(eq(schema.fileFlags.id, id))
    .run();
  await logAction(
    c,
    db,
    "flag.update",
    "flag",
    id,
    `${nextStatus}${body.action ? " / " + body.action : ""}`,
  );
  return c.json({ ok: true });
});

admin.post("/flags/:id/ban-hash", async (c) => {
  const body = await c.req
    .json<{ confirmation?: string; reason?: string }>()
    .catch(() => ({}) as { confirmation?: string; reason?: string });
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "BAN HASH",
  );
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const flag = await db
    .select()
    .from(schema.fileFlags)
    .where(eq(schema.fileFlags.id, id))
    .get();
  if (!flag?.fileId) return c.json({ error: "reported file not found" }, 404);
  const file = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, flag.fileId),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!file) return c.json({ error: "reported file not found" }, 404);
  if (file.encryptionMode === "aes-gcm")
    return c.json(
      {
        error:
          "Client-side ciphertext uses a random nonce and has no stable plaintext hash available to administrators.",
      },
      409,
    );
  const hash = String(file.contentHash ?? file.checksum ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash))
    return c.json(
      { error: "This file does not have a verified SHA-256 hash." },
      409,
    );
  await db
    .insert(schema.bannedFileHashes)
    .values({
      hash,
      algorithm: "sha-256",
      reason: body.reason?.slice(0, 500) ?? flag.reason?.slice(0, 500) ?? null,
      sourceFileId: file.id,
      createdBy: c.get("userEmail") ?? null,
      createdAt: nowSeconds(),
    })
    .onConflictDoUpdate({
      target: schema.bannedFileHashes.hash,
      set: {
        reason:
          body.reason?.slice(0, 500) ?? flag.reason?.slice(0, 500) ?? null,
        sourceFileId: file.id,
        createdBy: c.get("userEmail") ?? null,
        createdAt: nowSeconds(),
      },
    })
    .run();
  await logAction(c, db, "file_hash.ban", "file_hash", hash, file.filename);
  await notifyOwners(c.env, db, {
    type: "security.file_hash_banned",
    title: "File hash permanently banned",
    message: `${c.get("userEmail") ?? "The owner"} banned SHA-256 ${hash.slice(0, 12)}… from future uploads.`,
    targetType: "file_hash",
    targetId: hash,
  });
  return c.json({ ok: true, hash });
});

admin.get("/hash-bans", async (c) => {
  const db = getDb(c.env.DB);
  const bans = await db
    .select()
    .from(schema.bannedFileHashes)
    .orderBy(desc(schema.bannedFileHashes.createdAt))
    .all()
    .catch(() => []);
  return c.json({ bans });
});
admin.post("/flags/:id/resolve", async (c) => {
  const denied = await forbidUnlessCan(c, "manageFlags");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  await db
    .update(schema.fileFlags)
    .set({ status: "resolved", resolvedAt: nowSeconds() })
    .where(eq(schema.fileFlags.id, id))
    .run();
  await logAction(c, db, "flag.resolve", "flag", id, null);
  return c.json({ ok: true });
});
admin.delete("/flags/:id", async (c) => {
  const body = await c.req
    .json<{ confirmation?: string }>()
    .catch(() => ({}) as { confirmation?: string });
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "DELETE REPORT",
  );
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  await db.delete(schema.fileFlags).where(eq(schema.fileFlags.id, id)).run();
  await logAction(c, db, "flag.delete", "flag", id, null);
  return c.json({ ok: true });
});

admin.get("/admins", async (c) => {
  const db = getDb(c.env.DB);
  const envSet = adminEmailSet(c.env);
  const dbRows = await db.select().from(schema.adminEmails).all();
  const admins = [
    ...Array.from(envSet, (email) => ({
      email,
      role: "owner" as const,
      source: "env" as const,
      addedBy: null as string | null,
      createdAt: null as number | null,
    })),
    ...dbRows
      .filter((r) => !envSet.has(r.email.toLowerCase()))
      .map((r) => ({
        email: r.email,
        role: normalizeAdminRole(r.role),
        source: "db" as const,
        addedBy: r.addedBy ?? null,
        createdAt: r.createdAt as number | null,
      })),
  ];
  return c.json({ admins });
});
admin.post("/admins", async (c) => {
  const body = await c.req
    .json<{ email?: string; role?: AdminRole; confirmation?: string }>()
    .catch(
      () =>
        ({}) as {
          email?: string;
          role?: AdminRole;
          confirmation?: string;
        },
    );
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "GRANT ROLE",
  );
  if (denied) return denied;
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "invalid email" }, 400);
  const role = normalizeAdminRole(body.role);
  const db = getDb(c.env.DB);
  if (adminEmailSet(c.env).has(email))
    return c.json({ error: "already configured via ADMIN_EMAILS" }, 400);
  const previous = await db
    .select()
    .from(schema.adminEmails)
    .where(eq(schema.adminEmails.email, email))
    .get()
    .catch(() => null);
  await db
    .insert(schema.adminEmails)
    .values({
      email,
      role,
      addedBy: c.get("userEmail") ?? null,
      createdAt: nowSeconds(),
    })
    .onConflictDoUpdate({
      target: schema.adminEmails.email,
      set: {
        role,
        addedBy: c.get("userEmail") ?? null,
        createdAt: nowSeconds(),
      },
    })
    .run();
  await logAction(c, db, "admin.add", "admin", email, role);
  await notifyOwners(c.env, db, {
    type: "security.role_changed",
    title: previous ? "Administrator role changed" : "Administrator added",
    message: `${c.get("userEmail") ?? "An owner"} ${
      previous
        ? `changed ${email} from ${normalizeAdminRole(previous.role)} to ${role}`
        : `granted ${role} access to ${email}`
    }.`,
    targetType: "admin",
    targetId: email,
  });
  return c.json({ ok: true });
});
admin.delete("/admins/:email", async (c) => {
  const body = await c.req
    .json<{ confirmation?: string }>()
    .catch(() => ({}) as { confirmation?: string });
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "REMOVE ROLE",
  );
  if (denied) return denied;
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  if (adminEmailSet(c.env).has(email))
    return c.json({ error: "managed via ADMIN_EMAILS config" }, 400);
  const db = getDb(c.env.DB);
  await db
    .delete(schema.adminEmails)
    .where(eq(schema.adminEmails.email, email))
    .run();
  await logAction(c, db, "admin.remove", "admin", email, null);
  await notifyOwners(c.env, db, {
    type: "security.role_changed",
    title: "Administrator access removed",
    message: `${c.get("userEmail") ?? "An owner"} removed all administrative access from ${email}.`,
    targetType: "admin",
    targetId: email,
  });
  return c.json({ ok: true });
});
admin.get("/ip-bans", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const db = getDb(c.env.DB);
  return c.json({ bans: await getIpBans(db) });
});
admin.post("/ip-bans", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const body = await c.req
    .json<{ ip?: string; note?: string | null }>()
    .catch(() => ({}) as { ip?: string; note?: string | null });
  const db = getDb(c.env.DB);
  const ip = normalizeIp(body.ip ?? null);
  if (!ip) return c.json({ error: "invalid ip" }, 400);
  const bans = await addIpBan(
    db,
    ip,
    body.note?.slice(0, 200) ?? null,
    c.get("userEmail") ?? null,
  );
  await logAction(
    c,
    db,
    "ip_ban.add",
    "ip",
    ip,
    body.note?.slice(0, 200) ?? null,
  );
  return c.json({ ok: true, bans });
});
admin.delete("/ip-bans/:ip", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const raw = decodeURIComponent(c.req.param("ip"));
  const ip = normalizeIp(raw);
  if (!ip) return c.json({ error: "invalid ip" }, 400);
  const db = getDb(c.env.DB);
  const bans = await removeIpBan(db, ip, c.get("userEmail") ?? null);
  await logAction(c, db, "ip_ban.remove", "ip", ip, null);
  return c.json({ ok: true, bans });
});
admin.get("/settings", async (c) => {
  const db = getDb(c.env.DB);
  return c.json({
    settings: await settingsMap(db),
    revision: await latestPolicyRevision(db),
  });
});
admin.post("/settings", async (c) => {
  const denied = await forbidUnless(c, "owner");
  if (denied) return denied;
  const body = await c.req
    .json<{
      settings?: SettingsBody;
      expectedRevision?: string | null;
      reviewed?: boolean;
      confirmation?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          settings?: SettingsBody;
          expectedRevision?: string | null;
          reviewed?: boolean;
          confirmation?: string;
        },
    );
  if (!body.reviewed)
    return c.json({ error: "Review changes before saving." }, 400);
  const db = getDb(c.env.DB);
  const revision = await latestPolicyRevision(db);
  if ((body.expectedRevision ?? null) !== revision)
    return c.json(
      {
        error: "Policies changed in another session. Reload and review again.",
      },
      409,
    );
  const before = await settingsMap(db);
  const requested = body.settings ?? {};
  const after = applyRequestedSettingChanges(
    before,
    requested,
    settingsKeys,
    normalizeSettingValue,
  );
  const changes = policyChanges(before, after);
  if (
    changes.some((change) => SECURITY_SETTING_KEYS.has(change.key)) &&
    body.confirmation !== "APPLY POLICY"
  )
    return c.json(
      { error: "Owner confirmation required. Type APPLY POLICY." },
      400,
    );
  const saved = await persistPolicy(c, db, before, after, "update");
  return c.json({ ok: true, settings: after, revision: saved.revision });
});
admin.get("/settings/history", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.policyVersions)
    .orderBy(desc(schema.policyVersions.createdAt))
    .limit(limit)
    .all()
    .catch(() => []);
  return c.json({
    versions: rows.map((row) => ({
      id: row.id,
      actorEmail: row.actorEmail,
      source: row.source,
      changes: JSON.parse(row.changesJson || "[]"),
      settings: JSON.parse(row.afterJson || "{}"),
      createdAt: row.createdAt,
    })),
  });
});
admin.post("/settings/rollback/:id", async (c) => {
  const body = await c.req
    .json<{ confirmation?: string; expectedRevision?: string | null }>()
    .catch(
      () => ({}) as { confirmation?: string; expectedRevision?: string | null },
    );
  const denied = await requireOwnerConfirmation(
    c,
    body.confirmation,
    "RESTORE POLICY",
  );
  if (denied) return denied;
  const db = getDb(c.env.DB);
  const revision = await latestPolicyRevision(db);
  if ((body.expectedRevision ?? null) !== revision)
    return c.json(
      {
        error: "Policies changed in another session. Reload and review again.",
      },
      409,
    );
  const version = await db
    .select()
    .from(schema.policyVersions)
    .where(eq(schema.policyVersions.id, c.req.param("id")))
    .get();
  if (!version) return c.json({ error: "policy version not found" }, 404);
  const targetRaw = JSON.parse(version.afterJson || "{}") as Record<
    string,
    unknown
  >;
  const before = await settingsMap(db);
  const after = { ...before };
  for (const key of settingsKeys)
    if (key in targetRaw)
      after[key] = normalizeSettingValue(key, targetRaw[key]);
  const saved = await persistPolicy(c, db, before, after, "rollback");
  return c.json({ ok: true, settings: after, revision: saved.revision });
});
admin.get("/audit", async (c) => {
  const denied = await forbidUnlessCan(c, "viewActivity");
  if (denied) return denied;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const actor = c.req.query("actor")?.toLowerCase();
  const action = c.req.query("action");
  const targetType = c.req.query("targetType");
  const db = getDb(c.env.DB);
  let rows = await db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit)
    .all();
  if (actor)
    rows = rows.filter((r) =>
      (r.actorEmail ?? "").toLowerCase().includes(actor),
    );
  if (action) rows = rows.filter((r) => r.action === action);
  if (targetType) rows = rows.filter((r) => r.targetType === targetType);
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
      createdAt: r.createdAt,
    })),
  });
});

admin.get("/limit-requests", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.uploadLimitRequests)
    .orderBy(desc(schema.uploadLimitRequests.createdAt))
    .all()
    .catch(() => []);
  const users = await db.select().from(schema.user).all();
  const emailById = new Map(users.map((u) => [u.id, u.email] as const));
  return c.json({
    requests: rows.map((r) => ({
      ...r,
      userEmail: emailById.get(r.userId) ?? null,
    })),
  });
});
admin.post("/limit-requests/:id/approve", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const req = await db
    .select()
    .from(schema.uploadLimitRequests)
    .where(eq(schema.uploadLimitRequests.id, id))
    .get();
  if (!req || req.status !== "pending")
    return c.json({ error: "not found or already handled" }, 404);
  const actorRole = await adminRole(c.env, db, c.get("userEmail"));
  const policy = await settingsMap(db);
  const adminMaxQuotaBytes = Math.max(
    0,
    Number(policy.adminMaxQuotaBytes) || 10737418240,
  );
  if (actorRole === "admin" && req.requestedBytes > adminMaxQuotaBytes)
    return c.json(
      {
        error: `Admin quota approvals are capped at ${adminMaxQuotaBytes} bytes by the owner.`,
      },
      403,
    );
  await db
    .update(schema.uploadLimitRequests)
    .set({
      status: "approved",
      approvedBy: c.get("userEmail"),
      approvedAt: nowSeconds(),
    })
    .where(eq(schema.uploadLimitRequests.id, id))
    .run();
  await db
    .update(schema.user)
    .set({ quotaBytes: req.requestedBytes })
    .where(eq(schema.user.id, req.userId))
    .run();
  await notifyUser(db, {
    userId: req.userId,
    type: "limit_request",
    title: "Limit increase approved",
    message: `Your upload limit was increased to ${req.requestedBytes} bytes.`,
    targetType: "limit_request",
    targetId: req.id,
  });
  await logAction(
    c,
    db,
    "limit_request.approve",
    "user",
    req.userId,
    `${req.requestedBytes} bytes`,
  );
  return c.json({ ok: true });
});
admin.post("/limit-requests/:id/reject", async (c) => {
  const denied = await forbidUnlessCan(c, "manageUsers");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const req = await db
    .select()
    .from(schema.uploadLimitRequests)
    .where(eq(schema.uploadLimitRequests.id, id))
    .get();
  if (!req || req.status !== "pending")
    return c.json({ error: "not found or already handled" }, 404);
  await db
    .update(schema.uploadLimitRequests)
    .set({
      status: "rejected",
      approvedBy: c.get("userEmail"),
      approvedAt: nowSeconds(),
    })
    .where(eq(schema.uploadLimitRequests.id, id))
    .run();
  await notifyUser(db, {
    userId: req.userId,
    type: "limit_request",
    title: "Limit increase rejected",
    message: "Your upload limit request was reviewed and rejected.",
    targetType: "limit_request",
    targetId: req.id,
  });
  await logAction(
    c,
    db,
    "limit_request.reject",
    "user",
    req.userId,
    `${req.requestedBytes} bytes`,
  );
  return c.json({ ok: true });
});

export default admin;
