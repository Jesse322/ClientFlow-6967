import { Hono } from "hono";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { authMiddleware, requireAuth } from "./middleware/authentication";
import {
  dbGetClients, dbGetClient, dbCreateClient, dbUpdateClient, dbDeleteClient,
  dbSaveOnboardingData,
  dbGetTeamMembers, dbGetTeamMember, dbCreateTeamMember, dbUpdateTeamMember, dbDeleteTeamMember,
  dbGetDeliverables, dbGetDeliverable, dbCreateDeliverable, dbUpdateDeliverable, dbDeleteDeliverable,
  dbGetOpenItems, dbGetOpenItem, dbCreateOpenItem, dbUpdateOpenItem, dbDeleteOpenItem,
  dbGetOmni, dbUpsertOmni,
  newId,
  getDb,
} from "./db";

import { cacheGet, cacheSet, invalidateTable, invalidateAll } from "./cache";
import { aiChat } from "./ai";
import { generateComplianceDeadlines } from "./compliance";
import {
  sendNotificationEmail,
  buildChangeNotificationEmail,
  type ChangeNotificationPayload,
} from "./notifications";
import { runDailyDigest, runRecurringOpenItems } from "./scheduled";
import { OMNI_SEED_DATA, OMNI_ID_MAPPING } from "./omni-seed";
import { runImport, validatePayload, type ImportPayload } from "./import";

type Bindings = {
  AI_GATEWAY_BASE_URL: string;
  AI_GATEWAY_API_KEY: string;
  BETTER_AUTH_SECRET: string;
  RUNABLE_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  POSTMARK_WEBHOOK_TOKEN: string;
  INBOUND_EMAIL: string;
  REGIONAL_API_KEY: string;
  OPCO_NAME: string;
  [key: string]: any;
};

type Variables = {
  user: any;
  session: any;
};

const SITE_URL = "https://usiclienttracker.runable.site";

const ADMIN_EMAIL = "jesse.valentine@usi.com";

function getS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}
const S3_BUCKET = process.env.S3_BUCKET!


const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath("api");

// Sync CF Worker bindings into process.env so all existing code works unchanged
app.use(async (c, next) => {
  if (c.env) Object.assign(process.env, c.env);
  await next();
});

app.use(cors({ origin: (origin) => origin ?? "*", credentials: true }));
app.use(authMiddleware);

// ─── AUTH ROUTES ────────────────────────────────────────────────────────────

app.all("/auth/*", async (c) => {
  const publicURL = process.env.WEBSITE_URL?.replace(/\/$/, "") || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
  const auth = createAuth(process.env as any, publicURL);
  return auth.handler(c.req.raw);
});

// ─── SESSION ─────────────────────────────────────────────────────────────────

app.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  return c.json({ user: { id: user.id, name: user.name, email: user.email, role: (user as any).role, airtableId: (user as any).airtableId } });
});

// ─── PROFILE: Update own avatar ──────────────────────────────────────────────

app.patch("/me/avatar", requireAuth, async (c) => {
  try {
    const user = c.get("user") as any;
    const airtableId = user?.airtableId;
    if (!airtableId) return c.json({ error: "Your account is not linked to a team member" }, 400);
    const { avatarSeed } = await c.req.json();
    if (typeof avatarSeed !== "string") return c.json({ error: "Invalid avatarSeed" }, 400);
    const updated = await dbUpdateTeamMember(getDb(), airtableId, { "Avatar Seed": avatarSeed || "" } as any);
    invalidateTable("team_members");
    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isAdmin(c: any): boolean {
  const user = c.get("user");
  return user?.email === ADMIN_EMAIL || user?.role === "admin";
}

/** Fire-and-forget: send change notification to admin + assigned member */
async function fireChangeNotification(
  env: { RUNABLE_URL?: string; DB?: any },
  payload: ChangeNotificationPayload,
  assignedAirtableId?: string
): Promise<void> {
  const resendKey = env.RUNABLE_URL;
  if (!resendKey) return;

  try {
    const { subject, html } = buildChangeNotificationEmail(payload);

    const recipients = new Set<string>();

    if (assignedAirtableId) {
      try {
        const member = await dbGetTeamMember(getDb(), assignedAirtableId).catch(() => null);
        const email = member?.fields["_email"];
        if (email && email.includes("@")) {
          try {
            const prefs = await getDb().execute({ sql: "SELECT * FROM notification_settings WHERE airtable_member_id = ?", args: [assignedAirtableId] }).then(r => r.rows[0] ?? null);
            const shouldNotify =
              !prefs ||
              (payload.changeType === "status_changed" && prefs.notify_on_status_change !== 0) ||
              (payload.changeType === "created" && prefs.notify_on_new_item !== 0) ||
              (payload.changeType === "note_added" && prefs.notify_on_note_added !== 0);
            if (shouldNotify) recipients.add(email);
          } catch { recipients.add(email); }
        }
      } catch { /* member fetch failed */ }
    }

    await Promise.all(
      [...recipients].map((to) => sendNotificationEmail(env.RUNABLE_URL!, to, subject, html))
    );
  } catch { /* non-fatal */ }
}

function getMemberAirtableId(c: any): string | null {
  const user = c.get("user");
  // Use airtableId if set, otherwise fall back to the user's internal DB id
  return (user as any)?.airtableId || user?.id || null;
}
// ─── GAMIFICATION HELPERS ────────────────────────────────────────────────────

const BADGE_THRESHOLDS: Record<string, number> = {
  first_win: 1,
  getting_started: 10,
  veteran: 50,
  legend: 100,
};

async function awardPoints(
  db: any,
  userAirtableId: string,
  action: string,
  recordId: string,
  basePoints: number,
  dueDateStr: string | undefined
): Promise<{ totalPoints: number; bonusPoints: number; newBadges: string[] }> {
  // Early-completion bonus: 50% if due date exists and today <= due date
  let bonusPoints = 0;
  if (dueDateStr) {
    const today = new Date().toISOString().slice(0, 10);
    if (today <= dueDateStr) {
      bonusPoints = Math.round(basePoints * 0.5);
    }
  }
  const totalPoints = basePoints + bonusPoints;

  await getDb().execute({
    sql: "INSERT INTO points_ledger (user_airtable_id, action, record_id, base_points, bonus_points, total_points) VALUES (?, ?, ?, ?, ?, ?)",
    args: [userAirtableId, action, recordId, basePoints, bonusPoints, totalPoints],
  });

  // Count total completions for badge evaluation
  const cntResult = await getDb().execute({
    sql: "SELECT COUNT(*) as cnt FROM points_ledger WHERE user_airtable_id = ?",
    args: [userAirtableId],
  });
  const totalCompletions = (cntResult.rows[0]?.cnt as number) ?? 0;

  const newBadges: string[] = [];
  for (const [key, threshold] of Object.entries(BADGE_THRESHOLDS)) {
    if (totalCompletions >= threshold) {
      try {
        await getDb().execute({
          sql: "INSERT OR IGNORE INTO badges (user_airtable_id, badge_key) VALUES (?, ?)",
          args: [userAirtableId, key],
        });
        // Check if it was actually inserted (IGNORE means row may already exist)
        // We'll detect new badges by querying awarded_at near now
      } catch { /* ignore */ }
    }
  }

  // Return newly-awarded badges (awarded in last 5 seconds)
  const recentBadgesResult = await getDb().execute({
    sql: "SELECT badge_key FROM badges WHERE user_airtable_id = ? AND awarded_at >= datetime('now', '-5 seconds')",
    args: [userAirtableId],
  });
  for (const b of recentBadgesResult.rows) newBadges.push(b.badge_key as string);

  return { totalPoints, bonusPoints, newBadges };
}

/** Returns set of client IDs this user is allowed to access */
async function getAllowedClientIds(c: any, db: any): Promise<Set<string> | null> {
  if (isAdmin(c)) return null; // null = all clients allowed
  const airtableId = getMemberAirtableId(c);
  if (!airtableId) return new Set();
  const clients = await dbGetClients(db);
  const allowed = new Set<string>();
  for (const client of clients) {
    const f = client.fields;
    const ids = [
      ...(f["Producer"] || []),
      ...(f["Service Lead"] || []),
      ...(f["Analyst"] || []),
      ...(f["Assigned Team Members"] || []),
    ];
    if (ids.includes(airtableId)) allowed.add(client.id);
  }
  return allowed;
}
// ─── CLIENTS ─────────────────────────────────────────────────────────────────

app.get("/clients", requireAuth, async (c) => {
  try {
    const db = getDb();
    let records = cacheGet("clients");
    if (!records) { records = await dbGetClients(db); cacheSet("clients", {}, records); }
    if (isAdmin(c)) return c.json(records);
    const airtableId = getMemberAirtableId(c);
    if (!airtableId) return c.json([]);
    return c.json(records.filter((r: any) => {
      const f = r.fields;
      return [...(f["Producer"]||[]), ...(f["Service Lead"]||[]), ...(f["Analyst"]||[]), ...(f["Assigned Team Members"]||[])].includes(airtableId);
    }));
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/clients/:id", requireAuth, async (c) => {
  try {
    const db = getDb();
    const record = await dbGetClient(db, c.req.param("id"));
    if (!isAdmin(c)) {
      const airtableId = getMemberAirtableId(c);
      const f = record.fields;
      const ids = [...(f["Producer"]||[]), ...(f["Service Lead"]||[]), ...(f["Analyst"]||[]), ...(f["Assigned Team Members"]||[])];
      if (!airtableId || !ids.includes(airtableId)) return c.json({ error: "Not authorized" }, 403);
    }
    return c.json(record);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/clients", requireAuth, async (c) => {
  try {
    const db = getDb();
    const { fields } = await c.req.json();
    if (!isAdmin(c)) {
      const actorId = getMemberAirtableId(c);
      if (actorId) {
        const existing = (fields["Assigned Team Members"] as string[]) || [];
        if (!existing.includes(actorId)) fields["Assigned Team Members"] = [...existing, actorId];
      }
    }
    const id = newId("rec");
    const record = await dbCreateClient(db, id, fields);
    invalidateTable("clients");

    // If new-to-USI onboarding, auto-spawn onboarding deliverables
    if (fields["Is Onboarding"]) {
      const ONBOARDING_DELIVERABLES = [
        // Setup tasks
        { name: "Internal Huddle with Producer",          notes: "Discuss client expectations, promises, and next steps with Producer." },
        { name: "New Client BP Entry Support Request",    notes: "Submit to BP Data Entry Team to add new plans to BenefitPoint." },
        { name: "Analyst Assignment Request",             notes: "Submit once all carrier documents are saved to ImageRight." },
        { name: "BenefitPoint Client Setup",              notes: "Add client to BenefitPoint and confirm all basic client info is added." },
        { name: "Distribute New Client Welcome Kit",      notes: "Send Welcome Kit to client once set up in BenefitPoint." },
        { name: "CED Annual Setup",                       notes: "Configure CED for this client and confirm medical setup." },
        { name: "Post-Onboarding Huddle",                 notes: "Internal check-in after initial setup is complete." },
        // Document collection
        { name: "Gather: BAA and Client Agreement",       notes: "Collect signed Business Associate Agreement and Client Agreement (if applicable)." },
        { name: "Gather: Compensation Disclosure",        notes: "Collect compensation disclosure (prior to BOR letter going to carrier and updated 60 days later)." },
        { name: "Gather: BOR Letter to Carrier",          notes: "" },
        { name: "Gather: Plan Booklets / Certificates",   notes: "Collect booklets, certificates, and insurance group applications." },
        { name: "Gather: SBC",                            notes: "Collect Summary of Benefits and Coverage." },
        { name: "Gather: Wrap SPD",                       notes: "Collect Wrap Summary Plan Description." },
        { name: "Gather: Wrap Plan Document",             notes: "" },
        { name: "Gather: Cafeteria Plan Document",        notes: "" },
        { name: "Gather: HIPAA Policies and Procedures",  notes: "" },
        { name: "Gather: Copy of Most Recent Form 5500",  notes: "Search by EIN on efast.dol.gov to verify prior filing." },
        { name: "Gather: Current Employee Census",        notes: "Age, gender, zip code, dependent status, plan participation, employment status, title, salary/bonus." },
        { name: "Gather: Carrier Contact Sheet",          notes: "" },
        { name: "Gather: Current Premium Rates and Experience Data", notes: "Rates, by-month enrollment, paid claims, large claimant reports." },
        // Value adds
        { name: "Value Add Setup: BRC (Benefit Resource Center)", notes: "Only set up once final plan details are received and in BenefitPoint/ImageRight." },
        { name: "Value Add Setup: USI Mobile App",        notes: "Complete mobile app intake form from EB Hub before setup." },
        { name: "Value Add Setup: Zywave Client Cloud",   notes: "Generate Zywave Intake Form from the EB Hub." },
      ];
      for (const d of ONBOARDING_DELIVERABLES) {
        await dbCreateDeliverable(db, newId("rec"), {
          "Deliverable Name": d.name,
          "Client": [id],
          "Type": "USI",
          "Status": "Not Started",
          "Renewal Timeline Phase": "Onboarding",
          "Notes": d.notes,
        });
      }
      invalidateTable("deliverables");
    }

    return c.json({ ...record, _onboarding: fields["Is Onboarding"] ? true : false });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/clients/:id", requireAuth, async (c) => {
  try {
    const db = getDb();
    if (!isAdmin(c)) {
      const record = await dbGetClient(db, c.req.param("id"));
      const airtableId = getMemberAirtableId(c);
      const f = record.fields;
      const ids = [...(f["Producer"]||[]), ...(f["Service Lead"]||[]), ...(f["Analyst"]||[]), ...(f["Assigned Team Members"]||[])];
      if (!airtableId || !ids.includes(airtableId)) return c.json({ error: "Not authorized" }, 403);
    }
    const { fields } = await c.req.json();
    const updated = await dbUpdateClient(db, c.req.param("id"), fields);
    invalidateTable("clients");
    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/clients/:id", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await dbDeleteClient(getDb(), c.req.param("id"));
    invalidateTable("clients");
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── ONBOARDING ───────────────────────────────────────────────────────────────

app.patch("/clients/:id/onboarding", requireAuth, async (c) => {
  try {
    const db = getDb();
    const clientId = c.req.param("id");
    const { data, bor_date } = await c.req.json();
    if (data) await dbSaveOnboardingData(db, clientId, data);
    if (bor_date !== undefined) {
      await dbUpdateClient(db, clientId, { "BOR Date": bor_date });
    }
    invalidateTable("clients");
    return c.json({ ok: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/clients/:id/complete-onboarding", requireAuth, async (c) => {
  try {
    const db = getDb();
    const clientId = c.req.param("id");
    const updated = await dbUpdateClient(db, clientId, { "Is Onboarding": false });
    invalidateTable("clients");
    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── CLIENT CUSTOMIZATION ────────────────────────────────────────────────────

// Unsplash proxy — keeps API key server-side
app.get("/unsplash/search", requireAuth, async (c) => {
  const key = (process.env as any).UNSPLASH_ACCESS_KEY;
  if (!key) return c.json({ error: "Unsplash not configured" }, 503);
  const q = c.req.query("q") || "";
  const page = c.req.query("page") || "1";
  if (!q.trim()) return c.json({ results: [], total: 0, total_pages: 0 });
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=12&page=${page}&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
    if (!res.ok) return c.json({ error: "Unsplash error" }, 502);
    const data: any = await res.json();
    const results = (data.results || []).map((p: any) => ({
      id: p.id,
      urls: { regular: p.urls.regular, small: p.urls.small, thumb: p.urls.thumb },
      description: p.description || p.alt_description || "",
      color: p.color,
      download_location: p.links?.download_location,
      user: { name: p.user?.name, link: p.user?.links?.html },
    }));
    return c.json({ results, total: data.total, total_pages: data.total_pages });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Trigger Unsplash download (required by their guidelines when a photo is selected)
app.post("/unsplash/download", requireAuth, async (c) => {
  const key = (process.env as any).UNSPLASH_ACCESS_KEY;
  if (!key) return c.json({ ok: true });
  try {
    const { download_location } = await c.req.json();
    if (download_location) {
      await fetch(download_location, { headers: { Authorization: `Client-ID ${key}` } });
    }
    return c.json({ ok: true });
  } catch { return c.json({ ok: true }); }
});

// Upload a custom header photo to R2
app.post("/clients/:id/header-photo", requireAuth, async (c) => {
  try {
    const db = getDb();
    const clientId = c.req.param("id");
    // Auth check
    if (!isAdmin(c)) {
      const record = await dbGetClient(db, clientId);
      const airtableId = getMemberAirtableId(c);
      const f = record.fields;
      const ids = [...(f["Producer"]||[]), ...(f["Service Lead"]||[]), ...(f["Analyst"]||[]), ...(f["Assigned Team Members"]||[])];
      if (!airtableId || !ids.includes(airtableId)) return c.json({ error: "Not authorized" }, 403);
    }
    if (!S3_BUCKET) return c.json({ error: "Storage not configured" }, 503);
    const s3 = getS3Client();
    const formData = await c.req.formData();
    const file = formData.get("photo") as File | null;
    if (!file) return c.json({ error: "No file" }, 400);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const key = `client-headers/${clientId}/${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: Buffer.from(arrayBuffer), ContentType: file.type || "image/jpeg" }));
    // Clear old S3 file if any
    const existing = await dbGetClient(db, clientId);
    const oldKey = existing.fields["Header Photo URL"];
    if (oldKey && existing.fields["Header Photo Source"] === "upload" && oldKey !== key) {
      try { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: oldKey })); } catch {}
    }
    await dbUpdateClient(db, clientId, {
      "Header Photo URL": key,
      "Header Photo Source": "upload",
      "Header Photo Credit": null,
    });
    invalidateTable("clients");
    return c.json({ key, url: `/api/clients/${clientId}/header-photo` });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Serve uploaded header photo from R2
app.get("/clients/:id/header-photo", requireAuth, async (c) => {
  try {
    const db = getDb();
    const clientId = c.req.param("id");
    const client = await dbGetClient(db, clientId);
    const key = client.fields["Header Photo URL"];
    if (!key || client.fields["Header Photo Source"] !== "upload") return c.json({ error: "Not found" }, 404);
    const s3 = getS3Client();
    const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    if (!obj.Body) return c.json({ error: "Not found" }, 404);
    const headers = new Headers();
    headers.set("Content-Type", obj.ContentType || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(obj.Body as any, { headers });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Delete header photo
app.delete("/clients/:id/header-photo", requireAuth, async (c) => {
  try {
    const db = getDb();
    const clientId = c.req.param("id");
    if (!isAdmin(c)) {
      const record = await dbGetClient(db, clientId);
      const airtableId = getMemberAirtableId(c);
      const f = record.fields;
      const ids = [...(f["Producer"]||[]), ...(f["Service Lead"]||[]), ...(f["Analyst"]||[]), ...(f["Assigned Team Members"]||[])];
      if (!airtableId || !ids.includes(airtableId)) return c.json({ error: "Not authorized" }, 403);
    }
    const client = await dbGetClient(db, clientId);
    if (client.fields["Header Photo Source"] === "upload" && client.fields["Header Photo URL"]) {
      try { const s3 = getS3Client(); await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: client.fields["Header Photo URL"] })); } catch {}
    }
    await dbUpdateClient(db, clientId, {
      "Header Photo URL": null,
      "Header Photo Source": null,
      "Header Photo Credit": null,
    });
    invalidateTable("clients");
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── DELIVERABLES ────────────────────────────────────────────────────────────

app.get("/deliverables", requireAuth, async (c) => {
  try {
    const db = getDb();
    let records = cacheGet("deliverables");
    if (!records) { records = await dbGetDeliverables(db); cacheSet("deliverables", {}, records); }
    if (isAdmin(c)) return c.json(records);
    const allowedClientIds = await getAllowedClientIds(c, db);
    return c.json(records.filter((r: any) => {
      const clientId = r.fields["Client"]?.[0];
      return clientId && allowedClientIds?.has(clientId);
    }));
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/deliverables", requireAuth, async (c) => {
  try {
    const db = getDb();
    const { fields } = await c.req.json();
    if (!isAdmin(c)) {
      const allowedClientIds = await getAllowedClientIds(c, db);
      if (fields["Client"]?.[0] && !allowedClientIds?.has(fields["Client"][0])) return c.json({ error: "Not authorized" }, 403);
    }
    const id = newId("rec");
    const created = await dbCreateDeliverable(db, id, fields);
    invalidateTable("deliverables");

    const clientId = fields["Client"]?.[0];
    let clientName: string | undefined;
    if (clientId) { try { clientName = (await dbGetClient(db, clientId)).fields["Client Name"]; } catch {} }
    const assignedId = fields["Assigned Team Members"]?.[0];
    const user = c.get("user");
    void fireChangeNotification(process.env as any, {
      entityType: "deliverable", entityName: fields["Deliverable Name"] || "New Deliverable", clientName,
      changeType: "created", changedBy: user?.name || user?.email,
      currentStatus: fields["Status"], currentType: fields["Type"], deadlineDate: fields["Deadline"],
    }, assignedId);

    return c.json(created);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/deliverables/:id", requireAuth, async (c) => {
  try {
    const db = getDb();
    const deliverableId = c.req.param("id");
    const oldRecord = await dbGetDeliverable(db, deliverableId);
    if (!isAdmin(c)) {
      const allowedClientIds = await getAllowedClientIds(c, db);
      const clientId = oldRecord.fields["Client"]?.[0];
      if (!clientId || !allowedClientIds?.has(clientId)) return c.json({ error: "Not authorized" }, 403);
    }
    const { fields } = await c.req.json();
    const updated = await dbUpdateDeliverable(db, deliverableId, fields);
    invalidateTable("deliverables");

    try {
      const clientId = updated.fields["Client"]?.[0];
      let clientName: string | undefined;
      if (clientId) { try { clientName = (await dbGetClient(db, clientId)).fields["Client Name"]; } catch {} }
      const assignedId = (updated.fields["Assigned Team Members"] as string[])?.[0];
      const user = c.get("user");
      const entityName = updated.fields["Deliverable Name"] as string || "Deliverable";

      if (fields["Status"] && fields["Status"] !== oldRecord.fields["Status"]) {
        void fireChangeNotification(process.env as any, {
          entityType: "deliverable", entityName, clientName, changeType: "status_changed",
          changedBy: user?.name || user?.email, oldValue: oldRecord.fields["Status"],
          newValue: fields["Status"], currentStatus: fields["Status"],
          currentType: updated.fields["Type"], deadlineDate: updated.fields["Deadline"],
        }, assignedId);

        const newStatus = fields["Status"] as string;
        if ((newStatus === "Completed" || newStatus === "Closed") && getDb()) {
          const actorId = getMemberAirtableId(c);
          if (actorId) {
            void (
              awardPoints(getDb(), actorId, "deliverable_completed", deliverableId, 25, updated.fields["Deadline"])
                .catch(() => {})
            );
          }
        }
      } else if (fields["Notes"] && fields["Notes"] !== oldRecord.fields["Notes"]) {
        const newNote = (fields["Notes"] as string).split("\n").filter(Boolean).pop() || "";
        void fireChangeNotification(process.env as any, {
          entityType: "deliverable", entityName, clientName, changeType: "note_added",
          changedBy: user?.name || user?.email, noteText: newNote,
          currentStatus: updated.fields["Status"], currentType: updated.fields["Type"],
          deadlineDate: updated.fields["Deadline"],
        }, assignedId);
      }
    } catch { /* non-fatal */ }

    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/deliverables/:id", requireAuth, async (c) => {
  try {
    if (!isAdmin(c)) {
      const db = getDb();
      const record = await dbGetDeliverable(db, c.req.param("id"));
      const allowedClientIds = await getAllowedClientIds(c, db);
      const clientId = record.fields["Client"]?.[0];
      if (!clientId || !allowedClientIds?.has(clientId)) return c.json({ error: "Not authorized" }, 403);
    }
    await dbDeleteDeliverable(getDb(), c.req.param("id"));
    invalidateTable("deliverables");
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── OPEN ITEMS ──────────────────────────────────────────────────────────────

app.get("/open-items", requireAuth, async (c) => {
  try {
    const db = getDb();
    let records = cacheGet("open_items");
    if (!records) { records = await dbGetOpenItems(db); cacheSet("open_items", {}, records); }
    if (isAdmin(c)) return c.json(records);
    const allowedClientIds = await getAllowedClientIds(c, db);
    return c.json(records.filter((r: any) => {
      const clientId = r.fields["Client"]?.[0];
      return clientId && allowedClientIds?.has(clientId);
    }));
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/open-items", requireAuth, async (c) => {
  try {
    const db = getDb();
    const { fields } = await c.req.json();
    if (!isAdmin(c)) {
      const allowedClientIds = await getAllowedClientIds(c, db);
      if (fields["Client"]?.[0] && !allowedClientIds?.has(fields["Client"][0])) return c.json({ error: "Not authorized" }, 403);
    }
    const id = newId("rec");
    const created = await dbCreateOpenItem(db, id, fields);
    invalidateTable("open_items");

    const clientId = fields["Client"]?.[0];
    let clientName: string | undefined;
    if (clientId) { try { clientName = (await dbGetClient(db, clientId)).fields["Client Name"]; } catch {} }
    const assignedId = fields["Assigned To"]?.[0];
    const user = c.get("user");
    void fireChangeNotification(process.env as any, {
      entityType: "open_item", entityName: fields["Open Item Name"] || "New Open Item", clientName,
      changeType: "created", changedBy: user?.name || user?.email,
      currentStatus: fields["Status"] || "Not Started", currentType: fields["Open Item Type"],
      dueDate: fields["Due Date"],
    }, assignedId);

    return c.json(created);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/open-items/:id", requireAuth, async (c) => {
  try {
    const db = getDb();
    const itemId = c.req.param("id");
    const oldRecord = await dbGetOpenItem(db, itemId);
    if (!isAdmin(c)) {
      const allowedClientIds = await getAllowedClientIds(c, db);
      const clientId = oldRecord.fields["Client"]?.[0];
      if (!clientId || !allowedClientIds?.has(clientId)) return c.json({ error: "Not authorized" }, 403);
    }
    const { fields } = await c.req.json();
    const updated = await dbUpdateOpenItem(db, itemId, fields);
    invalidateTable("open_items");

    try {
      const clientId = updated.fields["Client"]?.[0];
      let clientName: string | undefined;
      if (clientId) { try { clientName = (await dbGetClient(db, clientId)).fields["Client Name"]; } catch {} }
      const assignedId = (updated.fields["Assigned To"] as string[])?.[0];
      const user = c.get("user");
      const entityName = updated.fields["Open Item Name"] as string || "Open Item";

      if (fields["Status"] && fields["Status"] !== oldRecord.fields["Status"]) {
        void fireChangeNotification(process.env as any, {
          entityType: "open_item", entityName, clientName, changeType: "status_changed",
          changedBy: user?.name || user?.email, oldValue: oldRecord.fields["Status"],
          newValue: fields["Status"], currentStatus: fields["Status"],
          currentType: updated.fields["Open Item Type"], dueDate: updated.fields["Due Date"],
        }, assignedId);

        if ((fields["Status"] === "Completed" || fields["Status"] === "Closed") && getDb()) {
          const actorId = getMemberAirtableId(c);
          if (actorId) {
            void (
              awardPoints(getDb(), actorId, "open_item_completed", itemId, 10, updated.fields["Due Date"])
                .catch(() => {})
            );
          }
        }
      } else if (fields["Notes"] && fields["Notes"] !== oldRecord.fields["Notes"]) {
        const newNote = (fields["Notes"] as string).split("\n").filter(Boolean).pop() || "";
        void fireChangeNotification(process.env as any, {
          entityType: "open_item", entityName, clientName, changeType: "note_added",
          changedBy: user?.name || user?.email, noteText: newNote,
          currentStatus: updated.fields["Status"], currentType: updated.fields["Open Item Type"],
          dueDate: updated.fields["Due Date"],
        }, assignedId);
      }
    } catch { /* non-fatal */ }

    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/open-items/:id", requireAuth, async (c) => {
  try {
    if (!isAdmin(c)) {
      const db = getDb();
      const record = await dbGetOpenItem(db, c.req.param("id"));
      const allowedClientIds = await getAllowedClientIds(c, db);
      const clientId = record.fields["Client"]?.[0];
      if (!clientId || !allowedClientIds?.has(clientId)) return c.json({ error: "Not authorized" }, 403);
    }
    await dbDeleteOpenItem(getDb(), c.req.param("id"));
    invalidateTable("open_items");
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── TEAM MEMBERS ─────────────────────────────────────────────────────────────

app.get("/team-members", requireAuth, async (c) => {
  try {
    let records = cacheGet("team_members");
    if (!records) { records = await dbGetTeamMembers(getDb()); cacheSet("team_members", {}, records); }
    return c.json(records);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/team-members", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const { fields } = await c.req.json();
    const email = fields["Email"] || fields["_email"] || "";
    const id = newId("rec");
    const created = await dbCreateTeamMember(getDb(), id, fields, email || undefined);
    invalidateTable("team_members");
    return c.json(created);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/team-members/:id", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const { fields } = await c.req.json();
    const email = fields["Email"] !== undefined ? fields["Email"] : fields["_email"];
    const updated = await dbUpdateTeamMember(getDb(), c.req.param("id"), fields, email);
    invalidateTable("team_members");
    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/team-members/:id", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await dbDeleteTeamMember(getDb(), c.req.param("id"));
    invalidateTable("team_members");
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── PASSWORD RESET ──────────────────────────────────────────────────────────

app.post("/request-password-reset", async (c) => {
  try {
    const { email } = await c.req.json();
    if (!email) return c.json({ error: "Email required" }, 400);
    const user = await (await getDb().execute({sql: "SELECT id, name FROM user WHERE email = ?", args: [email.toLowerCase()]})).rows[0] ?? null;
    if (!user) return c.json({ success: true });
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await await getDb().execute({sql: "INSERT OR REPLACE INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", args: [token, `reset:${email}`, token, expiresAt, Date.now(), Date.now()]});
    const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
    const resetUrl = `${origin}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    const runableUrl = (process.env as any)?.RUNABLE_URL;
    if (runableUrl) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;background:#f8fafc;padding:40px 16px;margin:0}.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;max-width:480px;margin:0 auto;padding:40px}h1{font-size:18px;font-weight:700;color:#0f172a;margin:0 0 12px}p{font-size:14px;color:#64748b;line-height:1.6;margin:0 0 16px}.btn{display:inline-block;background:#0ea5e9;color:#fff!important;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}.note{font-size:12px;color:#94a3b8;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9}</style></head><body><div class="card"><h1>Reset your password</h1><p>Hi${user.name ? ` ${user.name}` : ""},</p><p>Click below to reset your ClientFlow password. This link expires in 1 hour.</p><a href="${resetUrl}" class="btn">Reset Password</a><div class="note"><p>If you didn't request this, ignore this email.</p></div></div></body></html>`;
      try { const { sendEmail } = await import("@runablehq/website-runtime/server"); await sendEmail({ url: runableUrl, to: email, subject: "Reset your ClientFlow password", html }); } catch {}
    }
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/confirm-password-reset", async (c) => {
  try {
    const { token, email, newPassword } = await c.req.json();
    if (!token || !email || !newPassword) return c.json({ error: "Missing fields" }, 400);
    if (newPassword.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
    const record = await (await getDb().execute({sql: "SELECT * FROM verification WHERE identifier = ? AND value = ?", args: [`reset:${email}`, token]})).rows[0] ?? null;
    if (!record) return c.json({ error: "Invalid or expired reset link." }, 400);
    if (Date.now() > record.expires_at) {
      await await getDb().execute({sql: "DELETE FROM verification WHERE identifier = ?", args: [`reset:${email}`]});
      return c.json({ error: "Reset link has expired. Please request a new one." }, 400);
    }
    const user = await (await getDb().execute({sql: "SELECT id FROM user WHERE email = ?", args: [email.toLowerCase()]})).rows[0] ?? null;
    if (!user) return c.json({ error: "User not found" }, 404);
    const { hashPassword } = await import("better-auth/crypto");
    const hashed = await hashPassword(newPassword);
    await await getDb().execute({sql: "UPDATE account SET password = ? WHERE user_id = ? AND provider_id = 'credential'", args: [hashed, user.id]});
    await await getDb().execute({sql: "DELETE FROM verification WHERE identifier = ?", args: [`reset:${email}`]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/setup-status", async (c) => {
  try {
    const row = await (await getDb().execute({sql: "SELECT COUNT(*) as count FROM user WHERE role = 'admin'", args: []})).rows[0] ?? null;
    return c.json({ needsSetup: !row || row.count === 0 });
  } catch { return c.json({ needsSetup: true }); }
});

app.post("/setup", async (c) => {
  try {
    const row = await (await getDb().execute({sql: "SELECT COUNT(*) as count FROM user WHERE role = 'admin'", args: []})).rows[0] ?? null;
    if (row && row.count > 0) return c.json({ error: "Setup already complete" }, 403);
    const { email, name, password, airtableId } = await c.req.json();
    if (!email || !password || !name) return c.json({ error: "email, name and password required" }, 400);
    const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
    const auth = createAuth(process.env as any, origin);
    const result = await auth.api.signUpEmail({ body: { email, name, password, role: "admin", airtableId: airtableId || null } });
    await await getDb().execute({sql: "UPDATE user SET role = 'admin' WHERE id = ?", args: [result.user?.id]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/admin/create-user", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const { email, name, airtableId, tempPassword } = await c.req.json();
    const auth = createAuth(process.env as any, process.env.WEBSITE_URL?.replace(/\/$/, "") || "http://localhost:4200");
    const result = await auth.api.signUpEmail({ body: { email, name, password: tempPassword, role: "member", airtableId } });
    return c.json({ success: true, userId: result.user?.id });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── ADMIN: USER MANAGEMENT ──────────────────────────────────────────────────

app.get("/admin/users", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const users = (await getDb().execute({sql: "SELECT id, name, email, role, airtable_id, created_at, email_verified FROM user ORDER BY created_at DESC", args: []})).rows;
    return c.json(users);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/admin/users/:id", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const { name, role, airtableId } = await c.req.json();
    const updates: string[] = [];
    const values: any[] = [];
    if (name !== undefined)       { updates.push("name = ?");        values.push(name); }
    if (role !== undefined)       { updates.push("role = ?");        values.push(role); }
    if (airtableId !== undefined) { updates.push("airtable_id = ?"); values.push(airtableId || null); }
    if (!updates.length) return c.json({ error: "Nothing to update" }, 400);
    updates.push("updated_at = ?"); values.push(Date.now());
    values.push(c.req.param("id"));
    await await getDb().execute({sql: `UPDATE user SET ${updates.join(", ")} WHERE id = ?`, args: [...values]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/admin/users/:id", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const currentUser = c.get("user");
    if (currentUser?.id === c.req.param("id")) return c.json({ error: "Cannot delete your own account" }, 400);
    await await getDb().execute({sql: "DELETE FROM user WHERE id = ?", args: [c.req.param("id")]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/admin/users/:id/reset-password", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const user = await (await getDb().execute({sql: "SELECT id, name, email FROM user WHERE id = ?", args: [c.req.param("id")]})).rows[0] ?? null;
    if (!user) return c.json({ error: "User not found" }, 404);
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await await getDb().execute({sql: "INSERT OR REPLACE INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", args: [token, `reset:${user.email}`, token, expiresAt, Date.now(), Date.now()]});
    const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
    const resetUrl = `${origin}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    const runableUrl = (process.env as any)?.RUNABLE_URL;
    if (runableUrl) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;background:#f8fafc;padding:40px 16px;margin:0}.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;max-width:480px;margin:0 auto;padding:40px}h1{font-size:18px;font-weight:700;color:#0f172a;margin:0 0 12px}p{font-size:14px;color:#64748b;line-height:1.6;margin:0 0 16px}.btn{display:inline-block;background:#0ea5e9;color:#fff!important;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}</style></head><body><div class="card"><h1>Reset your password</h1><p>Hi${user.name ? ` ${user.name}` : ""},</p><p>An admin has sent you a password reset link. Click below to set a new password. This link expires in 1 hour.</p><a href="${resetUrl}" class="btn">Reset Password</a></div></body></html>`;
      try { const { sendEmail } = await import("@runablehq/website-runtime/server"); await sendEmail({ url: runableUrl, to: user.email, subject: "Reset your ClientFlow password", html }); } catch {}
    }
    return c.json({ success: true, resetUrl });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});



app.get("/omni", requireAuth, async (c) => {
  try {
    return c.json(await dbGetOmni(getDb()));
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.patch("/clients/:id/omni", requireAuth, async (c) => {
  try {
    const { omniIds } = await c.req.json();
    const updated = await dbUpdateClient(getDb(), c.req.param("id"), { "OMNI Solutions": omniIds });
    return c.json(updated);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});


// ─── COMPLIANCE DEADLINES ─────────────────────────────────────────────────────

app.post("/generate-compliance-deadlines", requireAuth, async (c) => {
  try {
    const { clientId, renewalDate, fundingStrategy, companySize, overwrite } = await c.req.json();
    if (!clientId || !renewalDate) return c.json({ error: "clientId and renewalDate required" }, 400);

    const db = getDb();
    const deadlines = generateComplianceDeadlines(renewalDate, fundingStrategy || "Fully Insured", clientId, companySize || "");

    const allDelivs = await dbGetDeliverables(db);
    const clientExisting = allDelivs.filter((r: any) =>
      r.fields["Client"]?.[0] === clientId && r.fields["Renewal Timeline Phase"] === "Compliance"
    );

    if (clientExisting.length > 0 && !overwrite) {
      return c.json({ existingCount: clientExisting.length, requiresConfirm: true });
    }

    if (overwrite && clientExisting.length > 0) {
      await Promise.all(clientExisting.map((r: any) => dbDeleteDeliverable(db, r.id)));
    }

    let created = 0;
    for (const d of deadlines) {
      await dbCreateDeliverable(db, newId("rec"), {
        "Deliverable Name": d.name, "Type": d.type, "Deadline": d.deadline,
        "Renewal Timeline Phase": d.phase, "Client": [clientId], "Status": "Not Started", "Notes": d.notes,
      });
      created++;
    }
    invalidateTable("deliverables");
    return c.json({ created, deadlines });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── RENEWAL TIMELINE ────────────────────────────────────────────────────────

app.post("/generate-renewal-timeline", requireAuth, async (c) => {
  try {
    const { clientId, renewalDate, overwrite } = await c.req.json();
    if (!clientId || !renewalDate) return c.json({ error: "clientId and renewalDate required" }, 400);

    

    const db = getDb();
    // Check for existing renewal timeline deliverables
    const allDelivs = await dbGetDeliverables(db);
    const renewalPhases = ["Pre-Renewal", "Marketing", "Implementation", "Post-Renewal"];
    const clientExisting = allDelivs.filter((r: any) =>
      r.fields["Client"]?.[0] === clientId &&
      renewalPhases.includes(r.fields["Renewal Timeline Phase"])
    );

    if (clientExisting.length > 0 && !overwrite) {
      return c.json({ existingCount: clientExisting.length, requiresConfirm: true });
    }

    if (overwrite && clientExisting.length > 0) {
      await Promise.all(clientExisting.map((r: any) => dbDeleteDeliverable(db, r.id)));
    }

    const renewal = new Date(renewalDate);
    const today = new Date();
    while (renewal <= today) renewal.setFullYear(renewal.getFullYear() + 1);
    const offset = (days: number) => {
      const d = new Date(renewal); d.setDate(d.getDate() + days); return d.toISOString().split("T")[0];
    };
    const mk = (name: string, days: number, phase: string) => ({
      "Deliverable Name": name, "Deadline": offset(days),
      "Renewal Timeline Phase": phase, "Client": [clientId], "Status": "Not Started",
    });
    const items = [
      mk("Pre-Renewal Meeting",                        -140, "Pre-Renewal"),
      mk("Request Employee Census",                    -120, "Pre-Renewal"),
      mk("Receive Employee Census",                    -106, "Pre-Renewal"),
      mk("Carrier Renewals Due",                        -92, "Marketing"),
      mk("Request for Proposal Sent to Market",         -92, "Marketing"),
      mk("Proposals Received from Market",              -78, "Marketing"),
      mk("Renewal / Analysis Meeting",                  -64, "Marketing"),
      mk("Carrier / Benefit Decisions Due",             -57, "Implementation"),
      mk("Enrollment Material",                         -43, "Implementation"),
      mk("Employee Meetings",                           -43, "Implementation"),
      mk("Open Enrollment Paperwork Complete",          -29, "Implementation"),
      mk("Enrollment Complete",                         -22, "Implementation"),
      mk("Post-Renewal Meeting",                        +47, "Post-Renewal"),
      mk("Population Health Management Strategy",       +47, "Post-Renewal"),
      mk("Creditable Coverage Reminder",                +47, "Post-Renewal"),
      mk("Creditable Coverage Notification to CMS",     +59, "Post-Renewal"),
    ];
    let created = 0;
    for (const fields of items) { await dbCreateDeliverable(db, newId("rec"), fields); created++; }
    invalidateTable("deliverables");
    return c.json({ created });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── AI: FULL CHAT ───────────────────────────────────────────────────────────

app.post("/ai/chat", requireAuth, async (c) => {
  try {
    const { message, history = [], model: requestedModel } = await c.req.json();
    if (!message) return c.json({ error: "message required" }, 400);

    // Admins can request gpt-4o; everyone else gets mini
    const adminAllowed = isAdmin(c);
    const ALLOWED_MODELS: Record<string, string> = {
      "gpt-4o-mini": "gpt-4o-mini",
      "gpt-4o":      "gpt-4o",
    };
    const model = adminAllowed && requestedModel && ALLOWED_MODELS[requestedModel]
      ? ALLOWED_MODELS[requestedModel]
      : "gpt-4o-mini";

    const db = getDb();
    const allowedClientIds = await getAllowedClientIds(c, db);
    const today = new Date().toISOString().split("T")[0];

    // Load all data in parallel
    const [clientsRaw, openItemsRaw, deliverablesRaw, teamMembersRaw] = await Promise.all([
      dbGetClients(db),
      dbGetOpenItems(db),
      dbGetDeliverables(db),
      dbGetTeamMembers(db),
    ]);

    const filteredClients = allowedClientIds
      ? clientsRaw.filter((r: any) => allowedClientIds.has(r.id))
      : clientsRaw;
    const filteredItems = allowedClientIds
      ? openItemsRaw.filter((r: any) => allowedClientIds.has(r.fields["Client"]?.[0]))
      : openItemsRaw;
    const filteredDelivs = allowedClientIds
      ? deliverablesRaw.filter((r: any) => allowedClientIds.has(r.fields["Client"]?.[0]))
      : deliverablesRaw;

    // Build context strings
    const clientsList = filteredClients.map((r: any) => {
      const f = r.fields;
      const daysUntilRenewal = f["Renewal Date"]
        ? Math.ceil((new Date(f["Renewal Date"] + "T12:00:00Z").getTime() - Date.now()) / 86400000)
        : null;
      return `ID:${r.id} | Name:${f["Client Name"]} | Funding:${f["Funding Strategy"] || "N/A"} | Size:${f["Company Size"] || "N/A"} | Renewal:${f["Renewal Date"] || "N/A"}${daysUntilRenewal !== null ? ` (${daysUntilRenewal}d)` : ""} | Active:${f["Active"] ? "Yes" : "No"} | Location:${f["Location"] || "N/A"}`;
    }).join("\n");

    const openItemsList = filteredItems.map((r: any) => {
      const f = r.fields;
      const clientName = filteredClients.find((c: any) => c.id === f["Client"]?.[0])?.fields["Client Name"] || "N/A";
      const assignedName = teamMembersRaw.find((m: any) => m.id === f["Assigned To"]?.[0])?.fields["Full Name"] || "Unassigned";
      const daysUntilDue = f["Due Date"]
        ? Math.ceil((new Date(f["Due Date"] + "T12:00:00Z").getTime() - Date.now()) / 86400000)
        : null;
      return `ID:${r.id} | Name:${f["Open Item Name"]} | Client:${clientName} | Status:${f["Status"] || "Not Started"} | Priority:${f["Priority"] || "N/A"} | Type:${f["Open Item Type"] || "N/A"} | Assigned:${assignedName} | Due:${f["Due Date"] || "N/A"}${daysUntilDue !== null ? ` (${daysUntilDue}d)` : ""}`;
    }).join("\n");

    const deliverablesList = filteredDelivs.map((r: any) => {
      const f = r.fields;
      const clientName = filteredClients.find((c: any) => c.id === f["Client"]?.[0])?.fields["Client Name"] || "N/A";
      const assignedNames = (f["Assigned Team Members"] || [])
        .map((id: string) => teamMembersRaw.find((m: any) => m.id === id)?.fields["Full Name"])
        .filter(Boolean).join(", ") || "Unassigned";
      const daysUntilDeadline = f["Deadline"]
        ? Math.ceil((new Date(f["Deadline"] + "T12:00:00Z").getTime() - Date.now()) / 86400000)
        : null;
      return `ID:${r.id} | Name:${f["Deliverable Name"]} | Client:${clientName} | Status:${f["Status"] || "Not Started"} | Type:${f["Type"] || "N/A"} | Phase:${f["Renewal Timeline Phase"] || "N/A"} | Assigned:${assignedNames} | Deadline:${f["Deadline"] || "N/A"}${daysUntilDeadline !== null ? ` (${daysUntilDeadline}d)` : ""}`;
    }).join("\n");

    const teamList = teamMembersRaw
      .filter((m: any) => m.fields["Active Status"] !== false)
      .map((m: any) => {
        const f = m.fields;
        return `ID:${m.id} | Name:${f["Full Name"]} | Role:${f["Role"] || "N/A"}`;
      }).join("\n");

    const systemPrompt = `You are an AI assistant embedded in an employee benefits client management dashboard called ClientFlow. Today is ${today}.

You have full knowledge of the following live data:

=== CLIENTS (${filteredClients.length}) ===
${clientsList || "No clients"}

=== OPEN ITEMS (${filteredItems.length}) ===
${openItemsList || "No open items"}

=== DELIVERABLES (${filteredDelivs.length}) ===
${deliverablesList || "No deliverables"}

=== TEAM MEMBERS ===
${teamList || "No team members"}

=== YOUR CAPABILITIES ===
You can:
1. ANSWER questions about the data (renewals, workload, risk analysis, trends)
2. SEARCH / FILTER and return structured results
3. SUMMARIZE a client, team member, or overall status
4. SUGGEST which clients are at risk, who needs attention, etc.
5. MAKE UPDATES: update or create open items and deliverables — including bulk operations
6. MULTI-TURN: you remember the conversation history

=== IMPORTANT RULES ===
- When updating data, be precise about what you changed
- For bulk operations, confirm what you're about to do with counts
- Never make up data — only use what's in the context above
- IDs are always the exact ID strings shown in the data (e.g. recXXXXXX)
- For date calculations, today is ${today}
- Q3 = July–September, Q4 = October–December, Q1 = January–March, Q2 = April–June

=== RESPONSE FORMAT ===
Always respond with valid JSON only (no markdown, no code fences):
{
  "type": "answer" | "mutation" | "search_result" | "suggestion",
  "message": "conversational response text (use \\n for line breaks)",
  "success": true | false,
  "mutated": false,
  "actions_taken": [],
  "table": null
}

For search results, populate "table":
{
  "headers": ["Column1", "Column2", ...],
  "rows": [{ "id": "recXXX", "href": "/clients/recXXX", "cols": ["val1", "val2"] }, ...]
}
href should be "/clients/ID" for clients, "/open-items" for open items, "/deliverables" for deliverables.

For mutations (updates/creates), set "mutated": true and list each action in "actions_taken":
[{ "type": "update_open_item", "description": "Closed 'Missing enrollment forms' for Acme Corp", "count": 1 }]

Then execute the mutations by including a "mutations" array in your JSON:
"mutations": [
  { "action": "update_open_item", "id": "recXXX", "fields": { "Status": "Closed", "Completion Date": "${today}" } },
  { "action": "create_open_item", "client_name": "Exact Client Name From Data", "assigned_name": "Exact Team Member Name", "fields": { "Open Item Name": "...", "Client": ["recXXX"], "Status": "Not Started" } },
  { "action": "update_deliverable", "id": "recXXX", "fields": { "Status": "Completed", "Completion Date": "${today}" } },
  { "action": "create_deliverable", "client_name": "Exact Client Name From Data", "fields": { "Deliverable Name": "...", "Client": ["recXXX"], "Status": "Not Started" } }
]

CRITICAL for create mutations: always include "client_name" set to the EXACT client name string from the CLIENTS list above. The server will verify the ID matches this name. If they don't match, the record will be rejected. Double-check the ID by finding the client in the CLIENTS list and copying the ID exactly.

Field names for open items: "Status" (Not Started|In Progress|Stuck|Closed), "Priority" (Urgent|High|Medium|Low), "Open Item Type", "Notes", "Due Date" (YYYY-MM-DD), "Assigned To" ([memberID]), "Completion Date" (YYYY-MM-DD)
Field names for deliverables: "Status" (Not Started|In Progress|Completed), "Type", "Renewal Timeline Phase", "Notes", "Deadline" (YYYY-MM-DD), "Assigned Team Members" ([memberID, ...]), "Completion Date" (YYYY-MM-DD)`;

    // Build messages array for the AI
    const aiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      // Include conversation history
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const raw = await aiChat(process.env as any as any, aiMessages, { json: true, model });
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result: any;
    try {
      result = JSON.parse(cleaned);
    } catch {
      return c.json({
        type: "answer",
        message: raw, // fallback: return raw text
        success: true,
        mutated: false,
        actions_taken: [],
        table: null,
      });
    }

    // Execute mutations server-side
    const mutations = result.mutations || [];
    const executedActions: { type: string; description: string; count?: number }[] = [];

    // Helper: retry a D1 operation on transient network errors
    const withRetry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await fn();
        } catch (e: any) {
          const transient = e.message?.includes("Network connection lost") ||
            e.message?.includes("D1_ERROR") ||
            e.message?.includes("network") ||
            e.message?.includes("timeout");
          if (transient && attempt < 3) {
            console.warn(`[ai/chat] ${label} transient error (attempt ${attempt}), retrying…`);
            await new Promise(r => setTimeout(r, 300 * attempt));
            continue;
          }
          throw e;
        }
      }
      throw new Error("unreachable");
    };

    // Helper: verify the client ID in a mutation actually matches the declared client_name
    const verifyClientId = (m: any, allClients: any[]): { ok: boolean; correctedId?: string; error?: string } => {
      const declaredClientId = m.fields?.["Client"]?.[0];
      const declaredName = (m.client_name || "").toLowerCase().trim();
      if (!declaredClientId && !declaredName) return { ok: true }; // no client, fine

      // Find client by the declared name first
      if (declaredName) {
        const byName = allClients.find((c: any) =>
          (c.fields["Client Name"] || "").toLowerCase().trim() === declaredName
        );
        if (byName) {
          if (byName.id !== declaredClientId) {
            // AI picked wrong ID — correct it
            console.warn(`[ai/chat] Client ID mismatch: AI said "${declaredClientId}" but "${declaredName}" is "${byName.id}". Auto-correcting.`);
            return { ok: true, correctedId: byName.id };
          }
          return { ok: true };
        }
        // Partial match fallback
        const partial = allClients.find((c: any) =>
          (c.fields["Client Name"] || "").toLowerCase().includes(declaredName) ||
          declaredName.includes((c.fields["Client Name"] || "").toLowerCase())
        );
        if (partial) {
          console.warn(`[ai/chat] Client partial match: "${declaredName}" → "${partial.fields["Client Name"]}" (${partial.id})`);
          return { ok: true, correctedId: partial.id };
        }
        return { ok: false, error: `Client "${m.client_name}" not found in client list` };
      }

      // No name declared — verify the ID at least exists
      if (declaredClientId) {
        const exists = allClients.find((c: any) => c.id === declaredClientId);
        if (!exists) return { ok: false, error: `Client ID "${declaredClientId}" not found` };
      }
      return { ok: true };
    };

    for (const m of mutations) {
      try {
        if (m.action === "update_open_item" && m.id) {
          await withRetry(() => dbUpdateOpenItem(db, m.id, m.fields), "update_open_item");
          executedActions.push({ type: "update_open_item", description: m.description || `Updated open item`, count: 1 });
        } else if (m.action === "create_open_item" && m.fields?.["Open Item Name"]) {
          const check = verifyClientId(m, clientsRaw);
          if (!check.ok) {
            console.error("[ai/chat] Rejected create_open_item:", check.error);
            executedActions.push({ type: "create_open_item_error", description: `Rejected: ${check.error}`, count: 0 });
            continue;
          }
          if (check.correctedId) m.fields["Client"] = [check.correctedId];
          await withRetry(() => dbCreateOpenItem(db, newId("rec"), m.fields), "create_open_item");
          executedActions.push({ type: "create_open_item", description: m.description || `Created open item: ${m.fields["Open Item Name"]}`, count: 1 });
        } else if (m.action === "update_deliverable" && m.id) {
          await withRetry(() => dbUpdateDeliverable(db, m.id, m.fields), "update_deliverable");
          executedActions.push({ type: "update_deliverable", description: m.description || `Updated deliverable`, count: 1 });
        } else if (m.action === "create_deliverable" && m.fields?.["Deliverable Name"]) {
          const check = verifyClientId(m, clientsRaw);
          if (!check.ok) {
            console.error("[ai/chat] Rejected create_deliverable:", check.error);
            executedActions.push({ type: "create_deliverable_error", description: `Rejected: ${check.error}`, count: 0 });
            continue;
          }
          if (check.correctedId) m.fields["Client"] = [check.correctedId];
          await withRetry(() => dbCreateDeliverable(db, newId("rec"), m.fields), "create_deliverable");
          executedActions.push({ type: "create_deliverable", description: m.description || `Created deliverable: ${m.fields["Deliverable Name"]}`, count: 1 });
        }
      } catch (mutErr: any) {
        console.error("[ai/chat] mutation error:", mutErr.message, m);
      }
    }

    const hasMutations = executedActions.length > 0;

    return c.json({
      type: result.type || "answer",
      message: result.message || "Done.",
      success: result.success !== false,
      mutated: hasMutations,
      actions_taken: hasMutations ? executedActions : (result.actions_taken || []),
      table: result.table || null,
      model,
    });
  } catch (e: any) {
    console.error("[ai/chat] error:", e.message);
    const isTransient = e.message?.includes("Network connection lost") ||
      e.message?.includes("D1_ERROR") ||
      e.message?.includes("network") ||
      e.message?.includes("timeout");
    return c.json({
      error: e.message,
      retryable: isTransient,
    }, 500);
  }
});

// ─── AI: SUGGEST REASSIGNMENTS ───────────────────────────────────────────────

app.post("/ai/suggest-reassignments", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const db = getDb();

    // Gather all active team members
    const allMembers = await dbGetTeamMembers(db);
    const activeMembers = allMembers.filter((m: any) => m.fields["Active Status"] !== false);

    // Gather all open deliverables + open items (not completed/closed)
    const allDeliverables = (await dbGetDeliverables(db)).filter(
      (d: any) => d.fields["Status"] !== "Completed"
    );
    const allOpenItems = (await dbGetOpenItems(db)).filter(
      (o: any) => o.fields["Status"] !== "Closed" && o.fields["Status"] !== "Completed"
    );

    // Gather client assignments
    const allClients = await dbGetClients(db);
    const clientAssignments: Record<string, string[]> = {};
    for (const c2 of allClients) {
      clientAssignments[c2.id] = [
        ...(c2.fields["Producer"] || []),
        ...(c2.fields["Service Lead"] || []),
        ...(c2.fields["Analyst"] || []),
        ...(c2.fields["Assigned Team Members"] || []),
      ];
    }

    // Build member summaries for the prompt
    const memberSummaries = activeMembers.map((m: any) => {
      const myDel = allDeliverables.filter(
        (d: any) => (d.fields["Assigned Team Members"] || []).includes(m.id)
      );
      const myOI = allOpenItems.filter(
        (o: any) => (o.fields["Assigned To"] || []).includes(m.id)
      );
      const clientIds = [...new Set([
        ...myDel.flatMap((d: any) => d.fields["Client"] || []),
        ...myOI.flatMap((o: any) => o.fields["Client"] || []),
      ])];
      const assignedClientIds = Object.entries(clientAssignments)
        .filter(([_, ids]) => ids.includes(m.id))
        .map(([cid]) => cid);

      return {
        id: m.id,
        name: m.fields["Full Name"],
        role: m.fields["Role"],
        deliverableCount: myDel.length,
        openItemCount: myOI.length,
        totalTasks: myDel.length + myOI.length,
        assignedClientIds,
        tasks: [
          ...myDel.map((d: any) => ({
            type: "deliverable",
            id: d.id,
            name: d.fields["Deliverable Name"] || d.fields["Name"] || "Untitled",
            status: d.fields["Status"],
            deadline: d.fields["Deadline"],
            clientId: (d.fields["Client"] || [])[0],
            clientName: d.fields["Client Name"]?.[0] || "Unknown",
          })),
          ...myOI.map((o: any) => ({
            type: "open_item",
            id: o.id,
            name: o.fields["Open Item Name"] || o.fields["Name"] || "Untitled",
            status: o.fields["Status"],
            dueDate: o.fields["Due Date"],
            priority: o.fields["Priority"],
            clientId: (o.fields["Client"] || [])[0],
            clientName: o.fields["Client Name"]?.[0] || "Unknown",
          })),
        ],
      };
    });

    // Build client name map
    const clientNames: Record<string, string> = {};
    allClients.forEach((c2: any) => { clientNames[c2.id] = c2.fields["Client Name"]; });

    // Build list of valid reassignment targets (only specific roles)
    const REASSIGNABLE_ROLES = ["Account Executive", "Account Representative", "Account Manager"];
    const validTargets = activeMembers
      .filter((m: any) => REASSIGNABLE_ROLES.includes(m.fields["Role"] || ""))
      .map((m: any) => ({ id: m.id, name: m.fields["Full Name"], role: m.fields["Role"] }));

    const systemPrompt = `You are a workload optimization assistant for an insurance brokerage team.

Your job: Analyze the team's current workload and suggest task reassignments for overburdened members.

CRITICAL CONSTRAINTS:
- You may ONLY suggest reassigning tasks TO team members with these roles: Account Executive, Account Representative, or Account Manager. These are the ONLY valid targets.
- NEVER suggest reassigning tasks to: Regional Operations Directors, Producers, Compliance Specialists, Analysts, PHM Support, HR Tech Support, or any leadership/director roles. They have specialized responsibilities.
- Producers should only be involved in escalations — do NOT suggest routing regular tasks to Producers.
- You MUST only reference team members that exist in the provided data. Do NOT invent or hallucinate team member names. Every fromMemberId, toMemberId, fromMemberName, and toMemberName MUST match exactly with the provided team member data.

VALID REASSIGNMENT TARGETS (you may ONLY suggest moving tasks TO these people):
${JSON.stringify(validTargets, null, 2)}

REASSIGNMENT RULES:
1. Focus on members with the highest total task counts (deliverables + open items).
2. When suggesting who to reassign a task to, PRIORITIZE other team members who are already assigned to the SAME CLIENT and who are in the valid target list above. Same-client context is critical.
3. Only if no same-client team member from the valid target list has capacity, suggest a valid target NOT on the client but with a lighter workload.
4. Never suggest moving tasks to someone who is already overwhelmed.
5. Be specific: name the exact task, who it's currently assigned to, who should take it, and why.
6. Limit to the top 5-8 most impactful reassignment suggestions.
7. Double-check every member ID and name against the provided data before including in your response.

RESPONSE FORMAT (JSON):
{
  "suggestions": [
    {
      "taskName": "Task name",
      "taskType": "deliverable" | "open_item",
      "taskId": "record ID",
      "fromMemberId": "member ID",
      "fromMemberName": "Name",
      "toMemberId": "member ID",
      "toMemberName": "Name",
      "reason": "Short explanation (1-2 sentences)",
      "priority": "high" | "medium" | "low",
      "sameClient": true/false
    }
  ],
  "summary": "2-3 sentence overview of the team's workload situation"
}`;

    const userPrompt = `Here is the current team workload data:

TEAM MEMBERS:
${JSON.stringify(memberSummaries, null, 2)}

CLIENT ASSIGNMENTS (which team members are on which clients):
${JSON.stringify(Object.entries(clientAssignments).map(([cid, mids]) => ({
  clientId: cid,
  clientName: clientNames[cid] || "Unknown",
  teamMemberIds: mids,
})), null, 2)}

Please analyze and suggest task reassignments.`;

    const raw = await aiChat(process.env as any as any, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { json: true, model: "gpt-4o-mini" });

    // Parse JSON from response — robustly extract the first {...} block
    let result;
    try {
      // Strip markdown fences first
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      // Extract first complete JSON object in case there's surrounding text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      result = JSON.parse(cleaned);
    } catch {
      result = { suggestions: [], summary: "Could not parse AI response. Please try again." };
    }

    // Server-side validation: filter out hallucinated members and invalid targets
    const memberIds = new Set(activeMembers.map((m: any) => m.id));
    const validTargetIds = new Set(validTargets.map((t: any) => t.id));
    if (result.suggestions && Array.isArray(result.suggestions)) {
      result.suggestions = result.suggestions.filter((s: any) => {
        // Both from and to members must exist in our data
        if (!memberIds.has(s.fromMemberId)) {
          console.warn(`[ai/suggest] Filtered out suggestion: fromMember "${s.fromMemberName}" (${s.fromMemberId}) not found`);
          return false;
        }
        if (!memberIds.has(s.toMemberId)) {
          console.warn(`[ai/suggest] Filtered out suggestion: toMember "${s.toMemberName}" (${s.toMemberId}) not found`);
          return false;
        }
        // Target must be in the valid reassignment roles
        if (!validTargetIds.has(s.toMemberId)) {
          console.warn(`[ai/suggest] Filtered out suggestion: toMember "${s.toMemberName}" not in valid target roles`);
          return false;
        }
        return true;
      });
    }

    return c.json(result);
  } catch (e: any) {
    console.error("[ai/suggest-reassignments] error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ─── AI: COMPANY INTEL ───────────────────────────────────────────────────────

app.post("/ai/company-intel", requireAuth, async (c) => {
  try {
    const { companyName, industry, location } = await c.req.json();
    if (!companyName) return c.json({ error: "companyName required" }, 400);
    const context = [industry && `Industry: ${industry}`, location && `Location: ${location}`].filter(Boolean).join(", ");
    const raw = await aiChat(process.env as any as any, [
      { role: "system", content: "You are a business intelligence analyst. Generate concise, accurate company profiles. Always respond with valid JSON only, no markdown, no extra text." },
      { role: "user", content: `Generate a company profile for "${companyName}"${context ? ` (${context})` : ""}.\n\nRespond with ONLY this JSON (no markdown, no code blocks):\n{"bio":"2-3 sentence description","industry":"primary industry","headquarters":"City, State","founded":"year or Unknown","employeeEstimate":"e.g. 500-1,000","newsItems":[{"headline":"...","summary":"...","date":"Month Year"},{"headline":"...","summary":"...","date":"Month Year"},{"headline":"...","summary":"...","date":"Month Year"}]}` },
    ]);
    const cleanedIntel = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return c.json(JSON.parse(cleanedIntel));
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── SHARE ACCESS ────────────────────────────────────────────────────────────

app.post("/share-access", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const { teamMemberIds, message } = await c.req.json();
    if (!teamMemberIds?.length) return c.json({ error: "teamMemberIds required" }, 400);
    
    const db2 = getDb();
    const runableUrl = (process.env as any)?.RUNABLE_URL;
    const members = await Promise.all(teamMemberIds.map((id: string) => dbGetTeamMember(db2, id)));
    const results: { name: string; email: string; sent: boolean; error?: string }[] = [];

    for (const member of members) {
      const f = member.fields;
      const emailRaw = f["_email"] || f["Email Address"];
      const email = typeof emailRaw === "object" ? emailRaw?.value : emailRaw;
      const name = f["Full Name"] || "Team Member";
      if (!email || !email.includes("@")) {
        results.push({ name, email: email || "no email", sent: false, error: "No valid email" });
        continue;
      }

      // Generate a temp password and create their auth account
      const tempPassword = Math.random().toString(36).slice(2, 10) + "X9!";
      let accountCreated = false;
      try {
        const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
        const auth = createAuth(process.env as any, origin);
        await auth.api.signUpEmail({
          body: { email, name, password: tempPassword, role: "member", airtableId: member.id },
        });
        accountCreated = true;
      } catch {
        // Account may already exist — that's OK
        accountCreated = false;
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:40px 20px}
.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;max-width:520px;margin:0 auto;padding:40px}
.logo{width:36px;height:36px;background:#0ea5e9;border-radius:8px;display:inline-block;text-align:center;line-height:36px;margin-bottom:24px}
h1{font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px}
p{font-size:14px;color:#64748b;line-height:1.6;margin:0 0 16px}
.btn{display:inline-block;background:#0ea5e9;color:#fff!important;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;margin:8px 0 24px}
.creds{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:16px 0;font-family:monospace;font-size:13px}
.msg{background:#f0f9ff;border-left:3px solid #0ea5e9;padding:12px 16px;border-radius:0 8px 8px 0;color:#0f172a;font-size:13px;margin-bottom:16px}
.footer{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;margin-top:16px;word-break:break-all}
</style></head><body>
<div class="card">
  <div class="logo"><span style="color:#fff;font-weight:700;font-size:16px">C</span></div>
  <h1>You've been invited to ClientFlow</h1>
  <p>Hi ${name},</p>
  <p>You've been given access to the <strong>ClientFlow Client Dashboard</strong> — a shared workspace for tracking client deliverables, open items, and compliance deadlines.</p>
  ${message ? `<div class="msg">${message}</div>` : ""}
  ${accountCreated ? `<div class="creds"><strong>Your login credentials:</strong><br>Email: ${email}<br>Password: <strong>${tempPassword}</strong><br><small>You can change your password after signing in.</small></div>` : ""}
  <a href="${SITE_URL}" class="btn">Open Dashboard →</a>
  <p>You'll only see the clients you're assigned to. If you have any issues, contact your administrator.</p>
  <div class="footer">${SITE_URL}</div>
</div>
</body></html>`;

      try {
        if (!runableUrl) throw new Error("Email service not configured — set RUNABLE_URL in website settings");
        const { sendEmail } = await import("@runablehq/website-runtime/server");
        await sendEmail({ url: runableUrl, to: email, subject: "You've been invited to ClientFlow", html });
        results.push({ name, email, sent: true });
      } catch (err: any) {
        console.error(`[share-access] Failed to send invite to ${email}:`, err.message);
        results.push({ name, email, sent: false, error: err.message });
      }
    }
    return c.json({ results });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── INBOUND EMAIL → OPEN ITEM ───────────────────────────────────────────────

app.post("/inbound-email", async (c) => {
  try {
    // Optional webhook token check
    const token = (process.env as any)?.POSTMARK_WEBHOOK_TOKEN;
    if (token) {
      const incoming = c.req.header("X-Webhook-Token");
      if (incoming !== token) return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json();
    const subject: string = body.Subject || "";
    const textBody: string = body.TextBody || body.StrippedTextReply || "";
    const htmlBody: string = body.HtmlBody || "";
    const fromEmail: string = body.From || "";
    const emailContent = textBody || htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // Parse subject: "[Client Name] - description" or "Client Name - description"
    const subjectMatch = subject.match(/^\[?([^\]–-]+?)\]?\s*[-–]\s*(.+)$/);
    const clientNameHint = subjectMatch ? subjectMatch[1].trim() : "";
    const descriptionHint = subjectMatch ? subjectMatch[2].trim() : subject.trim();

    // Load clients for matching (db3 assigned above)

    // Exact subject-line match only — no fuzzy. AI handles ambiguous cases.
    let matchedClient: any = null;
    if (clientNameHint) {
      const hint = clientNameHint.toLowerCase();
      matchedClient = clients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase() === hint
      );
    }

    // AI extraction
    const TYPES = ["Compliance", "HR Support", "Population Health", "Miscellaneous", "Other", "Member Support", "Planning Support", "Ancillary", "Technology"];
    const clientList = clients.map((cl: any) => cl.fields["Client Name"]).join(", ");

    const prompt = `You are an assistant for an employee benefits brokerage. Extract a structured open item from this email.

SUBJECT: ${subject}
BODY:
${emailContent.substring(0, 3000)}

KNOWN CLIENTS: ${clientList}

RULES:
- "openItemName": specific action title, max 60 chars, no filler words
- "notes": ONE concise sentence — what specifically needs to happen, who needs to do it, by when if known. No fluff.
- "isActionable": false only if the email requires zero follow-up (pure FYI)
- "suggestedClientName": MUST be an exact name from KNOWN CLIENTS, or null. Do not guess or invent names.
- Do not suggest a meeting unless the email explicitly requests one.
- "priority": High = urgent/within 2 weeks, Medium = within 30 days, Low = no deadline
- "dueDate": YYYY-MM-DD only if a specific date is in the email, else null

Return JSON only:
{"openItemName":"","openItemType":"Compliance|HR Support|Population Health|Miscellaneous|Other|Member Support|Planning Support|Ancillary|Technology","notes":"","priority":"High|Medium|Low","dueDate":null,"suggestedClientName":null,"isActionable":true}`;

    const raw = await aiChat(process.env as any as any, [
      { role: "system", content: "You are a precise assistant for an employee benefits brokerage. Read emails carefully and extract only what is actually needed. Return valid JSON only, no markdown, no explanation." },
      { role: "user", content: prompt },
    ]);

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const extracted = JSON.parse(cleaned);

    // Use AI client suggestion if no subject-line match found — exact match only
    if (!matchedClient && extracted.suggestedClientName) {
      const suggested = extracted.suggestedClientName.toLowerCase().trim();
      matchedClient = clients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase().trim() === suggested
      );
    }

    // If AI determined the email is informational (no action required)
    if (extracted.isActionable === false) {
      const timestamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const noteEntry = `[${timestamp} — via email] ${subject}\n${extracted.notes || emailContent.substring(0, 400)}`;

      if (matchedClient) {
        // Append to client's Intake Notes
        const existing = matchedClient.fields["Intake Notes"] || "";
        const updated = existing ? `${existing}\n\n${noteEntry}` : noteEntry;
        await dbUpdateClient(db3, matchedClient.id, { "Intake Notes": updated });

        return c.json({
          success: true,
          informational: true,
          action: "note_added_to_client",
          client: matchedClient.fields["Client Name"],
          note: noteEntry,
        });
      } else {
        // No client matched — create a low-priority FYI open item so nothing gets lost
        await dbCreateOpenItem(db3, newId("rec"), {
          "Open Item Name": `[FYI] ${extracted.openItemName || subject}`,
          "Open Item Type": TYPES.includes(extracted.openItemType) ? extracted.openItemType : "Other",
          "Notes": `[via email — informational, no client matched]\n${extracted.notes || emailContent.substring(0, 400)}`,
          "Status": "Not Started",
          "Priority (AI Suggested)": "Low",
        });

        return c.json({
          success: true,
          informational: true,
          action: "fyi_open_item_created",
          reason: "Email is informational but no client was matched — created as low-priority FYI open item.",
        });
      }
    }

    const unmatched = !matchedClient;
    const notesPrefix = unmatched
      ? "[via email — ⚠️ CLIENT UNMATCHED, please assign] "
      : "[via email] ";

    // Build open item fields
    const openItemFields: any = {
      "Open Item Name": extracted.openItemName || descriptionHint || subject,
      "Open Item Type": TYPES.includes(extracted.openItemType) ? extracted.openItemType : "Other",
      "Notes": notesPrefix + (extracted.notes || emailContent.substring(0, 500)),
      "Status": "Not Started",
      "Priority (AI Suggested)": extracted.priority || "Medium",
    };
    if (matchedClient) openItemFields["Client"] = [matchedClient.id];
    if (extracted.dueDate) openItemFields["Due Date"] = extracted.dueDate;

    await dbCreateOpenItem(db3, newId("rec"), openItemFields);

    // Send confirmation email back to sender
    const runableUrl = (process.env as any)?.RUNABLE_URL;
    if (runableUrl && fromEmail.includes("@")) {
      const clientName = matchedClient ? matchedClient.fields["Client Name"] : null;
      const confirmSubject = unmatched
        ? `⚠️ Open item created (unassigned) — ${openItemFields["Open Item Name"]}`
        : `✓ Open item created for ${clientName} — ${openItemFields["Open Item Name"]}`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:32px 16px}
.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;max-width:480px;margin:0 auto;padding:32px}
h2{font-size:17px;font-weight:700;color:#0f172a;margin:0 0 16px}
.row{display:flex;gap:8px;margin-bottom:8px;font-size:13px}
.label{color:#94a3b8;width:100px;shrink:0;flex-shrink:0}
.value{color:#1e293b;font-weight:500}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.warn{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.ok{background:#dcfce7;color:#166534;border:1px solid #86efac}
.footer{font-size:11px;color:#94a3b8;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9}
</style></head><body><div class="card">
<h2>${unmatched ? "⚠️ Open Item Created — Unassigned" : "✓ Open Item Created"}</h2>
${unmatched ? `<p style="font-size:13px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px">No matching client found for <strong>${clientNameHint || "unknown"}</strong>. Please assign it manually in the dashboard.</p>` : ""}
<div class="row"><span class="label">Item</span><span class="value">${openItemFields["Open Item Name"]}</span></div>
${clientName ? `<div class="row"><span class="label">Client</span><span class="value">${clientName}</span></div>` : ""}
<div class="row"><span class="label">Type</span><span class="value">${openItemFields["Open Item Type"]}</span></div>
<div class="row"><span class="label">Priority</span><span class="value">${openItemFields["Priority (AI Suggested)"]}</span></div>
${extracted.dueDate ? `<div class="row"><span class="label">Due</span><span class="value">${extracted.dueDate}</span></div>` : ""}
<div class="row"><span class="label">Notes</span><span class="value" style="white-space:pre-wrap">${extracted.notes || ""}</span></div>
<div class="footer">View and edit in <a href="${SITE_URL}/open-items" style="color:#0ea5e9">ClientFlow Dashboard</a></div>
</div></body></html>`;

      try {
        const { sendEmail } = await import("@runablehq/website-runtime/server");
        await sendEmail({ url: runableUrl, to: fromEmail, subject: confirmSubject, html });
      } catch { /* non-fatal */ }
    }

    return c.json({
      success: true,
      openItemName: openItemFields["Open Item Name"],
      client: matchedClient?.fields["Client Name"] || null,
      unmatched,
    });
  } catch (e: any) {
    console.error("Inbound email error:", e);
    return c.json({ error: e.message }, 500);
  }
});

// ─── TELEGRAM BOT ────────────────────────────────────────────────────────────

app.post("/telegram", async (c) => {
  try {
    const botToken = (process.env as any)?.TELEGRAM_BOT_TOKEN;
    const body = await c.req.json();
    const msg = body?.message;
    if (!msg?.text || !msg?.chat?.id) return c.json({ ok: true });

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const sendReply = async (reply: string) => {
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" }),
      });
    };

    // ── Commands ────────────────────────────────────────────────────────────

    // /start — welcome
    if (text === "/start" || text === "/help") {
      await sendReply(
        `👋 *ClientFlow Bot*\n\n` +
        `I can create and update open items directly from here.\n\n` +
        `*Create an open item:*\n` +
        `\`[Client Name] - description\`\n` +
        `e.g. \`Kantata - missing enrollment forms\`\n\n` +
        `*Check open items for a client:*\n` +
        `\`/open Kantata\`\n\n` +
        `*Close an open item (type part of the name):*\n` +
        `\`/close enrollment forms\`\n\n` +
        `*List all active open items:*\n` +
        `\`/list\``
      );
      return c.json({ ok: true });
    }

    // /list — show active open items
    if (text === "/list") {
      const dbT = getDb();
      const allItems = await dbGetOpenItems(dbT);
      const items = allItems.filter((r: any) => r.fields["Status"] !== "Closed");
      if (items.length === 0) {
        await sendReply("✅ No active open items!");
      } else {
        const lines = items.slice(0, 20).map((r: any) => {
          const f = r.fields;
          const status = f["Status"] || "Not Started";
          const emoji = status === "Stuck" ? "🔴" : status === "In Progress" ? "🟡" : "⚪";
          return `${emoji} *${f["Open Item Name"]}*`;
        });
        await sendReply(`*Active Open Items (${items.length}):*\n\n${lines.join("\n")}`);
      }
      return c.json({ ok: true });
    }

    // /open [client] — show open items for a specific client
    if (text.toLowerCase().startsWith("/open ")) {
      const query = text.slice(6).trim().toLowerCase();
      const dbC = getDb();
      const allClients = await dbGetClients(dbC);
      const client = allClients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase().includes(query)
      );
      if (!client) {
        await sendReply(`❓ No client found matching "*${query}*". Check the spelling and try again.`);
        return c.json({ ok: true });
      }
      const allOpenC = await dbGetOpenItems(dbC);
      const items = allOpenC.filter((r: any) => r.fields["Client"]?.[0] === client.id && r.fields["Status"] !== "Closed");
      const clientName = client.fields["Client Name"];
      if (items.length === 0) {
        await sendReply(`✅ No active open items for *${clientName}*.`);
      } else {
        const lines = items.map((r: any) => {
          const f = r.fields;
          const status = f["Status"] || "Not Started";
          const emoji = status === "Stuck" ? "🔴" : status === "In Progress" ? "🟡" : "⚪";
          const due = f["Due Date"] ? ` _(due ${f["Due Date"]})_` : "";
          return `${emoji} ${f["Open Item Name"]}${due}`;
        });
        await sendReply(`*Open items for ${clientName}:*\n\n${lines.join("\n")}`);
      }
      return c.json({ ok: true });
    }

    // /close [partial name] — close an open item
    if (text.toLowerCase().startsWith("/close ")) {
      const query = text.slice(7).trim().toLowerCase();
      const dbCl = getDb();
      const allOpenCl = await dbGetOpenItems(dbCl);
      const items = allOpenCl.filter((r: any) => r.fields["Status"] !== "Closed");
      const match = items.find((r: any) =>
        r.fields["Open Item Name"]?.toLowerCase().includes(query)
      );
      if (!match) {
        await sendReply(`❓ No active open item matching "*${query}*".`);
        return c.json({ ok: true });
      }
      await dbUpdateOpenItem(dbCl, match.id, {
        "Status": "Closed",
        "Completion Date": new Date().toISOString().split("T")[0],
      });
      await sendReply(`✅ Closed: *${match.fields["Open Item Name"]}*`);
      return c.json({ ok: true });
    }

    // /update [partial name] | [note] — add a timestamped note
    if (text.toLowerCase().startsWith("/update ")) {
      const rest = text.slice(8).trim();
      const parts = rest.split("|");
      if (parts.length < 2) {
        await sendReply(`Format: \`/update [item name] | [your note]\`\ne.g. \`/update enrollment forms | Carrier confirmed receipt\``);
        return c.json({ ok: true });
      }
      const query = parts[0].trim().toLowerCase();
      const note = parts[1].trim();
      const dbUp = getDb();
      const allOpenUp = await dbGetOpenItems(dbUp);
      const items = allOpenUp.filter((r: any) => r.fields["Status"] !== "Closed");
      const match = items.find((r: any) =>
        r.fields["Open Item Name"]?.toLowerCase().includes(query)
      );
      if (!match) {
        await sendReply(`❓ No active open item matching "*${query}*".`);
        return c.json({ ok: true });
      }
      // Append timestamped note
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const existing = match.fields["Notes"] || "";
      const updated = existing ? `${existing.trimEnd()}\n[${ts}] ${note}` : `[${ts}] ${note}`;
      await dbUpdateOpenItem(dbUp, match.id, { "Notes": updated });
      await sendReply(`📝 Note added to *${match.fields["Open Item Name"]}*:\n_${note}_`);
      return c.json({ ok: true });
    }

    // Default: treat as a new open item creation
    // Parse "[Client Name] - description" or just "description"
    const subjectMatch = text.match(/^\[?([^\]–\-]+?)\]?\s*[-–]\s*(.+)$/s);
    const clientNameHint = subjectMatch ? subjectMatch[1].trim() : "";
    const descriptionHint = subjectMatch ? subjectMatch[2].trim() : text;

    // Load clients and fuzzy-match
    const dbDef = getDb();
    const clients = await dbGetClients(dbDef);
    let matchedClient: any = null;
    if (clientNameHint) {
      const hint = clientNameHint.toLowerCase();
      matchedClient = clients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase() === hint
      ) || clients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase().includes(hint) ||
        hint.includes((cl.fields["Client Name"] || "").toLowerCase())
      );
    }

    // AI extraction — include today's date so relative dates resolve correctly
    const clientList = clients.map((cl: any) => cl.fields["Client Name"]).join(", ");
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const todayFull = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }); // e.g. "Monday, March 30, 2026"
    const raw = await aiChat(process.env as any as any, [
      { role: "system", content: "Extract open item details from a short message. Return valid JSON only, no markdown." },
      { role: "user", content: `Today is ${todayFull} (${todayStr}).\n\nMessage: ${text}\n\nKnown clients: ${clientList}\n\nReturn JSON:\n{"openItemName":"concise title","openItemType":"Compliance|HR Support|Population Health|Miscellaneous|Other|Member Support|Planning Support|Ancillary|Technology","notes":"brief summary","priority":"High|Medium|Low","dueDate":"YYYY-MM-DD if any date is mentioned — resolve relative dates like 'Friday', 'April 15', 'end of month', 'next week' using today's actual date and year. Otherwise null.","suggestedClientName":"best match from known clients list or null"}` },
    ]);
    const extracted = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

    // Try AI suggestion if no subject-line match
    if (!matchedClient && extracted.suggestedClientName) {
      const s = extracted.suggestedClientName.toLowerCase();
      matchedClient = clients.find((cl: any) =>
        cl.fields["Client Name"]?.toLowerCase() === s ||
        cl.fields["Client Name"]?.toLowerCase().includes(s)
      );
    }

    const TYPES = ["Compliance","HR Support","Population Health","Miscellaneous","Other","Member Support","Planning Support","Ancillary","Technology"];
    const fields: any = {
      "Open Item Name": extracted.openItemName || descriptionHint,
      "Open Item Type": TYPES.includes(extracted.openItemType) ? extracted.openItemType : "Other",
      "Notes": `[via Telegram] ${extracted.notes || text}`,
      "Status": "Not Started",
      "Priority (AI Suggested)": extracted.priority || "Medium",
    };
    if (matchedClient) fields["Client"] = [matchedClient.id];
    if (extracted.dueDate) fields["Due Date"] = extracted.dueDate;

    await dbCreateOpenItem(dbDef, newId("rec"), fields);

    const clientName = matchedClient?.fields["Client Name"];
    const dueLine = extracted.dueDate ? `\n📅 Due: ${extracted.dueDate}` : "";
    if (clientName) {
      await sendReply(`✅ *Open item created for ${clientName}:*\n📋 ${fields["Open Item Name"]}\n🏷 ${fields["Open Item Type"]} · ${fields["Priority (AI Suggested)"]} priority${dueLine}`);
    } else {
      await sendReply(`⚠️ *Open item created (no client matched):*\n📋 ${fields["Open Item Name"]}${dueLine}\n\nPlease assign a client in the dashboard.`);
    }

    return c.json({ ok: true });
  } catch (e: any) {
    console.error("Telegram error:", e);
    return c.json({ ok: true }); // Always return ok to Telegram
  }
});

app.get("/ping", (c) => c.json({ message: `Pong! ${Date.now()}` }));

// ─── NOTIFICATION SETTINGS ───────────────────────────────────────────────────

// Get settings for a team member (by their Airtable ID)
app.get("/notification-settings/:airtableMemberId", requireAuth, async (c) => {
  try {
    const mid = c.req.param("airtableMemberId");
    // Users can only read their own settings; admin can read any
    if (!isAdmin(c)) {
      const user = c.get("user") as any;
      if (user?.airtableId !== mid) return c.json({ error: "Forbidden" }, 403);
    }
    const row = await (await getDb().execute({sql: "SELECT * FROM notification_settings WHERE airtable_member_id = ?", args: [mid]})).rows[0] ?? null;
    // Return defaults if no row yet
    return c.json(row || {
      airtable_member_id: mid,
      notify_on_status_change: 1,
      notify_on_new_item: 1,
      notify_on_note_added: 1,
      daily_digest_enabled: 1,
      digest_always_send: 0,
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Upsert settings for a team member
app.put("/notification-settings/:airtableMemberId", requireAuth, async (c) => {
  try {
    const mid = c.req.param("airtableMemberId");
    if (!isAdmin(c)) {
      const user = c.get("user") as any;
      if (user?.airtableId !== mid) return c.json({ error: "Forbidden" }, 403);
    }
    const body = await c.req.json();
    const now = Date.now();
    await await getDb().execute({sql: `INSERT INTO notification_settings
        (airtable_member_id, notify_on_status_change, notify_on_new_item, notify_on_note_added, daily_digest_enabled, digest_always_send, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(airtable_member_id) DO UPDATE SET
          notify_on_status_change = excluded.notify_on_status_change,
          notify_on_new_item = excluded.notify_on_new_item,
          notify_on_note_added = excluded.notify_on_note_added,
          daily_digest_enabled = excluded.daily_digest_enabled,
          digest_always_send = excluded.digest_always_send,
          updated_at = excluded.updated_at`, args: [mid,
        body.notify_on_status_change ? 1 : 0,
        body.notify_on_new_item ? 1 : 0,
        body.notify_on_note_added ? 1 : 0,
        body.daily_digest_enabled ? 1 : 0,
        body.digest_always_send ? 1 : 0,
        now,
        now]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Admin: seed OMNI solutions from embedded data + migrate client_omni references
app.post("/admin/seed-omni", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  const db = getDb();
  try {
    // 1. Clear and re-insert all OMNI solutions
    await getDb().execute({ sql: "DELETE FROM omni_solutions", args: [] });
    for (const item of OMNI_SEED_DATA) {
      await getDb().execute({
        sql: "INSERT INTO omni_solutions (id, category, solution_name) VALUES (?, ?, ?)",
        args: [item.id, item.category, item.name],
      });
    }

    // 2. Migrate client_omni references: expand old Airtable IDs to new category-specific IDs
    const existingRefsResult = await getDb().execute({ sql: "SELECT client_id, omni_id FROM client_omni", args: [] });
    const oldRefs = existingRefsResult.rows;
    let migrated = 0;
    for (const ref of oldRefs) {
      const newIds = OMNI_ID_MAPPING[ref.omni_id as string];
      if (newIds) {
        // Old-style ID — expand to all category-specific IDs
        await getDb().execute({
          sql: "DELETE FROM client_omni WHERE client_id = ? AND omni_id = ?",
          args: [ref.client_id, ref.omni_id],
        });
        for (const nid of newIds) {
          await getDb().execute({
            sql: "INSERT OR IGNORE INTO client_omni (client_id, omni_id) VALUES (?, ?)",
            args: [ref.client_id, nid],
          });
        }
        migrated++;
      }
      // If it's already a new-style ID (has _suffix), keep it
    }

    invalidateTable("clients");
    return c.json({
      success: true,
      solutions: OMNI_SEED_DATA.length,
      clientRefsMigrated: migrated,
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Admin: manually trigger digest (for testing)
app.post("/admin/trigger-digest", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await runDailyDigest(process.env as any);
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Admin: manually trigger recurring open item spawner (for testing)
app.post("/admin/trigger-recurring", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await runRecurringOpenItems(process.env as any);
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Admin: check digest health
app.get("/admin/digest-status", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. RUNABLE_URL env var
  const runableUrl = (process.env as any).RUNABLE_URL;
  checks.push({
    name: "RUNABLE_URL env var",
    ok: !!runableUrl,
    detail: runableUrl ? `Set to ${runableUrl}` : "Not set — digest will silently skip",
  });

  // 2. Database connection
  let dbOk = false;
  let dbDetail = "";
  try {
    await (await getDb().execute({sql: "SELECT 1", args: []})).rows[0] ?? null;
    dbOk = true;
    dbDetail = "Connected";
  } catch (e: any) {
    dbDetail = `Connection failed: ${e.message}`;
  }
  checks.push({ name: "Database (D1)", ok: dbOk, detail: dbDetail });

  // 3. notification_settings table exists
  let tableOk = false;
  let rowCount = 0;
  let tableDetail = "";
  try {
    const result = await (await getDb().execute({sql: "SELECT COUNT(*) as cnt FROM notification_settings", args: []})).rows[0] ?? null;
    rowCount = result?.cnt ?? 0;
    tableOk = true;
    tableDetail = `Table exists · ${rowCount} row${rowCount !== 1 ? "s" : ""}`;
  } catch {
    tableDetail = "Table not found — run migrations";
  }
  checks.push({ name: "notification_settings table", ok: tableOk, detail: tableDetail });

  // 4. Active members with emails
  let memberCount = 0;
  let memberDetail = "";
  try {
    const members = await dbGetTeamMembers(getDb());
    const activeMembers = members.filter((m: any) => m.fields["Active Status"] !== false);
    // Check team_member_emails table for emails
    const emailRows = await (await getDb().execute({sql: "SELECT COUNT(*) as cnt FROM team_member_emails", args: []})).rows[0] ?? null;
    memberCount = emailRows?.cnt ?? 0;
    memberDetail = `${memberCount} members have emails · ${activeMembers.length} active members total`;
  } catch (e: any) {
    memberDetail = `Could not load members: ${e.message}`;
  }
  checks.push({
    name: "Active members with emails",
    ok: memberCount > 0,
    detail: memberDetail,
  });

  // 5. Cron config (static — just reports wrangler.json setting)
  checks.push({
    name: "Cron trigger configured",
    ok: true,
    detail: "0 16 * * * (8:00 AM PT) — verify it's registered under Cloudflare Workers → Triggers",
  });

  const allOk = checks.every((c) => c.ok);
  return c.json({ allOk, checks });
});

// ─── RUN DB MIGRATIONS ───────────────────────────────────────────────────────

app.post("/admin/run-migrations", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await await getDb().execute({sql: `
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        airtable_member_id TEXT NOT NULL UNIQUE,
        notify_on_status_change INTEGER NOT NULL DEFAULT 1,
        notify_on_new_item INTEGER NOT NULL DEFAULT 1,
        notify_on_note_added INTEGER NOT NULL DEFAULT 1,
        daily_digest_enabled INTEGER NOT NULL DEFAULT 1,
        digest_always_send INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
        updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
      )
    `, args: []});
    await await getDb().execute({sql: `
      CREATE INDEX IF NOT EXISTS notif_member_idx ON notification_settings (airtable_member_id)
    `, args: []});
    // team_member_emails
    await await getDb().execute({sql: `
      CREATE TABLE IF NOT EXISTS team_member_emails (
        airtable_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `, args: []});
    // gamification
    await await getDb().execute({sql: `
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
      )
    `, args: []});
    await await getDb().execute({sql: `
      CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_airtable_id TEXT NOT NULL,
        badge_key TEXT NOT NULL,
        awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_airtable_id, badge_key)
      )
    `, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_airtable_id)`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_airtable_id)`, args: []});
    // ── Core data tables (0004) ──
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, full_name TEXT NOT NULL, role TEXT, active INTEGER DEFAULT 1, phone TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`, args: []});
    // Safe column additions for existing tables that may be missing columns
    for (const stmt of [
      `ALTER TABLE team_members ADD COLUMN active INTEGER DEFAULT 1`,
      `ALTER TABLE team_members ADD COLUMN phone TEXT`,
      `ALTER TABLE team_members ADD COLUMN created_at TEXT DEFAULT (datetime('now'))`,
      `ALTER TABLE team_members ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
      `ALTER TABLE team_members ADD COLUMN avatar_seed TEXT`,
    ]) { try { await getDb().execute({sql: stmt, args: []}); } catch { /* already exists */ } }
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, renewal_date TEXT, active INTEGER DEFAULT 1, revenue REAL, funding_strategy TEXT, company_size TEXT, medical_carrier TEXT, ancillary_carrier TEXT, location TEXT, intake_notes TEXT, rxdc_complete TEXT, date_added TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`, args: []});
    // Safe column additions for clients table
    for (const stmt of [
      `ALTER TABLE clients ADD COLUMN renewal_date TEXT`,
      `ALTER TABLE clients ADD COLUMN active INTEGER DEFAULT 1`,
      `ALTER TABLE clients ADD COLUMN revenue REAL`,
      `ALTER TABLE clients ADD COLUMN funding_strategy TEXT`,
      `ALTER TABLE clients ADD COLUMN company_size TEXT`,
      `ALTER TABLE clients ADD COLUMN medical_carrier TEXT`,
      `ALTER TABLE clients ADD COLUMN ancillary_carrier TEXT`,
      `ALTER TABLE clients ADD COLUMN location TEXT`,
      `ALTER TABLE clients ADD COLUMN intake_notes TEXT`,
      `ALTER TABLE clients ADD COLUMN rxdc_complete TEXT`,
      `ALTER TABLE clients ADD COLUMN date_added TEXT`,
      `ALTER TABLE clients ADD COLUMN created_at TEXT DEFAULT (datetime('now'))`,
      `ALTER TABLE clients ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`,
      `ALTER TABLE clients ADD COLUMN theme_color TEXT`,
      `ALTER TABLE clients ADD COLUMN header_photo_url TEXT`,
      `ALTER TABLE clients ADD COLUMN header_photo_source TEXT`,
      `ALTER TABLE clients ADD COLUMN header_photo_credit TEXT`,
      `ALTER TABLE clients ADD COLUMN peo_name TEXT`,
      `ALTER TABLE clients ADD COLUMN sf_arrangement TEXT`,
      `ALTER TABLE clients ADD COLUMN pbm TEXT`,
      `ALTER TABLE clients ADD COLUMN stop_loss TEXT`,
      `ALTER TABLE clients ADD COLUMN tpa_name TEXT`,
      `ALTER TABLE clients ADD COLUMN segment TEXT`,
    ]) { try { await getDb().execute({sql: stmt, args: []}); } catch { /* already exists */ } }
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS client_team_members (client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY (client_id, team_member_id, role))`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_ctm_client ON client_team_members(client_id)`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_ctm_member ON client_team_members(team_member_id)`, args: []});
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS omni_solutions (id TEXT PRIMARY KEY, category TEXT NOT NULL, solution_name TEXT NOT NULL)`, args: []});
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS client_omni (client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, omni_id TEXT NOT NULL REFERENCES omni_solutions(id) ON DELETE CASCADE, PRIMARY KEY (client_id, omni_id))`, args: []});
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS deliverables (id TEXT PRIMARY KEY, name TEXT NOT NULL, client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, type TEXT, deadline TEXT, completion_date TEXT, status TEXT DEFAULT 'Not Started', notes TEXT, renewal_phase TEXT, template_source TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_deliverables_client ON deliverables(client_id)`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_deliverables_status ON deliverables(status)`, args: []});
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS deliverable_team_members (deliverable_id TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE, team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE, PRIMARY KEY (deliverable_id, team_member_id))`, args: []});
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS open_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, notes TEXT, status TEXT DEFAULT 'Not Started', begin_date TEXT, due_date TEXT, completion_date TEXT, type TEXT, priority TEXT, ai_priority TEXT, ai_summary TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_open_items_client ON open_items(client_id)`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_open_items_status ON open_items(status)`, args: []});
    for (const stmt of [
      `ALTER TABLE open_items ADD COLUMN recurring INTEGER DEFAULT 0`,
      `ALTER TABLE open_items ADD COLUMN recurrence_rate TEXT`,
    ]) { try { await getDb().execute({sql: stmt, args: []}); } catch { /* already exists */ } }
    await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS open_item_assigned (open_item_id TEXT NOT NULL REFERENCES open_items(id) ON DELETE CASCADE, team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'assigned', PRIMARY KEY (open_item_id, team_member_id, role))`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_oia_item ON open_item_assigned(open_item_id)`, args: []});
    await await getDb().execute({sql: `CREATE INDEX IF NOT EXISTS idx_oia_member ON open_item_assigned(team_member_id)`, args: []});

    // Seed OMNI solutions if table is empty
    const omniCount = await (await getDb().execute({sql: "SELECT COUNT(*) as cnt FROM omni_solutions", args: []})).rows[0] ?? null;
    if (!omniCount?.cnt || omniCount.cnt < 100) {
      await await getDb().execute({sql: "DELETE FROM omni_solutions", args: []});
      for (const item of OMNI_SEED_DATA) {
        await await getDb().execute({sql: "INSERT OR REPLACE INTO omni_solutions (id, category, solution_name) VALUES (?, ?, ?)", args: [item.id, item.category, item.name]});
      }
      // Migrate old client_omni references
      const oldRefs = await (await getDb().execute({sql: "SELECT client_id, omni_id FROM client_omni", args: []})).rows;
      for (const ref of oldRefs) {
        const newIds = OMNI_ID_MAPPING[ref.omni_id as string];
        if (newIds) {
          await await getDb().execute({sql: "DELETE FROM client_omni WHERE client_id = ? AND omni_id = ?", args: [ref.client_id, ref.omni_id]});
          for (const newId of newIds) {
            await await getDb().execute({sql: "INSERT OR IGNORE INTO client_omni (client_id, omni_id) VALUES (?, ?)", args: [ref.client_id, newId]});
          }
        }
      }
    }

    // Rename Broker → Producer
    await await getDb().execute({sql: `UPDATE team_members SET role = 'Producer' WHERE role = 'Broker'`, args: []});

    // Add office column (multi-office support)
    try { await getDb().execute({sql: `ALTER TABLE clients ADD COLUMN office TEXT`, args: []}); } catch { /* already exists */ }
    await getDb().execute({sql: `UPDATE clients SET office = 'Irvine' WHERE office IS NULL`, args: []});

    // Bust all caches so fresh data is served immediately
    invalidateAll();

    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── GAMIFICATION ENDPOINTS ──────────────────────────────────────────────────

app.get("/gamification/me", requireAuth, async (c) => {
  try {
    const db = getDb();
    const airtableId = getMemberAirtableId(c);
    if (!airtableId) return c.json({ totalPoints: 0, rank: 1, badges: [], recentActivity: [] });

    const totalRow = await getDb().execute({
      sql: "SELECT COALESCE(SUM(total_points), 0) as pts FROM points_ledger WHERE user_airtable_id = ?",
      args: [airtableId],
    });
    const totalPoints = (totalRow.rows[0]?.pts as number) ?? 0;

    const badgeRows = await getDb().execute({
      sql: "SELECT badge_key, awarded_at FROM badges WHERE user_airtable_id = ? ORDER BY awarded_at ASC",
      args: [airtableId],
    });
    const badges = badgeRows.rows.map((r) => r.badge_key as string);

    const recentRows = await getDb().execute({
      sql: "SELECT action, total_points, bonus_points, awarded_at FROM points_ledger WHERE user_airtable_id = ? ORDER BY id DESC LIMIT 10",
      args: [airtableId],
    });
    const recentActivity = recentRows.rows;

    // Rank: count users with more points than me
    const rankRow = await getDb().execute({
      sql: "SELECT COUNT(DISTINCT user_airtable_id) + 1 as rank FROM (SELECT user_airtable_id, SUM(total_points) as pts FROM points_ledger GROUP BY user_airtable_id HAVING pts > ?)",
      args: [totalPoints],
    });
    const rank = (rankRow.rows[0]?.rank as number) ?? 1;

    return c.json({ totalPoints, rank, badges, recentActivity });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/gamification/leaderboard", requireAuth, async (c) => {
  try {
    const db = getDb();
    

    const pointsRows = await getDb().execute({ sql: "SELECT user_airtable_id, SUM(total_points) as pts FROM points_ledger GROUP BY user_airtable_id ORDER BY pts DESC LIMIT 50", args: [] });
    const entries = (pointsRows.rows ?? []) as unknown as { user_airtable_id: string; pts: number }[];

    const badgeRows = await getDb().execute({ sql: "SELECT user_airtable_id, badge_key FROM badges", args: [] });
    const badgeMap: Record<string, string[]> = {};
    for (const b of (badgeRows.rows ?? []) as unknown as { user_airtable_id: string; badge_key: string }[]) {
      if (!badgeMap[b.user_airtable_id]) badgeMap[b.user_airtable_id] = [];
      badgeMap[b.user_airtable_id].push(b.badge_key);
    }

    const members = await dbGetTeamMembers(db);
    const memberMap: Record<string, { name: string; avatarUrl?: string }> = {};
    for (const m of members) {
      const name = m.fields["Full Name"] || m.id;
      memberMap[m.id] = { name };
    }

    const leaderboard = entries.map((e, i) => ({
      rank: i + 1,
      airtableId: e.user_airtable_id,
      name: memberMap[e.user_airtable_id]?.name ?? "Unknown",
      avatarUrl: memberMap[e.user_airtable_id]?.avatarUrl,
      totalPoints: e.pts,
      badges: badgeMap[e.user_airtable_id] ?? [],
    }));

    return c.json(leaderboard);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Also update run-migrations to include gamification tables
// (handled via 0003_gamification.sql migration, but add inline fallback)

// ─── GAMIFICATION ADMIN ───────────────────────────────────────────────────────

app.delete("/gamification/all", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    await await getDb().execute({sql: "DELETE FROM points_ledger", args: []});
    await await getDb().execute({sql: "DELETE FROM badges", args: []});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.delete("/gamification/user/:airtableId", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  const id = c.req.param("airtableId");
  try {
    await await getDb().execute({sql: "DELETE FROM points_ledger WHERE user_airtable_id = ?", args: [id]});
    await await getDb().execute({sql: "DELETE FROM badges WHERE user_airtable_id = ?", args: [id]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── IMPORT ROUTES ───────────────────────────────────────────────────────────

/** Validate rows without inserting — returns warnings only */
app.post("/import/preview", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const payload = await c.req.json() as ImportPayload;
    const warnings = validatePayload(payload);
    return c.json({ warnings });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

/** Run the actual import */
app.post("/import/run", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  try {
    const payload = await c.req.json() as ImportPayload;
    const result = await runImport(getDb(), payload);
    return c.json(result);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── REGIONAL KEY MANAGEMENT (stored in D1, not env) ──────────────────────────

app.get("/regional-key", requireAuth, async (c) => {
  const db = getDb();
  try {
    await db.execute({ sql: `CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, args: [] });
    const rowRes = await db.execute({ sql: `SELECT value FROM site_settings WHERE key = 'regional_api_key'`, args: [] });
    const row = rowRes.rows[0] as { value: string } | undefined;
    const envKey = (process.env as any).REGIONAL_API_KEY || "";
    return c.json({ key: row?.value || (envKey.trim() ? envKey : ""), source: row?.value ? "db" : "env" });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/regional-key", requireAuth, async (c) => {
  const db = getDb();
  try {
    const { key } = await c.req.json();
    if (!key) return c.json({ error: "key required" }, 400);
    await db.execute({ sql: `CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, args: [] });
    await db.execute({ sql: `INSERT INTO site_settings (key, value) VALUES ('regional_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [key] });
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── REGIONAL SUMMARY ENDPOINT ────────────────────────────────────────────────

/**
 * Read-only endpoint for the Regional dashboard.
 * Key is checked against REGIONAL_API_KEY env var OR the site_settings D1 table.
 */
app.options("/regional/summary", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  return c.text("", 204);
});

app.get("/regional/summary", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");

  const db = getDb();

  // Try env var first, fall back to D1 site_settings table
  let key = (process.env as any).REGIONAL_API_KEY || "";
  if (!key || key.trim() === "") {
    try {
      await db.execute({ sql: `CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, args: [] });
      const rowRes = await db.execute({ sql: `SELECT value FROM site_settings WHERE key = 'regional_api_key'`, args: [] });
      const row = rowRes.rows[0] as { value: string } | undefined;
      key = row?.value || "";
    } catch { key = ""; }
  }

  if (!key || key.trim() === "") return c.json({ error: "Regional access not configured" }, 403);
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${key}`) return c.json({ error: "Unauthorized" }, 401);

  try {
    const db = getDb();
    const [clients, teamMembers, openItems, deliverables] = await Promise.all([
      dbGetClients(db),
      dbGetTeamMembers(db),
      dbGetOpenItems(db),
      dbGetDeliverables(db),
    ]);

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const activeClients = clients.filter((c) => c.fields["Active"] !== false);
    const openCount = openItems.filter((o) => o.fields["Status"] !== "Closed").length;
    const overdueDeliverables = deliverables.filter((d) => {
      if (d.fields["Status"] === "Completed") return false;
      const dl = d.fields["Deadline"];
      return dl && new Date(dl) < now;
    }).length;
    const upcomingRenewals = activeClients.filter((cl) => {
      const rd = cl.fields["Renewal Date"];
      if (!rd) return false;
      const date = new Date(rd);
      return date >= now && date <= in30;
    }).length;

    return c.json({
      opco: (process.env as any).OPCO_NAME || "OpCo",
      clients,
      teamMembers,
      openItems,
      deliverables,
      stats: {
        totalClients: clients.length,
        activeClients: activeClients.length,
        openItemsCount: openCount,
        overdueDeliverables,
        upcomingRenewals30d: upcomingRenewals,
      },
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── TRANSCRIBE ───────────────────────────────────────────────────────────────
app.post("/transcribe", requireAuth, async (c) => {
  try {
    const formData = await c.req.formData();
    const audio = formData.get("audio") as File | null;
    if (!audio) return c.json({ error: "No audio file" }, 400);

    const outForm = new FormData();
    outForm.append("file", audio, "recording.webm");
    outForm.append("model", "whisper-1");

    const res = await fetch(`${(process.env as any).AI_GATEWAY_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${(process.env as any).AI_GATEWAY_API_KEY}` },
      body: outForm,
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ error: `Transcription failed: ${err}` }, 502);
    }

    const data: any = await res.json();
    return c.json({ transcript: data.text || "" });
  } catch (e: any) {
    return c.json({ error: e.message || "Transcription error" }, 500);
  }
});

// ─── OPCO SITES CONFIG ────────────────────────────────────────────────────────

async function ensureSiteSettings(db: any) {
  await await getDb().execute({sql: `CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, args: []});
}

app.get("/opco-sites", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  const db = getDb();
  try {
    await ensureSiteSettings(db);
    const row = await (await getDb().execute({sql: `SELECT value FROM site_settings WHERE key = 'opco_sites'`, args: []})).rows[0] ?? null;
    return c.json(row?.value ? JSON.parse(row.value) : []);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/opco-sites", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  const db = getDb();
  try {
    const sites = await c.req.json();
    if (!Array.isArray(sites)) return c.json({ error: "Expected array" }, 400);
    await ensureSiteSettings(db);
    await await getDb().execute({sql: `INSERT INTO site_settings (key, value) VALUES ('opco_sites', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [JSON.stringify(sites)]});
    return c.json({ success: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── REMOTE USER PROVISIONING (API-key gated, called cross-site) ──────────────

app.options("/remote/provision-user", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  return c.text("", 204);
});

app.post("/remote/provision-user", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  const db = getDb();

  // Verify regional API key
  let key = (process.env as any).REGIONAL_API_KEY || "";
  if (!key.trim()) {
    try {
      await ensureSiteSettings(db);
      const row = await (await getDb().execute({sql: `SELECT value FROM site_settings WHERE key = 'regional_api_key'`, args: []})).rows[0] ?? null;
      key = row?.value || "";
    } catch { key = ""; }
  }
  if (!key.trim()) return c.json({ error: "Remote provisioning not configured on this site" }, 403);
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${key}`) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { email, name, password, airtableId } = await c.req.json();
    if (!email || !name || !password) return c.json({ error: "email, name, and password required" }, 400);

    // Check if user already exists
    const existing = await (await getDb().execute({sql: "SELECT id FROM user WHERE email = ?", args: [email.toLowerCase()]})).rows[0] ?? null;
    if (existing) return c.json({ exists: true, userId: existing.id });

    const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
    const auth = createAuth(process.env as any, origin);
    const result = await auth.api.signUpEmail({ body: { email, name, password, role: "member", airtableId: airtableId || null } });
    return c.json({ created: true, userId: result.user?.id });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── GRANT OPCO ACCESS ────────────────────────────────────────────────────────

app.post("/admin/users/:id/grant-opco-access", requireAuth, async (c) => {
  if (!isAdmin(c)) return c.json({ error: "Admin only" }, 403);
  const db = getDb();
  try {
    const userId = c.req.param("id");
    const { siteUrls } = await c.req.json() as { siteUrls: string[] };
    if (!Array.isArray(siteUrls) || !siteUrls.length) return c.json({ error: "siteUrls required" }, 400);

    // Load the user
    const user = await (await getDb().execute({sql: "SELECT id, name, email, airtable_id FROM user WHERE id = ?", args: [userId]})).rows[0] ?? null;
    if (!user) return c.json({ error: "User not found" }, 404);

    // Load configured opco sites to get API keys
    await ensureSiteSettings(db);
    const row = await (await getDb().execute({sql: `SELECT value FROM site_settings WHERE key = 'opco_sites'`, args: []})).rows[0] ?? null;
    const opcoSites: Array<{ name: string; url: string; apiKey: string }> = row?.value ? JSON.parse(row.value) : [];

    // Generate a random temp password (user will reset via forgot password)
    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    const results: Array<{ url: string; status: "created" | "exists" | "error"; error?: string }> = [];

    for (const siteUrl of siteUrls) {
      const siteConfig = opcoSites.find(s => s.url.replace(/\/$/, "") === siteUrl.replace(/\/$/, ""));
      if (!siteConfig) { results.push({ url: siteUrl, status: "error", error: "Site not configured" }); continue; }

      try {
        const res = await fetch(`${siteConfig.url.replace(/\/$/, "")}/api/remote/provision-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${siteConfig.apiKey}` },
          body: JSON.stringify({ email: user.email, name: user.name, password: tempPassword, airtableId: user.airtable_id }),
        });
        const data = await res.json() as any;
        if (data.exists) results.push({ url: siteUrl, status: "exists" });
        else if (data.created) results.push({ url: siteUrl, status: "created" });
        else results.push({ url: siteUrl, status: "error", error: data.error || "Unknown error" });
      } catch (e: any) {
        results.push({ url: siteUrl, status: "error", error: e.message });
      }
    }

    return c.json({ results });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

export default app;