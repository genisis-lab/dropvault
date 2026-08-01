import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// better-auth core tables (user / session / account / verification).
// ---------------------------------------------------------------------------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  quotaBytes: integer("quota_bytes"),
  brandedPortalApproved: integer("branded_portal_approved", {
    mode: "boolean",
  }).default(false),
  twoFactorEnabled: integer("twoFactorEnabled", { mode: "boolean" }).default(
    false,
  ),
  keepFilesForever: integer("keep_files_forever", { mode: "boolean" }).default(
    false,
  ),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  ipV4: text("ip_v4"),
  ipV6: text("ip_v6"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", {
    mode: "timestamp",
  }).notNull(),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }).notNull(),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

export const twoFactor = sqliteTable(
  "twoFactor",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backupCodes").notNull(),
    verified: integer("verified", { mode: "boolean" }).default(false),
    failedVerificationCount: integer("failedVerificationCount").default(0),
    lockedUntil: integer("lockedUntil", { mode: "timestamp" }),
  },
  (t) => ({ userIdx: index("idx_two_factor_user").on(t.userId) }),
);

export type TwoFactorRow = typeof twoFactor.$inferSelect;

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    color: text("color"),
    teamId: text("team_id"),
    defaultExpiryDays: integer("default_expiry_days"),
    expireAfterDownload: integer("expire_after_download", {
      mode: "boolean",
    }).default(false),
    shareToken: text("share_token"),
    sharePassword: text("share_password"),
    shareDownloadLimit: integer("share_download_limit"),
    shareDownloadCount: integer("share_download_count").notNull().default(0),
    shareExpiresAt: integer("share_expires_at"),
    shareAccessMode: text("share_access_mode").default("download"),
    shareOneTime: integer("share_one_time", { mode: "boolean" }).default(false),
    shareAllowlist: text("share_allowlist"),
    shareIpAllowlist: text("share_ip_allowlist"),
    shareCountryAllowlist: text("share_country_allowlist"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    parentIdx: index("idx_folders_parent").on(t.parentId),
    teamIdx: index("idx_folders_team").on(t.teamId),
  }),
);

export type FolderRow = typeof folders.$inferSelect;

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    contentType: text("content_type"),
    contentHash: text("content_hash"),
    status: text("status").notNull().default("pending"),
    shareToken: text("share_token"),
    folderId: text("folder_id"),
    teamId: text("team_id"),
    sharePassword: text("share_password"),
    shareDownloadLimit: integer("share_download_limit"),
    shareDownloadCount: integer("share_download_count").notNull().default(0),
    shareExpiresAt: integer("share_expires_at"),
    shareAccessMode: text("share_access_mode").default("download"),
    shareOneTime: integer("share_one_time", { mode: "boolean" }).default(false),
    shareAllowlist: text("share_allowlist"),
    shareIpAllowlist: text("share_ip_allowlist"),
    shareCountryAllowlist: text("share_country_allowlist"),
    shareEmbed: integer("share_embed", { mode: "boolean" }).default(true),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    keepForever: integer("keep_forever", { mode: "boolean" }).default(false),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    tags: text("tags"),
    deletedAt: integer("deleted_at"),
    versionGroupId: text("version_group_id"),
    checksum: text("checksum"),
    checksumAlgorithm: text("checksum_algorithm").default("sha-256"),
    encryptionMode: text("encryption_mode").notNull().default("none"),
    encryptionNonce: text("encryption_nonce"),
    encryptedMetadata: text("encrypted_metadata"),
    releaseAt: integer("release_at"),
    expireAfterDownload: integer("expire_after_download", {
      mode: "boolean",
    }).default(false),
    scanStatus: text("scan_status").notNull().default("not_required"),
    scanResult: text("scan_result"),
    purgeRequestedAt: integer("purge_requested_at"),
    purgeReason: text("purge_reason"),
  },
  (t) => ({
    hashIdx: index("idx_files_content_hash").on(t.ownerId, t.contentHash),
    teamIdx: index("idx_files_team").on(t.teamId),
  }),
);

export type FileRow = typeof files.$inferSelect;

export const fileKeyRecovery = sqliteTable(
  "file_key_recovery",
  {
    fileId: text("file_id")
      .primaryKey()
      .references(() => files.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountEnvelope: text("account_envelope"),
    passwordEnvelope: text("password_envelope"),
    passwordVerifier: text("password_verifier"),
    duressVerifier: text("duress_verifier"),
    credentialSalt: text("credential_salt"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    ownerIdx: index("idx_file_key_recovery_owner").on(t.ownerId, t.updatedAt),
  }),
);

export type FileKeyRecoveryRow = typeof fileKeyRecovery.$inferSelect;

export const vaultPurgeJobs = sqliteTable(
  "vault_purge_jobs",
  {
    fileId: text("file_id")
      .primaryKey()
      .references(() => files.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    requestedAt: integer("requested_at").notNull(),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastError: text("last_error"),
  },
  (t) => ({
    pendingIdx: index("idx_vault_purge_jobs_pending").on(
      t.state,
      t.nextAttemptAt,
    ),
  }),
);

export type VaultPurgeJobRow = typeof vaultPurgeJobs.$inferSelect;

export const adminEmails = sqliteTable("admin_emails", {
  email: text("email").primaryKey(),
  role: text("role").notNull().default("admin"),
  addedBy: text("added_by"),
  createdAt: integer("created_at").notNull(),
});

export type AdminEmailRow = typeof adminEmails.$inferSelect;

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

export type AuditLogRow = typeof auditLog.$inferSelect;

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
});

export type FileFlagRow = typeof fileFlags.$inferSelect;

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at").notNull(),
});

export type AppSettingRow = typeof appSettings.$inferSelect;

export const policyVersions = sqliteTable(
  "policy_versions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    source: text("source").notNull().default("update"),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    changesJson: text("changes_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ createdAtIdx: index("idx_policy_versions_created_at").on(t.createdAt) }),
);

export type PolicyVersionRow = typeof policyVersions.$inferSelect;

export const bannedFileHashes = sqliteTable(
  "banned_file_hashes",
  {
    hash: text("hash").primaryKey(),
    algorithm: text("algorithm").notNull().default("sha-256"),
    reason: text("reason"),
    sourceFileId: text("source_file_id"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ createdAtIdx: index("idx_banned_hashes_created_at").on(t.createdAt) }),
);

export type BannedFileHashRow = typeof bannedFileHashes.$inferSelect;

export const activityLog = sqliteTable(
  "activity_log",
  {
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
  },
  (t) => ({
    createdAtIdx: index("idx_activity_created_at").on(t.createdAt),
    targetIdx: index("idx_activity_target").on(t.targetType, t.targetId),
    userIdx: index("idx_activity_user").on(t.userId),
  }),
);

export type ActivityLogRow = typeof activityLog.$inferSelect;

export const uploadRequests = sqliteTable("upload_requests", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  folderId: text("folder_id"),
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  password: text("password"),
  maxFileSize: integer("max_file_size"),
  totalMaxBytes: integer("total_max_bytes"),
  allowedTypes: text("allowed_types"),
  uploadLimit: integer("upload_limit"),
  uploadCount: integer("upload_count").notNull().default(0),
  reservedBytes: integer("reserved_bytes").notNull().default(0),
  requireEmail: integer("require_email", { mode: "boolean" })
    .notNull()
    .default(false),
  status: text("status").default("open"),
  moderationMode: text("moderation_mode").default("auto"),
  thankYouMessage: text("thank_you_message"),
  closeAfterFirstUpload: integer("close_after_first_upload", {
    mode: "boolean",
  }).default(false),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});

export type UploadRequestRow = typeof uploadRequests.$inferSelect;

export const publicUploads = sqliteTable(
  "public_uploads",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => uploadRequests.id, { onDelete: "cascade" }),
    fileId: text("file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    uploaderEmail: text("uploader_email"),
    uploaderName: text("uploader_name"),
    status: text("status").default("approved"),
    filename: text("filename"),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    requestIdx: index("idx_public_uploads_request").on(
      t.requestId,
      t.createdAt,
    ),
    statusIdx: index("idx_public_uploads_status").on(t.status),
  }),
);

export type PublicUploadRow = typeof publicUploads.$inferSelect;

export const fileVersions = sqliteTable("file_versions", {
  id: text("id").primaryKey(),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  versionGroupId: text("version_group_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  r2Key: text("r2_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksum: text("checksum"),
  contentType: text("content_type"),
  filename: text("filename"),
  createdAt: integer("created_at").notNull(),
});

export type FileVersionRow = typeof fileVersions.$inferSelect;

export const shareEvents = sqliteTable(
  "share_events",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    fileId: text("file_id"),
    folderId: text("folder_id"),
    event: text("event").notNull(),
    ip: text("ip"),
    country: text("country"),
    userAgent: text("user_agent"),
    referer: text("referer"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    tokenIdx: index("idx_share_events_token").on(t.token, t.createdAt),
    fileIdx: index("idx_share_events_file").on(t.fileId, t.createdAt),
    folderIdx: index("idx_share_events_folder").on(t.folderId, t.createdAt),
  }),
);

export type ShareEventRow = typeof shareEvents.$inferSelect;

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_notifications_user").on(t.userId, t.createdAt),
  }),
);

export type NotificationRow = typeof notifications.$inferSelect;

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
});

export type TeamRow = typeof teams.$inferSelect;

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uniqueMember: uniqueIndex("idx_team_members_unique").on(t.teamId, t.userId),
  }),
);

export type TeamMemberRow = typeof teamMembers.$inferSelect;

export const brandedPortalRequests = sqliteTable(
  "branded_portal_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedBrand: text("requested_brand"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_branded_portal_requests_user").on(t.userId),
    statusIdx: index("idx_branded_portal_requests_status").on(t.status),
  }),
);

export type BrandedPortalRequestRow = typeof brandedPortalRequests.$inferSelect;

export const keepForeverRequests = sqliteTable(
  "keep_forever_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_keep_forever_requests_user").on(t.userId, t.createdAt),
    statusIdx: index("idx_keep_forever_requests_status").on(
      t.status,
      t.createdAt,
    ),
  }),
);

export type KeepForeverRequestRow = typeof keepForeverRequests.$inferSelect;

export const ipObservations = sqliteTable(
  "ip_observations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    primaryIp: text("primary_ip"),
    ipV4: text("ip_v4"),
    ipV6: text("ip_v6"),
    path: text("path"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_ip_observations_user").on(t.userId, t.createdAt),
    ipv4Idx: index("idx_ip_observations_ipv4").on(t.ipV4, t.createdAt),
    ipv6Idx: index("idx_ip_observations_ipv6").on(t.ipV6, t.createdAt),
  }),
);

export type IpObservationRow = typeof ipObservations.$inferSelect;

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});

export type RateLimitRow = typeof rateLimits.$inferSelect;

export const userSuspensions = sqliteTable("user_suspensions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
});

export type UserSuspensionRow = typeof userSuspensions.$inferSelect;

export const uploadLimitRequests = sqliteTable("upload_limit_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  requestedBytes: integer("requested_bytes").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
});

export type UploadLimitRequestRow = typeof uploadLimitRequests.$inferSelect;

export const uploadReservations = sqliteTable(
  "upload_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .unique()
      .references(() => files.id, { onDelete: "cascade" }),
    bytes: integer("bytes").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_upload_reservations_user").on(t.userId, t.status),
    expiryIdx: index("idx_upload_reservations_expiry").on(t.expiresAt),
  }),
);

export type UploadReservationRow = typeof uploadReservations.$inferSelect;

export const uploadSessions = sqliteTable(
  "upload_sessions",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .unique()
      .references(() => files.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    uploadId: text("upload_id").notNull(),
    requestId: text("request_id"),
    accessTokenHash: text("access_token_hash"),
    uploaderEmail: text("uploader_email"),
    uploaderName: text("uploader_name"),
    parts: text("parts").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_upload_sessions_user").on(t.userId, t.status),
    expiryIdx: index("idx_upload_sessions_expiry").on(t.expiresAt),
  }),
);

export type UploadSessionRow = typeof uploadSessions.$inferSelect;

export const guestAccessCodes = sqliteTable(
  "guest_access_codes",
  {
    id: text("id").primaryKey(),
    shareToken: text("share_token").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    lookupIdx: index("idx_guest_access_codes_lookup").on(
      t.shareToken,
      t.email,
      t.expiresAt,
    ),
  }),
);

export const guestAccessTokens = sqliteTable(
  "guest_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    shareToken: text("share_token").notNull(),
    email: text("email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    shareIdx: index("idx_guest_access_tokens_share").on(
      t.shareToken,
      t.expiresAt,
    ),
  }),
);

export const portalBrands = sqliteTable("portal_brands", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  accentColor: text("accent_color").notNull().default("#7c3aed"),
  welcomeMessage: text("welcome_message"),
  customDomain: text("custom_domain"),
  updatedAt: integer("updated_at").notNull(),
});

export type PortalBrandRow = typeof portalBrands.$inferSelect;

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  webhookEnabled: integer("webhook_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  webhookUrl: text("webhook_url"),
  expiryWarnings: integer("expiry_warnings", { mode: "boolean" })
    .notNull()
    .default(true),
  uploadEvents: integer("upload_events", { mode: "boolean" })
    .notNull()
    .default(true),
  securityEvents: integer("security_events", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: integer("updated_at").notNull(),
});

export const outgoingEvents = sqliteTable(
  "outgoing_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    deliveredAt: integer("delivered_at"),
  },
  (t) => ({
    pendingIdx: index("idx_outgoing_events_pending").on(
      t.status,
      t.nextAttemptAt,
    ),
  }),
);
