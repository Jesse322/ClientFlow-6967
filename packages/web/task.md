# Airtable → D1 Migration — COMPLETE

## Status: Build passing, ready to deploy

## What was done
- Created `src/api/db.ts` — D1 query helpers returning `{ id, fields }` shape (zero frontend changes)
- Created `src/api/migrations/0004_d1_core_tables.sql` — all new tables
- Rewrote all data routes (clients, deliverables, open_items, team_members, omni) to use D1
- Added `POST /api/migrate-from-airtable` — one-time migration from Airtable to D1
- Added new tables to `run-migrations` inline fallback
- All secondary routes (compliance, renewal, AI, telegram, inbound-email, share-access, leaderboard) updated to D1
- No frontend changes needed — API response shape unchanged

## Deploy steps
1. Deploy via Runable dashboard
2. POST /api/run-migrations (or it runs on next deploy trigger)
3. POST /api/migrate-from-airtable (one time only — pulls all Airtable data into D1)
4. Verify data shows up
5. Optionally remove AIRTABLE_TOKEN from env vars (keep for now as fallback)
