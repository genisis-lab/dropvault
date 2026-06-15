-- User-submitted requests for a larger upload/storage limit.
-- Approving a request sets the user's quota_bytes to requested_bytes.

CREATE TABLE IF NOT EXISTS upload_limit_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  requested_bytes INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_limit_requests_user ON upload_limit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_limit_requests_status ON upload_limit_requests(status);
