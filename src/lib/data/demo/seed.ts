/**
 * DEMO / LOCAL DATA — 100% FICTIONAL.
 *
 * Every company, property, contact, address, phone number, email and URL below is invented
 * for testing the user interface. None of it was researched and none of it describes a real
 * business or building. Phone numbers use the reserved fictional 555-01xx range; all emails
 * and links use the reserved example.com domain. City / parish names are real only because
 * they are Traylor Pro's configured service area.
 *
 * Dates are generated relative to "now" so freshness, follow-ups and walkthroughs always
 * look current when the demo is (re)loaded.
 */
import { DEFAULT_SCORING_SETTINGS } from "../../config/scoring-settings";
import { SCHEMA_VERSION } from "../../domain/types";
import type {
  Activity,
  AuditEntry,
  Company,
  Contact,
  DataStatus,
  FieldProvenance,
  FollowUp,
  Lead,
  LeadFinderSnapshot,
  Market,
  OpportunitySignal,
  PipelineStatus,
  Property,
  PropertyRelationship,
  SignalType,
  Source,
  SourceRecord,
  UserRole,
  Walkthrough,
} from "../../domain/types";
import { normalizeAddress } from "../../engine/duplicates";
import { recordScoreChanges } from "../../engine/score-history";

export function createDemoSnapshot(now: Date = new Date()): LeadFinderSnapshot {
  /** Local date `days` from today at hh:mm. Negative = past. */
  const at = (days: number, hour = 9, minute = 0): string => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, minute);
    return d.toISOString();
  };

  /** created_at / updated_at, `daysAgo` days back. */
  const ts = (daysAgo = 60) => ({ createdAt: at(-daysAgo, 8), updatedAt: at(-daysAgo, 8) });

  // ---------------------------------------------------------------- markets (config as data)
  const cities: [string, string][] = [
    ["Baton Rouge", "East Baton Rouge"],
    ["Denham Springs", "Livingston"],
    ["Prairieville", "Ascension"],
    ["Gonzales", "Ascension"],
    ["Walker", "Livingston"],
    ["Zachary", "East Baton Rouge"],
    ["Port Allen", "West Baton Rouge"],
    ["Central", "East Baton Rouge"],
  ];
  const parishes = ["East Baton Rouge", "West Baton Rouge", "Livingston", "Ascension"];
  const markets: Market[] = [
    ...cities.map(([name, parish], i) => ({ id: `mkt-city-${i + 1}`, name, kind: "city" as const, parish, active: true, ...ts(90) })),
    ...parishes.map((name, i) => ({ id: `mkt-parish-${i + 1}`, name, kind: "parish" as const, active: true, ...ts(90) })),
  ];
  const marketIdForCity = (city: string) => markets.find((m) => m.kind === "city" && m.name === city)?.id ?? null;

  // ---------------------------------------------------------------- sources
  const src = (id: string, name: string, type: Source["type"], category: Source["category"], url: string | null, extra: Partial<Source> = {}): Source => ({
    id, name, type, category, url, status: "available", statusNote: null, lastCheckedAt: at(0, 7), lastSuccessAt: at(0, 7),
    automatedAccessAllowed: false, isDemo: true, ...ts(90), ...extra,
  });
  const sources: Source[] = [
    src("src-manual", "Manual entry (demo)", "manual", "manual_entry", null),
    src("src-csv", "Demo CSV import — demo_leads.csv", "csv", "csv_import", null),
    src("src-url", "URL reference (demo)", "url", "url_reference", "https://example.com/demo"),
    // A source that failed. Shown as "unavailable" — never as "no leads found".
    src("src-permits", "Demo permit feed (simulated outage)", "url", "permits", "https://example.com/demo/permits", {
      status: "unavailable", statusNote: "Simulated outage for the demo. Any leads from this feed are unknown, not absent.",
      lastSuccessAt: at(-9, 7), automatedAccessAllowed: null,
    }),
  ];

  // ---------------------------------------------------------------- companies (10)
  const co = (id: string, name: string, industry: string | null, extra: Partial<Company> = {}): Company => ({
    id, name, industry, website: null, phone: null, email: null, sourceId: "src-manual", mergedIntoId: null, isDemo: true, ...ts(80), ...extra,
  });
  const companies: Company[] = [
    co("co-a", "Demo Company A — Distribution", "Distribution & logistics", { website: "https://demo-company-a.example.com" }),
    co("co-pm1", "Demo Property Management Co.", "Property management", { phone: "225-555-0100", email: "office@demo-pm.example.com", website: "https://demo-pm.example.com" }),
    co("co-lease", "Demo Leasing Group", "Commercial leasing", { phone: "225-555-0110", website: "https://demo-leasing.example.com" }),
    co("co-b", "Demo Company B — Medical Group", "Healthcare"),
    co("co-c", "Demo Company C — Restaurant Group", "Restaurants"),
    co("co-d", "Demo Company D — Manufacturing", "Manufacturing"),
    co("co-e", "Demo Company E — Retail", "Retail"),
    co("co-f", "Demo Company F — Hotel Group", "Hospitality", { website: "https://demo-hotel.example.com" }),
    co("co-g", "Demo Company G — Private Academy", "Private education"),
    co("co-pm2", "Demo Realty Partners", "Property management", { phone: "225-555-0150", website: "https://demo-realty.example.com" }),
    co("co-h", "Demo Company H — Insurance Agency", "Insurance"),
    co("co-i", "Demo Company I — Dental Group", "Healthcare"),
  ];

  // ---------------------------------------------------------------- properties (15 + 1 intentional duplicate record)
  const prop = (
    id: string, name: string, address: string, city: string, parish: string, zip: string,
    facilityType: Property["facilityType"], sqft: number | null, sqftStatus: DataStatus, constructionStatus: string | null,
  ): Property => ({
    id, name, address, normalizedAddress: normalizeAddress(address), city, parish, zip, marketId: marketIdForCity(city), facilityType, sqft, sqftStatus,
    constructionStatus, lat: null, lng: null, mergedIntoId: null, isDemo: true, ...ts(70),
  });

  const properties: Property[] = [
    prop("p-01", "Demo Industrial Center", "1200 Demo Industrial Blvd", "Gonzales", "Ascension", "70737", "warehouse", 45_000, "publicly_reported", "Nearing completion"),
    prop("p-02", "Demo Office Park — Building B", "400 Demo Office Park Dr", "Baton Rouge", "East Baton Rouge", "70809", "office", null, "unknown", "Under construction"),
    prop("p-03", "Demo Retail Plaza", "88 Demo Plaza Way", "Denham Springs", "Livingston", "70726", "retail_center", 32_000, "publicly_reported", "Recently renovated"),
    prop("p-04", "Demo Medical Pavilion", "25 Demo Health Ct", "Prairieville", "Ascension", "70769", "medical_office", 18_000, "publicly_reported", "Under construction"),
    prop("p-05", "Demo Distribution Hub", "900 Demo Logistics Rd", "Port Allen", "West Baton Rouge", "70767", "distribution_center", 120_000, "estimated", null),
    prop("p-06", "Demo Professional Center", "300 Demo Commerce St", "Baton Rouge", "East Baton Rouge", "70806", "professional", 12_000, "verified", null),
    prop("p-07", "Demo Restaurant Site", "15 Demo Main St", "Walker", "Livingston", "70785", "restaurant", 4_200, "publicly_reported", "Build-out underway"),
    prop("p-08", "Demo Manufacturing Plant", "5000 Demo Plant Rd", "Zachary", "East Baton Rouge", "70791", "manufacturing", 60_000, "publicly_reported", "New wing under construction"),
    prop("p-09", "Demo Hotel", "700 Demo Hospitality Ln", "Gonzales", "Ascension", "70737", "hotel", null, "unknown", "Nearing completion"),
    prop("p-10", "Demo Academy Campus", "210 Demo School Dr", "Central", "East Baton Rouge", "70818", "school", 25_000, "estimated", "New building planned"),
    prop("p-11", "Demo Flex Space", "60 Demo Flex Ct", "Denham Springs", "Livingston", "70726", "multi_tenant", 9_000, "publicly_reported", null),
    prop("p-12", "Demo Strip Center", "1400 Demo Hwy", "Baton Rouge", "East Baton Rouge", "70816", "retail_center", 15_000, "estimated", null),
    prop("p-13", "Demo Church Campus", "77 Demo Fellowship Rd", "Prairieville", "Ascension", "70769", "church", null, "unknown", "New building announced"),
    prop("p-14", "Demo Auto Center", "3300 Demo Motor Way", "Baton Rouge", "East Baton Rouge", "70810", "automotive", 8_000, "publicly_reported", null),
    prop("p-15", "Demo Apartments Clubhouse", "500 Demo Commons Blvd", "Baton Rouge", "East Baton Rouge", "70808", "multifamily_common", 6_000, "estimated", "Recently renovated"),
    // INTENTIONAL DUPLICATE of p-01 (same building, different spelling) — for Phase 6 duplicate detection.
    prop("p-16", "Demo Industrial Ctr", "1200 Demo Industrial Boulevard", "Gonzales", "Ascension", "70737", "warehouse", null, "unknown", null),
    prop("p-17", "Demo Commerce Suites", "150 Demo Range Ave", "Denham Springs", "Livingston", "70726", "office", 7_500, "publicly_reported", "Build-out complete"),
    // No street address yet — only the city is known (allowed: the address is optional).
    prop("p-18", "Demo Dental Studio", "", "Walker", "Livingston", "", "medical_office", null, "unknown", "Opening announced"),
  ];

  // ---------------------------------------------------------------- relationships
  const rel = (id: string, propertyId: string, companyId: string, role: PropertyRelationship["role"]): PropertyRelationship => ({
    id, propertyId, companyId, role, dataStatus: "publicly_reported", ...ts(60),
  });
  const relationships: PropertyRelationship[] = [
    rel("r-01", "p-01", "co-a", "tenant"),
    rel("r-02", "p-01", "co-pm1", "property_manager"),
    rel("r-03", "p-02", "co-lease", "leasing_company"),
    rel("r-04", "p-03", "co-pm2", "property_manager"),
    rel("r-05", "p-04", "co-b", "tenant"),
    rel("r-06", "p-04", "co-pm1", "property_manager"),
    rel("r-07", "p-05", "co-a", "tenant"),
    rel("r-08", "p-06", "co-pm2", "property_manager"),
    rel("r-09", "p-07", "co-c", "tenant"),
    rel("r-10", "p-08", "co-d", "owner"),
    rel("r-11", "p-09", "co-f", "tenant"),
    rel("r-12", "p-10", "co-g", "owner"),
    rel("r-13", "p-11", "co-lease", "leasing_company"),
    rel("r-14", "p-12", "co-e", "tenant"),
    rel("r-15", "p-12", "co-pm1", "property_manager"),
    rel("r-16", "p-15", "co-pm2", "property_manager"),
    rel("r-17", "p-08", "co-d", "operator"),
    rel("r-18", "p-17", "co-h", "tenant"),
    rel("r-19", "p-18", "co-i", "tenant"),
  ];

  // ---------------------------------------------------------------- contacts (fictional people)
  const person = (
    id: string, name: string, role: string, companyId: string, phone: string | null, email: string | null, sourceId = "src-manual",
  ): Contact => ({ id, name, role, companyId, propertyId: null, phone, email, dataStatus: "publicly_reported", sourceId, isDemo: true, ...ts(60) });
  const contacts: Contact[] = [
    person("k-01", "Jordan Example", "Property Manager", "co-pm1", "225-555-0101", "jordan@demo-pm.example.com"),
    person("k-02", "Casey Sample", "Leasing Agent", "co-lease", "225-555-0111", "casey@demo-leasing.example.com"),
    person("k-03", "Riley Placeholder", "Practice Administrator", "co-b", "225-555-0121", "riley@demo-medical.example.com"),
    person("k-04", "Morgan Demo", "Operations Manager", "co-c", "225-555-0131", null),
    person("k-05", "Taylor Testcase", "Facilities Director", "co-d", "225-555-0141", "taylor@demo-mfg.example.com"),
    person("k-06", "Avery Sample", "Property Manager", "co-pm2", "225-555-0151", "avery@demo-realty.example.com"),
    person("k-07", "Drew Example", "General Manager", "co-f", null, "drew@demo-hotel.example.com"),
    person("k-08", "Quinn Demo", "Business Office Manager", "co-g", "225-555-0161", null),
    person("k-09", "Sam Placeholder", "Office Manager", "co-h", "225-555-0171", "sam@demo-insurance.example.com"),
  ];

  // ---------------------------------------------------------------- leads (22)
  const lead = (
    id: string, title: string, propertyId: string, companyId: string | null, primaryContactId: string | null,
    status: PipelineStatus, discoveredDaysAgo: number, verifiedDaysAgo: number | null, sourceId: string, extra: Partial<Lead> = {},
  ): Lead => ({
    id, title, propertyId, companyId, primaryContactId, status, potentialValue: "unknown", sourceId,
    sourceRecordId: `sr-${id.slice(2)}`,
    discoveredAt: at(-discoveredDaysAgo, 8),
    lastVerifiedAt: verifiedDaysAgo === null ? null : at(-verifiedDaysAgo, 8),
    lastVerifiedBy: verifiedDaysAgo === null ? null : "Demo user",
    snoozedUntil: null, notAFitReason: null, lostReasonCode: null, lostReason: null, closedAt: null, notes: null, mergedIntoLeadId: null,
    externalQuoteRef: null, convertedCustomerRef: null, isDemo: true,
    createdAt: at(-discoveredDaysAgo, 8), updatedAt: at(-(verifiedDaysAgo ?? discoveredDaysAgo), 8),
    ...extra,
  });

  const leads: Lead[] = [
    lead("l-01", "New tenant moving into warehouse nearing completion", "p-01", "co-a", "k-01", "new", 3, 3, "src-url", { potentialValue: "very_high" }),
    lead("l-02", "New office building — first tenant signed", "p-02", null, "k-02", "new", 6, 6, "src-url", { potentialValue: "high" }),
    lead("l-03", "Renovated retail center under new management", "p-03", null, "k-06", "contacted", 25, 10, "src-manual", { potentialValue: "medium" }),
    lead("l-04", "Medical group opening new pavilion", "p-04", "co-b", "k-03", "contacted", 40, 20, "src-csv", { potentialValue: "medium" }),
    lead("l-05", "Distribution company expanding into second hub", "p-05", "co-a", null, "researching", 8, 8, "src-csv", { potentialValue: "very_high" }),
    lead("l-06", "Multi-tenant professional center — vendor contract ending", "p-06", null, "k-06", "walkthrough", 30, 2, "src-manual", { potentialValue: "medium" }),
    lead("l-07", "New restaurant opening soon", "p-07", "co-c", "k-04", "walkthrough", 35, 3, "src-manual", { potentialValue: "low" }),
    lead("l-08", "Manufacturing plant adding new wing", "p-08", "co-d", "k-05", "new", 1, 1, "src-url", { potentialValue: "high" }),
    lead("l-09", "New hotel nearing opening", "p-09", "co-f", "k-07", "new", 0, 0, "src-url", { potentialValue: "high" }),
    lead("l-10", "Private academy building new campus — custodial RFP", "p-10", "co-g", "k-08", "researching", 15, 15, "src-url", { potentialValue: "medium" }),
    lead("l-11", "Flex space units recently leased", "p-11", null, "k-02", "new", 9, 9, "src-csv", { potentialValue: "low" }),
    lead("l-12", "Strip center space listed for lease", "p-12", "co-e", "k-01", "researching", 140, 120, "src-csv"),
    lead("l-13", "Church announces new building", "p-13", null, null, "new", 20, 20, "src-url"),
    lead("l-14", "Auto center sold — revisit after ownership transition", "p-14", null, null, "nurture", 60, 60, "src-manual"),
    lead("l-15", "Apartment clubhouse renovated under new management", "p-15", null, "k-06", "interested", 30, 4, "src-manual", { potentialValue: "medium" }),
    lead("l-16", "Professional center Suite 200 tenant", "p-06", null, "k-06", "won", 75, 20, "src-manual", { potentialValue: "medium", closedAt: at(-20, 16), notes: "DEMO: Won after the walkthrough — became a (fictional) customer." }),
    lead("l-17", "Auto center service bays", "p-14", null, null, "not_a_fit", 50, 50, "src-manual", { notAFitReason: "Service bays only — industrial degreasing, outside our services", closedAt: at(-50, 12) }),
    lead("l-18", "Strip center anchor tenant", "p-12", "co-e", "k-01", "lost", 160, 45, "src-csv", { lostReasonCode: "price", lostReason: "Price — chose another vendor", closedAt: at(-45, 12) }),
    // INTENTIONAL DUPLICATE of l-01 on duplicate property record p-16 (different source, less info).
    lead("l-19", "Warehouse tenant announced (CSV row)", "p-16", null, null, "new", 40, null, "src-csv"),
    // INTENTIONAL DUPLICATE of l-09 — same property, second source.
    lead("l-20", "Hotel opening (second source)", "p-09", "co-f", null, "new", 5, 5, "src-url"),
    // Walkthrough done and the prospect asked for a price — must stay on Today until "Quote requested" is logged.
    lead("l-21", "Insurance office moving into renovated suites", "p-17", "co-h", "k-09", "walkthrough", 21, 2, "src-manual", { potentialValue: "high" }),
    // Freshly found, nobody has verified it yet, no contact and no property manager known.
    lead("l-22", "Dental group announces new studio", "p-18", "co-i", null, "new", 2, null, "src-url", { potentialValue: "medium" }),
  ];

  // ---------------------------------------------------------------- opportunity signals
  let sigN = 0;
  const sig = (
    leadId: string, type: SignalType, description: string, discoveredDaysAgo: number,
    opts: { confidence?: DataStatus; expectedInDays?: number; verifiedDaysAgo?: number | null; sourceId?: string } = {},
  ): OpportunitySignal => {
    sigN += 1;
    const sourceId = opts.sourceId ?? "src-url";
    const parent = leads.find((l) => l.id === leadId);
    const verifiedAt = opts.verifiedDaysAgo === undefined ? at(-discoveredDaysAgo, 8) : opts.verifiedDaysAgo === null ? null : at(-opts.verifiedDaysAgo, 8);
    return {
      id: `sig-${String(sigN).padStart(2, "0")}`,
      leadId, type, description,
      sourceId,
      sourceRecordId: parent && parent.sourceId === sourceId ? parent.sourceRecordId : null,
      sourceUrl: `https://example.com/demo/signal-${sigN}`,
      discoveredAt: at(-discoveredDaysAgo, 8),
      verifiedAt,
      verifiedBy: verifiedAt ? "Demo user" : null,
      confidence: opts.confidence ?? "publicly_reported",
      expectedDate: opts.expectedInDays === undefined ? null : at(opts.expectedInDays, 9),
      ...ts(discoveredDaysAgo),
    };
  };

  const signals: OpportunitySignal[] = [
    sig("l-01", "new_tenant", "DEMO: Tenant announced a lease for the full building.", 12),
    sig("l-01", "new_construction", "DEMO: New warehouse construction permit on file.", 30),
    sig("l-01", "construction_nearing_completion", "DEMO: Exterior complete; interior finish-out underway.", 3, { expectedInDays: 45 }),
    sig("l-02", "new_construction", "DEMO: New three-story office building under construction.", 20),
    sig("l-02", "new_tenant", "DEMO: First tenant signed for two floors.", 6),
    sig("l-02", "occupancy_expected_soon", "DEMO: Leasing flyer lists move-in date.", 6, { expectedInDays: 75 }),
    sig("l-03", "major_renovation", "DEMO: Facade and common-area renovation completed.", 25),
    sig("l-03", "new_property_manager", "DEMO: New management company announced.", 18),
    sig("l-04", "new_construction", "DEMO: New medical pavilion under construction.", 40),
    sig("l-04", "new_business_opening", "DEMO: Medical group announced a new location.", 40),
    sig("l-04", "occupancy_expected_soon", "DEMO: Opening targeted next month.", 20, { expectedInDays: 30 }),
    sig("l-05", "expansion", "DEMO: Company announced a second regional hub.", 8, { sourceId: "src-csv" }),
    sig("l-05", "recently_leased", "DEMO: Hub lease reported.", 8, { sourceId: "src-csv" }),
    sig("l-06", "vendor_may_change", "DEMO: Property manager said current janitorial contract ends this quarter.", 14, { confidence: "verified", sourceId: "src-manual" }),
    sig("l-06", "multiple_tenants", "DEMO: Six tenant suites.", 30, { sourceId: "src-manual" }),
    sig("l-07", "new_business_opening", "DEMO: Restaurant group announced a new location.", 35),
    sig("l-07", "occupancy_expected_soon", "DEMO: Opening date posted.", 10, { expectedInDays: 20 }),
    sig("l-08", "expansion", "DEMO: Plant expansion announced.", 1),
    sig("l-08", "new_construction", "DEMO: New production wing under construction.", 1),
    sig("l-08", "construction_nearing_completion", "DEMO: Wing scheduled to finish soon.", 1, { expectedInDays: 60 }),
    sig("l-08", "vendor_may_change", "DEMO: Facilities director said the new wing needs a cleaning partner.", 1),
    sig("l-09", "new_construction", "DEMO: New hotel construction.", 50),
    sig("l-09", "facility_opening", "DEMO: Grand opening announced.", 0, { expectedInDays: 40 }),
    sig("l-10", "expansion", "DEMO: Academy adding a new classroom building.", 15),
    sig("l-10", "major_renovation", "DEMO: Existing gym renovation.", 15),
    sig("l-10", "rfp_bid", "DEMO: Custodial services RFP posted.", 15),
    sig("l-11", "recently_leased", "DEMO: Three flex units leased.", 9, { sourceId: "src-csv" }),
    sig("l-11", "multiple_tenants", "DEMO: Multi-tenant flex building.", 9, { sourceId: "src-csv" }),
    sig("l-12", "listed_for_lease", "DEMO: Two suites listed for lease.", 140, { sourceId: "src-csv", verifiedDaysAgo: 120 }),
    sig("l-13", "new_construction", "DEMO: New worship building announced.", 20),
    sig("l-14", "recently_sold", "DEMO: Property sale reported.", 60, { sourceId: "src-manual" }),
    sig("l-15", "new_property_manager", "DEMO: New management company took over.", 30, { sourceId: "src-manual" }),
    sig("l-15", "major_renovation", "DEMO: Clubhouse renovation completed.", 30, { sourceId: "src-manual" }),
    sig("l-16", "new_tenant", "DEMO: New tenant in Suite 200.", 75, { sourceId: "src-manual" }),
    sig("l-17", "recently_sold", "DEMO: Service bay building sold.", 50, { sourceId: "src-manual" }),
    sig("l-18", "new_tenant", "DEMO: Anchor tenant announced.", 160, { sourceId: "src-csv" }),
    sig("l-19", "new_tenant", "DEMO: Tenant announced (CSV row, duplicate).", 40, { sourceId: "src-csv", verifiedDaysAgo: null }),
    sig("l-20", "facility_opening", "DEMO: Hotel opening reported by a second source.", 5, { expectedInDays: 40 }),
    sig("l-21", "new_tenant", "DEMO: Insurance agency signed a lease for two suites.", 21, { sourceId: "src-manual" }),
    sig("l-21", "major_renovation", "DEMO: Suites renovated before move-in.", 21, { sourceId: "src-manual" }),
    sig("l-22", "new_business_opening", "DEMO: Dental group announced a new studio.", 2, { verifiedDaysAgo: null, expectedInDays: 70 }),
  ];

  // ---------------------------------------------------------------- activities
  let actN = 0;
  const act = (leadId: string, type: Activity["type"], summary: string, daysAgo: number, hour = 10, outcome: string | null = null): Activity => {
    actN += 1;
    return { id: `act-${String(actN).padStart(3, "0")}`, leadId, type, summary, outcome, occurredAt: at(-daysAgo, hour), performedBy: "Demo user" };
  };
  const activities: Activity[] = [
    ...leads.map((l) => ({
      id: `act-disc-${l.id}`, leadId: l.id, type: "discovered" as const,
      summary: `Lead discovered via ${sources.find((s) => s.id === l.sourceId)?.name ?? "unknown source"}`,
      outcome: null, occurredAt: l.discoveredAt, performedBy: "Demo user",
    })),
    act("l-03", "call", "Called Avery Sample (Property Manager)", 5, 11, "Left voicemail"),
    act("l-03", "email", "Sent intro email with Traylor Pro capabilities", 5, 11),
    act("l-04", "call", "Called Riley Placeholder (Practice Administrator)", 9, 14, "Connected — call back once opening date is set"),
    act("l-06", "call", "Called Avery Sample about the vendor contract", 6, 10, "Connected — walkthrough booked"),
    act("l-06", "walkthrough_scheduled", "Walkthrough scheduled", 6, 10),
    act("l-07", "call", "Called Morgan Demo (Operations Manager)", 15, 15, "Connected — walkthrough booked"),
    act("l-07", "walkthrough_completed", "Walkthrough completed — outcome not recorded yet", 3, 15),
    act("l-15", "call", "Called Avery Sample (Property Manager)", 4, 9, "Interested — wants a walkthrough"),
    act("l-15", "status_change", "Status: Contacted → Interested", 4, 9),
    act("l-16", "status_change", "Status: Walkthrough → Won", 20, 16),
    act("l-17", "not_a_fit", "Marked Not a Fit — service bays only", 50, 12),
    act("l-18", "status_change", "Status: Walkthrough → Lost (chose another vendor)", 45, 12),
    act("l-21", "call", "Called Sam Placeholder (Office Manager)", 9, 10, "Connected — walkthrough booked"),
    act("l-21", "walkthrough_scheduled", "Walkthrough scheduled", 9, 10),
    act("l-21", "walkthrough_completed", "Walkthrough completed: Ready for a quote — next: send pricing", 2, 15, "send_to_bid"),
  ];

  // ---------------------------------------------------------------- follow-ups
  const fu = (id: string, leadId: string, contactId: string | null, dueAt: string, method: FollowUp["method"], notes: string, done?: { at: string; note: string }): FollowUp => ({
    id, leadId, contactId, dueAt, method, notes,
    completedAt: done?.at ?? null, completedBy: done ? "Demo user" : null, completionNote: done?.note ?? null,
    ...ts(10),
  });
  const followups: FollowUp[] = [
    fu("fu-01", "l-04", "k-03", at(-2, 10), "call", "Ask if the opening date is set."),
    fu("fu-02", "l-03", "k-06", at(0, 10, 30), "email", "Follow up on the voicemail and intro email."),
    fu("fu-03", "l-11", "k-02", at(1, 9), "call", "Ask which flex tenants need cleaning."),
    fu("fu-04", "l-14", null, at(10, 9), "call", "Check whether the new owner is settled in."),
    // History: a follow-up that was completed.
    fu("fu-00", "l-06", "k-06", at(-7, 10), "call", "Check on the janitorial contract end date.", { at: at(-6, 10), note: "Reached Avery — walkthrough booked." }),
  ];

  // ---------------------------------------------------------------- walkthroughs
  const walkthroughs: Walkthrough[] = [
    { id: "wt-01", leadId: "l-06", propertyId: "p-06", contactId: "k-06", scheduledAt: at(0, 14), attendees: "Traylor Pro sales + Avery Sample", notes: "Walk all six suites and common areas.", outcome: null, nextAction: null, completedAt: null, ...ts(6) },
    { id: "wt-03", leadId: "l-21", propertyId: "p-17", contactId: "k-09", scheduledAt: at(-2, 14), attendees: "Traylor Pro sales + Sam Placeholder", notes: "Two suites, shared break room.", outcome: "send_to_bid", nextAction: "Send pricing", completedAt: at(-2, 15), ...ts(9) },
    { id: "wt-02", leadId: "l-07", propertyId: "p-07", contactId: "k-04", scheduledAt: at(-3, 15), attendees: "Traylor Pro sales + Morgan Demo", notes: "Kitchen excluded.", outcome: null, nextAction: null, completedAt: at(-3, 16), ...ts(15) },
  ];

  // ---------------------------------------------------------------- source records (one per lead, plus one rejected)
  const sourceRecords: SourceRecord[] = leads.map((l, i) => {
    const source = sources.find((x) => x.id === l.sourceId)!;
    const property = properties.find((p) => p.id === l.propertyId)!;
    const n = l.id.slice(2);
    return {
      id: l.sourceRecordId!, sourceId: source.id, sourceName: source.name,
      sourceUrl: source.type === "url" ? `https://example.com/demo/record-${n}` : null,
      externalId: source.type === "csv" ? `demo-row-${n}` : null,
      discoveredAt: l.discoveredAt, lastVerifiedAt: l.lastVerifiedAt, status: "imported" as const, importedLeadId: l.id,
      payload: source.type === "manual" ? null : { title: l.title, property: property.name, city: property.city, row: i + 1 },
      kind: source.type === "url" ? ("news_article" as const) : source.type === "manual" ? ("manual_research" as const) : null,
      title: source.type === "csv" ? "demo_leads.csv" : source.type === "url" ? "Demo business journal (fictional)" : null,
      verification: l.lastVerifiedAt ? ("verified" as const) : ("not_checked" as const),
      verifiedBy: l.lastVerifiedAt ? "Demo user" : null,
      note: null,
      isDemo: true, createdAt: l.discoveredAt, updatedAt: l.discoveredAt,
    };
  });
  sourceRecords.push({
    id: "sr-rejected-1", sourceId: "src-csv", sourceName: "Demo CSV import — demo_leads.csv", sourceUrl: null, externalId: "demo-row-99",
    discoveredAt: at(-12, 8), lastVerifiedAt: null, status: "rejected", importedLeadId: null,
    payload: { title: "DEMO: Single-family home (residential)", city: "Baton Rouge", row: 99 },
    kind: null, title: "demo_leads.csv", verification: "not_checked", verifiedBy: null, note: "Residential — Traylor Pro pursues commercial buildings only.",
    isDemo: true, createdAt: at(-12, 8), updatedAt: at(-12, 9),
  });

  sourceRecords.push({
    id: "sr-dup-1", sourceId: "src-csv", sourceName: "Demo CSV import — demo_leads.csv", sourceUrl: null, externalId: "demo-row-12",
    discoveredAt: at(-12, 8), lastVerifiedAt: null, status: "duplicate", importedLeadId: null,
    payload: { title: "DEMO: Warehouse tenant (repeat row)", address: "1200 Demo Industrial Blvd", city: "Gonzales", row: 12 },
    kind: null, title: "demo_leads.csv", verification: "not_checked", verifiedBy: null, note: "Skipped — possible duplicate of an existing lead",
    isDemo: true, createdAt: at(-12, 8), updatedAt: at(-12, 9),
  });

  // ---------------------------------------------------------------- duplicate decisions (history)
  const duplicateDecisions: LeadFinderSnapshot["duplicateDecisions"] = [
    {
      id: "dd-seed-1", context: "csv_import", decision: "skipped", subject: "DEMO: Warehouse tenant (repeat row) · 1200 Demo Industrial Blvd · Gonzales",
      candidatePropertyIds: ["p-01"], candidateLeadIds: ["l-01"], reasons: ["same_address"], resultLeadId: null, resultPropertyId: null,
      sourceRecordId: "sr-dup-1", decidedBy: "Demo user", decidedAt: at(-12, 9), note: "Skipped — possible duplicate of an existing lead",
    },
  ];

  // ---------------------------------------------------------------- field provenance ("where did this come from?")
  let fpN = 0;
  const provenance: FieldProvenance[] = [];
  const addProv = (p: Omit<FieldProvenance, "id" | "createdAt" | "updatedAt" | "recordedAt" | "verifiedBy"> & { recordedDaysAgo: number }) => {
    fpN += 1;
    const { recordedDaysAgo, ...rest } = p;
    provenance.push({ id: `fp-${String(fpN).padStart(3, "0")}`, ...rest, recordedAt: at(-recordedDaysAgo, 8), verifiedBy: rest.verifiedAt ? "Demo user" : null, ...ts(recordedDaysAgo) });
  };
  for (const p of properties) {
    if (p.sqft === null || p.sqftStatus === "unknown") continue;
    const origin = leads.find((l) => l.propertyId === p.id) ?? leads[0];
    const record = sourceRecords.find((r) => r.id === origin.sourceRecordId);
    addProv({
      entityType: "property", entityId: p.id, field: "sqft", status: p.sqftStatus, sourceId: origin.sourceId, sourceRecordId: origin.sourceRecordId,
      sourceUrl: record?.sourceUrl ?? null, valueNote: `${p.sqft.toLocaleString("en-US")} sq ft`,
      verifiedAt: p.sqftStatus === "verified" ? at(-3, 8) : null, recordedDaysAgo: 10,
    });
  }
  for (const c of contacts) {
    for (const field of ["phone", "email"] as const) {
      if (c[field]) addProv({ entityType: "contact", entityId: c.id, field, status: c.dataStatus, sourceId: c.sourceId, sourceRecordId: null, sourceUrl: null, valueNote: c[field], verifiedAt: null, recordedDaysAgo: 20 });
    }
  }
  for (const co of companies) {
    for (const field of ["phone", "email", "website"] as const) {
      if (co[field]) addProv({ entityType: "company", entityId: co.id, field, status: "publicly_reported", sourceId: "src-manual", sourceRecordId: null, sourceUrl: null, valueNote: co[field], verifiedAt: null, recordedDaysAgo: 30 });
    }
  }
  for (const r of relationships) {
    if (r.role !== "property_manager" && r.role !== "leasing_company") continue;
    addProv({ entityType: "relationship", entityId: r.id, field: r.role, status: r.dataStatus, sourceId: "src-manual", sourceRecordId: null, sourceUrl: null, valueNote: companies.find((c) => c.id === r.companyId)?.name ?? null, verifiedAt: null, recordedDaysAgo: 30 });
  }

  // ---------------------------------------------------------------- audit log (history that already happened)
  const audit = (id: string, leadId: string, from: PipelineStatus, to: PipelineStatus, daysAgo: number, hour: number, note: string | null = null): AuditEntry => ({
    id, entityType: "lead", entityId: leadId, leadId, action: "status_change", field: "status", oldValue: from, newValue: to,
    changedBy: "Demo user", changedAt: at(-daysAgo, hour), note,
  });
  const auditLog: AuditEntry[] = [
    audit("aud-seed-1", "l-15", "contacted", "interested", 4, 9),
    audit("aud-seed-2", "l-16", "walkthrough", "won", 20, 16),
    audit("aud-seed-3", "l-17", "new", "not_a_fit", 50, 12, "Service bays only"),
    audit("aud-seed-4", "l-18", "walkthrough", "lost", 45, 12, "Price"),
  ];

  // ---------------------------------------------------------------- settings + roles
  const settings: LeadFinderSnapshot["settings"] = [
    { key: "scoring", value: structuredClone(DEFAULT_SCORING_SETTINGS), version: 1, updatedAt: at(-90, 8), updatedBy: "System (demo seed)" },
  ];
  const role = (id: string, name: string, email: string, r: UserRole["role"]): UserRole => ({
    id, userId: null, email, displayName: name, role: r, active: true, isDemo: true, ...ts(90),
  });
  const userRoles: UserRole[] = [
    role("ur-1", "Demo Owner", "owner@example.com", "owner"),
    role("ur-2", "Demo Manager", "manager@example.com", "manager"),
    role("ur-3", "Demo Viewer", "viewer@example.com", "viewer"),
  ];

  const snapshot: LeadFinderSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    markets, sources, sourceRecords, companies, properties, contacts, relationships, provenance, leads, signals,
    scoreBreakdowns: [], activities, followups, walkthroughs, auditLog, duplicateDecisions, settings, userRoles,
  };

  // Save the first score breakdown for every lead (computed by the deterministic engine, never by AI).
  let seedId = 0;
  recordScoreChanges(snapshot, { now, by: "System (demo seed)", isDemo: true, newId: (prefix) => `${prefix}-seed-${++seedId}` });
  return snapshot;
}
