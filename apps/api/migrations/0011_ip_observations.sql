CREATE TABLE IF NOT EXISTS ip_observations (
  id text PRIMARY KEY NOT NULL,
  user_id text,
  primary_ip text,
  ip_v4 text,
  ip_v6 text,
  path text,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_observations_user ON ip_observations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ip_observations_ipv4 ON ip_observations(ip_v4, created_at);
CREATE INDEX IF NOT EXISTS idx_ip_observations_ipv6 ON ip_observations(ip_v6, created_at);

ALTER TABLE session ADD COLUMN ip_v4 text;
ALTER TABLE session ADD COLUMN ip_v6 text;
