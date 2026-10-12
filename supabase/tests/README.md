# Live database tests

`live-stack.test.ts` runs the app's real data layer (`SupabaseRepository`, `supabaseDb`, `supabaseAuth`) and the
official `@supabase/supabase-js` client against a running Supabase-compatible stack with **both migrations applied**.

⚠ It creates test leads. Run it only against a **local stack or a throwaway project — never the real Lead Finder project.**
It refuses to run unless `LF_TEST_THROWAWAY=yes`.

## What it needs
| Setting | Meaning |
|---|---|
| `LF_TEST_THROWAWAY=yes` | Explicit confirmation this is not the real project |
| `LF_TEST_SUPABASE_URL`, `LF_TEST_ANON_KEY` | The test stack's URL and public key |
| `LF_TEST_MAILBOX_URL` | A test mailbox that returns captured emails as JSON (`GET ?to=<email>`) |
| `LF_TEST_OWNER_EMAIL`, `LF_TEST_MANAGER_EMAIL` | Invited (not yet accepted) and given Owner / Manager roles |
| `LF_TEST_VIEWER_EMAIL` | Created confirmed, Viewer role |
| `LF_TEST_NOROLE_EMAIL` | Created confirmed, **no** role |
| `LF_TEST_PENDING_EMAIL` (optional) | Invited, never accepted |

The Auth server must use `email-templates/magic-link.html` for its Magic Link email (so the email contains the code).

Run: `npx tsx --test supabase/tests/live-stack.test.ts`

## Last result (Oct 12, 2026)
17 / 17 passed against Postgres 16 + Supabase Auth v2.197.0 + PostgREST v13.0.8 + supabase-js v2.117.3, with a local
gateway that mimics Supabase's (API-key check, open email-link routes, CORS) and a local mailbox.
This was **not** the hosted Supabase service — the real project still needs the iPhone test plan.
