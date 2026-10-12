# Setting up the Lead Finder database and putting it online

For the **dedicated Lead Finder Supabase project only** (`traylor-lead-finder`). Never run any of this in another
Traylor Pro project. Every step can be done from an iPhone. Supabase screen names change from time to time — if a
label differs slightly, look for the closest match.

Nothing here has been done yet. Do the steps only after you approve them.

---

## Part 1 — Supabase project settings (about 10 minutes)

1. **Reset the database password** (the old one was pasted in chat): Project Settings → Database → *Reset database password*. Save the new one in your password manager. The app never needs it.
2. **Sign-ups OFF**: Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". Keep **Email** enabled.
3. **Email codes**: Authentication → Emails → Templates → **Magic Link**. Set the subject to `Your Lead Finder sign-in code`. Replace the message with the contents of [`supabase/email-templates/magic-link.html`](../supabase/email-templates/magic-link.html). Save.
4. **Email sender (required for your wife)**: Supabase's built-in sender only delivers to members of your Supabase team and only about 2 emails an hour. Set up your own sender under Authentication → Emails → **SMTP Settings**. Any of these works: Resend, Brevo or SendGrid (free tiers), or Google Workspace / Microsoft 365 SMTP. The SMTP password you enter there stays inside Supabase and never goes in the app.

## Part 2 — Create the database (about 5 minutes)

5. On GitHub, open `supabase/migrations/20261012000001_lead_finder_schema.sql` → tap **Raw** → select all → copy.
   In Supabase: SQL Editor → New query → paste → **Run**. It should say "Success. No rows returned".
6. Do the same with `supabase/migrations/20261012000002_lead_finder_reference_data.sql`.
7. **Expose the schema**: Project Settings → Data API → *Exposed schemas* → add **`lead_finder`** → Save. Leave "Automatically expose new tables" **off**.

## Part 3 — Put the app online with Vercel (about 10 minutes)

8. vercel.com → Add New → Project → import **dp46hhbw54-png/traylor-lead-finder**. Framework: Next.js (detected).
9. Before the first deploy, add these **Environment Variables** (Production, Preview and Development):

   | Name | Value | Public or secret? |
   |---|---|---|
   | `NEXT_PUBLIC_DATA_SOURCE` | `supabase` | Public setting |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → *Project URL* | **Public** (in every visitor's browser by design) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → the **anon** key (or the **publishable** key) | **Public** — safe only because row-level security protects every table |

   **Do not add** the service_role / secret key, the database password, or a database connection string.
   The app doesn't use them. If a secret key is pasted into a `NEXT_PUBLIC_` variable by mistake, the app refuses
   to start and says so. In that case, rotate that key in Supabase.
10. Deploy. Copy your site address, e.g. `https://traylor-lead-finder.vercel.app`.
11. Back in Supabase: Authentication → URL Configuration → **Site URL** = your Vercel address. Under **Redirect URLs**, add `https://YOUR-ADDRESS/**`.

## Part 4 — Invite the two of you (invite-only)

12. Authentication → Users → **Add user → Send invitation** → your email. Repeat for your wife's email.
13. SQL Editor → run (with your real emails and names):
    ```sql
    insert into lead_finder.user_roles (user_id, email, display_name, role)
    select id, email, 'Kody', 'owner' from auth.users where email = 'YOUR EMAIL';

    insert into lead_finder.user_roles (user_id, email, display_name, role)
    select id, email, 'YOUR WIFE''S NAME', 'manager' from auth.users where email = 'HER EMAIL';
    ```
    Use `'viewer'` for anyone who should only look. An account without a row here can sign in but sees nothing.
14. Each of you: open the invitation email **on your iPhone** and tap **Accept invitation**. It opens the Lead Finder already signed in.
    After that, sign in any time with **Email me a code**. Codes only arrive after the invitation has been accepted.
    If an invitation is re-sent, only the newest link works.

Removing someone: Authentication → Users → delete the user, or `update lead_finder.user_roles set active = false where email = '…';`.

---

## Part 5 — Test from both iPhones

Do these in Safari on both phones. Write down anything confusing. Not only bugs.

| # | Who | Do this | Expect |
|---|---|---|---|
| 1 | Either | Open the site in a private tab, not signed in | Only the sign-in screen. No leads, no demo banner |
| 2 | Kody | Accept invitation (step 14) | App opens signed in. Menu shows your email |
| 3 | Wife | Accept invitation | Same |
| 4 | Kody | Menu → Sign out, then **Email me a code** → type the 6-digit code | Signed in again. Code arrives within a minute (check Junk) |
| 5 | Kody | Lead Finder → **Add from a web link** → a real listing link → save | "Lead saved" with score and next step |
| 6 | Wife | Leads → search the business name | She sees Kody's lead. Sources show **Web link** and the link |
| 7 | Wife | On that lead, log a call or change the stage | Saved |
| 8 | Kody | Switch away from Safari and back (or wait a minute) | Her change appears |
| 9 | Both | Open the same lead. Both change the stage within a few seconds | Second person sees "Someone else changed this lead…". Nothing is overwritten. Retry works |
| 10 | Kody | Airplane mode → try to save a new lead | "Couldn't reach the Lead Finder database. Nothing was saved." What you typed is still there. Turn airplane mode off → Save works |
| 11 | Either | Add to Home Screen, open from the icon | If it asks you to sign in again, that's expected the first time. Use **Email me a code** (home-screen apps keep their own sign-in) |
| 12 | Either | Rotate the phone, use one hand | No sideways scrolling. Buttons easy to hit |
| 13 | Kody | Settings | Shows you as Owner and lists who has access. **Sign out** works |

## If something goes wrong
- **"The Lead Finder isn't connected"** → a Vercel variable is missing or wrong. Fix it and redeploy.
- **No code email** → check Junk. Make sure the invitation was accepted first (step 14) and custom SMTP is set (step 4).
- **"doesn't have access to the Lead Finder yet"** → that email has no row in `lead_finder.user_roles` (step 13).
- **Everything empty after signing in** → `lead_finder` isn't in Exposed schemas (step 7).
