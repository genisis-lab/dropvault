UPDATE admin_emails SET role = 'auditor' WHERE role = 'viewer';

CREATE TABLE IF NOT EXISTS policy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  source TEXT NOT NULL DEFAULT 'update',
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_versions_created_at
  ON policy_versions(created_at DESC);

CREATE TABLE IF NOT EXISTS banned_file_hashes (
  hash TEXT PRIMARY KEY NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'sha-256',
  reason TEXT,
  source_file_id TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_banned_hashes_created_at
  ON banned_file_hashes(created_at DESC);
