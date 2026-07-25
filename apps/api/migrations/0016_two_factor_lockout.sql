ALTER TABLE twoFactor ADD COLUMN failedVerificationCount integer DEFAULT 0;
ALTER TABLE twoFactor ADD COLUMN lockedUntil integer;
