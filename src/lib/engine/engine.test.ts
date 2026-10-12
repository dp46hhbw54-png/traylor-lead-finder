import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoSnapshot } from "../data/demo/seed";
import type { LeadFinderSnapshot } from "../domain/types";
import { buildToday, evaluateAll, whyNow } from "./evaluate";
import { getFreshness } from "./freshness";
import { buildLeadContexts } from "./lead-context";
import { recommendAction } from "./recommended-action";
import { scoreLead, tierFor } from "./scoring";

const NOW = new Date(2026, 9, 7, 9, 0); // Oct 7 2026, 9:00 local
const fresh = () => createDemoSnapshot(NOW);
const ctxFor = (snap: LeadFinderSnapshot, id: string) => buildLeadContexts(snap).find((c) => c.lead.id === id)!;
const DAY = 86_400_000;

describe("demo data", () => {
  it("is clearly fictional and flagged as demo", () => {
    const s = fresh();
    assert.equal(s.companies.length, 12); // Phase 3 demo expansion (was 10)
    assert.equal(s.leads.length, 22); // Phase 3 demo expansion (was 20)
    for (const c of s.companies) assert.match(c.name, /^Demo /);
    for (const p of s.properties) assert.match(p.name, /^Demo /);
    for (const row of [...s.companies, ...s.properties, ...s.leads, ...s.contacts]) assert.equal(row.isDemo, true);
    for (const c of s.contacts) {
      if (c.phone) assert.match(c.phone, /^225-555-01\d\d$/, "fictional 555-01xx numbers only");
      if (c.email) assert.match(c.email, /example\.com$/);
    }
    for (const sig of s.signals) if (sig.sourceUrl) assert.match(sig.sourceUrl, /^https:\/\/example\.com\//);
  });
});

describe("scoring", () => {
  it("adds explainable lines and matches the breakdown total", () => {
    const score = scoreLead(ctxFor(fresh(), "l-01"), NOW);
    assert.equal(score.raw, score.lines.reduce((s, l) => s + l.points, 0));
    assert.equal(score.score, 90);
    assert.equal(score.tier, "hot");
  });

  it("counts each signal category only once", () => {
    const snap = fresh();
    // l-01 has two occupancy-category signals in the demo? add another to be sure.
    snap.signals.push({ ...snap.signals.find((s) => s.leadId === "l-01" && s.type === "new_tenant")!, id: "extra", type: "recently_leased" });
    const score = scoreLead(ctxFor(snap, "l-01"), NOW);
    assert.equal(score.lines.filter((l) => l.key === "signal:new_tenant_or_business").length, 1);
  });

  it("gives unknown square footage 0 points — never a penalty", () => {
    const score = scoreLead(ctxFor(fresh(), "l-02"), NOW);
    assert.equal(score.lines.find((l) => l.key === "size"), undefined);
    assert.ok(!score.lines.some((l) => l.points < 0));
  });

  it("clamps to 0–100 and preserves the raw total", () => {
    const snap = fresh();
    for (const type of ["expansion", "major_renovation", "listed_for_lease", "vendor_may_change"] as const) {
      snap.signals.push({ ...snap.signals[0], id: `x-${type}`, leadId: "l-01", type });
    }
    const score = scoreLead(ctxFor(snap, "l-01"), NOW);
    assert.equal(score.score, 100);
    assert.ok(score.raw > 100);
    assert.equal(score.capped, true);

    const low = scoreLead(ctxFor(fresh(), "l-14"), new Date(NOW.getTime() + 400 * DAY));
    assert.ok(low.score >= 0);
  });

  it("penalizes no contact path and stale information", () => {
    const church = scoreLead(ctxFor(fresh(), "l-13"), NOW);
    assert.ok(church.lines.some((l) => l.key === "contact:none" && l.points === -10));
    const stale = scoreLead(ctxFor(fresh(), "l-12"), NOW);
    assert.ok(stale.lines.some((l) => l.key === "freshness" && l.points === -10));
  });

  it("ignores signals with unknown confidence", () => {
    const snap = fresh();
    for (const s of snap.signals) if (s.leadId === "l-13") s.confidence = "unknown";
    const score = scoreLead(ctxFor(snap, "l-13"), NOW);
    assert.equal(score.lines.filter((l) => l.group === "signal").length, 0);
  });

  it("maps tiers at the configured thresholds", () => {
    assert.equal(tierFor(80), "hot");
    assert.equal(tierFor(79), "high");
    assert.equal(tierFor(60), "high");
    assert.equal(tierFor(59), "medium");
    assert.equal(tierFor(40), "medium");
    assert.equal(tierFor(39), "low");
  });
});

describe("freshness", () => {
  const lead = (daysAgo: number) => ({ discoveredAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), lastVerifiedAt: null });
  it("decays from today → week → aging → stale", () => {
    assert.equal(getFreshness(lead(0), NOW).level, "today");
    assert.equal(getFreshness(lead(7), NOW).level, "week");
    assert.equal(getFreshness(lead(8), NOW).level, "aging");
    assert.equal(getFreshness(lead(90), NOW).level, "aging");
    assert.equal(getFreshness(lead(91), NOW).level, "stale");
  });
});

describe("recommended action (rule-based)", () => {
  const snap = fresh();
  const kind = (id: string) => recommendAction(ctxFor(snap, id), NOW).kind;
  it("follows the rule order", () => {
    assert.equal(kind("l-04"), "follow_up"); // overdue follow-up
    assert.equal(kind("l-06"), "prepare_walkthrough"); // walkthrough today
    assert.equal(kind("l-07"), "record_outcome"); // walkthrough done, no outcome
    assert.equal(kind("l-15"), "schedule_walkthrough"); // interested
    assert.equal(kind("l-12"), "verify"); // >90 days old
    assert.equal(kind("l-13"), "research_pm"); // no PM, no contact
    assert.equal(kind("l-01"), "call"); // contact exists, never contacted
    assert.equal(kind("l-09"), "email"); // email only
    assert.equal(kind("l-18"), "record_lost_reason");
  });
});

describe("why now", () => {
  it("only uses stored signal dates and says so when there are none", () => {
    assert.deepEqual(whyNow([], NOW), ["No time-sensitive signal yet — research needed."]);
    const lines = whyNow(fresh().signals.filter((s) => s.leadId === "l-01"), NOW);
    assert.ok(lines.some((l) => l.startsWith("Occupancy/opening expected in ~45 days")));
  });
});

describe("today ranking", () => {
  it("puts overdue, then due today, then walkthroughs today, then priority", () => {
    const { items } = buildToday(fresh(), NOW);
    assert.deepEqual(items.slice(0, 3).map((i) => i.group), ["overdue", "due_today", "walkthrough_today"]);
    const ranked = items.filter((i) => i.group === "ranked");
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].priority >= ranked[i].priority);
    assert.ok(items.length <= 10);
  });

  it("excludes won, lost, not-a-fit, snoozed and idle nurture leads", () => {
    const snap = fresh();
    snap.leads.find((l) => l.id === "l-01")!.snoozedUntil = new Date(NOW.getTime() + 3 * DAY).toISOString();
    const ids = buildToday(snap, NOW).items.map((i) => i.view.ctx.lead.id);
    for (const id of ["l-01", "l-14", "l-16", "l-17", "l-18"]) assert.ok(!ids.includes(id), `${id} should be hidden`);
  });

  it("does not let several 100-point leads tie arbitrarily (priority is unclamped)", () => {
    const { items } = buildToday(fresh(), NOW);
    const top = items.find((i) => i.view.ctx.lead.id === "l-01")!;
    assert.equal(top.priority, top.priorityParts.reduce((s, p) => s + p.points, 0));
  });

  it("applies the recent-contact penalty to contacted leads but never to interested ones", () => {
    const snap = fresh();
    const views = evaluateAll(snap, NOW);
    assert.ok(views.length === 22); // Phase 3 demo expansion (was 20)
    const { items } = buildToday(snap, NOW);
    const interested = items.find((i) => i.view.ctx.lead.id === "l-15")!;
    assert.ok(!interested.priorityParts.some((p) => p.points < 0));
  });
});
