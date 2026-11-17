-- Brainchild's own license matcher (api/license-match.js), for license files GitHub or GitLab
-- doesn't name. NULL detection = the host named the license, as before.
--   matched    the file is a supported license's standard text, recognised by Brainchild
--   with_note  the standard text plus wording the maker said only explains what it covers
--   conditions the standard text plus wording the maker said adds conditions: listed as Custom
--   several    more than one license text in the one file: listed as Custom
ALTER TABLE license_records ADD COLUMN detection TEXT;
ALTER TABLE license_records ADD COLUMN base_spdx TEXT;   -- the license text found (conditions), or the ones found (several)
ALTER TABLE license_records ADD COLUMN extra_text TEXT;  -- the wording around the standard text, as written
