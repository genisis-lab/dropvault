-- Avoid full-table scans during scheduled and owner-reviewed storage reconciliation.
CREATE INDEX idx_files_r2_key ON files(r2_key);
CREATE INDEX idx_file_versions_r2_key ON file_versions(r2_key);
