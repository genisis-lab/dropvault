-- Folders: group files together; optional public share token (NULL = not shared).
CREATE TABLE IF NOT EXISTS `folders` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `name` text NOT NULL,
  `share_token` text,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `folders_share_token_idx` ON `folders` (`share_token`);
CREATE INDEX IF NOT EXISTS `folders_owner_idx` ON `folders` (`owner_id`);

-- Files can belong to a folder (nullable; NULL = top level / My Drive root).
ALTER TABLE `files` ADD `folder_id` text;
CREATE INDEX IF NOT EXISTS `files_folder_idx` ON `files` (`folder_id`);
