-- Enhanced share-link options (files only): optional password (sha-256 hash),
-- a download limit + counter, and a link-specific expiry separate from the
-- file's own auto-expiry. All nullable so existing share links keep working.
ALTER TABLE files ADD COLUMN share_password TEXT;
ALTER TABLE files ADD COLUMN share_download_limit INTEGER;
ALTER TABLE files ADD COLUMN share_download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN share_expires_at INTEGER;
