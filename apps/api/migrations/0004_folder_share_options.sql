-- Enhanced share-link options for FOLDER links, mirroring the file-link options
-- from 0003: an optional password (sha-256 hash), a download limit + counter,
-- and a link-specific expiry. All nullable so existing folder links keep working.
ALTER TABLE folders ADD COLUMN share_password TEXT;
ALTER TABLE folders ADD COLUMN share_download_limit INTEGER;
ALTER TABLE folders ADD COLUMN share_download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN share_expires_at INTEGER;
