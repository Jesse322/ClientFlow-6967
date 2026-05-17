/**
 * Cloudflare Worker scheduled handler — runs daily digest at 8 AM PT (16:00 UTC).
 * Registered as the `scheduled` export in index.ts.
 *
 * Logic:
 * 1. Load all team members, deliverables, and open items from D1
 * 2. For each team member with a valid email + notifications enabled:
 *    - Find deliverables assigned to them that are overdue or due ≤7 days
 *    - Find open items assigned to them that are due ≤7 days
 *    - Send digest if there's anything to show (or always if they opted in to "always send")
 * 3. Spawn new instances of recurring open items that are due
 */

import { getDb, dbGetTeamMembers, dbGetDeliverables, dbGetOpenItems, dbGetClients, dbCreateOpenItem, newId } from "./db";
import { buildDailyDigestEmail, sendNotificationEmail, type DigestItem } from "./notifications";

type Env = {
  RUNABLE_URL?: string;
  [key: string]: unknown;
};

function daysUntil(d?: string): number | null {
  if (!d) return null;
  const diff = new Date(d + "T12:00:00Z").getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

/** Advance a YYYY-MM-DD date by one recurrence period */
function nextDueDate(dueDateStr: string, rate: string): string {
  const d = new Date(dueDateStr + "T12:00:00Z");
  switch (rate) {
    case "Daily":       d.setUTCDate(d.getUTCDate() + 1); break;
    case "Weekly":      d.setUTCDate(d.getUTCDate() + 7); break;
    case "Bi-Weekly":   d.setUTCDate(d.getUTCDate() + 14); break;
    case "Monthly":     d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "Quarterly":   d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "Semi-Annual": d.setUTCMonth(d.getUTCMonth() + 6); break;
    case "Annual":      d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:            d.setUTCMonth(d.getUTCMonth() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

/** Number of whole days between two YYYY-MM-DD strings (b - a) */
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + "T12:00:00Z").getTime();
  const tb = new Date(b + "T12:00:00Z").getTime();
  return Math.round((tb - ta) / 86400000);
}

/** Offset a YYYY-MM-DD date by N days */
function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Spawns new open items for any recurring items that have been closed/completed
 * and whose next recurrence date is today or in the past.
 */
export async function runRecurringOpenItems(env: Env): Promise<void> {
  const db = getDb();

  try {
    const openItems = await dbGetOpenItems(db);
    const today = new Date().toISOString().slice(0, 10);
    let spawnedCount = 0;

    for (const item of openItems) {
      const f = item.fields;

      // Only process recurring items that are closed/completed
      if (!f["Recurring"]) continue;
      if (!f["Recurrence Rate"]) continue;
      const status = f["Status"];
      if (status !== "Closed" && status !== "Completed") continue;

      const dueDate = f["Due Date"];
      if (!dueDate) continue;

      const beginDate: string | undefined = f["Begin Date"];
      const rate = f["Recurrence Rate"];

      // Compute next begin + due dates, preserving the begin→due offset
      let newBegin: string | null = null;
      let newDue: string;
      if (beginDate) {
        newBegin = nextDueDate(beginDate, rate);
        const offset = daysBetween(beginDate, dueDate); // e.g. 6 days for 1/1→1/7
        newDue = offsetDate(newBegin, offset);
      } else {
        // No begin date — fall back to just advancing the due date
        newDue = nextDueDate(dueDate, rate);
      }

      // Spawn the day BEFORE the new begin date (or on newDue if no begin)
      const spawnOn = newBegin ? offsetDate(newBegin, -1) : newDue;

      // Not yet time to spawn
      if (today < spawnOn) continue;

      // Check if an open (non-closed) copy already exists for this item + next period
      // Match by same name + client + due date to avoid duplicates
      const alreadyExists = openItems.some((other) => {
        if (other.id === item.id) return false;
        return (
          other.fields["Open Item Name"] === f["Open Item Name"] &&
          other.fields["Due Date"] === newDue &&
          (other.fields["Client"]?.[0] || null) === (f["Client"]?.[0] || null) &&
          other.fields["Status"] !== "Closed" &&
          other.fields["Status"] !== "Completed"
        );
      });

      if (alreadyExists) continue;

      // Spawn the new item — clone everything except status/notes
      const newFields: any = {
        "Open Item Name": f["Open Item Name"],
        "Client": f["Client"],
        "Status": "Not Started",
        "Due Date": newDue,
        ...(newBegin ? { "Begin Date": newBegin } : {}),
        "Open Item Type": f["Open Item Type"] || null,
        "Priority": f["Priority"] || null,
        "Assigned To": f["Assigned To"] || [],
        "Producer": f["Producer"] || [],
        "Recurring": true,
        "Recurrence Rate": rate,
        // Notes intentionally blank — fresh item
      };

      const id = newId("rec");
      await dbCreateOpenItem(db, id, newFields);
      spawnedCount++;
      console.log(`[recurring] Spawned "${f["Open Item Name"]}" → begin=${newBegin ?? "n/a"} due=${newDue} (from ${item.id})`);
    }

    if (spawnedCount > 0) {
      console.log(`[recurring] Spawned ${spawnedCount} new recurring open item(s)`);
    }
  } catch (e: any) {
    console.error("[recurring] Error processing recurring items:", e);
  }
}

export async function runDailyDigest(env: Env): Promise<void> {
  const runableUrl = env.RUNABLE_URL;
  if (!runableUrl) { console.error("[digest] RUNABLE_URL not set, skipping digest"); return; }

  const db = getDb();
  if (!db) { console.error("[digest] DB not bound, skipping digest"); return; }

  try {
    // Load notification settings from D1
    let settingsMap: Record<string, any> = {};
    try {
      const rows = await (db as any)
        .prepare("SELECT * FROM notification_settings")
        .all();
      for (const row of (rows.results || [])) {
        settingsMap[row.airtable_member_id] = row;
      }
    } catch {
      console.log("[digest] notification_settings table not found, skipping digest");
      return;
    }

    // Load email map from D1
    let emailMap: Record<string, string> = {};
    try {
      const emailRows = await (db as any)
        .prepare("SELECT airtable_id, email FROM team_member_emails")
        .all();
      for (const row of (emailRows.results || [])) {
        if (row.email && row.email.includes("@")) {
          emailMap[row.airtable_id] = row.email;
        }
      }
    } catch {
      console.log("[digest] team_member_emails table not found, skipping digest");
      return;
    }

    console.log(`[digest] Found ${Object.keys(emailMap).length} team members with emails`);

    // Load all data from D1
    const [members, deliverables, openItems, clients] = await Promise.all([
      dbGetTeamMembers(db),
      dbGetDeliverables(db),
      dbGetOpenItems(db),
      dbGetClients(db),
    ]);

    // Build client name map
    const clientMap: Record<string, string> = {};
    for (const c of clients) {
      clientMap[c.id] = c.fields["Client Name"] || "";
    }

    console.log(`[digest] ${members.length} members, ${deliverables.length} deliverables, ${openItems.length} open items`);

    let sentCount = 0;

    for (const member of members) {
      const memberId = member.id;
      const memberFields = member.fields;
      const settings = settingsMap[memberId];

      // Skip inactive
      if (memberFields["Active Status"] === false) continue;

      // Skip if digest is disabled for this member
      if (settings && settings.daily_digest_enabled === 0) continue;

      // Get email from D1
      const email = emailMap[memberId];
      if (!email) continue;

      const name = memberFields["Full Name"] || "Team Member";

      // Filter deliverables assigned to this member
      const myDeliverables = deliverables.filter((d: any) => {
        const assigned: string[] = d.fields["Assigned Team Members"] || [];
        return assigned.includes(memberId) && d.fields["Status"] !== "Completed";
      });

      const overdueDeliverables: DigestItem[] = [];
      const dueSoonDeliverables: DigestItem[] = [];

      for (const d of myDeliverables) {
        const days = daysUntil(d.fields["Deadline"]);
        const clientId = d.fields["Client"]?.[0];
        const item: DigestItem = {
          name: d.fields["Deliverable Name"] || "Untitled",
          clientName: clientId ? clientMap[clientId] : undefined,
          status: d.fields["Status"],
          type: d.fields["Type"],
          date: d.fields["Deadline"],
          days,
          entityType: "deliverable",
        };
        if (days !== null && days < 0) overdueDeliverables.push(item);
        else if (days !== null && days <= 7) dueSoonDeliverables.push(item);
      }

      // Filter open items assigned to this member — due within 7 days
      const myOpenItems = openItems.filter((i: any) => {
        const assigned: string[] = i.fields["Assigned To"] || [];
        return assigned.includes(memberId);
      });

      const dueThisWeekOpenItems: DigestItem[] = [];
      for (const i of myOpenItems) {
        const days = daysUntil(i.fields["Due Date"]);
        if (days !== null && days <= 7) {
          const clientId = i.fields["Client"]?.[0];
          dueThisWeekOpenItems.push({
            name: i.fields["Open Item Name"] || "Untitled",
            clientName: clientId ? clientMap[clientId] : undefined,
            status: i.fields["Status"],
            type: i.fields["Open Item Type"],
            date: i.fields["Due Date"],
            days,
            entityType: "open_item",
          });
        }
      }

      const totalItems = overdueDeliverables.length + dueSoonDeliverables.length + dueThisWeekOpenItems.length;

      // Send only if there's something, or if member opted into "always send"
      const alwaysSend = settings?.digest_always_send === 1;
      if (totalItems === 0 && !alwaysSend) continue;

      const { subject, html } = buildDailyDigestEmail({
        recipientName: name,
        overdueDeliverables,
        dueSoonDeliverables,
        dueThisWeekOpenItems,
        stuckOpenItems: [],
      });

      await sendNotificationEmail(runableUrl, email, subject, html);
      sentCount++;
      console.log(`[digest] Sent to ${email} (${totalItems} items)`);
    }

    console.log(`[digest] Complete — sent ${sentCount} digest emails`);
  } catch (e: any) {
    console.error("[digest] Daily digest error:", e);
  }
}
