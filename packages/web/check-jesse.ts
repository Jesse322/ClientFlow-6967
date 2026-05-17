import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

console.log("=== user table ===");
const users = await db.execute(`SELECT id, name, email, email_verified, role FROM user WHERE email LIKE '%jesse%'`);
console.log(users.rows);

console.log("\n=== account table (Jesse's) ===");
const accs = await db.execute(`SELECT id, account_id, provider_id, user_id, password FROM account WHERE user_id = 'piSFsaWoo5jLEVvtOsgeuxgZuL72X3Rp'`);
console.log(accs.rows);

console.log("\n=== all users ===");
const all = await db.execute(`SELECT id, name, email, role FROM user ORDER BY created_at`);
for (const r of all.rows) console.log(r);
