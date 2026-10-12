import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveScoringSettings, SCORING_SETTING_KEY } from "../../config/scoring-settings";
import { RepositoryError } from "../../domain/errors";
import { can } from "../../domain/permissions";
import type { AppRole } from "../../domain/types";
import { buildToday, evaluateAll } from "../../engine/evaluate";
import { buildOutcomeRecords, sizeBand } from "../../engine/learning";
import { latestBreakdown, recordScoreChanges } from "../../engine/score-history";
import { clone, DAY, freshSnapshot, NOW, testContext } from "../../workflow/test-helpers";
import { LocalDemoRepository } from "./local-demo-repository";

const repo = (role: AppRole = "owner", clock: () => Date = () => NOW) => new LocalDemoRepository({ latencyMs: 0, clock, role });

describe("LocalDemoRepository (all-or-nothing changes, roles, audit)", () => {
  it("loads the demo data and Today still ranks the same way", async () => {
    const snap = await repo().loadSnapshot();
    assert.equal(snap.leads.length, 22); // Phase 3 demo expansion (was 20)
    const { items } = buildToday(snap, NOW);
    assert.deepEqual(items.slice(0, 3).map((i) => i.view.ctx.lead.id), ["l-04", "l-03", "l-06"]);
    assert.equal(items.length, 10);
  });

  it("returns a copy — callers can't change stored data by accident", async () => {
    const r = repo();
    const a = await r.loadSnapshot();
    a.leads[0].status = "won";
    assert.notEqual((await r.loadSnapshot()).leads[0].status, "won");
  });

  it("runs the shared sales rules and saves a timeline entry AND an audit row", async () => {
    const r = repo();
    await r.logActivity({ leadId: "l-01", type: "call", summary: "Called", outcome: "Connected" });
    const s = await r.loadSnapshot();
    assert.equal(s.leads.find((l) => l.id === "l-01")!.status, "contacted");
    assert.ok(s.activities.some((a) => a.leadId === "l-01" && a.type === "call" && a.performedBy === "Demo user"));
    assert.ok(s.auditLog.some((e) => e.leadId === "l-01" && e.action === "status_change" && e.oldValue === "new" && e.newValue === "contacted"));
  });

  it("is all-or-nothing: a failed change leaves no half-saved data", async () => {
    const r = repo();
    const before = JSON.stringify(await r.loadSnapshot());
    await assert.rejects(r.markLost("l-02", "nonsense" as never), RepositoryError);
    await assert.rejects(r.scheduleFollowUp({ leadId: "l-02", contactId: null, dueAt: "not a date", method: "call", notes: "" }), RepositoryError);
    await assert.rejects(r.logActivity({ leadId: "missing", type: "note", summary: "x" }), RepositoryError);
    assert.equal(JSON.stringify(await r.loadSnapshot()), before);
  });

  it("enforces roles: Viewers can look but not change; Managers can work and merge; the error says what to do", async () => {
    assert.equal(can("viewer", "view"), true);
    assert.equal(can("viewer", "work_leads"), false);
    assert.equal(can("manager", "merge_records"), true);
    assert.equal(can("manager", "manage_users"), false);
    assert.equal(can("owner", "manage_settings"), true);

    const viewer = repo("viewer");
    const before = JSON.stringify(await viewer.loadSnapshot());
    await assert.rejects(viewer.logActivity({ leadId: "l-01", type: "note", summary: "x" }), (e: unknown) => e instanceof RepositoryError && /Viewer/.test(e.message) && /Owner or Manager/.test(e.nextStep));
    await assert.rejects(viewer.mergeLeads("l-09", "l-20"), RepositoryError);
    await assert.rejects(viewer.markNotAFit("l-01", "x"), RepositoryError);
    assert.equal(JSON.stringify(await viewer.loadSnapshot()), before, "a Viewer changed nothing");
    assert.ok((await viewer.loadSnapshot()).leads.length > 0, "but can still read");

    const manager = repo("manager");
    await manager.mergeLeads("l-09", "l-20");
    await manager.logActivity({ leadId: "l-01", type: "note", summary: "ok" });
  });

  it("re-scores after every change and keeps both numbers — only when the score really changes", async () => {
    const r = repo();
    const s0 = await r.loadSnapshot();
    const n0 = s0.scoreBreakdowns.filter((b) => b.leadId === "l-13").length;
    // A note doesn't change the score → no new breakdown, no score audit row.
    await r.logActivity({ leadId: "l-13", type: "note", summary: "Drove by" });
    const s1 = await r.loadSnapshot();
    assert.equal(s1.scoreBreakdowns.filter((b) => b.leadId === "l-13").length, n0);
    // Re-verifying removes nothing here, but a new public contact does: log a lead score change by re-verifying a stale lead.
    await r.markVerified("l-12", "Re-checked the listing");
    const s2 = await r.loadSnapshot();
    const rows = s2.scoreBreakdowns.filter((b) => b.leadId === "l-12").sort((a, b) => a.computedAt.localeCompare(b.computedAt));
    assert.equal(rows.length, 2);
    assert.ok(rows[1].score > rows[0].score, "stale penalty removed, fresh bonus added");
    const audit = s2.auditLog.find((e) => e.leadId === "l-12" && e.action === "score_change")!;
    assert.deepEqual([audit.oldValue, audit.newValue], [String(rows[0].score), String(rows[1].score)]);
  });

  it("creates leads, reports duplicates, merges, and survives a reload", async () => {
    const r = repo();
    const input = {
      title: "New hotel annex",
      property: { name: "Demo Hotel", address: "700 Demo Hospitality Lane", city: "Gonzales", zip: "70737", facilityType: "hotel" as const },
      signals: [{ type: "expansion" as const, description: "DEMO: Annex announced." }], // Phase 3: a reason is required
      source: { sourceId: "src-manual" },
    };
    const dup = await r.createLead(input);
    assert.equal(dup.status, "duplicates_found");
    assert.equal((await r.previewDuplicates(input)).length, 1);
    const made = await r.createLead(input, { duplicateAction: "link_to_property" });
    assert.equal(made.status, "created");
    if (made.status !== "created") return;
    const s = await r.loadSnapshot();
    assert.ok(s.scoreBreakdowns.some((b) => b.leadId === made.leadId), "the new lead was scored");
    assert.equal(s.leads.length, 23); // 22 demo leads + the new one
    await r.mergeLeads("l-09", made.leadId);
    assert.equal((await r.loadSnapshot()).leads.find((l) => l.id === made.leadId)!.mergedIntoLeadId, "l-09");
  });

  it("undo works for Lost and Not a Fit", async () => {
    const r = repo();
    await r.markLost("l-02", "price");
    await r.restoreStatus("l-02", "new");
    const l = (await r.loadSnapshot()).leads.find((x) => x.id === "l-02")!;
    assert.deepEqual([l.status, l.lostReasonCode, l.closedAt], ["new", null, null]);
  });

  it("reset restores the fictional data", async () => {
    const r = repo();
    await r.markWon("l-02");
    await r.reset!();
    assert.equal((await r.loadSnapshot()).leads.find((l) => l.id === "l-02")!.status, "new");
  });
});

describe("score history", () => {
  it("saves a new breakdown only when the score changes, audits old → new, and never loses the raw score", () => {
    const s = freshSnapshot();
    const m = testContext();
    assert.equal(recordScoreChanges(s, m), 0, "nothing changed since the seed");
    s.signals.push({ ...clone(s.signals.find((g) => g.leadId === "l-13")!), id: "extra", type: "expansion" });
    assert.equal(recordScoreChanges(s, m), 1);
    const rows = s.scoreBreakdowns.filter((b) => b.leadId === "l-13");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].score - rows[0].score, 10);
    assert.equal(latestBreakdown(s, "l-13"), rows[1]);
    assert.equal(rows[1].rawScore, rows[1].lines.reduce((x, l) => x + l.points, 0));
    const a = s.auditLog.filter((e) => e.action === "score_change" && e.leadId === "l-13");
    assert.equal(a.length, 1);
  });

  it("stores raw above 100 next to the capped score", () => {
    const s = freshSnapshot();
    for (const type of ["expansion", "major_renovation", "listed_for_lease", "vendor_may_change"] as const) {
      s.signals.push({ ...clone(s.signals[0]), id: `x-${type}`, leadId: "l-01", type });
    }
    recordScoreChanges(s, testContext());
    const b = latestBreakdown(s, "l-01")!;
    assert.equal(b.score, 100);
    assert.ok(b.rawScore > 100 && b.capped);
    assert.ok(b.lines.length >= 7, "every point still explained");
  });

  it("explains every point: displayed score always equals the clamped sum of its lines", () => {
    for (const v of evaluateAll(freshSnapshot(), NOW)) {
      assert.equal(v.score.score, Math.max(0, Math.min(100, v.score.lines.reduce((x, l) => x + l.points, 0))), v.ctx.lead.id);
    }
  });
});

describe("scoring settings are data (lead_settings), not code", () => {
  it("uses stored values over defaults and ignores bad ones", () => {
    const defaults = resolveScoringSettings(undefined);
    const row = (value: unknown) => [{ key: SCORING_SETTING_KEY, value, version: 2, updatedAt: NOW.toISOString(), updatedBy: "t" }];
    assert.equal(resolveScoringSettings(row({ signalPoints: { new_construction: 30 } })).signalPoints.new_construction, 30);
    assert.equal(resolveScoringSettings(row({ signalPoints: { new_construction: 30 } })).signalPoints.expansion, defaults.signalPoints.expansion, "other values untouched");
    assert.equal(resolveScoringSettings(row({ signalPoints: { new_construction: "lots" } })).signalPoints.new_construction, 20, "wrong type ignored");
    assert.equal(resolveScoringSettings(row("garbage")).tiers.hot, 80);
    assert.equal(resolveScoringSettings(row(null)).tiers.hot, 80);
    assert.equal(resolveScoringSettings(row({ signalCategoryByType: { rfp_bid: "made_up" } })).signalCategoryByType.rfp_bid, undefined, "mapping to a missing category is dropped");
  });

  it("changing a stored rule changes the score everywhere, and the breakdown records the rules version", () => {
    const s = freshSnapshot();
    const before = evaluateAll(s, NOW).find((v) => v.ctx.lead.id === "l-01")!.score.score;
    s.settings[0] = { ...s.settings[0], version: 2, value: { signalPoints: { new_construction: 5 } } };
    const after = evaluateAll(s, NOW).find((v) => v.ctx.lead.id === "l-01")!.score.score;
    assert.equal(before - after, 15);
    recordScoreChanges(s, testContext());
    assert.equal(latestBreakdown(s, "l-01")!.settingsVersion, 2);
  });

  it("the seed stores the same rules the engine defaults to", () => {
    assert.deepEqual(resolveScoringSettings(freshSnapshot().settings), resolveScoringSettings(undefined));
    // Spec values
    const r = resolveScoringSettings(undefined);
    assert.deepEqual(
      [r.signalPoints.new_construction, r.signalPoints.new_tenant_or_business, r.signalPoints.occupancy_soon, r.signalPoints.recently_renovated, r.signalPoints.expansion, r.signalPoints.for_lease, r.signalPoints.vendor_may_change],
      [20, 20, 10, 15, 10, 10, 10],
    );
    assert.deepEqual([r.size.largePoints, r.size.mediumPoints, r.contact.propertyManagerIdentified, r.contact.publicBusinessContact, r.contact.noContactPath, r.freshness.freshPoints, r.freshness.stalePoints], [15, 8, 10, 5, -10, 10, -10]);
  });
});

describe("learning data (no machine learning — just clean records)", () => {
  const rows = buildOutcomeRecords(freshSnapshot());
  const byId = (id: string) => rows.find((r) => r.leadId === id)!;

  it("has one row per closed lead: Won, Lost and Not a Fit", () => {
    assert.deepEqual(rows.map((r) => r.leadId).sort(), ["l-16", "l-17", "l-18"]);
    assert.deepEqual([byId("l-16").outcome, byId("l-17").outcome, byId("l-18").outcome], ["won", "not_a_fit", "lost"]);
  });

  it("captures the facts that may explain an outcome", () => {
    const lost = byId("l-18");
    assert.deepEqual([lost.reasonCode, lost.facilityType, lost.market, lost.parish, lost.sizeBand, lost.sourceName], ["price", "retail_center", "Baton Rouge", "East Baton Rouge", "medium", "Demo CSV import — demo_leads.csv"]);
    assert.deepEqual(lost.signalTypes, ["new_tenant"]);
    assert.equal(lost.contactRole, "Property Manager");
    assert.match(byId("l-17").reason!, /Service bays only/);
  });

  it("measures how long each step took", () => {
    const won = byId("l-16");
    assert.equal(won.daysToOutcome, 55); // discovered 75 days ago, closed 20 days ago
    assert.equal(byId("l-18").daysToOutcome, 115);
    assert.equal(byId("l-16").daysToFirstContact, null, "no call was ever logged — we don't invent one");
  });

  it("measures time to first contact and walkthrough when they happened", () => {
    const s = freshSnapshot();
    const m = testContext(new Date(NOW.getTime() + 2 * DAY));
    // l-15: discovered 30 days ago; first contact 4 days ago → 26 days. Close it as won and read the row.
    s.activities.push({ id: "a-c", leadId: "l-15", type: "walkthrough_scheduled", summary: "x", outcome: null, occurredAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), performedBy: "t" });
    s.leads.find((l) => l.id === "l-15")!.status = "won";
    s.leads.find((l) => l.id === "l-15")!.closedAt = m.now.toISOString();
    const row = buildOutcomeRecords(s).find((r) => r.leadId === "l-15")!;
    assert.equal(row.daysToFirstContact, 26);
    assert.equal(row.daysToWalkthrough, 28);
    assert.equal(row.daysToOutcome, 32);
  });

  it("uses unknown size honestly and bands by the configured thresholds", () => {
    assert.equal(sizeBand(null), "unknown");
    assert.equal(sizeBand(4_999), "small");
    assert.equal(sizeBand(5_000), "medium");
    assert.equal(sizeBand(20_000), "large");
  });
});
