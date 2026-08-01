ALTER TABLE files ADD COLUMN purge_requested_at INTEGER;
ALTER TABLE files ADD COLUMN purge_reason TEXT;

CREATE INDEX idx_files_owner_purge
  ON files(owner_id, purge_requested_at);

CREATE TABLE file_key_recovery (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_envelope TEXT,
  password_envelope TEXT,
  password_verifier TEXT,
  duress_verifier TEXT,
  credential_salt TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_file_key_recovery_owner
  ON file_key_recovery(owner_id, updated_at);

CREATE TABLE vault_purge_jobs (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX idx_vault_purge_jobs_pending
  ON vault_purge_jobs(state, next_attempt_at);
