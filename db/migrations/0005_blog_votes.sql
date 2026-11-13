-- 0005: blog votes. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
-- A project can be proposed once for a given month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_project_month ON proposals (project_id, month);
