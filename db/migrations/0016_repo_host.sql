-- 0016: projects can live on GitLab.com as well as GitHub. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
-- GitHub and GitLab both number their repositories, so a repo is identified by (repo_host, repo_id).
ALTER TABLE projects ADD COLUMN repo_host TEXT;              -- github | gitlab (NULL only for old unverified listings)
UPDATE projects SET repo_host = 'github' WHERE repo_id IS NOT NULL OR repo_url LIKE 'https://github.com/%';
ALTER TABLE license_records ADD COLUMN repo_host TEXT NOT NULL DEFAULT 'github';
ALTER TABLE lineage ADD COLUMN repo_host TEXT NOT NULL DEFAULT 'github';
-- A repo id is unique per host, not across hosts.
DROP INDEX IF EXISTS idx_projects_repo_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo ON projects (repo_host, repo_id);
