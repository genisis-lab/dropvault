-- Dropvault initial schema (better-auth tables + files).
-- This file is illustrative; prefer `pnpm db:generate` to regenerate from schema.ts.

CREATE TABLE IF NOT EXISTS `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL UNIQUE,
  `emailVerified` integer DEFAULT 0 NOT NULL,
  `image` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `session` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `token` text NOT NULL UNIQUE,
  `expiresAt` integer NOT NULL,
  `ipAddress` text,
  `userAgent` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `account` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `accessTokenExpiresAt` integer,
  `refreshTokenExpiresAt` integer,
  `scope` text,
  `idToken` text,
  `password` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expiresAt` integer NOT NULL,
  `createdAt` integer,
  `updatedAt` integer
);

CREATE TABLE IF NOT EXISTS `files` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `filename` text NOT NULL,
  `r2_key` text NOT NULL,
  `size_bytes` integer DEFAULT 0 NOT NULL,
  `content_type` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `files_owner_idx` ON `files` (`owner_id`);
CREATE INDEX IF NOT EXISTS `files_expires_idx` ON `files` (`expires_at`);
