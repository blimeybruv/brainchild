-- Owner request 17 Nov: first screenshots from brand-new accounts wait for a moderator.
-- held_at set = stored but not public; NULL = live. held_reason says which rule held it.
ALTER TABLE screenshots ADD COLUMN held_at TEXT;
ALTER TABLE screenshots ADD COLUMN held_reason TEXT;          -- new_provider_account | first_upload_new_account
ALTER TABLE screenshots ADD COLUMN approved_by TEXT REFERENCES users(id);
ALTER TABLE screenshots ADD COLUMN approved_at TEXT;
-- Set when a moderator approves one of the user's held screenshots: later uploads go live at once.
ALTER TABLE users ADD COLUMN screenshots_trusted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_screenshots_held ON screenshots (held_at) WHERE held_at IS NOT NULL;
