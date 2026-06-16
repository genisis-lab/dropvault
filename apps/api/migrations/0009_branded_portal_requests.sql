-- Request-only branded portal access. The portal feature itself is intentionally
-- deferred; this only lets users request access and admins approve eligibility.
CREATE TABLE IF NOT EXISTS branded_portal_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  requested_brand text,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at integer,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branded_portal_requests_user ON branded_portal_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_branded_portal_requests_status ON branded_portal_requests(status, created_at);

ALTER TABLE user ADD COLUMN branded_portal_approved integer DEFAULT 0;
