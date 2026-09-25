CREATE TABLE upload_diagnostics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  file_id TEXT,
  outcome TEXT NOT NULL,
  stage TEXT NOT NULL,
  category TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_upload_diagnostics_time ON upload_diagnostics(created_at);
CREATE INDEX idx_upload_diagnostics_user ON upload_diagnostics(user_id, created_at);
CREATE TABLE operation_runs (
  name TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  last_success_at INTEGER,
  status TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE operational_alerts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  resolved_at INTEGER,
  acknowledged_at INTEGER,
  acknowledged_by TEXT
);
