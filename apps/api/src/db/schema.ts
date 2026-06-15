import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ---------------------------------------------------------------------------
// better-auth core tables (user / session / account / verification).
// These match better-auth's default schema. If you change better-auth options,
// re-run `pnpm db:generate` after `npx @better-auth/cli generate`.
// ---------------------------------------------------------------------------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  // Per-user storage cap in bytes. NULL = no limit (default). Set by admins.
  quotaBytes: integer("quota_bytes"),
})

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
})

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
})

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
})

// ---------------------------------------------------------------------------
// Folders: group files; optional public share token (NULL = not shared).
// share_password / share_download_limit / share_download_count / share_expires_at:
//   optional per-link protections (see migration 0004), mirroring files. NULL = not set.
// ---------------------------------------------------------------------------
export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(), // uuid
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shareToken: text("share_token"), // null = not shared
  sharePassword: text("share_password"), // sha-256 hash; null = no password
  shareDownloadLimit: integer("share_download_limit"), // null = unlimited
  shareDownloadCount: integer("share_download_count").notNull().default(0),
  shareExpiresAt: integer("share_expires_at"), // link-specific expiry (epoch s); null = no expiry
  createdAt: integer("created_at").notNull(),
})

export type FolderRow = typeof folders.$inferSelect

// ---------------------------------------------------------------------------
// Dropvault files table. epoch seconds for created/expires.
// share_token: nullable public token; NULL means the file is not shared.
// folder_id: nullable; NULL means the file lives at the root (My Drive).
// share_password / share_download_limit / share_download_count / share_expires_at:
//   optional per-link protections (see migration 0003). NULL = not set.
// ---------------------------------------------------------------------------
export const files = sqliteTable("files", {
  id: text("id").primaryKey(), // uuid, also the R2 key
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  contentType: text("content_type"),
  status: text("status").notNull().default("pending"), // pending | ready
  shareToken: text("share_token"), // null = not shared
  folderId: text("folder_id"), // null = root
  sharePassword: text("share_password"), // sha-256 hash; null = no password
  shareDownloadLimit: integer("share_download_limit"), // null = unlimited
  shareDownloadCount: integer("share_download_count").notNull().default(0),
  shareExpiresAt: integer("share_expires_at"), // link-specific expiry (epoch s); null = follow file expiry
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
})

export type FileRow = typeof files.$inferSelect

// ---------------------------------------------------------------------------
// Admin allowlist (DB-managed). The env var ADMIN_EMAILS is the bootstrap
// allowlist; this table lets admins promote/demote others from the UI. The
// effective admin set is the UNION of both. Emails are stored lowercased.
// ---------------------------------------------------------------------------
export const adminEmails = sqliteTable("admin_emails", {
  email: text("email").primaryKey(), // lowercased
  addedBy: text("added_by"), // actor email that granted it
  createdAt: integer("created_at").notNull(),
})

export type AdminEmailRow = typeof adminEmails.$inferSelect

// ---------------------------------------------------------------------------
// Audit log: an append-only record of every admin write action.
// ---------------------------------------------------------------------------
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(), // e.g. file.delete, user.quota, admin.add
  targetType: text("target_type"), // file | user | admin | flag
  targetId: text("target_id"),
  detail: text("detail"), // short human-readable summary
  createdAt: integer("created_at").notNull(),
})

export type AuditLogRow = typeof auditLog.$inferSelect

// ---------------------------------------------------------------------------
// File flags: abuse / takedown reports submitted from a public share page.
// fileId is nullable so a flag survives the file being deleted.
// ---------------------------------------------------------------------------
export const fileFlags = sqliteTable("file_flags", {
  id: text("id").primaryKey(),
  fileId: text("file_id"), // null if the file no longer exists
  token: text("token"), // the share token used to reach it
  reason: text("reason"),
  reporterEmail: text("reporter_email"), // optional, self-reported
  status: text("status").notNull().default("open"), // open | resolved
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
})

export type FileFlagRow = typeof fileFlags.$inferSelect
