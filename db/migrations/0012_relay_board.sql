-- 0012: Relay rounds, part B (task board, claims, contributions, junk flags). Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
CREATE TABLE IF NOT EXISTS relay_tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,                   -- short label, e.g. Bug, Art, Balance
  title      TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL,
  removed_at TEXT                             -- set when the maintainer takes a task off the board
);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_round ON relay_tasks (round_id);

-- "I'm working on this": so people don't spend a month on the same task.
CREATE TABLE IF NOT EXISTS relay_claims (
  task_id    INTEGER NOT NULL REFERENCES relay_tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);

-- A contribution is a pull request on the winner's repo, checked on GitHub when it is submitted.
CREATE TABLE IF NOT EXISTS relay_contributions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),
  task_id         INTEGER REFERENCES relay_tasks(id),   -- NULL = wildcard (the contributor's own idea)
  pr_number       INTEGER NOT NULL,
  pr_url          TEXT NOT NULL,
  pr_title        TEXT NOT NULL,
  pr_opened_at    TEXT NOT NULL,
  note            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  flag_reason     TEXT,                       -- no_change | spam | no_effort | ignored  (set by the maintainer)
  flag_note       TEXT,
  flagged_by      TEXT REFERENCES users(id),
  flagged_at      TEXT,
  flag_outcome    TEXT,                       -- upheld (the PR doesn't count) | cleared
  flag_reasons    TEXT,                       -- the moderator's statement of reasons
  flag_decided_by TEXT REFERENCES users(id),
  flag_decided_at TEXT,
  action_id       INTEGER,                    -- moderation_actions row written when a flag is upheld
  UNIQUE (round_id, pr_number)
);
CREATE INDEX IF NOT EXISTS idx_relay_contrib_user ON relay_contributions (user_id, round_id);
