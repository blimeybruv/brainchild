-- 0009: versions of hosted builds. Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
-- status is now: uploading | active | previous (kept for rollback) | replaced | removed
ALTER TABLE builds ADD COLUMN version INTEGER;      -- 1, 2, 3 ... per project, set when the build goes live
ALTER TABLE builds ADD COLUMN commit_sha TEXT;      -- the repo's latest commit when the upload started
UPDATE builds SET version = (SELECT COUNT(*) FROM builds b2 WHERE b2.project_id = builds.project_id AND b2.activated_at IS NOT NULL AND b2.activated_at <= builds.activated_at)
 WHERE activated_at IS NOT NULL AND version IS NULL;
