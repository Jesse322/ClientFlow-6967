import { createClient } from "@libsql/client";

// DB client — recreated if env changes (first real request after CF env injection)
let _db: ReturnType<typeof createClient> | null = null;
let _dbUrl: string | undefined;

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!_db || url !== _dbUrl) {
    _dbUrl = url;
    _db = createClient({
      url: url!,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return _db;
}

/**
 * D1 query helpers — wrap results into { id, fields } shape so frontend needs zero changes.
 * All IDs are the original Airtable record IDs (text PKs).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Row { id: string; [k: string]: any; }

function toAirtable(id: string, fields: Record<string, any>) {
  return { id, fields };
}

function jsonArr(v: string | null | undefined): string[] {
  if (!v) return [];
  try { return JSON.parse(v); } catch { return []; }
}

// ─── Team Members ─────────────────────────────────────────────────────────────

export async function dbGetTeamMembers(db: any) {
  const rows = (await db.execute({sql: "SELECT tm.*, tme.email as _email FROM team_members tm LEFT JOIN team_member_emails tme ON tme.airtable_id = tm.id ORDER BY tm.full_name ASC", args: []})).rows;
  return rows.map((r: any) => toAirtable(r.id, {
    "Full Name": r.full_name,
    "Role": r.role,
    "Active Status": r.active === 1,
    "Phone Number": r.phone,
    "_email": r._email || null,
    "Avatar Seed": r.avatar_seed || null,
  }));
}

export async function dbGetTeamMember(db: any, id: string) {
  const r = (await db.execute({sql: "SELECT tm.*, tme.email as _email FROM team_members tm LEFT JOIN team_member_emails tme ON tme.airtable_id = tm.id WHERE tm.id = ?", args: [id]})).rows[0] ?? null;
  if (!r) throw new Error(`Team member ${id} not found`);
  return toAirtable(r.id, {
    "Full Name": r.full_name,
    "Role": r.role,
    "Active Status": r.active === 1,
    "Phone Number": r.phone,
    "_email": r._email || null,
    "Avatar Seed": r.avatar_seed || null,
  });
}

export async function dbCreateTeamMember(db: any, id: string, fields: any, email?: string) {
  await db.execute({sql: "INSERT INTO team_members (id, full_name, role, active, phone, avatar_seed) VALUES (?, ?, ?, ?, ?, ?)", args: [id, fields["Full Name"], fields["Role"] || null, fields["Active Status"] !== false ? 1 : 0, fields["Phone Number"] || null, fields["Avatar Seed"] || null]});
  if (email) {
    await db.execute({sql: "INSERT OR REPLACE INTO team_member_emails (airtable_id, email, updated_at) VALUES (?, ?, unixepoch())", args: [id, email.trim()]});
  }
  return dbGetTeamMember(db, id);
}

export async function dbUpdateTeamMember(db: any, id: string, fields: any, email?: string) {
  const updates: string[] = ["updated_at = datetime('now')"];
  const vals: any[] = [];
  if (fields["Full Name"] !== undefined) { updates.push("full_name = ?"); vals.push(fields["Full Name"]); }
  if (fields["Role"] !== undefined)       { updates.push("role = ?");      vals.push(fields["Role"]); }
  if (fields["Active Status"] !== undefined) { updates.push("active = ?"); vals.push(fields["Active Status"] ? 1 : 0); }
  if (fields["Phone Number"] !== undefined)  { updates.push("phone = ?");  vals.push(fields["Phone Number"]); }
  if (fields["Avatar Seed"] !== undefined)   { updates.push("avatar_seed = ?"); vals.push(fields["Avatar Seed"] || null); }
  if (updates.length > 1) {
    await db.execute({sql: `UPDATE team_members SET ${updates.join(", ")} WHERE id = ?`, args: [...vals, id]});
  }
  if (email !== undefined) {
    if (email.trim()) {
      await db.execute({sql: "INSERT OR REPLACE INTO team_member_emails (airtable_id, email, updated_at) VALUES (?, ?, unixepoch())", args: [id, email.trim()]});
    } else {
      await db.execute({sql: "DELETE FROM team_member_emails WHERE airtable_id = ?", args: [id]});
    }
  }
  return dbGetTeamMember(db, id);
}

export async function dbDeleteTeamMember(db: any, id: string) {
  await db.execute({sql: "DELETE FROM team_member_emails WHERE airtable_id = ?", args: [id]});
  await db.execute({sql: "DELETE FROM team_members WHERE id = ?", args: [id]});
}

// ─── Clients ──────────────────────────────────────────────────────────────────

async function clientWithAssignments(db: any, id: string) {
  const r = (await db.execute({sql: "SELECT * FROM clients WHERE id = ?", args: [id]})).rows[0] ?? null;
  if (!r) throw new Error(`Client ${id} not found`);
  return buildClientRecord(db, r);
}

async function buildClientRecord(db: any, r: any) {
  const assignments = (await db.execute({sql: "SELECT team_member_id, role FROM client_team_members WHERE client_id = ?", args: [r.id]})).rows;
  const byRole: Record<string, string[]> = { producer: [], service_lead: [], analyst: [], member: [] };
  for (const a of (assignments || [])) {
    (byRole[a.role] || byRole.member).push(a.team_member_id);
  }
  const omniRows = (await db.execute({sql: "SELECT omni_id FROM client_omni WHERE client_id = ?", args: [r.id]})).rows;
  const omniIds = (omniRows || []).map((o: any) => o.omni_id);

  return toAirtable(r.id, {
    "Client Name": r.name,
    "Renewal Date": r.renewal_date,
    "Active": r.active === 1,
    "Revenue": r.revenue,
    "Funding Strategy": r.funding_strategy,
    "Company Size": r.company_size,
    "Medical Carrier/TPA": jsonArr(r.medical_carrier),
    "Ancillary Carrier": jsonArr(r.ancillary_carrier),
    "Location": r.location,
    "Intake Notes": r.intake_notes,
    "RxDC Reporting Complete?": r.rxdc_complete,
    "PEO Name": r.peo_name || null,
    "SF Arrangement": r.sf_arrangement || null,
    "PBM": r.pbm || null,
    "Stop Loss": r.stop_loss || null,
    "TPA Name": r.tpa_name || null,
    "Segment": r.segment || null,
    "Date Added": r.date_added,
    "Producer": byRole.producer,
    "Service Lead": byRole.service_lead,
    "Analyst": byRole.analyst,
    "Assigned Team Members": byRole.member,
    "OMNI Solutions": omniIds,
    "Theme Color": r.theme_color || null,
    "Header Photo URL": r.header_photo_url || null,
    "Header Photo Source": r.header_photo_source || null,
    "Header Photo Credit": r.header_photo_credit ? JSON.parse(r.header_photo_credit) : null,
    "Is Onboarding": r.is_onboarding === 1,
    "BOR Date": r.bor_date || null,
    "Onboarding Data": r.onboarding_data ? JSON.parse(r.onboarding_data) : null,
    "Office": r.office || null,
  });
}

export async function dbGetClients(db: any) {
  // Single query for all clients
  const rows = (await db.execute({sql: "SELECT * FROM clients ORDER BY name ASC", args: []})).rows;
  if (rows.length === 0) return [];

  // Bulk-load all team assignments and OMNI links in 2 queries instead of 2N
  const [assignRows, omniRows] = await Promise.all([
    db.execute({sql: "SELECT client_id, team_member_id, role FROM client_team_members", args: []}).then((r: any) => r.rows),
    db.execute({sql: "SELECT client_id, omni_id FROM client_omni", args: []}).then((r: any) => r.rows),
  ]);

  // Index by client_id
  const assignByClient = new Map<string, { team_member_id: string; role: string }[]>();
  for (const a of assignRows) {
    if (!assignByClient.has(a.client_id)) assignByClient.set(a.client_id, []);
    assignByClient.get(a.client_id)!.push(a);
  }
  const omniByClient = new Map<string, string[]>();
  for (const o of omniRows) {
    if (!omniByClient.has(o.client_id)) omniByClient.set(o.client_id, []);
    omniByClient.get(o.client_id)!.push(o.omni_id);
  }

  return rows.map((r: any) => {
    const assignments = assignByClient.get(r.id) || [];
    const byRole: Record<string, string[]> = { producer: [], service_lead: [], analyst: [], member: [] };
    for (const a of assignments) {
      (byRole[a.role] || byRole.member).push(a.team_member_id);
    }
    return toAirtable(r.id, {
      "Client Name": r.name,
      "Renewal Date": r.renewal_date,
      "Active": r.active === 1,
      "Revenue": r.revenue,
      "Funding Strategy": r.funding_strategy,
      "Company Size": r.company_size,
      "Medical Carrier/TPA": jsonArr(r.medical_carrier),
      "Ancillary Carrier": jsonArr(r.ancillary_carrier),
      "Location": r.location,
      "Intake Notes": r.intake_notes,
      "RxDC Reporting Complete?": r.rxdc_complete,
      "PEO Name": r.peo_name || null,
      "SF Arrangement": r.sf_arrangement || null,
      "PBM": r.pbm || null,
      "Stop Loss": r.stop_loss || null,
      "TPA Name": r.tpa_name || null,
      "Segment": r.segment || null,
      "Date Added": r.date_added,
      "Producer": byRole.producer,
      "Service Lead": byRole.service_lead,
      "Analyst": byRole.analyst,
      "Assigned Team Members": byRole.member,
      "OMNI Solutions": omniByClient.get(r.id) || [],
      "Theme Color": r.theme_color || null,
      "Header Photo URL": r.header_photo_url || null,
      "Header Photo Source": r.header_photo_source || null,
      "Header Photo Credit": r.header_photo_credit ? JSON.parse(r.header_photo_credit) : null,
      "Is Onboarding": r.is_onboarding === 1,
      "BOR Date": r.bor_date || null,
      "Onboarding Data": r.onboarding_data ? JSON.parse(r.onboarding_data) : null,
      "Office": r.office || null,
    });
  });
}

export async function dbGetClient(db: any, id: string) {
  return clientWithAssignments(db, id);
}

export async function dbCreateClient(db: any, id: string, fields: any) {
  await db.execute({sql: `INSERT INTO clients (id, name, renewal_date, active, revenue, funding_strategy, company_size,
      medical_carrier, ancillary_carrier, location, intake_notes, rxdc_complete, date_added,
      peo_name, sf_arrangement, pbm, stop_loss, tpa_name, segment,
      is_onboarding, bor_date, office)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, fields["Client Name"], fields["Renewal Date"] || null,
    fields["Active"] !== false ? 1 : 0, fields["Revenue"] || null,
    fields["Funding Strategy"] || null, fields["Company Size"] || null,
    fields["Medical Carrier/TPA"] ? JSON.stringify(fields["Medical Carrier/TPA"]) : null,
    fields["Ancillary Carrier"] ? JSON.stringify(fields["Ancillary Carrier"]) : null,
    fields["Location"] || null, fields["Intake Notes"] || null,
    fields["RxDC Reporting Complete?"] || null, fields["Date Added"] || null,
    fields["PEO Name"] || null, fields["SF Arrangement"] || null,
    fields["PBM"] || null, fields["Stop Loss"] || null, fields["TPA Name"] || null,
    fields["Segment"] || null,
    fields["Is Onboarding"] ? 1 : 0, fields["BOR Date"] || null,
    fields["Office"] || null]});
  await syncClientAssignments(db, id, fields);
  return clientWithAssignments(db, id);
}

export async function dbUpdateClient(db: any, id: string, fields: any) {
  const colMap: Record<string, string> = {
    "Client Name": "name", "Renewal Date": "renewal_date", "Active": "active",
    "Revenue": "revenue", "Funding Strategy": "funding_strategy",
    "Company Size": "company_size", "Location": "location",
    "Intake Notes": "intake_notes", "RxDC Reporting Complete?": "rxdc_complete",
    "Date Added": "date_added",
    "PEO Name": "peo_name", "SF Arrangement": "sf_arrangement",
    "PBM": "pbm", "Stop Loss": "stop_loss", "TPA Name": "tpa_name",
    "Segment": "segment",
    "Theme Color": "theme_color",
    "Header Photo URL": "header_photo_url",
    "Header Photo Source": "header_photo_source",
    "BOR Date": "bor_date",
    "Office": "office",
  };
  const updates: string[] = ["updated_at = datetime('now')"];
  const vals: any[] = [];
  for (const [field, col] of Object.entries(colMap)) {
    if (fields[field] !== undefined) {
      updates.push(`${col} = ?`);
      vals.push(col === "active" ? (fields[field] ? 1 : 0) : (fields[field] === null ? null : fields[field]));
    }
  }
  if (fields["Medical Carrier/TPA"] !== undefined) {
    updates.push("medical_carrier = ?"); vals.push(JSON.stringify(fields["Medical Carrier/TPA"]));
  }
  if (fields["Ancillary Carrier"] !== undefined) {
    updates.push("ancillary_carrier = ?"); vals.push(JSON.stringify(fields["Ancillary Carrier"]));
  }
  if (fields["Header Photo Credit"] !== undefined) {
    updates.push("header_photo_credit = ?");
    vals.push(fields["Header Photo Credit"] === null ? null : JSON.stringify(fields["Header Photo Credit"]));
  }
  if (fields["Is Onboarding"] !== undefined) {
    updates.push("is_onboarding = ?");
    vals.push(fields["Is Onboarding"] ? 1 : 0);
  }
  if (fields["Onboarding Data"] !== undefined) {
    updates.push("onboarding_data = ?");
    vals.push(fields["Onboarding Data"] === null ? null : JSON.stringify(fields["Onboarding Data"]));
  }
  if (updates.length > 1) {
    await db.execute({sql: `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`, args: [...vals, id]});
  }
  await syncClientAssignments(db, id, fields);
  return clientWithAssignments(db, id);
}

async function syncClientAssignments(db: any, clientId: string, fields: any) {
  const roleMap: Record<string, string> = {
    "Producer": "producer", "Service Lead": "service_lead",
    "Analyst": "analyst", "Assigned Team Members": "member",
  };
  for (const [field, role] of Object.entries(roleMap)) {
    if (fields[field] !== undefined) {
      await db.execute({sql: "DELETE FROM client_team_members WHERE client_id = ? AND role = ?", args: [clientId, role]});
      for (const memberId of (fields[field] as string[] || [])) {
        await db.execute({sql: "INSERT OR IGNORE INTO client_team_members (client_id, team_member_id, role) VALUES (?, ?, ?)", args: [clientId, memberId, role]});
      }
    }
  }
  if (fields["OMNI Solutions"] !== undefined) {
    await db.execute({sql: "DELETE FROM client_omni WHERE client_id = ?", args: [clientId]});
    for (const omniId of (fields["OMNI Solutions"] as string[] || [])) {
      await db.execute({sql: "INSERT OR IGNORE INTO client_omni (client_id, omni_id) VALUES (?, ?)", args: [clientId, omniId]});
    }
  }
}

export async function dbDeleteClient(db: any, id: string) {
  await db.execute({sql: "DELETE FROM clients WHERE id = ?", args: [id]});
}

export async function dbSaveOnboardingData(db: any, id: string, patch: Record<string, any>) {
  // Merge patch into existing onboarding_data JSON blob
  const existing = (await db.execute({sql: "SELECT onboarding_data FROM clients WHERE id = ?", args: [id]})).rows[0] ?? null;
  const current = existing?.onboarding_data ? JSON.parse(existing.onboarding_data) : {};
  const merged = { ...current, ...patch };
  await db.execute({sql: "UPDATE clients SET onboarding_data = ?, updated_at = datetime('now') WHERE id = ?", args: [JSON.stringify(merged), id]});
}

// ─── OMNI Solutions ───────────────────────────────────────────────────────────

export async function dbGetOmni(db: any) {
  const rows = (await db.execute({sql: "SELECT * FROM omni_solutions ORDER BY category, solution_name", args: []})).rows;
  return rows.map((r: any) => toAirtable(r.id, {
    [r.category]: r.solution_name,
    "Clients": [],
  }));
}

export async function dbUpsertOmni(db: any, id: string, category: string, solutionName: string) {
  await db.execute({sql: "INSERT OR REPLACE INTO omni_solutions (id, category, solution_name) VALUES (?, ?, ?)", args: [id, category, solutionName]});
}

// ─── Deliverables ─────────────────────────────────────────────────────────────

async function buildDeliverableRecord(db: any, r: any) {
  const members = (await db.execute({sql: "SELECT team_member_id FROM deliverable_team_members WHERE deliverable_id = ?", args: [r.id]})).rows;
  const memberIds = (members || []).map((m: any) => m.team_member_id);
  return toAirtable(r.id, {
    "Deliverable Name": r.name,
    "Client": r.client_id ? [r.client_id] : [],
    "Type": r.type,
    "Deadline": r.deadline,
    "Completion Date": r.completion_date,
    "Status": r.status || "Not Started",
    "Notes": r.notes,
    "Renewal Timeline Phase": r.renewal_phase,
    "Template Source": r.template_source,
    "Assigned Team Members": memberIds,
  });
}

export async function dbGetDeliverables(db: any) {
  const rows = (await db.execute({sql: "SELECT * FROM deliverables ORDER BY deadline ASC NULLS LAST", args: []})).rows;
  if (rows.length === 0) return [];

  // Bulk load all member assignments in one query
  const memberRows = (await db.execute({sql: "SELECT deliverable_id, team_member_id FROM deliverable_team_members", args: []})).rows;
  const membersByDel = new Map<string, string[]>();
  for (const m of memberRows) {
    if (!membersByDel.has(m.deliverable_id)) membersByDel.set(m.deliverable_id, []);
    membersByDel.get(m.deliverable_id)!.push(m.team_member_id);
  }

  return rows.map((r: any) => toAirtable(r.id, {
    "Deliverable Name": r.name,
    "Client": r.client_id ? [r.client_id] : [],
    "Type": r.type,
    "Deadline": r.deadline,
    "Completion Date": r.completion_date,
    "Status": r.status || "Not Started",
    "Notes": r.notes,
    "Renewal Timeline Phase": r.renewal_phase,
    "Template Source": r.template_source,
    "Assigned Team Members": membersByDel.get(r.id) || [],
  }));
}

export async function dbGetDeliverable(db: any, id: string) {
  const r = (await db.execute({sql: "SELECT * FROM deliverables WHERE id = ?", args: [id]})).rows[0] ?? null;
  if (!r) throw new Error(`Deliverable ${id} not found`);
  return buildDeliverableRecord(db, r);
}

export async function dbCreateDeliverable(db: any, id: string, fields: any) {
  await db.execute({sql: `INSERT INTO deliverables (id, name, client_id, type, deadline, completion_date, status, notes, renewal_phase, template_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, fields["Deliverable Name"], fields["Client"]?.[0] || null,
    fields["Type"] || null, fields["Deadline"] || null, fields["Completion Date"] || null,
    fields["Status"] || "Not Started", fields["Notes"] || null,
    fields["Renewal Timeline Phase"] || null, fields["Template Source"] || null]});
  await syncDeliverableMembers(db, id, fields);
  return dbGetDeliverable(db, id);
}

export async function dbUpdateDeliverable(db: any, id: string, fields: any) {
  const colMap: Record<string, string> = {
    "Deliverable Name": "name", "Type": "type", "Deadline": "deadline",
    "Completion Date": "completion_date", "Status": "status", "Notes": "notes",
    "Renewal Timeline Phase": "renewal_phase", "Template Source": "template_source",
  };
  const updates: string[] = ["updated_at = datetime('now')"];
  const vals: any[] = [];
  if (fields["Client"] !== undefined) { updates.push("client_id = ?"); vals.push(fields["Client"]?.[0] || null); }
  for (const [field, col] of Object.entries(colMap)) {
    if (fields[field] !== undefined) { updates.push(`${col} = ?`); vals.push(fields[field]); }
  }
  if (updates.length > 1) {
    await db.execute({sql: `UPDATE deliverables SET ${updates.join(", ")} WHERE id = ?`, args: [...vals, id]});
  }
  await syncDeliverableMembers(db, id, fields);
  return dbGetDeliverable(db, id);
}

async function syncDeliverableMembers(db: any, deliverableId: string, fields: any) {
  if (fields["Assigned Team Members"] !== undefined) {
    await db.execute({sql: "DELETE FROM deliverable_team_members WHERE deliverable_id = ?", args: [deliverableId]});
    for (const memberId of (fields["Assigned Team Members"] as string[] || [])) {
      await db.execute({sql: "INSERT OR IGNORE INTO deliverable_team_members (deliverable_id, team_member_id) VALUES (?, ?)", args: [deliverableId, memberId]});
    }
  }
}

export async function dbDeleteDeliverable(db: any, id: string) {
  await db.execute({sql: "DELETE FROM deliverables WHERE id = ?", args: [id]});
}

// ─── Open Items ───────────────────────────────────────────────────────────────

async function buildOpenItemRecord(db: any, r: any) {
  const assigned = (await db.execute({sql: "SELECT team_member_id, role FROM open_item_assigned WHERE open_item_id = ?", args: [r.id]})).rows;
  const assignedTo: string[] = [];
  const producer: string[] = [];
  for (const a of (assigned || [])) {
    if (a.role === "producer") producer.push(a.team_member_id);
    else assignedTo.push(a.team_member_id);
  }
  let aiSummary = null;
  if (r.ai_summary) {
    try { aiSummary = JSON.parse(r.ai_summary); } catch { aiSummary = { state: "ready", value: r.ai_summary }; }
  }
  return toAirtable(r.id, {
    "Open Item Name": r.name,
    "Client": r.client_id ? [r.client_id] : [],
    "Notes": r.notes,
    "Status": r.status || "Not Started",
    "Begin Date": r.begin_date,
    "Due Date": r.due_date,
    "Completion Date": r.completion_date,
    "Open Item Type": r.type,
    "Priority": r.priority,
    "Priority (AI Suggested)": r.ai_priority,
    "Reviewed by AI (Summary of Notes)": aiSummary,
    "Assigned To": assignedTo,
    "Producer": producer,
    "Created At": r.created_at,
    "Recurring": r.recurring === 1,
    "Recurrence Rate": r.recurrence_rate || null,
  });
}

export async function dbGetOpenItems(db: any) {
  const rows = (await db.execute({sql: "SELECT * FROM open_items ORDER BY due_date ASC NULLS LAST", args: []})).rows;
  if (rows.length === 0) return [];

  // Bulk load all assignments in one query
  const assignedRows = (await db.execute({sql: "SELECT open_item_id, team_member_id, role FROM open_item_assigned", args: []})).rows;
  const assignedByItem = new Map<string, { team_member_id: string; role: string }[]>();
  for (const a of assignedRows) {
    if (!assignedByItem.has(a.open_item_id)) assignedByItem.set(a.open_item_id, []);
    assignedByItem.get(a.open_item_id)!.push(a);
  }

  return rows.map((r: any) => {
    const assigned = assignedByItem.get(r.id) || [];
    const assignedTo: string[] = [];
    const producer: string[] = [];
    for (const a of assigned) {
      if (a.role === "producer") producer.push(a.team_member_id);
      else assignedTo.push(a.team_member_id);
    }
    let aiSummary = null;
    if (r.ai_summary) {
      try { aiSummary = JSON.parse(r.ai_summary); } catch { aiSummary = { state: "ready", value: r.ai_summary }; }
    }
    return toAirtable(r.id, {
      "Open Item Name": r.name,
      "Client": r.client_id ? [r.client_id] : [],
      "Notes": r.notes,
      "Status": r.status || "Not Started",
      "Begin Date": r.begin_date,
      "Due Date": r.due_date,
      "Completion Date": r.completion_date,
      "Open Item Type": r.type,
      "Priority": r.priority,
      "Priority (AI Suggested)": r.ai_priority,
      "Reviewed by AI (Summary of Notes)": aiSummary,
      "Assigned To": assignedTo,
      "Producer": producer,
      "Created At": r.created_at,
      "Recurring": r.recurring === 1,
      "Recurrence Rate": r.recurrence_rate || null,
    });
  });
}

export async function dbGetOpenItem(db: any, id: string) {
  const r = (await db.execute({sql: "SELECT * FROM open_items WHERE id = ?", args: [id]})).rows[0] ?? null;
  if (!r) throw new Error(`Open item ${id} not found`);
  return buildOpenItemRecord(db, r);
}

export async function dbCreateOpenItem(db: any, id: string, fields: any) {
  await db.execute({sql: `INSERT INTO open_items (id, name, client_id, notes, status, begin_date, due_date, completion_date, type, priority, ai_priority, ai_summary, recurring, recurrence_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, fields["Open Item Name"], fields["Client"]?.[0] || null,
    fields["Notes"] || null, fields["Status"] || "Not Started",
    fields["Begin Date"] || null, fields["Due Date"] || null, fields["Completion Date"] || null,
    fields["Open Item Type"] || null, fields["Priority"] || null,
    fields["Priority (AI Suggested)"] || null,
    fields["Reviewed by AI (Summary of Notes)"] ? JSON.stringify(fields["Reviewed by AI (Summary of Notes)"]) : null,
    fields["Recurring"] ? 1 : 0, fields["Recurrence Rate"] || null]});
  await syncOpenItemAssigned(db, id, fields);
  return dbGetOpenItem(db, id);
}

export async function dbUpdateOpenItem(db: any, id: string, fields: any) {
  const colMap: Record<string, string> = {
    "Open Item Name": "name", "Notes": "notes", "Status": "status",
    "Begin Date": "begin_date", "Due Date": "due_date", "Completion Date": "completion_date",
    "Open Item Type": "type", "Priority": "priority", "Priority (AI Suggested)": "ai_priority",
    "Recurrence Rate": "recurrence_rate",
  };
  const updates: string[] = ["updated_at = datetime('now')"];
  const vals: any[] = [];
  if (fields["Client"] !== undefined) { updates.push("client_id = ?"); vals.push(fields["Client"]?.[0] || null); }
  for (const [field, col] of Object.entries(colMap)) {
    if (fields[field] !== undefined) { updates.push(`${col} = ?`); vals.push(fields[field]); }
  }
  if (fields["Reviewed by AI (Summary of Notes)"] !== undefined) {
    updates.push("ai_summary = ?");
    vals.push(fields["Reviewed by AI (Summary of Notes)"] ? JSON.stringify(fields["Reviewed by AI (Summary of Notes)"]) : null);
  }
  if (fields["Recurring"] !== undefined) {
    updates.push("recurring = ?"); vals.push(fields["Recurring"] ? 1 : 0);
  }
  if (updates.length > 1) {
    await db.execute({sql: `UPDATE open_items SET ${updates.join(", ")} WHERE id = ?`, args: [...vals, id]});
  }
  await syncOpenItemAssigned(db, id, fields);
  return dbGetOpenItem(db, id);
}

async function syncOpenItemAssigned(db: any, itemId: string, fields: any) {
  const roleMap: Record<string, string> = { "Assigned To": "assigned", "Producer": "producer" };
  for (const [field, role] of Object.entries(roleMap)) {
    if (fields[field] !== undefined) {
      await db.execute({sql: "DELETE FROM open_item_assigned WHERE open_item_id = ? AND role = ?", args: [itemId, role]});
      for (const memberId of (fields[field] as string[] || [])) {
        await db.execute({sql: "INSERT OR IGNORE INTO open_item_assigned (open_item_id, team_member_id, role) VALUES (?, ?, ?)", args: [itemId, memberId, role]});
      }
    }
  }
}

export async function dbDeleteOpenItem(db: any, id: string) {
  await db.execute({sql: "DELETE FROM open_items WHERE id = ?", args: [id]});
}

// ─── ID generation ────────────────────────────────────────────────────────────

export function newId(prefix = "rec"): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  const arr = new Uint8Array(14);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}
