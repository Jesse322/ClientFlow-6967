/**
 * Notification email builders and send helpers.
 * All email sending is fire-and-forget — never throw to callers.
 */

const SITE_URL = "https://usiclienttracker.runable.site";

// ─── Email styles (shared) ──────────────────────────────────────────────────

const BASE_STYLES = `
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:32px 16px}
.wrap{max-width:560px;margin:0 auto}
.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:32px;margin-bottom:16px}
h1{font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px}
h2{font-size:15px;font-weight:600;color:#0f172a;margin:0 0 12px}
.sub{font-size:13px;color:#94a3b8;margin:0 0 24px}
p{font-size:14px;color:#64748b;line-height:1.6;margin:0 0 12px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.3px}
.badge-blue{background:#dbeafe;color:#1d4ed8}
.badge-green{background:#dcfce7;color:#166534}
.badge-orange{background:#ffedd5;color:#c2410c}
.badge-red{background:#fee2e2;color:#991b1b}
.badge-slate{background:#f1f5f9;color:#475569}
.badge-purple{background:#ede9fe;color:#6d28d9}
.item{border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:8px}
.item-title{font-size:14px;font-weight:600;color:#0f172a;margin:0 0 4px}
.item-meta{font-size:12px;color:#94a3b8;margin:0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.item-urgent{border-color:#fecaca;background:#fff5f5}
.item-warn{border-color:#fed7aa;background:#fff7ed}
.divider{height:1px;background:#f1f5f9;margin:20px 0}
.btn{display:inline-block;background:#0ea5e9;color:#fff!important;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600}
.footer{font-size:11px;color:#94a3b8;text-align:center;padding-top:12px}
.change-row{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f8fafc}
.change-label{font-size:12px;color:#94a3b8;min-width:80px;padding-top:2px}
.change-val{font-size:13px;color:#0f172a;font-weight:500}
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    "Not Started": "badge-slate",
    "In Progress": "badge-blue",
    "Stuck": "badge-orange",
    "Closed": "badge-green",
    "Completed": "badge-green",
    "Overdue": "badge-red",
  };
  return `<span class="badge ${map[status] || "badge-slate"}">${status || "—"}</span>`;
}

function typeBadge(type: string): string {
  return type ? `<span class="badge badge-purple">${type}</span>` : "";
}

function fmtDate(d?: string): string {
  if (!d) return "—";
  const dt = new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(d?: string): number | null {
  if (!d) return null;
  const diff = new Date(d + "T12:00:00Z").getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function urgencyLabel(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `<span style="color:#dc2626;font-weight:600">${Math.abs(days)}d overdue</span>`;
  if (days === 0) return `<span style="color:#dc2626;font-weight:600">Due today</span>`;
  if (days <= 3) return `<span style="color:#ea580c;font-weight:600">Due in ${days}d</span>`;
  if (days <= 7) return `<span style="color:#d97706;font-weight:600">Due in ${days}d</span>`;
  return `<span style="color:#64748b">Due in ${days}d</span>`;
}

function wrap(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body><div class="wrap">${body}<div class="footer"><p>ClientFlow · <a href="${SITE_URL}" style="color:#0ea5e9">Open Dashboard</a></p></div></div></body></html>`;
}

// ─── Send helper ─────────────────────────────────────────────────────────────

export async function sendNotificationEmail(
  runableUrl: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  try {
    if (!runableUrl) {
      console.error(`[email] RUNABLE_URL not set — cannot send to ${to}: "${subject}"`);
      return;
    }
    const { sendEmail } = await import("@runablehq/website-runtime/server");
    await sendEmail({ url: runableUrl, to, subject, html });
  } catch (e: any) {
    console.error(`[email] Failed to send to ${to}: ${e.message}`);
  }
}

// ─── Change notification ─────────────────────────────────────────────────────

export interface ChangeNotificationPayload {
  entityType: "open_item" | "deliverable";
  entityName: string;
  clientName?: string;
  changeType: "created" | "status_changed" | "note_added";
  changedBy?: string;
  oldValue?: string;
  newValue?: string;
  noteText?: string;
  currentStatus?: string;
  currentType?: string;
  dueDate?: string;
  deadlineDate?: string;
}

export function buildChangeNotificationEmail(payload: ChangeNotificationPayload): { subject: string; html: string } {
  const { entityType, entityName, clientName, changeType, changedBy, oldValue, newValue, noteText, currentStatus, currentType, dueDate, deadlineDate } = payload;

  const entityLabel = entityType === "open_item" ? "Open Item" : "Deliverable";
  const entityPath = entityType === "open_item" ? "open-items" : "deliverables";

  const subjectMap = {
    created: `New ${entityLabel}: ${entityName}`,
    status_changed: `Status Update: ${entityName} → ${newValue}`,
    note_added: `New Note on: ${entityName}`,
  };

  const subject = subjectMap[changeType];

  const changeSection = () => {
    if (changeType === "created") {
      return `<p style="color:#166534;background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px">
        ✨ New ${entityLabel.toLowerCase()} created${clientName ? ` for <strong>${clientName}</strong>` : ""}
      </p>`;
    }
    if (changeType === "status_changed") {
      return `<div class="change-row">
        <span class="change-label">Status</span>
        <span class="change-val">${statusBadge(oldValue || "")} → ${statusBadge(newValue || "")}</span>
      </div>`;
    }
    if (changeType === "note_added") {
      return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px;font-size:13px;color:#0f172a;margin-bottom:8px;white-space:pre-wrap">${noteText || ""}</div>`;
    }
    return "";
  };

  const dateField = entityType === "open_item" ? dueDate : deadlineDate;
  const dateLabel = entityType === "open_item" ? "Due" : "Deadline";
  const days = daysUntil(dateField);

  const html = wrap(`
    <div class="card">
      <h1>${entityName}</h1>
      <p class="sub">${entityLabel}${clientName ? ` · ${clientName}` : ""}</p>

      ${changeSection()}

      <div class="divider"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${currentStatus ? statusBadge(currentStatus) : ""}
        ${currentType ? typeBadge(currentType) : ""}
        ${dateField ? `<span class="badge badge-slate">${dateLabel}: ${fmtDate(dateField)}</span>` : ""}
      </div>

      ${days !== null ? `<p style="margin-bottom:16px">${urgencyLabel(days)}</p>` : ""}

      ${changedBy ? `<p style="font-size:12px;color:#94a3b8;margin-bottom:16px">Updated by ${changedBy}</p>` : ""}

      <a href="${SITE_URL}/${entityPath}" class="btn">View in Dashboard →</a>
    </div>
  `);

  return { subject, html };
}

// ─── Daily digest ─────────────────────────────────────────────────────────────

export interface DigestItem {
  name: string;
  clientName?: string;
  status?: string;
  type?: string;
  date?: string; // ISO date
  days?: number | null;
  entityType: "open_item" | "deliverable";
}

export interface DigestPayload {
  recipientName: string;
  overdueDeliverables: DigestItem[];
  dueSoonDeliverables: DigestItem[]; // within 7 days
  dueThisWeekOpenItems: DigestItem[];
  stuckOpenItems: DigestItem[];
}

export function buildDailyDigestEmail(payload: DigestPayload): { subject: string; html: string } {
  const { recipientName, overdueDeliverables, dueSoonDeliverables, dueThisWeekOpenItems } = payload;

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalUrgent = overdueDeliverables.length + dueSoonDeliverables.length + dueThisWeekOpenItems.length;

  const subject = totalUrgent === 0
    ? `✅ All clear — ClientFlow Daily Digest`
    : `🔔 ${totalUrgent} item${totalUrgent !== 1 ? "s" : ""} need attention — ClientFlow`;

  const renderItems = (items: DigestItem[], urgentClass: string): string => {
    if (items.length === 0) return `<p style="color:#94a3b8;font-size:13px;font-style:italic">None</p>`;
    return items.map((item) => {
      const days = item.days !== undefined ? item.days : daysUntil(item.date);
      return `<div class="item ${urgentClass}">
        <p class="item-title">${item.name}</p>
        <p class="item-meta">
          ${item.clientName ? `<span>${item.clientName}</span>` : ""}
          ${item.status ? statusBadge(item.status) : ""}
          ${item.type ? typeBadge(item.type) : ""}
          ${urgencyLabel(days)}
        </p>
      </div>`;
    }).join("");
  };

  const sections: string[] = [];

  if (overdueDeliverables.length > 0) {
    sections.push(`
      <div class="card">
        <h2>🚨 Overdue Deliverables (${overdueDeliverables.length})</h2>
        ${renderItems(overdueDeliverables, "item-urgent")}
      </div>
    `);
  }

  if (dueSoonDeliverables.length > 0) {
    sections.push(`
      <div class="card">
        <h2>⏰ Deliverables Due This Week (${dueSoonDeliverables.length})</h2>
        ${renderItems(dueSoonDeliverables, "item-warn")}
      </div>
    `);
  }

  if (dueThisWeekOpenItems.length > 0) {
    sections.push(`
      <div class="card">
        <h2>📋 Open Items Due This Week (${dueThisWeekOpenItems.length})</h2>
        ${renderItems(dueThisWeekOpenItems, "item-warn")}
      </div>
    `);
  }

  if (sections.length === 0) {
    sections.push(`
      <div class="card" style="text-align:center;padding:40px 32px">
        <p style="font-size:32px;margin:0 0 12px">✅</p>
        <h2 style="margin-bottom:8px">All clear!</h2>
        <p style="color:#94a3b8;margin:0">No overdue items or upcoming deadlines today.</p>
      </div>
    `);
  }

  const html = wrap(`
    <div class="card" style="background:linear-gradient(135deg,#0ea5e9,#0284c7);border:none;padding:28px 32px">
      <p style="font-size:12px;color:rgba(255,255,255,.7);margin:0 0 4px;text-transform:uppercase;letter-spacing:.5px">Daily Digest · ${today}</p>
      <h1 style="color:#fff;margin:0 0 4px;font-size:22px">Good morning, ${recipientName.split(" ")[0]}!</h1>
      <p style="color:rgba(255,255,255,.8);font-size:14px;margin:0">
        ${totalUrgent === 0 ? "Everything's on track today." : `You have ${totalUrgent} item${totalUrgent !== 1 ? "s" : ""} needing attention.`}
      </p>
    </div>
    ${sections.join("")}
    <div style="text-align:center;padding:8px 0">
      <a href="${SITE_URL}" class="btn">Open Dashboard</a>
    </div>
  `);

  return { subject, html };
}
