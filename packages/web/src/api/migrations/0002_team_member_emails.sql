CREATE TABLE IF NOT EXISTS team_member_emails (
  airtable_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
