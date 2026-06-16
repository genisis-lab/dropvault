ALTER TABLE user ADD COLUMN twoFactorEnabled integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS twoFactor (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  secret text NOT NULL,
  backupCodes text NOT NULL,
  verified integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_two_factor_user ON twoFactor(userId);
