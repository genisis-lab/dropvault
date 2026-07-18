ALTER TABLE folders ADD COLUMN default_expiry_days integer;
ALTER TABLE folders ADD COLUMN expire_after_download integer DEFAULT 0;

ALTER TABLE upload_requests ADD COLUMN reserved_bytes integer NOT NULL DEFAULT 0;
UPDATE upload_requests
SET reserved_bytes = COALESCE((
  SELECT SUM(size_bytes)
  FROM public_uploads
  WHERE request_id = upload_requests.id AND status != 'rejected'
), 0);

ALTER TABLE files ADD COLUMN checksum text;
ALTER TABLE files ADD COLUMN checksum_algorithm text DEFAULT 'sha-256';
ALTER TABLE files ADD COLUMN encryption_mode text NOT NULL DEFAULT 'none';
ALTER TABLE files ADD COLUMN encryption_nonce text;
ALTER TABLE files ADD COLUMN encrypted_metadata text;
ALTER TABLE files ADD COLUMN release_at integer;
ALTER TABLE files ADD COLUMN expire_after_download integer DEFAULT 0;
ALTER TABLE files ADD COLUMN scan_status text NOT NULL DEFAULT 'not_required';
ALTER TABLE files ADD COLUMN scan_result text;

ALTER TABLE file_versions ADD COLUMN checksum text;
ALTER TABLE file_versions ADD COLUMN content_type text;
ALTER TABLE file_versions ADD COLUMN filename text;

CREATE TABLE upload_reservations (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  file_id text NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at integer NOT NULL,
  expires_at integer NOT NULL
);
CREATE INDEX idx_upload_reservations_user ON upload_reservations(user_id, status);
CREATE INDEX idx_upload_reservations_expiry ON upload_reservations(expires_at);

CREATE TABLE upload_sessions (
  id text PRIMARY KEY NOT NULL,
  file_id text NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  upload_id text NOT NULL,
  request_id text,
  access_token_hash text,
  uploader_email text,
  uploader_name text,
  parts text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active',
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  expires_at integer NOT NULL
);
CREATE INDEX idx_upload_sessions_user ON upload_sessions(user_id, status);
CREATE INDEX idx_upload_sessions_expiry ON upload_sessions(expires_at);

CREATE TABLE guest_access_codes (
  id text PRIMARY KEY NOT NULL,
  share_token text NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at integer NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX idx_guest_access_codes_lookup ON guest_access_codes(share_token, email, expires_at);

CREATE TABLE guest_access_tokens (
  id text PRIMARY KEY NOT NULL,
  token text NOT NULL UNIQUE,
  share_token text NOT NULL,
  email text NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX idx_guest_access_tokens_share ON guest_access_tokens(share_token, expires_at);

CREATE TABLE portal_brands (
  user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  logo_url text,
  accent_color text NOT NULL DEFAULT '#7c3aed',
  welcome_message text,
  custom_domain text,
  updated_at integer NOT NULL
);

CREATE TABLE notification_preferences (
  user_id text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email_enabled integer NOT NULL DEFAULT 0,
  webhook_enabled integer NOT NULL DEFAULT 0,
  webhook_url text,
  expiry_warnings integer NOT NULL DEFAULT 1,
  upload_events integer NOT NULL DEFAULT 1,
  security_events integer NOT NULL DEFAULT 1,
  updated_at integer NOT NULL
);

CREATE TABLE outgoing_events (
  id text PRIMARY KEY NOT NULL,
  user_id text REFERENCES user(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at integer NOT NULL,
  last_error text,
  created_at integer NOT NULL,
  delivered_at integer
);
CREATE INDEX idx_outgoing_events_pending ON outgoing_events(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_files_owner_status_expiry ON files(owner_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_files_owner_deleted_created ON files(owner_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_folder_status ON files(folder_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_files_release_at ON files(release_at);
CREATE INDEX IF NOT EXISTS idx_public_uploads_request_bytes ON public_uploads(request_id, size_bytes);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_versions_group_number ON file_versions(version_group_id, version_number);
