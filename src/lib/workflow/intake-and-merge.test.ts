import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RepositoryError } from "../domain/errors";
import {
  compareProperties,
  distanceMeters,
  findLeadDuplicates,
  findPropertyDuplicates,
  nameSimilarity,
  normalizeAddress,
  normalizePhone,
  websiteDomain,
  type PropertyFacts,
} from "../engine/duplicates";
import { buildToday } from "../engine/evaluate";
import { buildLeadContexts } from "../engine/lead-context";
import { scoreLead } from "../engine/scoring";
import { createLead, previewDuplicates, type NewLeadInput } from "./ingest";
import { mergeLeads, mergeProperties } from "./merge";
import { clone, freshSnapshot, NOW, testContext } from "./test-helpers";

const facts = (o: Partial<PropertyFacts>): PropertyFacts => ({ name: "X", normalizedAddress: "", city: "Gonzales", zip: "70737", lat: null, lng: null, phones: [], domains: [], ...o });

describe("duplicate detection (finding only — never changes anything)", () => {
  it("normalizes addresses: abbreviations, punctuation, case and suites", () => {
    const same = [
      "1200 Demo Industrial Blvd",
      "1200 Demo Industrial Boulevard",
      "1200 DEMO INDUSTRIAL BLVD.",
      "1200 Demo Industrial Boulevard, Suite 200",
      "1200 Demo Industrial Blvd #4",
      "1200 Demo Industrial Blvd, Ste B",
    ].map(normalizeAddress);
    assert.equal(new Set(same).size, 1);
    assert.equal(same[0], "1200 demo industrial blvd");
    assert.equal(normalizeAddress("400 North Main Street"), "400 n main st");
    assert.notEqual(normalizeAddress("1201 Demo Industrial Blvd"), same[0]);
  });

  it("scores name similarity after expanding abbreviations", () => {
    assert.equal(nameSimilarity("Demo Industrial Center", "Demo Industrial Ctr"), 1);
    assert.ok(nameSimilarity("Demo Industrial Center", "Demo Medical Pavilion") < 0.3);
    assert.equal(nameSimilarity("", "x"), 0);
  });

  it("normalizes phones and website domains", () => {
    assert.equal(normalizePhone("(225) 555-0100"), "2255550100");
    assert.equal(normalizePhone("+1 225-555-0100"), "2255550100");
    assert.equal(normalizePhone("555-0100"), null);
    assert.equal(websiteDomain("https://www.Demo-PM.example.com/contact"), "demo-pm.example.com");
    assert.equal(websiteDomain("demo-pm.example.com"), "demo-pm.example.com");
    assert.equal(websiteDomain(null), null);
  });

  it("measures about 50 meters correctly", () => {
    assert.ok(distanceMeters(30.2, -91.0, 30.2003, -91.0) < 50); // ~33 m
    assert.ok(distanceMeters(30.2, -91.0, 30.2006, -91.0) > 50); // ~67 m
  });

  it("matches on address (exact), 50 m (likely) and name (likely)", () => {
    assert.equal(compareProperties(facts({ normalizedAddress: "1 a st" }), facts({ normalizedAddress: "1 a st" }))?.strength, "exact");
    assert.deepEqual(compareProperties(facts({ lat: 30.2, lng: -91.0, name: "Alpha" }), facts({ lat: 30.2003, lng: -91.0, name: "Zed" }))?.reasons, ["within_50m"]);
    assert.equal(compareProperties(facts({ name: "Demo Plaza", normalizedAddress: "1 a st" }), facts({ name: "Demo Plaza", normalizedAddress: "9 z st" }))?.strength, "likely");
  });

  it("does NOT call it a duplicate just because one company owns two buildings", () => {
    const a = facts({ name: "Warehouse One", normalizedAddress: "1 a st", phones: ["2255550100"], domains: ["co.example.com"] });
    const b = facts({ name: "Warehouse Two", normalizedAddress: "2 b st", phones: ["2255550100"], domains: ["co.example.com"] });
    assert.equal(compareProperties(a, b), null);
    // Same address in a different city is a different building.
    assert.equal(compareProperties(facts({ normalizedAddress: "1 a st", city: "Walker", zip: "70785" }), facts({ normalizedAddress: "1 a st" })), null);
  });

  it("finds the intentional demo duplicates and nothing else", () => {
    const s = freshSnapshot();
    const props = findPropertyDuplicates(s);
    assert.equal(props.length, 1);
    assert.deepEqual([props[0].propertyId, props[0].duplicateId, props[0].strength], ["p-01", "p-16", "exact"]);
    assert.ok(props[0].reasons.includes("same_address") && props[0].reasons.includes("similar_name"));

    const leads = findLeadDuplicates(s).map((d) => `${d.leadId}/${d.duplicateId}:${d.kind}`).sort();
    assert.deepEqual(leads, ["l-01/l-19:duplicate_property", "l-09/l-20:same_property"]);
  });

  it("never reports closed leads as duplicates to chase", () => {
    const s = freshSnapshot();
    s.leads.find((l) => l.id === "l-19")!.status = "lost";
    assert.ok(!findLeadDuplicates(s).some((d) => d.duplicateId === "l-19"));
  });
});

// Phase 3: "why this is an opportunity" is required, so the base input carries one UNCONFIRMED reason (confidence unknown → scores 0).
const baseInput = (over: Partial<NewLeadInput> = {}): NewLeadInput => ({
  title: "New tenant moving into warehouse",
  property: { name: "Demo Logistics Park", address: "77 Demo Freight Way", city: "Walker", zip: "70785", facilityType: "warehouse" },
  signals: [{ type: "new_tenant", description: "DEMO: Heard a tenant is moving in." }],
  source: { sourceId: "src-manual" },
  ...over,
});

describe("putting a new opportunity into the system", () => {
  it("answers the CEO test: what, why it matters, where the evidence came from, how strong, who to call, what next, full history", () => {
    const s = freshSnapshot();
    const m = testContext();
    const result = createLead(
      s,
      m,
      baseInput({
        property: { name: "Demo Logistics Park", address: "77 Demo Freight Way", city: "Walker", zip: "70785", facilityType: "warehouse", sqft: 30_000, sqftStatus: "publicly_reported" },
        company: { name: "Demo Freight Co.", industry: "Logistics", website: "https://demo-freight.example.com", phone: "225-555-0171", dataStatus: "publicly_reported" },
        propertyManager: { name: "Demo Manager LLC", phone: "225-555-0172", dataStatus: "publicly_reported" },
        contact: { name: "Sam Example", role: "Operations Manager", phone: "225-555-0173", email: "sam@demo-freight.example.com", dataStatus: "publicly_reported" },
        signals: [
          { type: "new_tenant", description: "DEMO: Lease announced.", sourceUrl: "https://example.com/demo/new-1", confidence: "publicly_reported", expectedDate: new Date(NOW.getTime() + 30 * 86_400_000).toISOString() },
          { type: "construction_nearing_completion", description: "DEMO: Finish-out underway." },
        ],
        source: { sourceId: "src-url", sourceUrl: "https://example.com/demo/new-1", externalId: "listing-77" },
        potentialValue: "high",
      }),
    );
    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const lead = s.leads.find((l) => l.id === result.leadId)!;
    const view = buildToday(s, NOW).items.find((i) => i.view.ctx.lead.id === lead.id)!.view;

    assert.equal(lead.status, "new"); // what: a new lead
    assert.equal(lead.potentialValue, "high");
    assert.ok(view.why.length > 0 && view.why.every((w) => w.points > 0)); // why it matters, with points
    assert.ok(view.whyNow.some((w) => /expected in ~30 days/.test(w))); // why now
    assert.equal(view.ctx.signals.length, 2); // evidence
    assert.equal(view.ctx.source?.name, "URL reference (demo)"); // where it came from
    assert.equal(view.ctx.sourceRecord?.externalId, "listing-77");
    assert.equal(view.ctx.sourceRecord?.sourceUrl, "https://example.com/demo/new-1");
    assert.ok(view.score.score > 0 && view.score.lines.length > 0); // how strong
    assert.equal(view.contact.name, "Sam Example"); // who to contact
    assert.equal(view.contact.phone, "225-555-0173");
    assert.equal(view.ctx.propertyManager?.name, "Demo Manager LLC");
    assert.equal(view.action.kind, "call"); // what to do next
    assert.ok(s.activities.some((a) => a.leadId === lead.id && a.type === "discovered")); // history starts
    assert.ok(s.auditLog.some((e) => e.leadId === lead.id && e.action === "create"));

    // Provenance is recorded for every fact we were told, with how well we know it.
    const sqft = s.provenance.find((p) => p.entityId === result.propertyId && p.field === "sqft")!;
    assert.deepEqual([sqft.status, sqft.sourceId, sqft.sourceRecordId, sqft.valueNote], ["publicly_reported", "src-url", lead.sourceRecordId, "30,000 sq ft"]);
    assert.ok(s.provenance.some((p) => p.entityType === "contact" && p.field === "email" && p.status === "publicly_reported"));
    // The market was found from DATA, not code.
    assert.equal(s.properties.find((p) => p.id === result.propertyId)!.marketId, s.markets.find((x) => x.name === "Walker")!.id);
    // The source record points back at the lead.
    assert.equal(s.sourceRecords.find((r) => r.id === lead.sourceRecordId)!.importedLeadId, lead.id);
    // Created records in the demo are flagged as demo.
    assert.ok(lead.isDemo && s.properties.find((p) => p.id === result.propertyId)!.isDemo);
  });

  it("never invents facts: whatever isn't supplied stays empty / unknown", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), baseInput());
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    const p = s.properties.find((x) => x.id === r.propertyId)!;
    assert.deepEqual([p.sqft, p.sqftStatus, p.lat, p.lng, p.constructionStatus], [null, "unknown", null, null, null]);
    const lead = s.leads.find((l) => l.id === r.leadId)!;
    assert.deepEqual([lead.companyId, lead.primaryContactId, lead.lastVerifiedAt, lead.potentialValue], [null, null, null, "unknown"]);
    assert.equal(s.provenance.filter((f) => f.entityId === p.id).length, 0, "no provenance row for facts we don't have");
    // Only the one reason we supplied — nothing added, and its confidence was not upgraded.
    assert.deepEqual(s.signals.filter((g) => g.leadId === lead.id).map((g) => [g.type, g.confidence]), [["new_tenant", "unknown"]]);
  });

  it("a signal's confidence defaults to 'unknown', so unconfirmed evidence is shown but never scores", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), baseInput({ signals: [{ type: "new_construction", description: "DEMO: Heard a building is going up." }] }));
    if (r.status !== "created") return assert.fail();
    assert.equal(s.signals.find((g) => g.leadId === r.leadId)!.confidence, "unknown");
    const score = scoreLead(buildLeadContexts(s).find((c) => c.lead.id === r.leadId)!, NOW);
    assert.ok(!score.lines.some((l) => l.group === "signal"), "unconfirmed evidence adds no points");
    assert.equal(s.signals.filter((g) => g.leadId === r.leadId).length, 1, "but it is still saved and visible");
  });

  it("refuses facts without a stated confidence, with a plain-language next step", () => {
    const s = freshSnapshot();
    const m = testContext();
    const bad: [Partial<NewLeadInput>, RegExp][] = [
      [{ property: { name: "Demo A", address: "1 A St", city: "Walker", facilityType: "office", sqft: 10_000 } }, /how you know the square footage/],
      [{ contact: { name: "Pat", role: "Manager", phone: "225-555-0199" } }, /how you know the contact's phone or email/],
      [{ company: { name: "Demo Co", website: "https://demo.example.com" } }, /business contact details/],
      [{ title: "  " }, /why this is an opportunity/],
      // Phase 3: the street address became optional; the city is the required location.
      [{ property: { name: "Demo A", address: "1 A St", city: " ", facilityType: "office" } }, /location \(city\)/],
      [{ property: { city: "Walker", facilityType: "office" } }, /business or property name/],
      [{ signals: [] }, /why this is an opportunity/],
      [{ source: { sourceId: "src-manual", sourceUrl: "not a link" } }, /web address/],
      [{ property: { name: "Demo A", address: "1 A St", city: "Walker", facilityType: "office", sqft: -5, sqftStatus: "estimated" } }, /positive number/],
      [{ signals: [{ type: "expansion", description: " " }] }, /Describe what you saw/],
      [{ source: { sourceId: "nope" } }, /needs a source/],
      [{ source: { sourceId: "src-permits" } }, /Source temporarily unavailable/],
    ];
    for (const [over, pattern] of bad) {
      const before = JSON.stringify(s);
      assert.throws(() => createLead(s, m, baseInput(over)), (e: unknown) => e instanceof RepositoryError && pattern.test(e.message) && e.nextStep.length > 0, pattern.source);
      assert.equal(JSON.stringify(s), before, `nothing saved when: ${pattern.source}`);
    }
  });

  it("reports probable duplicates BEFORE saving anything", () => {
    const s = freshSnapshot();
    const input = baseInput({ property: { name: "Demo Industrial Ctr.", address: "1200 Demo Industrial Boulevard, Suite 5", city: "Gonzales", zip: "70737", facilityType: "warehouse" } });
    const before = JSON.stringify(s);
    const r = createLead(s, testContext(), input);
    assert.equal(r.status, "duplicates_found");
    if (r.status !== "duplicates_found") return;
    assert.deepEqual(r.candidates.map((c) => [c.propertyId, c.strength]), [["p-01", "exact"], ["p-16", "exact"]]);
    assert.deepEqual(r.candidates[0].openLeadIds, ["l-01"]);
    assert.equal(JSON.stringify(s), before, "nothing was written");
    assert.equal(previewDuplicates(s, input).length, 2);
  });

  it("'Link as same property' creates a new lead on the existing building and fills only what was unknown", () => {
    const s = freshSnapshot();
    const input = baseInput({
      property: { name: "Demo Industrial Ctr.", address: "1200 Demo Industrial Blvd", city: "Gonzales", zip: "70737", facilityType: "warehouse", sqft: 99_000, sqftStatus: "estimated" },
    });
    const r = createLead(s, testContext(), input, { duplicateAction: "link_to_property", linkPropertyId: "p-16" });
    if (r.status !== "created") return assert.fail();
    assert.equal(r.propertyId, "p-16");
    assert.equal(r.reusedProperty, true);
    assert.equal(s.properties.length, 18, "no new property");
    const p16 = s.properties.find((p) => p.id === "p-16")!;
    assert.deepEqual([p16.sqft, p16.sqftStatus], [99_000, "estimated"], "p-16 had unknown size, so it was filled");

    const r2 = createLead(s, testContext(), { ...input, title: "Second look" }, { duplicateAction: "link_to_property", linkPropertyId: "p-01" });
    if (r2.status !== "created") return assert.fail();
    assert.equal(s.properties.find((p) => p.id === "p-01")!.sqft, 45_000, "known facts are never overwritten");
  });

  it("'Create anyway' makes a separate property and notes the possible duplicate in the history", () => {
    const s = freshSnapshot();
    const input = baseInput({ property: { name: "Demo Industrial Center", address: "1200 Demo Industrial Blvd", city: "Gonzales", zip: "70737", facilityType: "warehouse" } });
    const r = createLead(s, testContext(), input, { duplicateAction: "create_anyway" });
    if (r.status !== "created") return assert.fail();
    assert.equal(r.reusedProperty, false);
    assert.equal(s.properties.length, 19);
    assert.deepEqual(r.possibleDuplicateOf.sort(), ["p-01", "p-16"]);
    assert.ok(s.auditLog.some((e) => e.entityId === r.propertyId && /Created anyway/.test(e.note ?? "")));
  });

  it("'link' with nothing to link to is refused", () => {
    assert.throws(() => createLead(freshSnapshot(), testContext(), baseInput(), { duplicateAction: "link_to_property" }), RepositoryError);
  });

  it("reuses a business that already exists instead of creating a twin; a business can have many properties", () => {
    const s = freshSnapshot();
    const r1 = createLead(s, testContext(), baseInput({ company: { name: "demo company a — distribution" } }));
    if (r1.status !== "created") return assert.fail();
    assert.equal(s.companies.length, 12, "no new company");
    assert.equal(s.leads.find((l) => l.id === r1.leadId)!.companyId, "co-a");
    const second = createLead(s, testContext(), baseInput({ property: { address: "9 Other Rd", city: "Zachary", facilityType: "warehouse" }, company: { existingId: "co-a" } }));
    if (second.status !== "created") return assert.fail();
    assert.ok(s.relationships.filter((r) => r.companyId === "co-a" && r.role === "tenant").length >= 3);
  });

  it("a property can have several tenants and a manager without collapsing them into one record", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), baseInput({ company: { name: "Demo Tenant One" }, propertyManager: { name: "Demo PM Two" } }));
    if (r.status !== "created") return assert.fail();
    const roles = s.relationships.filter((x) => x.propertyId === r.propertyId).map((x) => x.role).sort();
    assert.deepEqual(roles, ["property_manager", "tenant"]);
    const again = createLead(s, testContext(), { ...baseInput({ company: { name: "Demo Tenant Three" } }), property: { existingId: r.propertyId } });
    if (again.status !== "created") return assert.fail();
    assert.equal(s.relationships.filter((x) => x.propertyId === r.propertyId && x.role === "tenant").length, 2);
  });
});

describe("merging duplicates without losing history", () => {
  const counts = (s: ReturnType<typeof freshSnapshot>) => ({
    properties: s.properties.length, leads: s.leads.length, signals: s.signals.length, activities: s.activities.length,
    followups: s.followups.length, walkthroughs: s.walkthroughs.length, sourceRecords: s.sourceRecords.length,
    provenance: s.provenance.length, breakdowns: s.scoreBreakdowns.length, audit: s.auditLog.length,
  });

  it("merging properties moves everything, keeps both records, and fills only gaps", () => {
    const s = freshSnapshot();
    s.properties.find((p) => p.id === "p-16")!.constructionStatus = "Punch list";
    s.followups.push({ ...clone(s.followups[0]), id: "fu-x", leadId: "l-19", completedAt: null });
    const before = counts(s);

    const summary = mergeProperties(s, testContext(), "p-01", "p-16");
    const after = counts(s);

    assert.equal(summary.moved.leads, 1);
    assert.equal(s.leads.find((l) => l.id === "l-19")!.propertyId, "p-01");
    const dup = s.properties.find((p) => p.id === "p-16")!;
    assert.equal(dup.mergedIntoId, "p-01", "duplicate kept, marked merged");
    assert.equal(after.properties, before.properties, "nothing deleted");
    for (const k of ["leads", "signals", "activities", "followups", "walkthroughs", "sourceRecords", "provenance"] as const) assert.ok(after[k] >= before[k], `${k} not lost`);
    assert.ok(after.audit > before.audit, "the merge is audited");
    assert.equal(s.properties.find((p) => p.id === "p-01")!.sqft, 45_000, "survivor's size kept");
    assert.equal(s.properties.find((p) => p.id === "p-01")!.constructionStatus, "Nearing completion", "survivor's value wins");
    assert.ok(s.auditLog.some((e) => e.entityId === "p-01" && e.field === "constructionStatus" && e.oldValue === "Punch list"), "the other value is recoverable from history");
    assert.ok(s.activities.some((a) => a.leadId === "l-19" && a.type === "merged"));
    assert.equal(findPropertyDuplicates(s).length, 0, "no longer reported as a duplicate");
  });

  it("merging properties keeps each side's relationships and provenance (identical ones are combined, not lost)", () => {
    const s = freshSnapshot();
    s.relationships.push({ ...clone(s.relationships.find((r) => r.id === "r-01")!), id: "r-dup", propertyId: "p-16" }); // same tenant on the duplicate
    s.relationships.push({ ...clone(s.relationships.find((r) => r.id === "r-03")!), id: "r-lease", propertyId: "p-16" }); // a leasing company only the duplicate knew
    s.provenance.push({ ...clone(s.provenance[0]), id: "fp-dup-rel", entityType: "relationship", entityId: "r-dup", field: "tenant" });
    mergeProperties(s, testContext(), "p-01", "p-16");
    assert.ok(!s.relationships.some((r) => r.id === "r-dup"), "identical relationship folded into the survivor's");
    assert.equal(s.relationships.find((r) => r.id === "r-lease")!.propertyId, "p-01", "the other side's relationship survives");
    assert.equal(s.provenance.find((f) => f.id === "fp-dup-rel")!.entityId, "r-01", "its provenance moved with it");
  });

  it("merging leads keeps signals, activities, follow-ups, walkthroughs, notes and sources; hides the duplicate", () => {
    const s = freshSnapshot();
    mergeProperties(s, testContext(), "p-01", "p-16");
    s.leads.find((l) => l.id === "l-19")!.notes = "Heard from the CSV contact.";
    s.leads.find((l) => l.id === "l-01")!.notes = "Original note.";
    const sigL19 = s.signals.filter((g) => g.leadId === "l-19").length;
    const actL19 = s.activities.filter((a) => a.leadId === "l-19").length;
    const before = counts(s);

    const summary = mergeLeads(s, testContext(), "l-01", "l-19");
    const after = counts(s);
    const keep = s.leads.find((l) => l.id === "l-01")!;
    const dup = s.leads.find((l) => l.id === "l-19")!;

    assert.equal(dup.mergedIntoLeadId, "l-01");
    assert.equal(after.leads, before.leads, "nothing deleted");
    assert.equal(summary.moved.signals, sigL19);
    assert.equal(summary.moved.activities, actL19);
    assert.equal(s.signals.filter((g) => g.leadId === "l-19").length, 0);
    assert.ok(s.signals.filter((g) => g.leadId === "l-01").length >= 3 + sigL19);
    assert.match(keep.notes!, /Original note\./);
    assert.match(keep.notes!, /Heard from the CSV contact\./);
    assert.equal(s.sourceRecords.find((r) => r.id === "sr-19")!.importedLeadId, "l-01", "the duplicate's source record is kept and points at the survivor");
    assert.equal(s.sourceRecords.find((r) => r.id === "sr-19")!.status, "duplicate");
    assert.ok(new Date(keep.discoveredAt) <= new Date(dup.discoveredAt), "earliest discovery date kept");
    for (const k of ["signals", "activities", "followups", "walkthroughs", "sourceRecords", "provenance", "breakdowns"] as const) assert.ok(after[k] >= before[k], `${k} not lost`);

    // The merged lead disappears from every list, including Today.
    assert.ok(!buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === "l-19"));
    assert.equal(findLeadDuplicates(s).filter((d) => d.duplicateId === "l-19" || d.leadId === "l-19").length, 0);
  });

  it("merge errors are plain-language and change nothing", () => {
    const s = freshSnapshot();
    const before = JSON.stringify(s);
    const m = testContext();
    assert.throws(() => mergeProperties(s, m, "p-01", "p-01"), RepositoryError);
    assert.throws(() => mergeProperties(s, m, "p-01", "nope"), RepositoryError);
    assert.throws(() => mergeLeads(s, m, "l-01", "l-19"), (e: unknown) => e instanceof RepositoryError && /merge the two property records first/.test(e.nextStep));
    assert.equal(JSON.stringify(s), before);
    mergeLeads(s, m, "l-09", "l-20"); // same property → allowed
    assert.throws(() => mergeLeads(s, m, "l-09", "l-20"), /already merged/);
  });
});
