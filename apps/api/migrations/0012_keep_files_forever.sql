ALTER TABLE "user" ADD COLUMN keep_files_forever integer DEFAULT false;
ALTER TABLE files ADD COLUMN keep_forever integer DEFAULT false;

CREATE TABLE IF NOT EXISTS keep_forever_requests (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at integer,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_keep_forever_requests_user ON keep_forever_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_keep_forever_requests_status ON keep_forever_requests(status, created_at);
