-- Notification preferences per team member (keyed by Airtable member ID)
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  airtable_member_id TEXT NOT NULL UNIQUE,
  -- Change notifications
  notify_on_status_change INTEGER NOT NULL DEFAULT 1,
  notify_on_new_item INTEGER NOT NULL DEFAULT 1,
  notify_on_note_added INTEGER NOT NULL DEFAULT 1,
  -- Daily digest
  daily_digest_enabled INTEGER NOT NULL DEFAULT 1,
  digest_always_send INTEGER NOT NULL DEFAULT 0,
  -- Metadata
  created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS notif_member_idx ON notification_settings (airtable_member_id);
