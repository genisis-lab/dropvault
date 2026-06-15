import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ---------------------------------------------------------------------------
// better-auth core tables (user / session / account / verification).
// ---------------------------------------------------------------------------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
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
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }).notNull(),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }).notNull(),
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

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shareToken: text("share_token"),
  sharePassword: text("share_password"),
  shareDownloadLimit: integer("share_download_limit"),
  shareDownloadCount: integer("share_download_count").notNull().default(0),
  shareExpiresAt: integer("share_expires_at"),
  createdAt: integer("created_at").notNull(),
})

export type FolderRow = typeof folders.$inferSelect

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  r2Key: text("r2_key").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  contentType: text("content_type"),
  status: text("status").notNull().default("pending"),
  shareToken: text("share_token"),
  folderId: text("folder_id"),
  sharePassword: text("share_password"),
  shareDownloadLimit: integer("share_download_limit"),
  shareDownloadCount: integer("share_download_count").notNull().default(0),
  shareExpiresAt: integer("share_expires_at"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  tags: text("tags"),
  deletedAt: integer("deleted_at"),
  versionGroupId: text("version_group_id"),
})

export type FileRow = typeof files.$inferSelect

export const adminEmails = sqliteTable("admin_emails", {
  email: text("email").primaryKey(),
  role: text("role").notNull().default("admin"),
  addedBy: text("added_by"),
  createdAt: integer("created_at").notNull(),
})

export type AdminEmailRow = typeof adminEmails.$inferSelect

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
})

export type AuditLogRow = typeof auditLog.$inferSelect

export const fileFlags = sqliteTable("file_flags", {
  id: text("id").primaryKey(),
  fileId: text("file_id"),
  token: text("token"),
  reason: text("reason"),
  reporterEmail: text("reporter_email"),
  status: text("status").notNull().default("open"),
  adminNote: text("admin_note"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
})

export type FileFlagRow = typeof fileFlags.$inferSelect

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at").notNull(),
})

export type AppSettingRow = typeof appSettings.$inferSelect

export const activityLog = sqliteTable("activity_log", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: text("detail"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
}, (t) => ({
  createdAtIdx: index("idx_activity_created_at").on(t.createdAt),
  targetIdx: index("idx_activity_target").on(t.targetType, t.targetId),
  userIdx: index("idx_activity_user").on(t.userId),
}))

export type ActivityLogRow = typeof activityLog.$inferSelect

export const uploadRequests = sqliteTable("upload_requests", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  folderId: text("folder_id"),
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  password: text("password"),
  maxFileSize: integer("max_file_size"),
  allowedTypes: text("allowed_types"),
  uploadLimit: integer("upload_limit"),
  uploadCount: integer("upload_count").notNull().default(0),
  requireEmail: integer("require_email", { mode: "boolean" }).notNull().default(false),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
})

export type UploadRequestRow = typeof uploadRequests.$inferSelect

export const publicUploads = sqliteTable("public_uploads", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => uploadRequests.id, { onDelete: "cascade" }),
  fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
  uploaderEmail: text("uploader_email"),
  uploaderName: text("uploader_name"),
  createdAt: integer("created_at").notNull(),
})

export type PublicUploadRow = typeof publicUploads.$inferSelect

export const fileVersions = sqliteTable("file_versions", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  versionGroupId: text("version_group_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  r2Key: text("r2_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
})

export type FileVersionRow = typeof fileVersions.$inferSelect

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
})

export type RateLimitRow = typeof rateLimits.$inferSelect

export const userSuspensions = sqliteTable("user_suspensions", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
})

export type UserSuspensionRow = typeof userSuspensions.$inferSelect

export const uploadLimitRequests = sqliteTable("upload_limit_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  requestedBytes: integer("requested_bytes").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
})

export type UploadLimitRequestRow = typeof uploadLimitRequests.$inferSelect
