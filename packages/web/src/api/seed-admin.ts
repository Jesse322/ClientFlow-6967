import { createAuth } from "./auth";

const ADMIN_EMAIL = "jesse.valenitne@usi.com";
const ADMIN_PASSWORD = "ClientFlow2026!";
const ADMIN_AIRTABLE_ID = "recVyjDX31kYK91GE";

let seeded = false;

export async function seedAdmin(env: { DB: D1Database; BETTER_AUTH_SECRET: string }, baseURL: string) {
  if (seeded) return;
  seeded = true;
  try {
    const existing = await (env.DB as any)
      .prepare("SELECT id FROM user WHERE email = ?")
      .bind(ADMIN_EMAIL)
      .first();
    if (existing) return;

    const auth = createAuth(env, baseURL);
    await auth.api.signUpEmail({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        name: "Jesse Valentine",
        role: "admin",
        airtableId: ADMIN_AIRTABLE_ID,
      },
    });
    console.log("[seed] Admin account created:", ADMIN_EMAIL);
  } catch (e) {
    console.error("[seed] Admin seed failed:", e);
  }
}
