-- Admin features: per-user storage quota, DB-managed admin allowlist,
-- audit log, and public file abuse flags.

ALTER TABLE user ADD COLUMN quota_bytes integer;

CREATE TABLE IF NOT EXISTS admin_emails (
  email text PRIMARY KEY NOT NULL,
  added_by text,
  created_at integer NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY NOT NULL,
  actor_id text,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  detail text,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at);

CREATE TABLE IF NOT EXISTS file_flags (
  id text PRIMARY KEY NOT NULL,
  file_id text,
  token text,
  reason text,
  reporter_email text,
  status text NOT NULL DEFAULT 'open',
  created_at integer NOT NULL,
  resolved_at integer
);
CREATE INDEX IF NOT EXISTS file_flags_status_idx ON file_flags (status);
