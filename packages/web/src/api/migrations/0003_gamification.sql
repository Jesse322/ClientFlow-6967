-- Points ledger (one row per event)
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_airtable_id TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id TEXT NOT NULL,
  base_points INTEGER NOT NULL,
  bonus_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

-- Badge awards (one row per badge earned)
CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_airtable_id TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_airtable_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_airtable_id);
CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_airtable_id);
