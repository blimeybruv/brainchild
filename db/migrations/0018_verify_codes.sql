-- 0018: codes for proving push access to a project on a self-hosted GitLab. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
CREATE TABLE IF NOT EXISTS verify_codes (
  code       TEXT PRIMARY KEY,                    -- what the person commits to brainchild-verify.txt
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_host  TEXT NOT NULL,                       -- selfhosted:<hostname>
  repo_path  TEXT NOT NULL,                       -- group/project, lower case
  created_at INTEGER NOT NULL,                    -- Unix seconds; a code must be committed within 7 days
  used_at    INTEGER                              -- set when a listing, handoff or adoption used it
);
CREATE INDEX IF NOT EXISTS idx_verify_codes_user ON verify_codes (user_id, created_at);
