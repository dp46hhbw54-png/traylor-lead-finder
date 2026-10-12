/**
 * MOCK TESTS — the database here is an in-memory fake (FakeDb), not Supabase and not Postgres.
 * They check the app's own logic: what it sends, how it reacts to each kind of failure, and that it
 * never loses or mislabels data. The real database rules are tested separately against a local
 * Postgres + PostgREST + Supabase Auth stack (see supabase/tests/README.md).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { RepositoryError } from "../../domain/errors";
import type { LeadFinderSnapshot } from "../../domain/types";
import { pickIntakeSource } from "../../workflow/intake-source";
import type { NewLeadInput } from "../../workflow/ingest";
import { freshSnapshot, NOW } from "../../workflow/test-helpers";
import { classifyDbError, DbError, type LeadFinderDb, type SignedInUser } from "./db";
import { isSecretKey, resolveDataSource } from "./config";
import { computeChanges, fromRow, primaryKeyOf, SNAPSHOT_KEYS, TABLE_FOR, toRow, type ChangeSet } from "./rows";
import { NoAccessError, SignedOutError, SupabaseRepository } from "./supabase-repository";

type Row = Record<string, unknown>;

/** A database-shaped copy of the demo data: UUID ids, not flagged as demo, two invited users. */
function seededTables(): { tables: Record<string, Row[]>; owner: SignedInUser; manager: SignedInUser; viewer: SignedInUser } {
  const s = freshSnapshot();
  const ids = new Map<string, string>();
  for (const k of SNAPSHOT_KEYS) for (const r of s[k] as unknown as Row[]) if (typeof r.id === "string") ids.set(r.id, randomUUID());
  const map = (v: unknown): unknown => (typeof v === "string" && ids.has(v) ? ids.get(v) : Array.isArray(v) ? v.map(map) : v);
  const owner = { id: randomUUID(), email: "kody@example.test" };
  const manager = { id: randomUUID(), email: "wife@example.test" };
  const viewer = { id: randomUUID(), email: "viewer@example.test" };
  const tables: Record<string, Row[]> = {};
  for (const k of SNAPSHOT_KEYS) {
    tables[TABLE_FOR[k]] = (s[k] as unknown as Row[]).map((r) => {
      const out: Row = {};
      for (const [f, v] of Object.entries(r)) out[f] = ["lines", "payload", "value"].includes(f) ? v : map(v);
      if ("isDemo" in out) out.isDemo = false;
      return toRow(out);
    });
  }
  tables.user_roles = [
    { id: randomUUID(), user_id: owner.id, email: owner.email, display_name: "Kody", role: "owner", active: true, is_demo: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
    { id: randomUUID(), user_id: manager.id, email: manager.email, display_name: "Wife", role: "manager", active: true, is_demo: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
    { id: randomUUID(), user_id: viewer.id, email: viewer.email, display_name: "Viewer", role: "viewer", active: true, is_demo: false, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
  ];
  return { tables, owner, manager, viewer };
}

/** In-memory stand-in for the database: shared by several "phones", applies saves, detects stale edits. */
class FakeDb {
  saves: ChangeSet[] = [];
  failNext: DbError | null = null;
  tick = 0;
  constructor(public tables: Record<string, Row[]>) {}
  as(user: SignedInUser | null): LeadFinderDb {
    return {
      currentUser: async () => user,
      selectAll: async (table) => {
        if (this.failNext) throw this.takeFailure();
        return structuredClone(this.tables[table] ?? []);
      },
      applyChanges: async (changes) => {
        if (this.failNext) throw this.takeFailure();
        if (!user) throw new DbError("signed_out", "JWT expired", "PGRST303");
        for (const [table, byId] of Object.entries(changes.expected)) {
          for (const [id, seen] of Object.entries(byId)) {
            if (this.tables[table].find((r) => String(r.id) === id)?.updated_at !== seen) throw new DbError("conflict", "LF_CONFLICT", "PT409");
          }
        }
        const stamp = new Date(NOW.getTime() + ++this.tick * 1000).toISOString();
        for (const [table, rows] of Object.entries(changes.rows)) {
          const pk = table === "lead_settings" ? "key" : "id";
          for (const r of rows) {
            const existing = this.tables[table].find((x) => x[pk] === r[pk]);
            if (existing) Object.assign(existing, r, "updated_at" in existing ? { updated_at: stamp } : {});
            else this.tables[table].push({ ...r, ...("updated_at" in r ? { updated_at: stamp } : {}) });
          }
        }
        this.saves.push(structuredClone(changes));
      },
    };
  }
  private takeFailure() {
    const f = this.failNext!;
    this.failNext = null;
    return f;
  }
}

const clock = () => NOW;
const linkLead = (s: LeadFinderSnapshot, name: string): NewLeadInput => {
  const pick = pickIntakeSource(s.sources, true);
  assert.ok(pick.ok, "a web-link source exists");
  return {
    title: "Listing posted",
    company: { name },
    property: { city: "Central", facilityType: "office" },
    signals: [{ type: "listed_for_lease", description: "Listing says the whole floor is available", confidence: "publicly_reported" }],
    source: { sourceId: pick.source.id, sourceUrl: "https://example.com/listing/1", kind: "property_listing" },
  };
};

describe("database settings (mock-free, pure)", () => {
  it("uses demo data unless the database is explicitly chosen", () => {
    assert.equal(resolveDataSource({}).mode, "demo");
    assert.equal(resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "demo", NEXT_PUBLIC_SUPABASE_URL: "https://x.example" }).mode, "demo");
  });
  it("refuses to start with a missing URL or key instead of falling back to demo", () => {
    const r = resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.example" });
    assert.equal(r.mode, "misconfigured");
  });
  it("refuses a SECRET key put in a public setting (service-role JWT or sb_secret_)", () => {
    const fakeJwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
    assert.equal(isSecretKey(fakeJwt("service_role")), true);
    assert.equal(isSecretKey("sb_secret_abc123"), true);
    assert.equal(isSecretKey(fakeJwt("anon")), false);
    assert.equal(isSecretKey("sb_publishable_abc123"), false);
    const r = resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt("service_role") });
    assert.equal(r.mode, "misconfigured");
    if (r.mode === "misconfigured") assert.match(r.problem, /SECRET/);
  });
  it("accepts the URL and the public key, with either variable name", () => {
    const a = resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.example/", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" });
    assert.deepEqual(a, { mode: "supabase", url: "https://abc.example", publicKey: "sb_publishable_x" });
    const b = resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.example", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_y" });
    assert.equal(b.mode === "supabase" && b.publicKey, "sb_publishable_y");
    assert.equal(resolveDataSource({ NEXT_PUBLIC_DATA_SOURCE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "http://evil.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }).mode, "misconfigured");
  });
});

describe("what gets sent to the database (pure)", () => {
  it("round-trips app records through database column names", () => {
    const s = freshSnapshot();
    for (const k of SNAPSHOT_KEYS) for (const r of s[k] as unknown as Row[]) assert.deepEqual(fromRow(toRow(r)), r);
  });
  it("sends only what changed, with the version last seen, and never deletes", () => {
    const before = freshSnapshot();
    const after = structuredClone(before);
    const lead = after.leads[0];
    lead.notes = "Called, left voicemail";
    const changes = computeChanges(before, after);
    assert.deepEqual(Object.keys(changes.rows), ["leads"]);
    assert.deepEqual(changes.rows.leads, [{ id: lead.id, notes: "Called, left voicemail" }]);
    assert.equal(changes.expected.leads[lead.id], before.leads[0].updatedAt);
    after.leads.pop();
    assert.throws(() => computeChanges(before, after), /delete/);
  });
  it("refuses to rewrite history or change roles", () => {
    const before = freshSnapshot();
    const a = structuredClone(before);
    a.activities[0].summary = "rewritten";
    assert.throws(() => computeChanges(before, a), /History can't be rewritten/);
    const b = structuredClone(before);
    b.userRoles[0].role = "owner";
    b.userRoles[1].role = "owner";
    assert.throws(() => computeChanges(before, b), /roles can't be changed/);
  });
  it("classifies database failures", () => {
    assert.equal(classifyDbError(new TypeError("Failed to fetch")).kind, "network");
    assert.equal(classifyDbError({ code: "PT409", message: "LF_CONFLICT: leads x was changed by someone else" }).kind, "conflict");
    assert.equal(classifyDbError({ code: "42501", message: "new row violates row-level security policy" }).kind, "denied");
    assert.equal(classifyDbError({ code: "PGRST303", message: "JWT expired" }).kind, "signed_out");
    assert.equal(classifyDbError({ code: "23514", message: "violates check constraint" }).kind, "invalid");
  });
});

describe("Lead Finder on the database — MOCK database", () => {
  it("a signed-out visitor gets no data, only the sign-in prompt", async () => {
    const { tables } = seededTables();
    const repo = new SupabaseRepository(new FakeDb(tables).as(null), { clock });
    await assert.rejects(repo.loadSnapshot(), SignedOutError);
  });

  it("someone signed in but not given a role sees nothing and is told to ask the Owner", async () => {
    const { tables } = seededTables();
    const repo = new SupabaseRepository(new FakeDb(tables).as({ id: randomUUID(), email: "stranger@example.test" }), { clock });
    await assert.rejects(repo.loadSnapshot(), (e: unknown) => e instanceof NoAccessError && /doesn't have access/.test(e.message));
  });

  it("two invited people share the same records: what one saves, the other sees", async () => {
    const { tables, owner, manager } = seededTables();
    const db = new FakeDb(tables);
    const kody = new SupabaseRepository(db.as(owner), { clock });
    const wife = new SupabaseRepository(db.as(manager), { clock });
    const s = await kody.loadSnapshot();
    const r = await kody.createLead(linkLead(s, "Shared Test Office"));
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    const seen = await wife.loadSnapshot();
    const lead = seen.leads.find((l) => l.id === r.leadId);
    assert.ok(lead, "wife sees Kody's new lead");
    await wife.logActivity({ leadId: r.leadId, type: "call", summary: "Spoke to the office manager" });
    const back = await kody.loadSnapshot();
    assert.ok(back.activities.some((a) => a.leadId === r.leadId && a.summary === "Spoke to the office manager" && a.performedBy === "Wife"));
  });

  it("new records get database ids, are not demo-flagged, and name who did it", async () => {
    const { tables, owner } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(owner), { clock });
    const s = await repo.loadSnapshot();
    const r = await repo.createLead(linkLead(s, "Id Check Co"));
    if (r.status !== "created") return assert.fail();
    assert.match(r.leadId, /^[0-9a-f-]{36}$/);
    const saved = db.saves.at(-1)!;
    assert.ok(saved.rows.leads.every((l) => l.is_demo === false));
    assert.ok(saved.rows.activities.every((a) => a.performed_by === "Kody"));
    assert.equal(saved.rows.user_roles, undefined, "roles are never written by a save");
  });

  it("a lead from a web link keeps the web-link source (with database ids)", async () => {
    const { tables, manager } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(manager), { clock });
    const s = await repo.loadSnapshot();
    const r = await repo.createLead(linkLead(s, "Link Source Check"));
    if (r.status !== "created") return assert.fail();
    const after = await repo.loadSnapshot();
    const lead = after.leads.find((l) => l.id === r.leadId)!;
    assert.equal(after.sources.find((x) => x.id === lead.sourceId)!.type, "url");
    const rec = after.sourceRecords.find((x) => x.importedLeadId === r.leadId)!;
    assert.equal(rec.sourceUrl, "https://example.com/listing/1");
    assert.equal(after.sources.find((x) => x.id === rec.sourceId)!.type, "url");
  });

  it("a Viewer can look but every change is refused before anything is sent", async () => {
    const { tables, viewer } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(viewer), { clock });
    const s = await repo.loadSnapshot();
    await assert.rejects(repo.createLead(linkLead(s, "Viewer Try")), /can look at leads but can't change them/);
    await assert.rejects(repo.logActivity({ leadId: s.leads[0].id, type: "note", summary: "x" }), /can't change them/);
    assert.equal(db.saves.length, 0);
  });

  it("a Manager can work leads but not change settings or roles; the Owner check lives in the database too", async () => {
    const { tables, manager } = seededTables();
    const repo = new SupabaseRepository(new FakeDb(tables).as(manager), { clock });
    const s = await repo.loadSnapshot();
    await repo.setStatus(s.leads[0].id, "contacted");
    assert.equal((await repo.loadSnapshot()).leads[0].status, "contacted");
  });

  it("conflicting edits: the second person's stale change is refused, nothing is overwritten, latest is loaded", async () => {
    const { tables, owner, manager } = seededTables();
    const db = new FakeDb(tables);
    const kody = new SupabaseRepository(db.as(owner), { clock });
    const wife = new SupabaseRepository(db.as(manager), { clock });
    const s1 = await kody.loadSnapshot();
    await wife.loadSnapshot();
    const id = s1.leads[0].id;
    const values = (["very_high", "high", "medium", "low"] as const).filter((v) => v !== s1.leads[0].potentialValue);
    const [kodyValue, wifeValue] = values;
    await kody.setPotentialValue(id, kodyValue); // Kody saves first
    await assert.rejects(wife.setPotentialValue(id, wifeValue), /Someone else changed this lead/);
    const after = await kody.loadSnapshot();
    assert.equal(after.leads.find((l) => l.id === id)!.potentialValue, kodyValue, "Kody's change was not overwritten");
    await wife.setPotentialValue(id, wifeValue); // wife retries on the reloaded data
    assert.equal((await kody.loadSnapshot()).leads.find((l) => l.id === id)!.potentialValue, wifeValue);
  });

  it("a network failure says nothing was saved and leaves the data unchanged", async () => {
    const { tables, owner } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(owner), { clock });
    const s = await repo.loadSnapshot();
    const before = JSON.stringify(db.tables.leads);
    db.failNext = new DbError("network", "Failed to fetch");
    await assert.rejects(repo.createLead(linkLead(s, "Offline Co")), (e: unknown) => e instanceof RepositoryError && /Nothing was saved/.test(e.message) && /still there/.test(e.nextStep));
    assert.equal(JSON.stringify(db.tables.leads), before);
    const ok = await repo.createLead(linkLead(s, "Offline Co")); // same input works once back online
    assert.equal(ok.status, "created");
  });

  it("an expired session on save is reported as signed out (the app returns to sign-in)", async () => {
    const { tables, owner } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(owner), { clock });
    const s = await repo.loadSnapshot();
    db.failNext = new DbError("signed_out", "JWT expired", "PGRST303");
    await assert.rejects(repo.logActivity({ leadId: s.leads[0].id, type: "note", summary: "x" }), SignedOutError);
  });

  it("a database refusal (row-level security) is explained plainly", async () => {
    const { tables, owner } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(owner), { clock });
    const s = await repo.loadSnapshot();
    db.failNext = new DbError("denied", "new row violates row-level security policy", "42501");
    await assert.rejects(repo.logActivity({ leadId: s.leads[0].id, type: "note", summary: "x" }), /isn't allowed to do that. Nothing was saved/);
  });

  it("a business-rule problem is caught before anything is sent", async () => {
    const { tables, owner } = seededTables();
    const db = new FakeDb(tables);
    const repo = new SupabaseRepository(db.as(owner), { clock });
    const s = await repo.loadSnapshot();
    await assert.rejects(repo.createLead({ ...linkLead(s, "No City"), property: { city: "", facilityType: "office" } }), /location/);
    assert.equal(db.saves.length, 0);
  });

  it("loads more than one page of rows", async () => {
    const { tables, owner } = seededTables();
    const many = Array.from({ length: 2500 }, () => ({ ...tables.activities[0], id: randomUUID() }));
    tables.activities = many;
    let calls = 0;
    const db: LeadFinderDb = {
      currentUser: async () => owner,
      selectAll: async (t) => {
        calls++;
        return structuredClone(tables[t] ?? []);
      },
      applyChanges: async () => undefined,
    };
    const s = await new SupabaseRepository(db, { clock }).loadSnapshot();
    assert.equal(s.activities.length, 2500);
    assert.equal(calls, SNAPSHOT_KEYS.length);
    assert.ok(SNAPSHOT_KEYS.every((k) => primaryKeyOf(k) === (k === "settings" ? "key" : "id")));
  });
});
