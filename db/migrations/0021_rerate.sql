-- 0021: moderators can change a listing's rating; the decision records the old and new values. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
ALTER TABLE moderation_actions ADD COLUMN old_value TEXT;   -- JSON, e.g. {"rating":"teen","content_notes":["Violence"]}
ALTER TABLE moderation_actions ADD COLUMN new_value TEXT;
