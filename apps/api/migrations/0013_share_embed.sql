-- Adds a per-file toggle controlling whether shared image links render an
-- Open Graph / Twitter preview when the link is pasted into chat apps.
-- Defaults to 1 (on) so existing image shares keep unfurling.
ALTER TABLE files ADD COLUMN share_embed integer DEFAULT 1;
