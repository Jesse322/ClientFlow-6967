-- ─── Team Members ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,  -- Airtable record ID
  full_name TEXT NOT NULL,
  role TEXT,
  active INTEGER DEFAULT 1,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── Clients ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,  -- Airtable record ID
  name TEXT NOT NULL,
  renewal_date TEXT,
  active INTEGER DEFAULT 1,
  revenue REAL,
  funding_strategy TEXT,
  company_size TEXT,
  medical_carrier TEXT,   -- JSON array
  ancillary_carrier TEXT, -- JSON array
  location TEXT,
  intake_notes TEXT,
  rxdc_complete TEXT,
  date_added TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── Client ↔ Team Member assignments ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_team_members (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'producer' | 'service_lead' | 'analyst' | 'member'
  PRIMARY KEY (client_id, team_member_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ctm_client ON client_team_members(client_id);
CREATE INDEX IF NOT EXISTS idx_ctm_member ON client_team_members(team_member_id);

-- ─── OMNI Solutions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS omni_solutions (
  id TEXT PRIMARY KEY,  -- Airtable record ID
  category TEXT NOT NULL,
  solution_name TEXT NOT NULL
);

-- ─── Client ↔ OMNI ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_omni (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  omni_id TEXT NOT NULL REFERENCES omni_solutions(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, omni_id)
);

-- ─── Deliverables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,  -- Airtable record ID
  name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  type TEXT,
  deadline TEXT,
  completion_date TEXT,
  status TEXT DEFAULT 'Not Started',
  notes TEXT,
  renewal_phase TEXT,
  template_source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deliverables_client ON deliverables(client_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables(status);

-- ─── Deliverable ↔ Team Member ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliverable_team_members (
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (deliverable_id, team_member_id)
);

-- ─── Open Items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_items (
  id TEXT PRIMARY KEY,  -- Airtable record ID
  name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT DEFAULT 'Not Started',
  begin_date TEXT,
  due_date TEXT,
  completion_date TEXT,
  type TEXT,
  priority TEXT,
  ai_priority TEXT,
  ai_summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_open_items_client ON open_items(client_id);
CREATE INDEX IF NOT EXISTS idx_open_items_status ON open_items(status);

-- ─── Open Item ↔ Team Member (assigned_to + producer) ────────────────────────
CREATE TABLE IF NOT EXISTS open_item_assigned (
  open_item_id TEXT NOT NULL REFERENCES open_items(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'assigned', -- 'assigned' | 'producer'
  PRIMARY KEY (open_item_id, team_member_id, role)
);

CREATE INDEX IF NOT EXISTS idx_oia_item ON open_item_assigned(open_item_id);
CREATE INDEX IF NOT EXISTS idx_oia_member ON open_item_assigned(team_member_id);
