# Traylor Pro Commercial Lead Finder

**Who should Traylor Pro call today?** — a standalone app that finds, ranks and tracks new commercial cleaning opportunities.

> **Status: Phase 3 + database integration (built and tested, not yet deployed).** By default the app runs on fictional demo data in your browser. With `NEXT_PUBLIC_DATA_SOURCE=supabase` it uses the **dedicated Lead Finder Supabase project only**, with invite-only email-code sign-in. Not connected to the Employee Operations, Supply, Inventory, Command Center or Client Portal systems. Setup: **[docs/SETUP.md](docs/SETUP.md)**.

## Run it locally

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # optional — defaults to demo data
npm run dev                  # http://localhost:3000
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Unit tests for scoring, freshness, recommended actions and Today ranking |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build (also type-checks) |
| `npm run test:db` | Live tests against a **throwaway** Supabase stack (see `supabase/tests/README.md`) |

## Database mode (added after Phase 3)

- `NEXT_PUBLIC_DATA_SOURCE=supabase` + the project URL and **public** key → the app shows an invite-only sign-in (email → 6-digit code). No server secrets exist in the app.
- Same business rules as the demo (`WorkflowRepository`); only loading/saving differs (`SupabaseRepository`). Each change is saved in **one all-or-nothing call** (`lead_finder.apply_changes`) that runs as the signed-in person, never deletes, and refuses to overwrite someone else's newer change.
- Both people see each other's changes after each save, when the app comes back into view, and every minute.
- If the database settings are missing or wrong, the app says so — it never quietly switches to demo data.

## What Phase 3 added (Lead Finder + intake)

- **Leads** (`/leads`): one forgiving search box (business, property, contact, phone, email, website, address — any order, any case, one typo OK), five filters up front (Market, Property type, Score, Status, Freshness), the rest under **More filters**, and **Clear filters** whenever something is active. Cards on phones, a two-column list on wide screens. Not a Fit is hidden from the open view but found by search.
- **Lead page** (`/leads/:id`): company, property, score, opportunity, why now, potential and the ONE recommended action on top; Property · Contact · Opportunity · Sources · Activity · History start closed. Possible duplicates show a review box (Review existing · Merge · Not a duplicate).
- **Lead Finder** (`/lead-finder`): Add a lead · Add from a web link · Import a CSV, plus “recently added” and source outages.
- **Add a lead**: 5 required things (name, city, facility type, why, source). Everything else is optional under “Add more details”. Checks duplicates **before** saving, then shows the score, why, and the next step.
- **Web link sources**: the link is stored, never opened by the app. Only a person can mark it “checked”; a link that won't open is saved as **Source unavailable** (unconfirmed, not “no opportunity”).
- **CSV import**: upload → match columns → review (ready / possible duplicates / problems, per row, in plain words) → import. Duplicates are skipped unless you choose; every row is accounted for and kept in the import history.
- **Duplicate decisions are real records** (`duplicate_decisions`): create anyway, same building/new opportunity, add to existing lead, merged, not a duplicate, skipped — with who, when, the records considered and why they matched.
- **Today**: a lead whose walkthrough is done stays on Today (“Ready for a quote”) until Quote requested / Won / Lost / Not a Fit / Nurture.
- Freshness now says “Found 3d ago” unless someone actually verified it.

## What Phase 2.5 changed (UX hardening)

- Each Today card now shows only Level 1: who, where, opportunity, score, potential, why now, who to contact, and **one** recommended action button (e.g. “Call Riley”). Email · Text · Follow-Up and a **More** menu are smaller. Everything else is behind **View details**, and system detail (score math, sources, history) behind **View source & history**.
- Today's header is one line of “needs attention” chips instead of tiles plus a funnel strip.
- Fixed: dialog option buttons had a wrong accessible name; lingering toasts could cover dialog buttons.
- Draft SQL was applied to a throwaway local Postgres and tested (see `supabase/README.md`).

## What Phase 2 added (data foundation)

- Full data model (17 entities in Phase 2; Phase 3 added duplicate decisions → 18) (markets, companies, properties, contacts, property relationships, leads, opportunity signals, score breakdowns, sources, source records, field provenance, activities, follow-ups, walkthroughs, audit log, settings, user roles) — see `src/lib/domain/types.ts`.
- **Business rules are pure functions** in `src/lib/workflow/` (status changes, logging, follow-ups, walkthroughs, Lost/Not a Fit with reasons, snooze, re-verify, duplicate-aware lead intake, non-destructive merges). Any repository runs the same rules.
- **Repository seam**: UI → store → `LeadFinderRepository` (`src/lib/data/repository.ts`). Only `LocalDemoRepository` exists; every change is atomic and role-checked (Owner / Manager / Viewer).
- Explainable scoring unchanged (raw + capped score kept; score history saved only when it changes). Scoring weights live in a `lead_settings` row.
- Duplicate detection (normalized address, ~50 m, name similarity, phone, website domain) and merges that keep sources, activities, notes, follow-ups and provenance.
- Draft database design: `supabase/migrations/20261012000001_lead_finder_schema.sql` — **NOT executed anywhere.** See `supabase/README.md`.
- New UI: **Status** (with Lost reason + Undo), walkthrough outcome, “Quote requested” log, re-verify, potential opportunity value, “where the facts came from”, change history, source-outage banner, duplicate chips, role switch in Settings.

## What's in Phase 1

- App shell: desktop sidebar, mobile menu, **DEMO / LOCAL DATA** banner on every screen.
- **Today — “Who should we call today?”** Top 10 opportunities, each showing score + tier, freshness, opportunity signals, *Why this lead* (with points), *Why now*, the rule-based next step, who to contact, property manager, last contact and next follow-up.
- Working demo actions: **Call, Email, Text, Log, Follow-Up, Walkthrough, Snooze (with undo), Not a Fit (with undo)**. Changes persist in this browser only.
- Score breakdown + evidence panel on every card (every point explained; every signal shows source, dates and confidence).
- Loading, empty, error and success states (toggle them in **Settings → Demo controls**).
- Read-only previews for Leads, Pipeline, Follow-Ups, Companies, Properties, Sources; placeholders for Lead Finder and Map.

## How the code is organized

```
src/
  app/                     Next.js routes (thin wrappers around screens)
  components/
    shell/                 Layout, navigation, demo banner
    today/                 Today screen, opportunity card, action dialogs, score breakdown
    ui/                    Buttons, badges, dialog, toasts, loading/empty/error states
  screens/                 Placeholder screens + Settings
  state/                   React store (talks ONLY to the repository interface)
  lib/
    domain/                Types (mirror the planned lead_finder schema) + labels
    config/                Scoring weights / tiers / ranking settings (future lead_settings table)
    engine/                Pure, deterministic logic — scoring, freshness, recommended action, Today ranking
    data/
      repository.ts        LeadFinderRepository interface — the only seam to the backend
      demo/                Fictional seed data + LocalDemoRepository (browser-only)
```

### Swapping in Supabase later

1. Create the **dedicated** Lead Finder Supabase project (never an existing Traylor Pro project).
2. Review and approve `supabase/migrations/20261012000001_lead_finder_schema.sql`, then apply it to that dedicated project (not before approval).
3. Add `src/lib/data/supabase/supabase-repository.ts` implementing `LeadFinderRepository`.
4. Return it from `getRepository()` in `src/lib/data/index.ts` when `NEXT_PUBLIC_DATA_SOURCE=supabase`.

No screen code changes — the UI only talks to the repository interface.

## Rules this build follows

- Scores and next steps are **rule-based**, never AI. Every point is shown.
- Score is clamped 0–100 (raw total kept). Today's ranking priority is **not** clamped, so leads that hit 100 still sort meaningfully.
- Unknown square footage scores 0 — never a penalty.
- Nothing is fabricated. Demo records use `Demo …` names, fictional 555-01xx phone numbers and `example.com` addresses.
- No quoting, pricing, estimating, payroll, inventory or scraping. “Quote requested” is logged only.
