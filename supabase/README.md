# Lead Finder database (draft — not applied)

Two files, run in this order, **only** in the dedicated Lead Finder Supabase project and **only** after the CEO approves:

1. `migrations/20261012000001_lead_finder_schema.sql` — 18 tables in their own `lead_finder` schema, security rules, and the save function.
2. `migrations/20261012000002_lead_finder_reference_data.sql` — the service area (8 cities, 4 parishes) and the 3 ways leads come in. No leads, businesses, contacts or demo data.

## Status
- **Never run against any Supabase project.** Validated in a throwaway local Postgres 16 with a stub of Supabase's `auth` schema and roles (same settings as the real project: "Automatically expose new tables" OFF), then deleted.
- Connection-readiness review (Oct 12): the app's real business rules generated ~350 rows across all 16 data tables (manual intake, web-link source marked unavailable, CSV import with duplicates, merges, "not a duplicate", quote request, lost, verified, snooze, follow-up completed). Those rows were saved **as a signed-in Manager with security on**, read back as a Viewer, and compared field by field: **0 differences** in ~4,400 fields.

## Rules the database enforces (not just the app)
- Row level security on every table; nothing granted to `anon` or `public`, now or for future objects.
- Owner / Manager / Viewer, from `lead_finder.user_roles`. Signed in without a role → sees nothing, changes nothing.
- History (audit log, activities, score breakdowns, field provenance, duplicate decisions) can be added to, never edited or deleted.
- Nothing is ever deleted; merges mark records instead.
- No money columns. A size can't be stored without saying how it's known.
- The only link outside `lead_finder` is the project's own `auth.users`.

## How the app saves: `lead_finder.apply_changes(changes)`
One call = one transaction = everything saved or nothing saved (adding a lead touches ~8 tables).
- Runs **as the signed-in person** (`security invoker`), so every rule above still applies.
- Refuses a save if someone else changed the same record since it was loaded (`LF_CONFLICT`) — no silent overwrites when two people work at once.
- Refuses unknown tables/columns, changes to history, and changes to users/roles. Never deletes.
- All foreign keys are deferrable so a lead, its property and its source record can be saved together.

## Changes in the Oct 12 review
- `source_records (source_id, external_id)` index is now **not unique**: the app keeps every sighting of a row (status `duplicate`), and a unique index would have made re-importing a CSV fail outright.
- Added `apply_changes`, deferrable foreign keys, default-privilege lock-down, and the reference-data file.

`src/lib/data/schema.test.ts` keeps this SQL and the app's data model in step.
Keys: the app needs only the project URL and the public (anon) key. The service-role key and database password never go in code, git, or chat.
