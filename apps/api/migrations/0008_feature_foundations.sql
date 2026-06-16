-- Nested folders
ALTER TABLE folders ADD COLUMN parent_id text;
ALTER TABLE folders ADD COLUMN color text;
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

-- Share controls and analytics
ALTER TABLE files ADD COLUMN content_hash text;
ALTER TABLE files ADD COLUMN share_access_mode text DEFAULT 'download';
ALTER TABLE files ADD COLUMN share_one_time integer DEFAULT 0;
ALTER TABLE files ADD COLUMN share_allowlist text;
ALTER TABLE files ADD COLUMN share_ip_allowlist text;
ALTER TABLE files ADD COLUMN share_country_allowlist text;
ALTER TABLE folders ADD COLUMN share_access_mode text DEFAULT 'download';
ALTER TABLE folders ADD COLUMN share_one_time integer DEFAULT 0;
ALTER TABLE folders ADD COLUMN share_allowlist text;
ALTER TABLE folders ADD COLUMN share_ip_allowlist text;
ALTER TABLE folders ADD COLUMN share_country_allowlist text;
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(owner_id, content_hash);

CREATE TABLE IF NOT EXISTS share_events (
  id text PRIMARY KEY,
  token text NOT NULL,
  file_id text,
  folder_id text,
  event text NOT NULL,
  ip text,
  country text,
  user_agent text,
  referer text,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_events_token ON share_events(token, created_at);
CREATE INDEX IF NOT EXISTS idx_share_events_file ON share_events(file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_share_events_folder ON share_events(folder_id, created_at);

-- Upload request management and moderation
ALTER TABLE upload_requests ADD COLUMN status text DEFAULT 'open';
ALTER TABLE upload_requests ADD COLUMN total_max_bytes integer;
ALTER TABLE upload_requests ADD COLUMN moderation_mode text DEFAULT 'auto';
ALTER TABLE upload_requests ADD COLUMN thank_you_message text;
ALTER TABLE upload_requests ADD COLUMN close_after_first_upload integer DEFAULT 0;
ALTER TABLE public_uploads ADD COLUMN status text DEFAULT 'approved';
ALTER TABLE public_uploads ADD COLUMN filename text;
ALTER TABLE public_uploads ADD COLUMN size_bytes integer;
ALTER TABLE public_uploads ADD COLUMN content_type text;
ALTER TABLE public_uploads ADD COLUMN reviewed_by text;
ALTER TABLE public_uploads ADD COLUMN reviewed_at integer;
CREATE INDEX IF NOT EXISTS idx_public_uploads_request ON public_uploads(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_public_uploads_status ON public_uploads(status);

-- In-app notifications (email delivery intentionally not included)
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  target_type text,
  target_id text,
  read_at integer,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- Team/shared spaces
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_unique ON team_members(team_id, user_id);
ALTER TABLE folders ADD COLUMN team_id text;
ALTER TABLE files ADD COLUMN team_id text;
CREATE INDEX IF NOT EXISTS idx_folders_team ON folders(team_id);
CREATE INDEX IF NOT EXISTS idx_files_team ON files(team_id);
