-- Add a public share token to files (nullable; NULL = not shared).
ALTER TABLE `files` ADD `share_token` text;
CREATE UNIQUE INDEX IF NOT EXISTS `files_share_token_idx` ON `files` (`share_token`);
