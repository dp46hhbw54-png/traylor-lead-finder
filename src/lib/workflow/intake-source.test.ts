import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Source } from "../domain/types";
import { pickIntakeSource } from "./intake-source";
import { createLead } from "./ingest";
import { freshSnapshot, testContext } from "./test-helpers";

/** The demo sources re-labelled with database-style ids, as they will be in Supabase. */
function databaseStyleSources(): Source[] {
  return freshSnapshot().sources.map((s) => ({ ...s, id: randomUUID(), isDemo: false }));
}

describe("Add from link: the lead keeps the right source", () => {
  it("files a web-link lead under the web-link source even when ids are database ids (the old bug)", () => {
    const sources = databaseStyleSources();
    const pick = pickIntakeSource(sources, true);
    assert.ok(pick.ok);
    assert.equal(pick.source.type, "url");
    assert.notEqual(pick.source.type, "manual", "never silently becomes a manual entry");
  });

  it("files a hand-typed lead with no link under manual entry", () => {
    const pick = pickIntakeSource(databaseStyleSources(), false);
    assert.ok(pick.ok);
    assert.equal(pick.source.type, "manual");
  });

  it("refuses (with a plain reason) instead of mislabelling when web-link saving is turned off", () => {
    const sources = databaseStyleSources().map((s) => (s.type === "url" ? { ...s, status: "disabled" as const } : s));
    const pick = pickIntakeSource(sources, true);
    assert.equal(pick.ok, false);
    if (!pick.ok) assert.match(pick.message, /Web-link saving is turned off.*Nothing was saved/);
  });

  it("refuses when no web-link source exists at all, and says who can fix it", () => {
    const pick = pickIntakeSource(databaseStyleSources().filter((s) => s.type !== "url"), true);
    assert.equal(pick.ok, false);
    if (!pick.ok) assert.match(pick.message, /isn't set up yet.*Owner/);
  });

  it("prefers the real (non-demo) source when both exist", () => {
    const demo = freshSnapshot().sources;
    const real = databaseStyleSources().filter((s) => s.type === "url");
    const pick = pickIntakeSource([...demo, ...real], true);
    assert.ok(pick.ok);
    assert.equal(pick.source.isDemo, false);
  });

  it("end to end: the saved lead, its source record and its evidence all point at the web-link source", () => {
    const s = freshSnapshot();
    const pick = pickIntakeSource(s.sources, true);
    assert.ok(pick.ok);
    const r = createLead(s, testContext(), {
      title: "Listing posted",
      company: { name: "Demo Link Check Co" },
      property: { city: "Central", facilityType: "office" },
      signals: [{ type: "listed_for_lease", description: "DEMO: listing", confidence: "publicly_reported" }],
      source: { sourceId: pick.source.id, sourceUrl: "https://example.com/demo/link-check", kind: "property_listing" },
    });
    if (r.status !== "created") return assert.fail("should be created");
    const lead = s.leads.find((l) => l.id === r.leadId)!;
    const record = s.sourceRecords.find((x) => x.importedLeadId === r.leadId)!;
    assert.equal(s.sources.find((x) => x.id === lead.sourceId)!.type, "url");
    assert.equal(record.sourceId, pick.source.id);
    assert.equal(record.sourceUrl, "https://example.com/demo/link-check");
    assert.ok(s.signals.filter((g) => g.leadId === r.leadId).every((g) => g.sourceId === pick.source.id));
  });
});
