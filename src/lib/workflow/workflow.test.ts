import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RepositoryError } from "../domain/errors";
import { SCHEMA_VERSION } from "../domain/types";
import { buildToday } from "../engine/evaluate";
import { scoreLead } from "../engine/scoring";
import { buildLeadContexts } from "../engine/lead-context";
import { recommendAction } from "../engine/recommended-action";
import * as flow from "./actions";
import { clone, DAY, freshSnapshot, NOW, testContext } from "./test-helpers";

const lead = (s: ReturnType<typeof freshSnapshot>, id: string) => s.leads.find((l) => l.id === id)!;

describe("Phase 2 demo data foundation", () => {
  const s = freshSnapshot();

  it("has the expected shape and is still clearly fictional", () => {
    assert.equal(s.schemaVersion, SCHEMA_VERSION);
    assert.equal(s.companies.length, 12); // Phase 3 demo expansion (was 10)
    assert.equal(s.leads.length, 22); // Phase 3 demo expansion (was 20)
    assert.equal(s.properties.length, 18); // 17 + 1 intentional duplicate record (Phase 3 added 2)
    assert.equal(s.markets.filter((m) => m.kind === "city").length, 8);
    assert.equal(s.markets.filter((m) => m.kind === "parish").length, 4);
    for (const row of [...s.companies, ...s.properties, ...s.contacts, ...s.leads, ...s.sources, ...s.sourceRecords, ...s.userRoles]) assert.equal(row.isDemo, true);
    for (const u of s.userRoles) assert.match(u.email, /@example\.com$/);
  });

  it("has every kind of record the CEO test needs", () => {
    const statuses = new Set(s.leads.map((l) => l.status));
    for (const st of ["new", "researching", "contacted", "interested", "walkthrough", "won", "lost", "nurture", "not_a_fit"]) assert.ok(statuses.has(st as never), st);
    const now = NOW.getTime();
    assert.ok(s.followups.some((f) => !f.completedAt && new Date(f.dueAt).getTime() < now - 0 && new Date(f.dueAt).toDateString() !== NOW.toDateString()), "overdue follow-up");
    assert.ok(s.followups.some((f) => !f.completedAt && new Date(f.dueAt).toDateString() === NOW.toDateString()), "follow-up due today");
    assert.ok(s.followups.some((f) => f.completedAt && f.completedBy), "a completed follow-up with completion info");
    assert.ok(s.walkthroughs.some((w) => !w.completedAt && new Date(w.scheduledAt).toDateString() === NOW.toDateString()), "walkthrough today");
    assert.ok(s.sources.some((x) => x.status === "unavailable"), "an unavailable source is represented explicitly");
    assert.ok(s.sourceRecords.some((r) => r.status === "rejected"));
    for (const tier of ["hot", "high", "medium", "low"]) assert.ok(s.scoreBreakdowns.some((b) => b.tier === tier), `a ${tier} lead`);
  });

  it("every reference points at a record that exists (no orphans)", () => {
    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    const [props, cos, cts, srcs, recs, leads] = [ids(s.properties), ids(s.companies), ids(s.contacts), ids(s.sources), ids(s.sourceRecords), ids(s.leads)];
    for (const p of s.properties) assert.ok(p.marketId && s.markets.some((m) => m.id === p.marketId), `market for ${p.id}`);
    for (const r of s.relationships) assert.ok(props.has(r.propertyId) && cos.has(r.companyId), r.id);
    for (const c of s.contacts) assert.ok(srcs.has(c.sourceId) && (!c.companyId || cos.has(c.companyId)), c.id);
    for (const l of s.leads) {
      assert.ok(props.has(l.propertyId) && srcs.has(l.sourceId) && recs.has(l.sourceRecordId!), l.id);
      if (l.companyId) assert.ok(cos.has(l.companyId));
      if (l.primaryContactId) assert.ok(cts.has(l.primaryContactId));
    }
    for (const sg of s.signals) assert.ok(leads.has(sg.leadId) && srcs.has(sg.sourceId) && (!sg.sourceRecordId || recs.has(sg.sourceRecordId)), sg.id);
    for (const a of s.activities) assert.ok(leads.has(a.leadId), a.id);
    for (const f of s.followups) assert.ok(leads.has(f.leadId), f.id);
    for (const w of s.walkthroughs) assert.ok(leads.has(w.leadId) && props.has(w.propertyId), w.id);
    for (const r of s.sourceRecords) assert.ok(srcs.has(r.sourceId) && (!r.importedLeadId || leads.has(r.importedLeadId)), r.id);
    for (const b of s.scoreBreakdowns) assert.ok(leads.has(b.leadId), b.id);
  });

  it("keeps a source name, URL, record id and dates on every imported record", () => {
    for (const r of s.sourceRecords) {
      assert.ok(r.sourceName && r.discoveredAt, r.id);
      assert.ok("sourceUrl" in r && "externalId" in r && "lastVerifiedAt" in r);
    }
    const csv = s.sourceRecords.find((r) => r.id === "sr-04")!;
    assert.equal(csv.externalId, "demo-row-04");
  });

  it("stores one explained score breakdown per lead, keeping raw AND displayed score", () => {
    for (const l of s.leads) {
      const rows = s.scoreBreakdowns.filter((b) => b.leadId === l.id);
      assert.equal(rows.length, 1, l.id);
      const b = rows[0];
      assert.equal(b.rawScore, b.lines.reduce((sum, x) => sum + x.points, 0), `${l.id} lines add up to the raw score`);
      assert.equal(b.score, Math.max(0, Math.min(100, b.rawScore)));
      assert.equal(b.capped, b.rawScore !== b.score);
    }
  });

  it("has no dollar amounts or pricing anywhere — only the qualitative potential value", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); if (k !== "value") walk(x); }
    };
    walk({ ...s, settings: [] });
    for (const k of keys) assert.doesNotMatch(k, /price|cost|dollar|amount|estimate|revenue|\$/i, k);
    assert.ok(s.leads.every((l) => ["very_high", "high", "medium", "low", "unknown"].includes(l.potentialValue)));
    assert.ok(s.leads.some((l) => l.potentialValue === "very_high") && s.leads.some((l) => l.potentialValue === "unknown"));
    for (const l of s.leads) assert.ok(l.externalQuoteRef === null && l.convertedCustomerRef === null, "quote hooks exist and are empty");
  });

  it("uses markets as data — the engine has no city list of its own", () => {
    const s2 = clone(s);
    s2.markets.push({ id: "mkt-new", name: "Slidell", kind: "city", parish: "St. Tammany", active: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    assert.ok(s2.markets.some((m) => m.name === "Slidell"));
    // Scoring and ranking behave identically with a new market added.
    assert.deepEqual(buildToday(s2, NOW).items.map((i) => i.view.ctx.lead.id), buildToday(s, NOW).items.map((i) => i.view.ctx.lead.id));
  });
});

describe("sales actions (business rules shared by every repository)", () => {
  it("a call moves a New lead to Contacted, completes the due follow-up, and audits the status change", () => {
    const s = freshSnapshot();
    const m = testContext();
    flow.logActivity(s, m, { leadId: "l-03", type: "call", summary: "Called Avery", outcome: "Connected" }); // l-03 already contacted with a follow-up due today
    assert.ok(s.followups.find((f) => f.id === "fu-02")!.completedAt, "due follow-up completed");
    assert.equal(s.followups.find((f) => f.id === "fu-02")!.completedBy, "Test user");

    flow.logActivity(s, m, { leadId: "l-01", type: "call", summary: "Called Jordan" });
    assert.equal(lead(s, "l-01").status, "contacted");
    const entry = s.auditLog.find((e) => e.leadId === "l-01" && e.action === "status_change")!;
    assert.deepEqual([entry.oldValue, entry.newValue, entry.changedBy], ["new", "contacted", "Test user"]);
    assert.ok(s.activities.some((a) => a.leadId === "l-01" && a.type === "status_change"));
  });

  it("notes do not change status", () => {
    const s = freshSnapshot();
    flow.logActivity(s, testContext(), { leadId: "l-01", type: "note", summary: "Drove by" });
    assert.equal(lead(s, "l-01").status, "new");
  });

  it("scheduling a walkthrough moves the lead to Walkthrough and records it", () => {
    const s = freshSnapshot();
    const wt = flow.scheduleWalkthrough(s, testContext(), { leadId: "l-15", contactId: "k-06", scheduledAt: new Date(NOW.getTime() + 3 * DAY).toISOString(), attendees: "Sales", notes: "" });
    assert.equal(lead(s, "l-15").status, "walkthrough");
    assert.equal(wt.propertyId, "p-15");
    assert.equal(wt.nextAction, null);
    assert.ok(s.auditLog.some((e) => e.entityType === "walkthrough" && e.entityId === wt.id));
  });

  it("completing a walkthrough records outcome + next action, and 'send to bid' leads to 'Quote requested' (nothing more)", () => {
    const s = freshSnapshot();
    const m = testContext();
    assert.equal(recommendAction(buildLeadContexts(s).find((c) => c.lead.id === "l-07")!, NOW).kind, "record_outcome");
    flow.completeWalkthrough(s, m, { walkthroughId: "wt-02", outcome: "send_to_bid", nextAction: "Send the information packet", notes: "Kitchen excluded" });
    const wt = s.walkthroughs.find((w) => w.id === "wt-02")!;
    assert.equal(wt.outcome, "send_to_bid");
    assert.equal(wt.nextAction, "Send the information packet");
    assert.equal(recommendAction(buildLeadContexts(s).find((c) => c.lead.id === "l-07")!, NOW).kind, "request_quote");
    flow.requestQuote(s, m, "l-07");
    assert.ok(s.activities.some((a) => a.leadId === "l-07" && a.type === "quote_requested"));
    assert.notEqual(recommendAction(buildLeadContexts(s).find((c) => c.lead.id === "l-07")!, NOW).kind, "request_quote");
    assert.equal(lead(s, "l-07").externalQuoteRef, null, "no quote is created — only a log entry");
  });

  it("Won and Lost stamp the close time, Lost requires a reason, and undo clears them", () => {
    const s = freshSnapshot();
    const m = testContext();
    assert.throws(() => flow.setStatus(s, m, "l-02", "lost"), RepositoryError);
    assert.throws(() => flow.setStatus(s, m, "l-02", "not_a_fit"), RepositoryError);
    flow.markLost(s, m, "l-02", "competitor", "Went with the incumbent");
    const l = lead(s, "l-02");
    assert.deepEqual([l.status, l.lostReasonCode, l.closedAt], ["lost", "competitor", NOW.toISOString()]);
    assert.match(l.lostReason!, /another cleaning company — Went with the incumbent/);
    flow.restoreStatus(s, m, "l-02", "new");
    assert.deepEqual([l.status, l.lostReason, l.lostReasonCode, l.closedAt], ["new", null, null, null]);

    flow.markWon(s, m, "l-06", "Signed!");
    assert.equal(lead(s, "l-06").status, "won");
    assert.equal(lead(s, "l-06").closedAt, NOW.toISOString());
  });

  it("Not a Fit stays searchable (still in the data) but leaves Today; undo brings it back", () => {
    const s = freshSnapshot();
    const m = testContext();
    flow.markNotAFit(s, m, "l-08", "Too small for us");
    assert.ok(s.leads.some((l) => l.id === "l-08"));
    assert.ok(!buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === "l-08"));
    assert.throws(() => flow.markNotAFit(s, m, "l-09", "  "), RepositoryError);
    flow.restoreStatus(s, m, "l-08", "new");
    assert.ok(buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === "l-08") || buildToday(s, NOW).remaining > 0);
  });

  it("snooze hides a lead from Today and unsnooze brings it back, both audited", () => {
    const s = freshSnapshot();
    const m = testContext();
    flow.snooze(s, m, "l-01", new Date(NOW.getTime() + 7 * DAY).toISOString());
    assert.ok(!buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === "l-01"));
    flow.unsnooze(s, m, "l-01");
    assert.ok(buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === "l-01"));
    assert.equal(s.auditLog.filter((e) => e.leadId === "l-01" && e.field === "snoozedUntil").length, 2);
  });

  it("potential value is saved and audited; invalid values are rejected", () => {
    const s = freshSnapshot();
    const m = testContext();
    flow.setPotentialValue(s, m, "l-13", "high");
    assert.equal(lead(s, "l-13").potentialValue, "high");
    const e = s.auditLog.find((x) => x.leadId === "l-13" && x.field === "potentialValue")!;
    assert.deepEqual([e.oldValue, e.newValue], ["unknown", "high"]);
    assert.throws(() => flow.setPotentialValue(s, m, "l-13", "gigantic" as never), RepositoryError);
    // Setting the same value again writes nothing.
    const before = s.auditLog.length;
    flow.setPotentialValue(s, m, "l-13", "high");
    assert.equal(s.auditLog.length, before);
  });

  it("re-verifying resets freshness and the stale penalty, and is audited", () => {
    const s = freshSnapshot();
    const m = testContext();
    const stale = () => scoreLead(buildLeadContexts(s).find((c) => c.lead.id === "l-12")!, NOW);
    assert.ok(stale().lines.some((l) => l.key === "freshness" && l.points < 0));
    flow.markVerified(s, m, "l-12", "Called the listing agent");
    assert.ok(!stale().lines.some((l) => l.key === "freshness" && l.points < 0));
    assert.equal(lead(s, "l-12").lastVerifiedBy, "Test user");
    assert.ok(s.auditLog.some((e) => e.leadId === "l-12" && e.field === "lastVerifiedAt"));
  });

  it("completing a follow-up by hand records who, when and a note; completing twice is refused", () => {
    const s = freshSnapshot();
    const m = testContext();
    flow.completeFollowUp(s, m, "fu-03", "Spoke by phone");
    const f = s.followups.find((x) => x.id === "fu-03")!;
    assert.deepEqual([f.completedAt, f.completedBy, f.completionNote], [NOW.toISOString(), "Test user", "Spoke by phone"]);
    assert.throws(() => flow.completeFollowUp(s, m, "fu-03"), RepositoryError);
  });

  it("explains problems in plain language with a next step", () => {
    const s = freshSnapshot();
    try {
      flow.getLead(s, "nope");
      assert.fail("should throw");
    } catch (e) {
      assert.ok(e instanceof RepositoryError);
      assert.ok(e.message.length > 0 && e.nextStep.length > 0);
    }
  });
});

describe("Today ranking (tie-breakers)", () => {
  /** Two identical-scoring leads that differ only in the thing we're testing. */
  function twins() {
    const s = freshSnapshot();
    s.leads = s.leads.filter((l) => l.id === "l-08");
    s.signals = s.signals.filter((g) => g.leadId === "l-08");
    s.activities = s.activities.filter((a) => a.leadId === "l-08");
    s.followups = [];
    s.walkthroughs = [];
    const l = s.leads[0];
    const p = s.properties.find((x) => x.id === l.propertyId)!;
    s.properties = [p, { ...clone(p), id: "p-twin" }];
    s.leads.push({ ...clone(l), id: "l-twin", propertyId: "p-twin" });
    s.signals.push(...s.signals.map((g) => ({ ...clone(g), id: `${g.id}-twin`, leadId: "l-twin" })));
    return s;
  }
  const order = (s: ReturnType<typeof freshSnapshot>) => buildToday(s, NOW).items.map((i) => i.view.ctx.lead.id);

  it("breaks an exact tie by the SOONER opening/occupancy date", () => {
    const s = twins();
    for (const g of s.signals) if (g.leadId === "l-twin" && g.expectedDate) g.expectedDate = new Date(NOW.getTime() + 20 * DAY).toISOString();
    assert.deepEqual(order(s), ["l-twin", "l-08"]);
    for (const g of s.signals) if (g.leadId === "l-08" && g.expectedDate) g.expectedDate = new Date(NOW.getTime() + 5 * DAY).toISOString();
    assert.deepEqual(order(s), ["l-08", "l-twin"]);
  });

  it("then by raw score, so two leads capped at 100 are not ordered arbitrarily", () => {
    const s = twins();
    for (const g of s.signals) g.expectedDate = null; // remove urgency from the picture
    const extra = (leadId: string, types: string[]) =>
      types.forEach((type, i) => s.signals.push({ ...clone(s.signals[0]), id: `x-${leadId}-${i}`, leadId, type: type as never, expectedDate: null }));
    extra("l-08", ["major_renovation", "listed_for_lease"]);
    extra("l-twin", ["major_renovation", "listed_for_lease", "new_tenant"]);
    const items = buildToday(s, NOW).items;
    const [a, b] = ["l-08", "l-twin"].map((id) => items.find((i) => i.view.ctx.lead.id === id)!);
    assert.equal(a.view.score.score, 100);
    assert.equal(b.view.score.score, 100);
    assert.ok(b.view.score.raw > a.view.score.raw);
    assert.equal(a.priority, b.priority, "displayed scores tie");
    assert.deepEqual(order(s), ["l-twin", "l-08"]);
  });

  it("is deterministic — identical inputs always give the same order", () => {
    const s = twins();
    assert.deepEqual(order(s), order(clone(s)));
  });

  it("still puts overdue, due today and walkthrough-today leads first in the real demo data", () => {
    const { items } = buildToday(freshSnapshot(), NOW);
    assert.deepEqual(items.slice(0, 3).map((i) => i.group), ["overdue", "due_today", "walkthrough_today"]);
    assert.deepEqual(items.slice(0, 3).map((i) => i.view.ctx.lead.id), ["l-04", "l-03", "l-06"]);
  });
});
