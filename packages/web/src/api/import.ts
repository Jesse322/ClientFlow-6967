/**
 * Bulk import helpers for OpCo onboarding.
 * Handles clients, team members, open items, and deliverables.
 */

import type { Client } from "@libsql/client";
import { newId } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportRow {
  [key: string]: string | number | null | undefined;
}

export interface ImportWarning {
  sheet: string;
  row: number;
  message: string;
}

export interface ImportPayload {
  clients: ImportRow[];
  teamMembers: ImportRow[];
  openItems: ImportRow[];
  deliverables: ImportRow[];
}

export interface ImportResult {
  imported: {
    clients: number;
    teamMembers: number;
    openItems: number;
    deliverables: number;
  };
  warnings: ImportWarning[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validatePayload(payload: ImportPayload): ImportWarning[] {
  const warnings: ImportWarning[] = [];

  payload.clients.forEach((row, i) => {
    if (!row["Client Name"] || String(row["Client Name"]).trim() === "") {
      warnings.push({ sheet: "Clients", row: i + 2, message: "Missing required field: Client Name" });
    }
  });

  payload.teamMembers.forEach((row, i) => {
    if (!row["Full Name"] || String(row["Full Name"]).trim() === "") {
      warnings.push({ sheet: "Team Members", row: i + 2, message: "Missing required field: Full Name" });
    }
  });

  payload.openItems.forEach((row, i) => {
    if (!row["Open Item Name"] || String(row["Open Item Name"]).trim() === "") {
      warnings.push({ sheet: "Open Items", row: i + 2, message: "Missing required field: Open Item Name" });
    }
  });

  payload.deliverables.forEach((row, i) => {
    if (!row["Deliverable Name"] || String(row["Deliverable Name"]).trim() === "") {
      warnings.push({ sheet: "Deliverables", row: i + 2, message: "Missing required field: Deliverable Name" });
    }
  });

  return warnings;
}

// ─── Bulk Insert ──────────────────────────────────────────────────────────────

export async function runImport(db: Client, payload: ImportPayload): Promise<ImportResult> {
  const warnings = validatePayload(payload);
  const result = { clients: 0, teamMembers: 0, openItems: 0, deliverables: 0 };

  // Build name→id maps for cross-sheet linking
  const clientNameToId: Record<string, string> = {};
  const memberNameToId: Record<string, string> = {};

  // ── Team Members ──
  for (const row of payload.teamMembers) {
    const name = String(row["Full Name"] || "").trim();
    if (!name) continue;
    const id = newId();
    try {
      await db.execute({
        sql: "INSERT INTO team_members (id, full_name, role, active, phone) VALUES (?, ?, ?, 1, ?)",
        args: [id, name, row["Role"] ? String(row["Role"]).trim() : null, row["Phone"] ? String(row["Phone"]).trim() : null],
      });

      if (row["Email"] && String(row["Email"]).trim()) {
        await db.execute({
          sql: "INSERT OR REPLACE INTO team_member_emails (airtable_id, email, updated_at) VALUES (?, ?, unixepoch())",
          args: [id, String(row["Email"]).trim()],
        });
      }
      memberNameToId[name.toLowerCase()] = id;
      result.teamMembers++;
    } catch (e) {
      warnings.push({ sheet: "Team Members", row: result.teamMembers + 2, message: `Insert failed: ${(e as any).message}` });
    }
  }

  // ── Clients ──
  for (const row of payload.clients) {
    const name = String(row["Client Name"] || "").trim();
    if (!name) continue;
    const id = newId();
    const medArr = row["Medical Carrier/TPA"]
      ? String(row["Medical Carrier/TPA"]).split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const ancArr = row["Ancillary Carrier"]
      ? String(row["Ancillary Carrier"]).split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    try {
      await db.execute({
        sql: `INSERT INTO clients (id, name, renewal_date, active, revenue, funding_strategy, company_size,
          medical_carrier, ancillary_carrier, location, intake_notes, rxdc_complete, date_added)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, name,
          row["Renewal Date"] ? String(row["Renewal Date"]).trim() : null,
          row["Revenue"] ? Number(row["Revenue"]) : null,
          row["Funding Strategy"] ? String(row["Funding Strategy"]).trim() : null,
          row["Company Size"] ? String(row["Company Size"]).trim() : null,
          medArr.length ? JSON.stringify(medArr) : null,
          ancArr.length ? JSON.stringify(ancArr) : null,
          row["Location"] ? String(row["Location"]).trim() : null,
          row["Intake Notes"] ? String(row["Intake Notes"]).trim() : null,
          row["RxDC Complete"] ? String(row["RxDC Complete"]).trim() : null,
          new Date().toISOString().split("T")[0],
        ],
      });
      clientNameToId[name.toLowerCase()] = id;
      result.clients++;
    } catch (e) {
      warnings.push({ sheet: "Clients", row: result.clients + 2, message: `Insert failed: ${(e as any).message}` });
    }
  }

  // ── Open Items ──
  for (const row of payload.openItems) {
    const name = String(row["Open Item Name"] || "").trim();
    if (!name) continue;
    const id = newId();
    const clientName = row["Client Name"] ? String(row["Client Name"]).trim().toLowerCase() : null;
    const clientId = clientName ? (clientNameToId[clientName] || null) : null;

    try {
      await db.execute({
        sql: `INSERT INTO open_items (id, name, client_id, notes, status, begin_date, due_date, type, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, name, clientId,
          row["Notes"] ? String(row["Notes"]).trim() : null,
          row["Status"] ? String(row["Status"]).trim() : "Not Started",
          row["Begin Date"] ? String(row["Begin Date"]).trim() : null,
          row["Due Date"] ? String(row["Due Date"]).trim() : null,
          row["Type"] ? String(row["Type"]).trim() : null,
          row["Priority"] ? String(row["Priority"]).trim() : null,
        ],
      });
      result.openItems++;
    } catch (e) {
      warnings.push({ sheet: "Open Items", row: result.openItems + 2, message: `Insert failed: ${(e as any).message}` });
    }
  }

  // ── Deliverables ──
  for (const row of payload.deliverables) {
    const name = String(row["Deliverable Name"] || "").trim();
    if (!name) continue;
    const id = newId();
    const clientName = row["Client Name"] ? String(row["Client Name"]).trim().toLowerCase() : null;
    const clientId = clientName ? (clientNameToId[clientName] || null) : null;

    try {
      await db.execute({
        sql: `INSERT INTO deliverables (id, name, client_id, type, deadline, status, notes, renewal_phase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, name, clientId,
          row["Type"] ? String(row["Type"]).trim() : null,
          row["Deadline"] ? String(row["Deadline"]).trim() : null,
          row["Status"] ? String(row["Status"]).trim() : "Not Started",
          row["Notes"] ? String(row["Notes"]).trim() : null,
          row["Renewal Phase"] ? String(row["Renewal Phase"]).trim() : null,
        ],
      });
      result.deliverables++;
    } catch (e) {
      warnings.push({ sheet: "Deliverables", row: result.deliverables + 2, message: `Insert failed: ${(e as any).message}` });
    }
  }

  return { imported: result, warnings };
}
