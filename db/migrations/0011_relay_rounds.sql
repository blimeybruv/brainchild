-- 0011: Relay rounds, part A (rounds, entries, ranked votes). Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
CREATE TABLE IF NOT EXISTS relay_rounds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  month           TEXT NOT NULL UNIQUE,            -- e.g. 2026-12; a round lasts one calendar month
  status          TEXT NOT NULL,                   -- entry | voting | running | review | closed | not_run (fewer than 4 entries)
  winner_entry_id INTEGER,
  carried         INTEGER NOT NULL DEFAULT 0,      -- 1 once a not-run round's entries have been carried into the next
  created_at      TEXT NOT NULL,
  decided_at      TEXT,
  closed_at       TEXT
);

CREATE TABLE IF NOT EXISTS relay_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  pitch        TEXT NOT NULL,                      -- what a month of help would get done
  created_at   TEXT NOT NULL,                      -- also the last tie-breaker: earlier entry wins
  carried_from INTEGER,                            -- the round this entry was carried over from, if any
  UNIQUE (round_id, user_id),                      -- one project per person per round
  UNIQUE (round_id, project_id)
);

-- Each entrant ranks three other entries: rank 1 = 3 points, 2 = 2 points, 3 = 1 point.
CREATE TABLE IF NOT EXISTS relay_votes (
  round_id  INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  voter_id  TEXT NOT NULL REFERENCES users(id),
  entry_id  INTEGER NOT NULL REFERENCES relay_entries(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL CHECK (rank IN (1, 2, 3)),
  PRIMARY KEY (round_id, voter_id, rank),
  UNIQUE (round_id, voter_id, entry_id)
);
