import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalDemoRepository } from "../data/demo/local-demo-repository";
import { RepositoryError } from "../domain/errors";
import { resolveScoringSettings } from "../config/scoring-settings";
import { parseCsv } from "../engine/csv";
import { buildToday, evaluateAll } from "../engine/evaluate";
import { activeFilterKeys, applyLeadFilters, EMPTY_FILTERS, matchesSearch, type LeadFilters } from "../engine/lead-search";
import { autoMapColumns, buildCsvPreview, csvTemplate, importCsv, missingRequiredMappings, summarizePreview, type CsvImportOptions } from "./csv-import";
import { markNotDuplicate, mergeDuplicateLeads, openDuplicatesOf } from "./duplicate-review";
import { requestQuote, setStatus } from "./actions";
import { createLead, type NewLeadInput } from "./ingest";
import { clone, freshSnapshot, NOW, testContext } from "./test-helpers";

/** The five required things, and nothing else. */
const minimal = (over: Partial<NewLeadInput> = {}): NewLeadInput => ({
  title: "Lease signed for the whole building",
  company: { name: "Demo Phase3 Freight" },
  property: { city: "Walker", facilityType: "warehouse" },
  signals: [{ type: "new_tenant", description: "DEMO: Lease signed for the whole building.", confidence: "publicly_reported" }],
  source: { sourceId: "src-manual", kind: "news_article" },
  ...over,
});

const viewOf = (s: ReturnType<typeof freshSnapshot>, leadId: string) => evaluateAll(s, NOW).find((v) => v.ctx.lead.id === leadId)!;

// =====================================================================================================
describe("Phase 3 · manual intake", () => {
  it("saves a lead with only the five required things (no street address needed)", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), minimal());
    if (r.status !== "created") return assert.fail("should be created");
    assert.equal(r.mode, "new_lead");
    const p = s.properties.find((x) => x.id === r.propertyId)!;
    assert.deepEqual([p.name, p.address, p.city, p.parish, p.facilityType], ["Demo Phase3 Freight", "", "Walker", "Livingston", "warehouse"]);
    assert.equal(p.marketId, s.markets.find((x) => x.name === "Walker")!.id, "market comes from data");
    const v = viewOf(s, r.leadId);
    assert.equal(v.ctx.lead.status, "new");
    assert.ok(v.score.score > 0, "scored by the deterministic engine");
    assert.equal(v.readiness.ready, true, "ready for the sales workflow without a URL or contact");
    assert.equal(v.action.kind, "research_pm", "no manager, no contact → research property manager");
  });

  it("refuses each missing required field with a plain-language next step, and saves nothing", () => {
    const cases: [Partial<NewLeadInput>, RegExp][] = [
      [{ company: null, property: { city: "Walker", facilityType: "warehouse" } }, /business or property name/],
      [{ property: { city: "", facilityType: "warehouse" } }, /location/],
      [{ property: { city: "Walker", facilityType: "" as never } }, /facility type/],
      [{ signals: [] }, /why this is an opportunity/],
      [{ title: "" }, /why this is an opportunity/],
      [{ source: { sourceId: "" } }, /needs a source/],
    ];
    for (const [over, pattern] of cases) {
      const s = freshSnapshot();
      const before = JSON.stringify(s);
      assert.throws(
        () => createLead(s, testContext(), minimal(over)),
        (e: unknown) => e instanceof RepositoryError && pattern.test(e.message) && e.nextStep.length > 0,
        pattern.source,
      );
      assert.equal(JSON.stringify(s), before, `nothing saved: ${pattern.source}`);
    }
  });

  it("unknown optional information stays unknown — nothing is guessed", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), minimal());
    if (r.status !== "created") return assert.fail();
    const p = s.properties.find((x) => x.id === r.propertyId)!;
    const lead = s.leads.find((l) => l.id === r.leadId)!;
    assert.deepEqual([p.sqft, p.sqftStatus, p.zip, p.lat, p.lng], [null, "unknown", "", null, null]);
    assert.deepEqual([lead.primaryContactId, lead.potentialValue, lead.lastVerifiedAt], [null, "unknown", null]);
    const v = viewOf(s, r.leadId);
    assert.deepEqual([v.contact.name, v.contact.phone, v.contact.email, v.ctx.propertyManager], [null, null, null, null]);
    assert.ok(!s.contacts.some((c) => c.sourceId === "src-manual" && c.createdAt === NOW.toISOString()), "no contact invented");
  });

  it("keeps the source: kind, link, name, discovered date — and NEVER claims it was checked unless a person says so", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), minimal({ source: { sourceId: "src-url", kind: "property_listing", sourceUrl: "https://example.com/demo/listing-9", title: "Demo listing site" } }));
    if (r.status !== "created") return assert.fail();
    const lead = s.leads.find((l) => l.id === r.leadId)!;
    const sr = s.sourceRecords.find((x) => x.id === lead.sourceRecordId)!;
    assert.deepEqual(
      [sr.sourceUrl, sr.kind, sr.title, sr.verification, sr.lastVerifiedAt, sr.verifiedBy, sr.discoveredAt],
      ["https://example.com/demo/listing-9", "property_listing", "Demo listing site", "not_checked", null, null, NOW.toISOString()],
    );
    assert.equal(lead.lastVerifiedAt, null);
    assert.equal(viewOf(s, lead.id).freshness.label, "Found today", "found, not 'verified'");
    assert.equal(s.signals.find((g) => g.leadId === lead.id)!.sourceUrl, "https://example.com/demo/listing-9");
  });

  it("a person checking the link marks it verified (who + when); a link that won't open is 'Source unavailable', not 'no opportunity'", () => {
    const s = freshSnapshot();
    const ok = createLead(s, testContext(), minimal({ source: { sourceId: "src-url", sourceUrl: "https://example.com/demo/a", verification: "verified" } }));
    if (ok.status !== "created") return assert.fail();
    const lead = s.leads.find((l) => l.id === ok.leadId)!;
    const sr = s.sourceRecords.find((x) => x.id === lead.sourceRecordId)!;
    assert.deepEqual([sr.verification, sr.verifiedBy, sr.lastVerifiedAt, lead.lastVerifiedAt], ["verified", "Test user", NOW.toISOString(), NOW.toISOString()]);
    assert.equal(viewOf(s, lead.id).freshness.label, "Verified today");

    const down = createLead(s, testContext(), minimal({ company: { name: "Demo Other Biz" }, source: { sourceId: "src-url", sourceUrl: "https://example.com/demo/b", verification: "unavailable" } }));
    if (down.status !== "created") return assert.fail();
    const sr2 = s.sourceRecords.find((x) => x.importedLeadId === down.leadId)!;
    assert.equal(sr2.verification, "unavailable");
    assert.match(sr2.note ?? "", /unconfirmed, not disproven/);
    assert.equal(s.leads.find((l) => l.id === down.leadId)!.lastVerifiedAt, null);
  });

  it("rejects a malformed link instead of storing junk", () => {
    assert.throws(() => createLead(freshSnapshot(), testContext(), minimal({ source: { sourceId: "src-url", sourceUrl: "www nope" } })), /web address/);
  });
});

// =====================================================================================================
describe("Phase 3 · search", () => {
  const s = freshSnapshot();
  const views = evaluateAll(s, NOW);
  const find = (q: string) => views.filter((v) => matchesSearch(v, q)).map((v) => v.ctx.lead.id);

  it("finds by company, property, contact, address, phone, email and website — any case, any order", () => {
    assert.ok(find("demo company b").includes("l-04"), "company");
    assert.ok(find("MEDICAL pavilion").includes("l-04"), "property");
    assert.ok(find("riley").includes("l-04"), "contact");
    assert.ok(find("25 demo health").includes("l-04"), "address");
    assert.ok(find("225-555-0121").includes("l-04") && find("5550121").includes("l-04"), "phone, with or without dashes");
    assert.ok(find("riley@demo-medical").includes("l-04"), "email");
    assert.ok(find("demo-hotel.example.com").includes("l-09"), "website");
    assert.ok(find("pavilion medical").includes("l-04"), "word order doesn't matter");
  });

  it("is forgiving about one typo in a longer word, but not loose", () => {
    assert.ok(find("pavillion").includes("l-04"));
    assert.equal(find("zzqx").length, 0);
  });

  it("search finds Not a Fit leads even though they're hidden from the open view", () => {
    const open = applyLeadFilters(views, { ...EMPTY_FILTERS }, s, NOW).map((v) => v.ctx.lead.id);
    assert.ok(!open.includes("l-17"));
    const searched = applyLeadFilters(views, { ...EMPTY_FILTERS, q: "service bays" }, s, NOW).map((v) => v.ctx.lead.id);
    assert.deepEqual(searched, ["l-17"]);
  });
});

// =====================================================================================================
describe("Phase 3 · filters", () => {
  const s = freshSnapshot();
  const views = evaluateAll(s, NOW);
  const run = (f: Partial<LeadFilters>) => applyLeadFilters(views, { ...EMPTY_FILTERS, ...f }, s, NOW);

  it("market works for a city and for a parish (from data)", () => {
    const gonzales = s.markets.find((m) => m.name === "Gonzales")!.id;
    const ascension = s.markets.find((m) => m.kind === "parish" && m.name === "Ascension")!.id;
    assert.ok(run({ market: gonzales }).every((v) => v.ctx.property.city === "Gonzales"));
    const parish = run({ market: ascension });
    assert.ok(parish.length > run({ market: gonzales }).length && parish.every((v) => v.ctx.property.parish === "Ascension"));
  });

  it("property type, score tier, status and freshness", () => {
    assert.ok(run({ facilityType: "warehouse" }).every((v) => v.ctx.property.facilityType === "warehouse"));
    const hot = run({ tier: "hot" });
    assert.ok(hot.length > 0 && hot.every((v) => v.score.tier === "hot"));
    assert.deepEqual(run({ status: "won" }).map((v) => v.ctx.lead.id), ["l-16"]);
    assert.ok(run({ status: "closed" }).every((v) => ["won", "lost", "not_a_fit"].includes(v.ctx.lead.status)));
    assert.ok(run({ status: "open" }).every((v) => !["won", "lost", "not_a_fit"].includes(v.ctx.lead.status)));
    assert.ok(run({ freshness: "stale" }).every((v) => v.freshness.level === "stale") && run({ freshness: "stale" }).length > 0);
  });

  it("more filters: contact, manager, follow-up, source, opportunity type", () => {
    assert.ok(run({ hasContact: "no" }).every((v) => !v.contact.phone && !v.contact.email));
    assert.ok(run({ hasManager: "yes" }).every((v) => v.ctx.propertyManager));
    assert.deepEqual(run({ followUp: "overdue" }).map((v) => v.ctx.lead.id), ["l-04"]);
    assert.ok(run({ source: "src-csv" }).length > 0);
    assert.ok(run({ opportunityType: "new_construction" }).length > 0);
  });

  it("clear filters puts everything back", () => {
    const busy: LeadFilters = { ...EMPTY_FILTERS, q: "demo", tier: "hot", hasContact: "yes", status: "all" };
    assert.deepEqual(activeFilterKeys(busy).sort(), ["hasContact", "q", "status", "tier"]);
    assert.deepEqual(activeFilterKeys({ ...EMPTY_FILTERS }), []);
  });
});

// =====================================================================================================
describe("Phase 3 · CSV import", () => {
  const opts: CsvImportOptions = { fileName: "test.csv", sourceId: "src-csv", dataStatus: "publicly_reported" };
  const CSV = [
    "Business name,Street address,City,Facility type,Opportunity type,Why it's an opportunity,Phone,Square feet",
    'Demo CSV Alpha,"10 Alpha Rd, Suite 2",Zachary,Office,New tenant,"DEMO: Lease signed, two floors",225-555-0191,"12,000"',
    "Demo CSV Bravo,,Central,Spaceship,New tenant,DEMO: something,,",
    ",,Central,Office,,,,",
    "Demo CSV Echo,1200 Demo Industrial Blvd,Gonzales,Warehouse,New tenant,DEMO: repeat of an existing building,,",
    "Demo CSV Foxtrot,55 Fox Ln,Walker,Retail,Renovation,DEMO: renovated,,",
    "Demo CSV Foxtrot,55 Fox Lane,Walker,Retail,Renovation,DEMO: same building twice in one file,,",
    "Demo CSV Golf,9 Golf St,Port Allen,Warehouse,Expansion,DEMO: x,,abc",
  ].join("\r\n");

  it("parses quoted cells (commas inside quotes) and maps columns by their names", () => {
    const parsed = parseCsv(CSV);
    assert.equal(parsed.rows.length, 7);
    assert.equal(parsed.rows[0][1], "10 Alpha Rd, Suite 2");
    const mapping = autoMapColumns(parsed.headers);
    assert.deepEqual(missingRequiredMappings(mapping), []);
    assert.deepEqual(missingRequiredMappings({}), ["Business name or Property name", "City (location)", "Facility type", "Why it's an opportunity"]);
  });

  it("previews valid rows, rows with errors, missing required fields and possible duplicates", () => {
    const s = freshSnapshot();
    const parsed = parseCsv(CSV);
    const rows = buildCsvPreview(s, parsed, autoMapColumns(parsed.headers), opts);
    const byRow = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));
    assert.equal(byRow[2].status, "ready");
    assert.equal(byRow[3].status, "error");
    assert.match(byRow[3].errors.join(" "), /Facility type “Spaceship” isn't one we know/);
    assert.equal(byRow[4].status, "error");
    assert.match(byRow[4].errors.join(" "), /Missing the business or property name/);
    assert.match(byRow[4].errors.join(" "), /Missing why it's an opportunity/);
    assert.equal(byRow[5].status, "duplicate", "matches an existing building");
    assert.equal(byRow[5].duplicates[0].propertyId, "p-01");
    assert.equal(byRow[6].status, "ready");
    assert.equal(byRow[7].status, "duplicate", "same building as an earlier row of this file");
    assert.equal(byRow[7].inFileDuplicateOf, 6);
    assert.equal(byRow[8].status, "error");
    assert.match(byRow[8].errors.join(" "), /Square feet “abc” isn't a number/);
    assert.deepEqual(summarizePreview(rows), { total: 7, ready: 2, duplicates: 2, errors: 3, missingRequired: 1 });
    assert.equal(JSON.stringify(freshSnapshot().leads.length), String(s.leads.length), "preview saves nothing");
  });

  it("imports ready rows, skips duplicates by default, and accounts for EVERY row (no silent discards)", () => {
    const s = freshSnapshot();
    const before = { leads: s.leads.length, records: s.sourceRecords.length, decisions: s.duplicateDecisions.length };
    const parsed = parseCsv(CSV);
    const result = importCsv(s, testContext(), { parsed, mapping: autoMapColumns(parsed.headers), options: opts, choices: {} });
    assert.equal(result.total, 7);
    assert.equal(result.imported + result.addedToExisting + result.skipped + result.notImported, 7);
    assert.deepEqual([result.imported, result.skipped, result.notImported], [2, 2, 3]);
    assert.equal(s.leads.length, before.leads + 2);
    assert.equal(s.sourceRecords.length, before.records + 7, "every row is kept as a source record, imported or not");
    assert.equal(s.sourceRecords.filter((r) => r.status === "rejected" && r.title === "test.csv").length, 3);
    assert.equal(s.duplicateDecisions.length, before.decisions + 2, "skips are recorded decisions");
    const alpha = s.leads.find((l) => l.title.startsWith("DEMO: Lease signed"))!;
    const p = s.properties.find((x) => x.id === alpha.propertyId)!;
    assert.deepEqual([p.sqft, p.sqftStatus], [12_000, "publicly_reported"]);
    assert.equal(s.sourceRecords.find((r) => r.importedLeadId === alpha.id)!.externalId, "test.csv · row 2");
  });

  it("'add to existing lead' fills blanks only — an existing lead is never overwritten", () => {
    const s = freshSnapshot();
    const l01 = clone(s.leads.find((l) => l.id === "l-01")!);
    const p01 = clone(s.properties.find((p) => p.id === "p-01")!);
    const parsed = parseCsv(
      "Business name,Street address,City,Facility type,Why it's an opportunity,Square feet,Potential value\nDemo Company A — Distribution,1200 Demo Industrial Blvd,Gonzales,Warehouse,DEMO: second article,99000,Low",
    );
    const r = importCsv(s, testContext(), { parsed, mapping: autoMapColumns(parsed.headers), options: opts, choices: { 2: { action: "add_to_existing_lead", leadId: "l-01" } } });
    assert.equal(r.addedToExisting, 1);
    const after = s.leads.find((l) => l.id === "l-01")!;
    assert.deepEqual([after.title, after.status, after.potentialValue], [l01.title, l01.status, l01.potentialValue]);
    assert.equal(s.properties.find((p) => p.id === "p-01")!.sqft, p01.sqft, "45,000 stays 45,000");
    assert.ok(s.signals.some((g) => g.leadId === "l-01" && g.description === "DEMO: second article"), "the new evidence is attached");
    assert.equal(s.duplicateDecisions.at(-1)!.decision, "add_to_existing_lead");
  });

  it("offers a template with the column names it recognizes", () => {
    const parsed = parseCsv(csvTemplate());
    assert.deepEqual(missingRequiredMappings(autoMapColumns(parsed.headers)), []);
    assert.match(parsed.rows[0][0], /EXAMPLE/);
  });
});

// =====================================================================================================
describe("Phase 3 · duplicate handling", () => {
  it("detects a likely duplicate from the business name even without an address", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), minimal({ company: { name: "Demo Company C — Restaurant Group" }, property: { city: "Walker", facilityType: "restaurant" } }));
    assert.equal(r.status, "duplicates_found");
    if (r.status !== "duplicates_found") return;
    assert.equal(r.candidates[0].propertyId, "p-07");
    assert.ok(r.candidates[0].reasons.includes("same_business"));
  });

  it("'Create anyway' is a real, persistent decision: what was flagged, who decided, when, and the records considered", () => {
    const s = freshSnapshot();
    const input = minimal({ property: { name: "Demo Industrial Center", address: "1200 Demo Industrial Blvd", city: "Gonzales", facilityType: "warehouse" } });
    const r = createLead(s, testContext(), input, { duplicateAction: "create_anyway", decisionNote: "Different suite owner" });
    if (r.status !== "created") return assert.fail();
    const d = s.duplicateDecisions.find((x) => x.id === r.decisionId)!;
    assert.deepEqual(
      [d.context, d.decision, d.decidedBy, d.decidedAt, d.resultLeadId, d.note],
      ["manual_entry", "create_anyway", "Test user", NOW.toISOString(), r.leadId, "Different suite owner"],
    );
    assert.deepEqual(d.candidatePropertyIds.sort(), ["p-01", "p-16"]);
    assert.ok(d.candidateLeadIds.includes("l-01") && d.reasons.includes("same_address"));
    assert.match(d.subject, /Demo Industrial Center — 1200 Demo Industrial Blvd, Gonzales/);
  });

  it("'Link as same property / new opportunity' and 'Add to existing lead' are recorded too", () => {
    const s = freshSnapshot();
    const input = minimal({ property: { address: "1200 Demo Industrial Blvd", city: "Gonzales", facilityType: "warehouse" } });
    const linked = createLead(s, testContext(), input, { duplicateAction: "link_to_property", linkPropertyId: "p-01" });
    if (linked.status !== "created") return assert.fail();
    assert.equal(linked.propertyId, "p-01");
    assert.equal(s.duplicateDecisions.find((d) => d.id === linked.decisionId)!.decision, "link_to_property");

    const leadsBefore = s.leads.length;
    const added = createLead(s, testContext(), input, { duplicateAction: "add_to_existing_lead", existingLeadId: "l-01" });
    if (added.status !== "created") return assert.fail();
    assert.equal(added.mode, "added_to_existing");
    assert.equal(s.leads.length, leadsBefore, "no new lead");
    assert.ok(s.activities.some((a) => a.leadId === "l-01" && /New information added/.test(a.summary)));
  });

  it("review → merge two leads on two property records keeps sources, activity, notes, follow-ups, provenance and score history", () => {
    const s = freshSnapshot();
    const m = testContext();
    const keepActs = s.activities.filter((a) => a.leadId === "l-19").length;
    const breakdownsBefore = s.scoreBreakdowns.filter((b) => b.leadId === "l-19").length;
    assert.ok(openDuplicatesOf(s, "l-01").some((d) => d.leadId === "l-19" || d.duplicateId === "l-19"));
    const summary = mergeDuplicateLeads(s, m, "l-01", "l-19");
    assert.equal(s.leads.find((l) => l.id === "l-19")!.mergedIntoLeadId, "l-01", "kept, marked, not deleted");
    assert.equal(s.properties.find((p) => p.id === "p-16")!.mergedIntoId, "p-01");
    assert.ok(s.activities.filter((a) => a.leadId === "l-01").length >= keepActs + 1);
    assert.ok(s.signals.some((g) => g.leadId === "l-01" && /duplicate/.test(g.description)), "the duplicate's evidence moved over");
    assert.ok(s.sourceRecords.some((r) => r.id === "sr-19" && r.importedLeadId === "l-01"), "its source record is kept");
    assert.equal(s.scoreBreakdowns.filter((b) => b.leadId === "l-19").length, breakdownsBefore, "score history rows are never edited or removed");
    assert.equal(summary.decision.decision, "merged");
    assert.equal(openDuplicatesOf(s, "l-01").filter((d) => d.leadId === "l-19" || d.duplicateId === "l-19").length, 0);
  });

  it("'Create anyway' and 'same building, new opportunity' also count as answers — the pair stops warning", () => {
    const s = freshSnapshot();
    const input = minimal({ property: { name: "Demo Industrial Center", address: "1200 Demo Industrial Blvd", city: "Gonzales", facilityType: "warehouse" } });
    const r = createLead(s, testContext(), input, { duplicateAction: "create_anyway" });
    if (r.status !== "created") return assert.fail();
    assert.ok(!openDuplicatesOf(s, r.leadId).some((d) => [d.leadId, d.duplicateId].includes("l-01")));
    const linked = createLead(s, testContext(), { ...input, title: "Second suite" }, { duplicateAction: "link_to_property", linkPropertyId: "p-01" });
    if (linked.status !== "created") return assert.fail();
    assert.ok(!openDuplicatesOf(s, linked.leadId).some((d) => [d.leadId, d.duplicateId].includes("l-01")));
    assert.ok(openDuplicatesOf(s, "l-01").some((d) => [d.leadId, d.duplicateId].includes("l-19")), "unanswered pairs still warn");
  });

  it("'not a duplicate' stops the warning and is remembered", () => {
    const s = freshSnapshot();
    assert.equal(openDuplicatesOf(s, "l-09").length, 1);
    markNotDuplicate(s, testContext(), "l-09", "l-20", "Two separate hotel wings");
    assert.equal(openDuplicatesOf(s, "l-09").length, 0);
    assert.equal(s.duplicateDecisions.at(-1)!.decision, "not_duplicate");
  });
});

// =====================================================================================================
describe("Phase 3 · scoring and Today", () => {
  it("a new lead is scored by the same engine: raw + capped score, tier, breakdown and history are saved", async () => {
    const repo = new LocalDemoRepository({ latencyMs: 0, clock: () => NOW, role: "manager" });
    const r = await repo.createLead(
      minimal({
        property: { city: "Walker", facilityType: "warehouse", sqft: 60_000, sqftStatus: "verified" },
        signals: [
          { type: "new_tenant", description: "DEMO: lease", confidence: "verified" },
          { type: "new_construction", description: "DEMO: new building", confidence: "publicly_reported" },
          { type: "construction_nearing_completion", description: "DEMO: finish-out", confidence: "publicly_reported" },
        ],
        propertyManager: { name: "Demo Phase3 Management" },
        contact: { name: "Demo Person", role: "Facilities", phone: "225-555-0198", dataStatus: "publicly_reported" },
        source: { sourceId: "src-manual", kind: "referral" },
      }),
    );
    if (r.status !== "created") return assert.fail();
    let s = await repo.loadSnapshot();
    const rows = s.scoreBreakdowns.filter((b) => b.leadId === r.leadId);
    assert.equal(rows.length, 1);
    const view = evaluateAll(s, NOW).find((v) => v.ctx.lead.id === r.leadId)!;
    assert.deepEqual([rows[0].rawScore, rows[0].score, rows[0].tier], [view.score.raw, view.score.score, view.score.tier]);
    assert.ok(rows[0].lines.length > 0 && rows[0].lines.every((l) => l.label.length > 0), "every point explained");
    assert.equal(view.action.kind, "call", "contact available and never contacted → call");
    assert.equal(view.score.tier, "hot");
    assert.ok(buildToday(s, NOW).items.some((i) => i.view.ctx.lead.id === r.leadId), "a strong, qualified new lead flows straight into Today");

    // More evidence later → a second history row and an audit entry; the first row is untouched.
    await repo.createLead(minimal({ signals: [{ type: "rfp_bid", description: "DEMO: RFP posted", confidence: "verified" }] }), {
      duplicateAction: "add_to_existing_lead",
      existingLeadId: r.leadId,
    });
    s = await repo.loadSnapshot();
    const after = s.scoreBreakdowns.filter((b) => b.leadId === r.leadId);
    assert.equal(after.length, 2);
    assert.deepEqual(after[0], rows[0]);
    assert.ok(s.auditLog.some((e) => e.leadId === r.leadId && e.action === "score_change"));
  });

  it("a ready-for-quote lead stays on Today until Quote requested, Won, Lost, Not a Fit or Nurture", () => {
    const s = freshSnapshot();
    const pinned = (snap: typeof s) => buildToday(snap, NOW).items.find((i) => i.view.ctx.lead.id === "l-21");
    assert.equal(pinned(s)?.group, "quote_needed");
    assert.equal(pinned(s)?.rankNote, "Ready for a quote");
    assert.equal(pinned(s)?.view.action.kind, "request_quote");

    // Even if the list were tiny, it is not pushed off.
    const tiny = clone(s);
    const settings = resolveScoringSettings(tiny.settings);
    const small = { ...settings, ranking: { ...settings.ranking, todayListSize: 2 } };
    assert.ok(buildToday(tiny, NOW, small).items.some((i) => i.view.ctx.lead.id === "l-21"));

    const quoted = clone(s);
    requestQuote(quoted, testContext(), "l-21");
    assert.notEqual(pinned(quoted)?.group, "quote_needed", "after Quote requested it ranks normally");

    const nurtured = clone(s);
    setStatus(nurtured, testContext(), "l-21", "nurture");
    assert.equal(pinned(nurtured), undefined);
  });

  it("a weak new lead is ranked with everyone else — it doesn't jump the queue", () => {
    const s = freshSnapshot();
    const r = createLead(s, testContext(), minimal({ signals: [{ type: "generic_commercial", description: "DEMO: commercial building", confidence: "publicly_reported" }] }));
    if (r.status !== "created") return assert.fail();
    const today = buildToday(s, NOW);
    assert.ok(!today.items.some((i) => i.view.ctx.lead.id === r.leadId));
    assert.ok(today.remaining > 0, "it is waiting below the top of the list");
  });

  it("a walkthrough that is done but has no outcome is also kept on Today (it used to fall off)", () => {
    const item = buildToday(freshSnapshot(), NOW).items.find((i) => i.view.ctx.lead.id === "l-07");
    assert.equal(item?.group, "quote_needed");
  });
});
