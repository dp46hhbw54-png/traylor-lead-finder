/**
 * LIVE INTEGRATION TESTS — real Supabase components, real network calls, real row-level security.
 *
 * Runs the app's own data layer (SupabaseRepository + supabaseDb + supabaseAuth) and the official
 * @supabase/supabase-js client against a running Supabase-compatible stack:
 *   Postgres + Supabase Auth (GoTrue) + PostgREST + an API gateway, with BOTH migrations applied.
 *
 * ⚠ It CREATES test leads and activity. Run it ONLY against a local stack or a throwaway project —
 *   NEVER against the real Lead Finder project. It refuses to run unless LF_TEST_THROWAWAY=yes.
 *
 * Required environment (see supabase/tests/README.md):
 *   LF_TEST_THROWAWAY=yes
 *   LF_TEST_SUPABASE_URL, LF_TEST_ANON_KEY
 *   LF_TEST_OWNER_EMAIL, LF_TEST_MANAGER_EMAIL, LF_TEST_VIEWER_EMAIL, LF_TEST_NOROLE_EMAIL
 *     (owner + manager INVITED and not yet accepted; viewer + no-role created confirmed;
 *      owner/manager/viewer given roles in lead_finder.user_roles; no-role given none)
 *   LF_TEST_MAILBOX_URL  a test mailbox that returns captured emails as JSON: GET ?to=<email>
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAuth } from "../../src/lib/data/supabase/auth";
import { supabaseDb, type SupabaseLikeClient } from "../../src/lib/data/supabase/db";
import { NoAccessError, SignedOutError, SupabaseRepository } from "../../src/lib/data/supabase/supabase-repository";
import { pickIntakeSource } from "../../src/lib/workflow/intake-source";
import type { NewLeadInput } from "../../src/lib/workflow/ingest";

const env = process.env;
const ENABLED = env.LF_TEST_THROWAWAY === "yes" && !!env.LF_TEST_SUPABASE_URL && !!env.LF_TEST_ANON_KEY && !!env.LF_TEST_MAILBOX_URL;
const URL_ = env.LF_TEST_SUPABASE_URL ?? "";
const KEY = env.LF_TEST_ANON_KEY ?? "";
const EMAIL = {
  owner: env.LF_TEST_OWNER_EMAIL ?? "",
  manager: env.LF_TEST_MANAGER_EMAIL ?? "",
  viewer: env.LF_TEST_VIEWER_EMAIL ?? "",
  norole: env.LF_TEST_NOROLE_EMAIL ?? "",
};

const newClient = () => createClient(URL_, KEY, { db: { schema: "lead_finder" }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Mail {
  to: string[];
  raw: string;
  at: number;
}
async function inbox(email: string): Promise<Mail[]> {
  const res = await fetch(`${env.LF_TEST_MAILBOX_URL}?to=${encodeURIComponent(email)}`);
  return (await res.json()) as Mail[];
}
const decode = (raw: string) => raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
async function waitForMail(email: string, since: number, match: RegExp): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const m = (await inbox(email)).filter((x) => x.at >= since).map((x) => decode(x.raw)).find((b) => match.test(b));
    if (m) return m;
    await sleep(150);
  }
  return null;
}

/** The real sign-in flow: ask for a code (as the app does), read it from the email, type it in. */
async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient();
  const auth = supabaseAuth(client.auth as never);
  const since = Date.now() - 50;
  assert.deepEqual(await auth.sendCode(email), { ok: true });
  const mail = await waitForMail(email, since, /sign-in code/i);
  assert.ok(mail, `a sign-in code email reached ${email}`);
  const code = /\b(\d{6})\b/.exec(mail.split(/\r?\n\r?\n/).slice(1).join("\n"))?.[1];
  assert.ok(code, "the email contains a 6-digit code");
  assert.deepEqual(await auth.verifyCode(email, code), { ok: true });
  return client;
}

/** An invited person taps "Accept invitation": the link confirms the account and signs them in. */
async function acceptInvite(email: string) {
  const mail = await waitForMail(email, 0, /invited/i);
  assert.ok(mail, `${email} received an invitation email`);
  const link = /href="([^"]+\/verify\?[^"]+)"/.exec(mail)?.[1]?.replace(/&amp;/g, "&");
  assert.ok(link, "the invitation contains a link");
  const res = await fetch(link, { redirect: "manual" });
  assert.ok([302, 303].includes(res.status), `invite link redirects (got ${res.status})`);
  assert.match(res.headers.get("location") ?? "", /access_token=/, "and hands back a session for the app to pick up");
}

const repoFor = (c: SupabaseClient) => new SupabaseRepository(supabaseDb(c as unknown as SupabaseLikeClient));
const rawDb = (c: SupabaseClient) => c as unknown as SupabaseLikeClient;

function linkLead(sources: Parameters<typeof pickIntakeSource>[0], name: string, url: string): NewLeadInput {
  const pick = pickIntakeSource(sources, true);
  assert.ok(pick.ok);
  return {
    title: "Listing shows the building as newly leased",
    company: { name },
    property: { city: "Gonzales", facilityType: "warehouse" },
    signals: [{ type: "recently_leased", description: "TEST: listing marked leased", confidence: "publicly_reported" }],
    source: { sourceId: pick.source.id, sourceUrl: url, kind: "property_listing" },
  };
}

describe("LIVE: Lead Finder against real Supabase components", { skip: ENABLED ? false : "set LF_TEST_THROWAWAY=yes and the LF_TEST_* settings to run" }, () => {
  let owner: SupabaseClient, manager: SupabaseClient, viewer: SupabaseClient;
  const stamp = Date.now().toString(36);

  before(async () => {
    // Both invited people accept their invitation once, then sign in with emailed codes like every other day.
    await acceptInvite(EMAIL.owner);
    await acceptInvite(EMAIL.manager);
    owner = await signIn(EMAIL.owner);
    manager = await signIn(EMAIL.manager);
    viewer = await signIn(EMAIL.viewer);
  });

  // ------------------------------------------------------------------ sign-in / sign-out / access
  it("signed out: nothing can be read, and the app shows sign-in", async () => {
    const anon = newClient();
    const { data, error } = await anon.from("leads").select("id");
    assert.ok(error, "the database refuses");
    assert.equal(data, null);
    await assert.rejects(repoFor(anon).loadSnapshot(), SignedOutError);
  });

  it("nobody can register: public sign-up and code requests for unknown emails create no account", async () => {
    const c = newClient();
    const { error } = await c.auth.signUp({ email: `stranger-${stamp}@leadfinder.test`, password: "A-long-test-password-1" });
    assert.ok(error, "public sign-up is refused");
    const r = await supabaseAuth(c.auth as never).sendCode(`stranger-${stamp}@leadfinder.test`);
    assert.deepEqual(r, { ok: true }, "same answer as for a real account (no probing)");
    assert.equal((await inbox(`stranger-${stamp}@leadfinder.test`)).length, 0, "but no email is ever sent");
  });

  it("an invited person who hasn't accepted the invitation gets no code (why the sign-in screen says to accept first)", async () => {
    const c = newClient();
    const pendingEmail = env.LF_TEST_PENDING_EMAIL;
    if (!pendingEmail) return; // optional extra account; covered in the stack README
    const since = Date.now();
    await supabaseAuth(c.auth as never).sendCode(pendingEmail);
    assert.equal(await waitForMail(pendingEmail, since, /sign-in code/i), null);
  });

  it("a wrong code is refused", async () => {
    // (Supabase also limits code requests per email — 60 s by default; the sign-in screen's "New code" countdown matches.)
    const r = await supabaseAuth(newClient().auth as never).verifyCode(EMAIL.viewer, "000000");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /didn't work/);
  });

  it("signed in without a role: sees nothing, can save nothing", async () => {
    const c = await signIn(EMAIL.norole);
    await assert.rejects(repoFor(c).loadSnapshot(), NoAccessError);
    const { data } = await c.from("leads").select("id");
    assert.deepEqual(data, [], "row-level security returns no rows");
    const { error } = await c.rpc("apply_changes", { changes: { rows: {} } });
    assert.match(String(error?.message), /LF_NO_ROLE/);
  });

  // ------------------------------------------------------------------ shared data
  it("both of you see the same data: starter markets and sources are there for everyone", async () => {
    const [a, b] = await Promise.all([repoFor(owner).loadSnapshot(), repoFor(manager).loadSnapshot()]);
    assert.equal(a.markets.length, 12);
    assert.deepEqual(a.sources.map((s) => s.type).sort(), ["csv", "manual", "url"]);
    assert.deepEqual(a.leads.map((l) => l.id).sort(), b.leads.map((l) => l.id).sort());
  });

  it("a lead one person saves from a web link appears for the other, filed under the web-link source", async () => {
    const wife = repoFor(manager);
    const s = await wife.loadSnapshot();
    const r = await wife.createLead(linkLead(s.sources, `TEST Shared Warehouse ${stamp}`, `https://example.com/listing/${stamp}`));
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    const kody = await repoFor(owner).loadSnapshot();
    const lead = kody.leads.find((l) => l.id === r.leadId);
    assert.ok(lead, "Kody sees the lead his wife saved");
    assert.equal(kody.sources.find((x) => x.id === lead.sourceId)?.type, "url");
    const rec = kody.sourceRecords.find((x) => x.importedLeadId === r.leadId);
    assert.equal(rec?.sourceUrl, `https://example.com/listing/${stamp}`);
    assert.equal(kody.sources.find((x) => x.id === rec?.sourceId)?.type, "url");
    assert.equal(lead.isDemo, false);
    assert.ok(kody.scoreBreakdowns.some((b) => b.leadId === r.leadId), "the score and its explanation were saved");
    assert.ok(kody.activities.some((a) => a.leadId === r.leadId && a.performedBy === "Wife"), "the timeline says who added it");
  });

  it("activity logged by one person shows for the other, stamped with who did it", async () => {
    const kodyRepo = repoFor(owner);
    const s = await kodyRepo.loadSnapshot();
    const lead = s.leads.find((l) => l.title.startsWith("Listing shows"))!;
    await kodyRepo.logActivity({ leadId: lead.id, type: "call", summary: `TEST call ${stamp}` });
    const w = await repoFor(manager).loadSnapshot();
    assert.ok(w.activities.some((a) => a.summary === `TEST call ${stamp}` && a.performedBy === "Kody"));
    const { data } = await manager.from("activities").select("performed_by_user_id").eq("summary", `TEST call ${stamp}`);
    const { data: who } = await owner.auth.getUser();
    assert.equal(data?.[0]?.performed_by_user_id, who.user?.id, "the database records the signed-in account, not just a name");
  });

  it("conflicting edits: the second, out-of-date change is refused and nothing is overwritten", async () => {
    const kodyRepo = repoFor(owner);
    const wifeRepo = repoFor(manager);
    const s = await kodyRepo.loadSnapshot();
    await wifeRepo.loadSnapshot();
    const lead = s.leads.find((l) => l.title.startsWith("Listing shows"))!;
    const [first, second] = (["very_high", "high", "medium", "low"] as const).filter((v) => v !== lead.potentialValue);
    await kodyRepo.setPotentialValue(lead.id, first);
    await assert.rejects(wifeRepo.setPotentialValue(lead.id, second), /Someone else changed this lead/);
    assert.equal((await kodyRepo.loadSnapshot()).leads.find((l) => l.id === lead.id)?.potentialValue, first, "Kody's change survived");
    await wifeRepo.setPotentialValue(lead.id, second); // retry on the latest data works
    assert.equal((await kodyRepo.loadSnapshot()).leads.find((l) => l.id === lead.id)?.potentialValue, second);
  });

  it("duplicate decisions are recorded and permanent", async () => {
    const wife = repoFor(manager);
    const s = await wife.loadSnapshot();
    const input = linkLead(s.sources, `TEST Shared Warehouse ${stamp}`, `https://example.com/listing/${stamp}-again`);
    const first = await wife.createLead(input);
    assert.equal(first.status, "duplicates_found", "the same business is caught as a possible duplicate");
    const r = await wife.createLead(input, { duplicateAction: "create_anyway", decisionNote: `TEST second location ${stamp}` });
    assert.equal(r.status, "created");
    const { data } = await manager.from("duplicate_decisions").select("id, decision").eq("note", `TEST second location ${stamp}`);
    assert.equal(data?.length, 1);
    const del = await manager.from("duplicate_decisions").delete().eq("id", data![0].id).select("id");
    assert.ok(del.error || (del.data ?? []).length === 0, "can't be deleted");
    const upd = await manager.from("duplicate_decisions").update({ note: "rewritten" }).eq("id", data![0].id).select("id");
    assert.ok(upd.error || (upd.data ?? []).length === 0, "can't be edited");
  });

  // ------------------------------------------------------------------ permissions, enforced by the database
  it("Viewer: can read, but every write is refused — by the app AND by the database", async () => {
    const repo = repoFor(viewer);
    const s = await repo.loadSnapshot();
    assert.ok(s.leads.length > 0);
    await assert.rejects(repo.createLead(linkLead(s.sources, "TEST viewer", "https://example.com/v")), /can't change them/);
    const ins = await viewer.from("activities").insert({ lead_id: s.leads[0].id, type: "note", summary: "viewer", performed_by: "viewer" }).select("id");
    assert.ok(ins.error, "direct insert refused");
    const upd = await viewer.from("leads").update({ notes: "viewer edit" }).eq("id", s.leads[0].id).select("id");
    assert.ok(upd.error || (upd.data ?? []).length === 0, "direct update changes nothing");
    const rpc = await viewer.rpc("apply_changes", { changes: { rows: { leads: [{ id: s.leads[0].id, notes: "viewer via save" }] } } });
    assert.ok(rpc.error, "the save function refuses too");
  });

  it("nobody but an Owner can change roles — no self-promotion", async () => {
    for (const c of [manager, viewer]) {
      const { data: me } = await c.auth.getUser();
      const res = await c.from("user_roles").update({ role: "owner" }).eq("user_id", me.user!.id).select("id");
      assert.ok(res.error || (res.data ?? []).length === 0);
      const add = await c.from("user_roles").insert({ email: `x-${stamp}@leadfinder.test`, display_name: "x", role: "owner" }).select("id");
      assert.ok(add.error);
    }
    const { data } = await owner.from("user_roles").select("email, role").order("email");
    assert.deepEqual(data?.find((r) => r.email === EMAIL.manager)?.role, "manager", "still a Manager");
  });

  it("scoring settings: Managers can't change them, the Owner can", async () => {
    const row = { key: `test-${stamp}`, value: { a: 1 }, version: 1, updated_by: "test" };
    assert.ok((await manager.from("lead_settings").insert(row).select("key")).error);
    assert.ok((await manager.rpc("apply_changes", { changes: { rows: { lead_settings: [row] } } })).error);
    assert.equal((await owner.rpc("apply_changes", { changes: { rows: { lead_settings: [row] } } })).error, null);
  });

  it("history can't be rewritten and nothing can be deleted", async () => {
    const { data: act } = await manager.from("activities").select("id").limit(1);
    const id = act![0].id;
    const upd = await manager.from("activities").update({ summary: "rewritten" }).eq("id", id).select("id");
    assert.ok(upd.error || (upd.data ?? []).length === 0);
    const viaSave = await manager.rpc("apply_changes", { changes: { rows: { activities: [{ id, summary: "rewritten" }] } } });
    assert.match(String(viaSave.error?.message), /history/);
    const { data: lead } = await owner.from("leads").select("id").limit(1);
    const del = await owner.from("leads").delete().eq("id", lead![0].id).select("id");
    assert.ok(del.error || (del.data ?? []).length === 0, "even the Owner can't delete a lead");
  });

  it("only the lead_finder schema is reachable", async () => {
    const other = createClient(URL_, KEY, { db: { schema: "public" }, auth: { persistSession: false } });
    const { error } = await other.from("anything").select("*");
    assert.ok(error);
    const authUsers = await (owner as unknown as { schema(s: string): SupabaseClient }).schema("auth").from("users").select("id");
    assert.ok(authUsers.error, "the sign-in system's tables are not exposed");
  });

  it("raw save function: one bad row rolls back the whole save", async () => {
    const { data: lead } = await manager.from("leads").select("id, status").limit(1);
    const id = lead![0].id;
    const actId = crypto.randomUUID();
    const res = await rawDb(manager).rpc("apply_changes", {
      changes: { rows: { activities: [{ id: actId, lead_id: id, type: "note", summary: "TEST rollback", performed_by: "test" }], leads: [{ id, status: "not-a-status" }] } },
    });
    assert.ok(res.error);
    const { data } = await manager.from("activities").select("id").eq("id", actId);
    assert.deepEqual(data, [], "the activity in the same save was not kept");
  });

  it("sign-out ends access on that device", async () => {
    const c = viewer; // last test: signs the shared viewer session out
    const auth = supabaseAuth(c.auth as never);
    assert.ok(await auth.getSession());
    assert.deepEqual(await auth.signOut(), { ok: true });
    assert.equal(await auth.getSession(), null);
    await assert.rejects(repoFor(c).loadSnapshot(), SignedOutError);
  });
});
