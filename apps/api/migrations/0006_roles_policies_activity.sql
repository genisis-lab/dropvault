ALTER TABLE admin_emails ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE files ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN tags TEXT;
ALTER TABLE files ADD COLUMN deleted_at INTEGER;
ALTER TABLE files ADD COLUMN version_group_id TEXT;
ALTER TABLE file_flags ADD COLUMN admin_note TEXT;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_target ON activity_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);

CREATE TABLE IF NOT EXISTS upload_requests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  folder_id TEXT,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  instructions TEXT,
  password TEXT,
  max_file_size INTEGER,
  allowed_types TEXT,
  upload_limit INTEGER,
  upload_count INTEGER NOT NULL DEFAULT 0,
  require_email INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_upload_requests_owner ON upload_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_upload_requests_token ON upload_requests(token);

CREATE TABLE IF NOT EXISTS public_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES upload_requests(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  uploader_email TEXT,
  uploader_name TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_uploads_request ON public_uploads(request_id);

CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version_group_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_versions_group ON file_versions(version_group_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_suspensions (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  reason TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
