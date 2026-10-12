import { FACILITY_TYPE_LABEL, OPPORTUNITY_TYPE_LABEL, POTENTIAL_VALUE_LABEL, SIGNAL_DEFINITIONS } from "../domain/labels";
import type { DataStatus, FacilityType, LeadFinderSnapshot, PotentialValue, SignalType, SourceRecord } from "../domain/types";
import { csvCell, type ParsedCsv } from "../engine/csv";
import { nameSimilarity, normalizeAddress, normalizePhone } from "../engine/duplicates";
import type { MutationContext } from "./context";
import {
  checkNewLead,
  createLead,
  isValidUrl,
  previewDuplicates,
  recordDuplicateDecision,
  type DuplicateAction,
  type DuplicateCandidate,
  type NewLeadInput,
} from "./ingest";

/**
 * CSV import:  upload → map columns → preview → validate → detect duplicates → review problems → import.
 *
 * Promises kept:
 *  - Every row is accounted for in the result: imported, added to an existing lead, skipped (by the person), or not imported (with the reason).
 *  - Rows that are not imported are still kept as "rejected" source records, so nothing silently disappears.
 *  - An existing lead is never overwritten. "Add to existing lead" only fills blanks and adds evidence.
 *  - Possible duplicates default to "skip" — a person has to choose to import them.
 */

export type CsvField =
  | "business"
  | "propertyName"
  | "address"
  | "city"
  | "zip"
  | "parish"
  | "facilityType"
  | "why"
  | "opportunity"
  | "expectedDate"
  | "sourceUrl"
  | "sourceName"
  | "contactName"
  | "contactRole"
  | "phone"
  | "email"
  | "website"
  | "propertyManager"
  | "sqft"
  | "potential"
  | "notes";

export interface CsvFieldDef {
  key: CsvField;
  label: string;
  /** "name" = business OR property name is required. */
  required?: true | "name";
  hint?: string;
  aliases: string[];
}

export const CSV_FIELDS: CsvFieldDef[] = [
  { key: "business", label: "Business name", required: "name", aliases: ["business", "business name", "company", "company name", "tenant", "organization", "name"] },
  { key: "propertyName", label: "Property name", required: "name", aliases: ["property", "property name", "building", "building name", "site", "facility name"] },
  { key: "city", label: "City (location)", required: true, aliases: ["city", "location", "town", "market"] },
  { key: "facilityType", label: "Facility type", required: true, hint: "Office, Warehouse, Retail center…", aliases: ["facility type", "property type", "building type", "type", "facility"] },
  { key: "why", label: "Why it's an opportunity", required: true, hint: "One sentence about what was seen", aliases: ["why", "why its an opportunity", "why it is an opportunity", "why opportunity", "opportunity description", "opportunity reason", "description", "reason", "summary"] },
  { key: "opportunity", label: "Opportunity type", hint: "New construction, New tenant…", aliases: ["opportunity", "opportunity type", "signal", "signal type", "lead type"] },
  { key: "address", label: "Street address", aliases: ["address", "street", "street address", "address 1", "address1"] },
  { key: "zip", label: "ZIP", aliases: ["zip", "zip code", "zipcode", "postal code", "postcode"] },
  { key: "parish", label: "Parish", aliases: ["parish", "county"] },
  { key: "sourceUrl", label: "Source link", aliases: ["source url", "url", "link", "source link", "source"] },
  { key: "sourceName", label: "Source name", aliases: ["source name", "publisher", "where found", "found on"] },
  { key: "expectedDate", label: "Expected opening / move-in", hint: "YYYY-MM-DD or MM/DD/YYYY", aliases: ["expected date", "opening date", "move in", "move-in date", "expected opening", "occupancy date"] },
  { key: "contactName", label: "Contact name", aliases: ["contact", "contact name", "person", "contact person"] },
  { key: "contactRole", label: "Contact role", aliases: ["role", "title", "contact title", "contact role", "position"] },
  { key: "phone", label: "Phone", aliases: ["phone", "phone number", "telephone", "tel", "contact phone"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address", "contact email"] },
  { key: "website", label: "Business website", aliases: ["website", "web", "site url", "business website", "homepage"] },
  { key: "propertyManager", label: "Property manager", aliases: ["property manager", "manager", "management company", "pm", "property management"] },
  { key: "sqft", label: "Square feet", aliases: ["sqft", "sq ft", "square feet", "square footage", "size", "building size"] },
  { key: "potential", label: "Potential value", hint: "Very High / High / Medium / Low", aliases: ["potential", "potential value", "opportunity value", "priority"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"] },
];

export type CsvMapping = Partial<Record<CsvField, number | null>>;

const norm = (v: string) => v.toLowerCase().replace(/[_\-./]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Guess which column is which from the header names. Each column is used at most once. */
export function autoMapColumns(headers: string[]): CsvMapping {
  const used = new Set<number>();
  const mapping: CsvMapping = {};
  const h = headers.map(norm);
  // Exact alias matches first, then "contains" matches.
  for (const pass of ["exact", "contains"] as const) {
    for (const f of CSV_FIELDS) {
      if (mapping[f.key] !== undefined && mapping[f.key] !== null) continue;
      const idx = h.findIndex((col, i) => !used.has(i) && f.aliases.some((a) => (pass === "exact" ? col === a : col.includes(a) && a.length >= 4)));
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

/** Required fields that have no column yet. */
export function missingRequiredMappings(mapping: CsvMapping): string[] {
  const has = (k: CsvField) => mapping[k] !== undefined && mapping[k] !== null;
  const out: string[] = [];
  if (!has("business") && !has("propertyName")) out.push("Business name or Property name");
  for (const f of CSV_FIELDS) if (f.required === true && !has(f.key)) out.push(f.label);
  return out;
}

// ------------------------------------------------------------------ value parsing (plain-language errors)

const FACILITY_ALIASES: Record<string, FacilityType> = {
  medical: "medical_office",
  clinic: "medical_office",
  apartment: "multifamily_common",
  apartments: "multifamily_common",
  multifamily: "multifamily_common",
  condo: "multifamily_common",
  retail: "retail_center",
  "shopping center": "retail_center",
  distribution: "distribution_center",
  plant: "manufacturing",
  factory: "manufacturing",
  "flex space": "multi_tenant",
  "multi tenant": "multi_tenant",
  "other commercial": "other",
  other: "other",
  "professional office": "professional",
  auto: "automotive",
  dealership: "automotive",
};

export function parseFacilityType(v: string): FacilityType | null {
  const n = norm(v);
  if (!n) return null;
  for (const [key, label] of Object.entries(FACILITY_TYPE_LABEL)) if (n === norm(key) || n === norm(label)) return key as FacilityType;
  return FACILITY_ALIASES[n] ?? null;
}

const OPPORTUNITY_ALIASES: Record<string, SignalType> = {
  "new construction": "new_construction",
  construction: "new_construction",
  "new business": "new_business_opening",
  "business opening": "new_business_opening",
  opening: "facility_opening",
  "new tenant": "new_tenant",
  tenant: "new_tenant",
  renovation: "major_renovation",
  renovated: "major_renovation",
  "recently renovated": "major_renovation",
  "for lease": "listed_for_lease",
  lease: "listed_for_lease",
  expansion: "expansion",
  relocation: "business_relocation",
  "new owner": "new_ownership",
  "new manager": "new_property_manager",
  "new owner manager": "new_ownership",
  rfp: "rfp_bid",
  bid: "rfp_bid",
  "vendor change": "vendor_may_change",
  "vendor change bid": "rfp_bid",
};

export function parseOpportunity(v: string): SignalType | null {
  const n = norm(v);
  if (!n) return null;
  for (const [key, def] of Object.entries(SIGNAL_DEFINITIONS)) if (n === norm(key) || n === norm(def.label)) return key as SignalType;
  for (const [, label] of Object.entries(OPPORTUNITY_TYPE_LABEL)) if (n === norm(label) && OPPORTUNITY_ALIASES[n]) return OPPORTUNITY_ALIASES[n];
  return OPPORTUNITY_ALIASES[n] ?? null;
}

export function parsePotential(v: string): PotentialValue | null {
  const n = norm(v).replace(/ potential$/, "");
  if (!n) return "unknown";
  for (const [key, label] of Object.entries(POTENTIAL_VALUE_LABEL)) if (n === norm(key) || n === norm(label).replace(/ potential$/, "")) return key as PotentialValue;
  return null;
}

export function parseSqft(v: string): number | null | "invalid" {
  const t = v.replace(/sq\.?\s*ft\.?|square feet|sf/gi, "").replace(/[, ]/g, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "invalid";
  const n = Math.round(Number(t));
  return n > 0 ? n : "invalid";
}

/** YYYY-MM-DD or M/D/YYYY → ISO (9:00 local). */
export function parseDate(v: string): string | null | "invalid" {
  const t = v.trim();
  if (!t) return null;
  let y: number, mo: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (mt) [y, mo, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [mo, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return "invalid";
  const date = new Date(y, mo - 1, d, 9, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return "invalid";
  return date.toISOString();
}

// ------------------------------------------------------------------ preview

export interface CsvImportOptions {
  /** Shown as the source of every row, e.g. the file name. */
  fileName: string;
  /** The source these rows belong to (the CSV import source). */
  sourceId: string;
  /** How reliable the facts in this file are. Applied to sqft, phones, emails and the opportunity. */
  dataStatus: Exclude<DataStatus, "unknown">;
}

export type CsvRowStatus = "ready" | "duplicate" | "error";

export interface CsvPreviewRow {
  /** Spreadsheet row number (the header is row 1). */
  rowNumber: number;
  label: string;
  status: CsvRowStatus;
  errors: string[];
  warnings: string[];
  duplicates: DuplicateCandidate[];
  /** Another row in this same file that looks like the same building. */
  inFileDuplicateOf: number | null;
  input: NewLeadInput | null;
  payload: Record<string, string>;
}

const cell = (row: string[], mapping: CsvMapping, k: CsvField) => {
  const i = mapping[k];
  return i === undefined || i === null ? "" : (row[i] ?? "").trim();
};

function shorten(v: string, max = 110): string {
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60))}…`;
}

function rowToInput(s: LeadFinderSnapshot, row: string[], headers: string[], mapping: CsvMapping, opts: CsvImportOptions, rowNumber: number) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = (k: CsvField) => cell(row, mapping, k);
  const payload: Record<string, string> = {};
  headers.forEach((h, i) => (payload[h || `Column ${i + 1}`] = row[i] ?? ""));
  if (row.length > headers.length && row.slice(headers.length).some((c) => c.trim() !== "")) {
    errors.push("This row has more cells than there are column headings — check for an unquoted comma.");
  }

  const business = get("business");
  const propertyName = get("propertyName");
  const city = get("city");
  const why = get("why");
  if (!business && !propertyName) errors.push("Missing the business or property name.");
  if (!city) errors.push("Missing the city (location).");
  if (!why) errors.push("Missing why it's an opportunity.");

  const ftRaw = get("facilityType");
  const facilityType = parseFacilityType(ftRaw);
  if (!ftRaw) errors.push("Missing the facility type.");
  else if (!facilityType) errors.push(`Facility type “${ftRaw}” isn't one we know. Use one of: ${Object.values(FACILITY_TYPE_LABEL).join(", ")}.`);

  const oppRaw = get("opportunity");
  let signalType: SignalType = "generic_commercial";
  if (oppRaw) {
    const t = parseOpportunity(oppRaw);
    if (!t) errors.push(`Opportunity type “${oppRaw}” isn't one we know (for example: New construction, New tenant, Renovation, Expansion, For lease).`);
    else signalType = t;
  } else if (why) warnings.push("No opportunity type — saved as “Generic commercial property” (scores low until you add a stronger signal).");

  const sqft = parseSqft(get("sqft"));
  if (sqft === "invalid") errors.push(`Square feet “${get("sqft")}” isn't a number.`);
  const expected = parseDate(get("expectedDate"));
  if (expected === "invalid") errors.push(`Date “${get("expectedDate")}” isn't a date we can read (use YYYY-MM-DD or MM/DD/YYYY).`);
  const potential = parsePotential(get("potential"));
  if (potential === null) errors.push(`Potential “${get("potential")}” should be Very High, High, Medium, Low or Unknown.`);

  const sourceUrl = get("sourceUrl");
  if (sourceUrl && !isValidUrl(sourceUrl)) errors.push(`Source link “${sourceUrl}” doesn't look like a web address (it should start with https://).`);
  const website = get("website");
  if (website && !isValidUrl(website)) errors.push(`Website “${website}” doesn't look like a web address (it should start with https://).`);
  const email = get("email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email “${email}” doesn't look right.`);
  const phone = get("phone");
  if (phone && phone.replace(/\D/g, "").length < 7) errors.push(`Phone “${phone}” looks too short.`);

  if (city && !s.markets.some((m) => m.kind === "city" && m.name.toLowerCase() === city.toLowerCase())) {
    warnings.push(`${city} isn't one of the configured markets — it will still be imported.`);
  }

  const contactName = get("contactName");
  const pm = get("propertyManager");
  if (website && !business) warnings.push("Website kept with the original row only (no business name to attach it to).");
  if ((phone || email) && !contactName && !business && !pm) warnings.push("Phone/email kept with the original row only (no contact or business to attach it to).");

  const label = [business || propertyName, get("address"), city].filter(Boolean).join(" · ") || `Row ${rowNumber}`;
  if (errors.length > 0) return { label, errors, warnings, payload, input: null as NewLeadInput | null };

  const ds = opts.dataStatus;
  const contactOnCompany = !contactName && business;
  const input: NewLeadInput = {
    title: shorten(why),
    property: {
      name: propertyName || undefined,
      address: get("address") || undefined,
      city,
      zip: get("zip") || undefined,
      parish: get("parish") || undefined,
      facilityType: facilityType!,
      sqft: typeof sqft === "number" ? sqft : null,
      sqftStatus: typeof sqft === "number" ? ds : undefined,
    },
    company: business
      ? {
          name: business,
          website: website || null,
          phone: contactOnCompany ? phone || null : null,
          email: contactOnCompany ? email || null : null,
          dataStatus: website || (contactOnCompany && (phone || email)) ? ds : undefined,
        }
      : null,
    propertyManager: pm ? { name: pm, phone: !contactName && !business ? phone || null : null, email: !contactName && !business ? email || null : null, dataStatus: !contactName && !business && (phone || email) ? ds : undefined } : null,
    contact: contactName
      ? { name: contactName, role: get("contactRole"), phone: phone || null, email: email || null, dataStatus: phone || email ? ds : undefined, employer: business ? "company" : "property_manager" }
      : null,
    signals: [{ type: signalType, description: why, expectedDate: typeof expected === "string" ? expected : null, confidence: ds, sourceUrl: sourceUrl || null }],
    source: {
      sourceId: opts.sourceId,
      sourceUrl: sourceUrl || null,
      externalId: `${opts.fileName} · row ${rowNumber}`,
      payload,
      kind: null,
      title: get("sourceName") ? `${get("sourceName")} (via ${opts.fileName})` : opts.fileName,
      verification: ds === "verified" ? "verified" : "not_checked",
    },
    potentialValue: potential ?? "unknown",
    notes: get("notes") || null,
  };
  const problem = checkNewLead(s, input);
  if (problem) errors.push(`${problem.message} ${problem.nextStep}`);
  return { label, errors, warnings, payload, input: errors.length ? null : input };
}

/** Two rows in the same file describing the same building (same street address, or near-identical name, in the same city). */
function sameBuilding(a: NewLeadInput, b: NewLeadInput): boolean {
  const pa = a.property as { name?: string; address?: string; city: string };
  const pb = b.property as { name?: string; address?: string; city: string };
  if (pa.city.trim().toLowerCase() !== pb.city.trim().toLowerCase()) return false;
  const aa = normalizeAddress(pa.address ?? "");
  const ab = normalizeAddress(pb.address ?? "");
  if (aa && ab) return aa === ab;
  const na = [pa.name, a.company && "name" in a.company ? a.company.name : null].filter((x): x is string => Boolean(x));
  const nb = [pb.name, b.company && "name" in b.company ? b.company.name : null].filter((x): x is string => Boolean(x));
  if (na.some((x) => nb.some((y) => nameSimilarity(x, y) >= 0.8))) return true;
  const phA = normalizePhone(a.contact?.phone);
  return Boolean(phA && phA === normalizePhone(b.contact?.phone));
}

export function buildCsvPreview(s: LeadFinderSnapshot, parsed: ParsedCsv, mapping: CsvMapping, opts: CsvImportOptions): CsvPreviewRow[] {
  const out: CsvPreviewRow[] = [];
  parsed.rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const r = rowToInput(s, row, parsed.headers, mapping, opts, rowNumber);
    const duplicates = r.input ? previewDuplicates(s, r.input) : [];
    const earlier = r.input ? out.find((o) => o.input && sameBuilding(o.input, r.input!)) : undefined;
    const inFileDuplicateOf = earlier?.rowNumber ?? null;
    const status: CsvRowStatus = r.errors.length > 0 ? "error" : duplicates.length > 0 || inFileDuplicateOf ? "duplicate" : "ready";
    out.push({ rowNumber, label: r.label, status, errors: r.errors, warnings: r.warnings, duplicates, inFileDuplicateOf, input: r.input, payload: r.payload });
  });
  return out;
}

export function summarizePreview(rows: CsvPreviewRow[]) {
  return {
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    errors: rows.filter((r) => r.status === "error").length,
    missingRequired: rows.filter((r) => r.errors.some((e) => e.startsWith("Missing"))).length,
  };
}

// ------------------------------------------------------------------ import

/** What to do with a possible-duplicate row. Ready rows are always imported; error rows never are. */
export type CsvRowChoice =
  | { action: "skip" }
  | { action: "create_anyway" }
  | { action: "link_to_property"; propertyId: string }
  | { action: "add_to_existing_lead"; leadId: string };

export interface CsvImportPlan {
  parsed: ParsedCsv;
  mapping: CsvMapping;
  options: CsvImportOptions;
  /** By spreadsheet row number. Duplicate rows without a choice are skipped. */
  choices: Record<number, CsvRowChoice>;
}

export type CsvRowOutcome = "imported" | "added_to_existing" | "skipped" | "not_imported";

export interface CsvImportRowResult {
  rowNumber: number;
  label: string;
  outcome: CsvRowOutcome;
  leadId: string | null;
  message: string;
}

export interface CsvImportResult {
  fileName: string;
  total: number;
  imported: number;
  addedToExisting: number;
  skipped: number;
  notImported: number;
  rows: CsvImportRowResult[];
}

export function importCsv(s: LeadFinderSnapshot, m: MutationContext, plan: CsvImportPlan): CsvImportResult {
  // Re-check against the data as it is NOW (it may have changed since the preview).
  const preview = buildCsvPreview(s, plan.parsed, plan.mapping, plan.options);
  const source = s.sources.find((x) => x.id === plan.options.sourceId);
  const rows: CsvImportRowResult[] = [];
  const createdByRow = new Map<number, string>();

  const keepRejected = (r: CsvPreviewRow, status: SourceRecord["status"], note: string) => {
    const ts = m.now.toISOString();
    s.sourceRecords.push({
      id: m.newId("sr"), sourceId: plan.options.sourceId, sourceName: source?.name ?? "CSV import", sourceUrl: null,
      externalId: `${plan.options.fileName} · row ${r.rowNumber}`, discoveredAt: ts, lastVerifiedAt: null, status, importedLeadId: null,
      payload: r.payload, kind: null, title: plan.options.fileName, verification: "not_checked", verifiedBy: null, note, isDemo: m.isDemo,
      createdAt: ts, updatedAt: ts,
    });
  };

  for (const r of preview) {
    if (r.status === "error" || !r.input) {
      const why = r.errors.join(" ");
      keepRejected(r, "rejected", why);
      rows.push({ rowNumber: r.rowNumber, label: r.label, outcome: "not_imported", leadId: null, message: why });
      continue;
    }

    let action: DuplicateAction | undefined;
    let linkPropertyId: string | undefined;
    let existingLeadId: string | undefined;
    if (r.status === "duplicate") {
      const choice = plan.choices[r.rowNumber] ?? { action: "skip" };
      if (choice.action === "skip") {
        const note = r.inFileDuplicateOf ? `Skipped — same building as row ${r.inFileDuplicateOf} in this file` : "Skipped — possible duplicate of an existing lead";
        keepRejected(r, "duplicate", note);
        recordDuplicateDecision(s, m, {
          context: "csv_import", decision: "skipped", subject: r.label,
          candidatePropertyIds: r.duplicates.map((d) => d.propertyId),
          candidateLeadIds: [...new Set([...r.duplicates.flatMap((d) => d.openLeadIds), ...(r.inFileDuplicateOf && createdByRow.get(r.inFileDuplicateOf) ? [createdByRow.get(r.inFileDuplicateOf)!] : [])])],
          reasons: [...new Set(r.duplicates.flatMap((d) => d.reasons)), ...(r.inFileDuplicateOf ? ["same_file_row"] : [])],
          resultLeadId: null, resultPropertyId: null, sourceRecordId: s.sourceRecords[s.sourceRecords.length - 1].id, note,
        });
        rows.push({ rowNumber: r.rowNumber, label: r.label, outcome: "skipped", leadId: null, message: note });
        continue;
      }
      action = choice.action;
      if (choice.action === "link_to_property") linkPropertyId = choice.propertyId;
      if (choice.action === "add_to_existing_lead") existingLeadId = choice.leadId;
    }

    try {
      // Rows that only duplicate another row of this file have no existing match yet: "create anyway" is the import.
      const res = createLead(s, m, r.input, { duplicateAction: action, linkPropertyId, existingLeadId, context: "csv_import" });
      if (res.status === "duplicates_found") {
        // A row that looked new now matches something imported moments ago (another row of this file). Never guess — ask.
        const note = "Not imported — it looks like a duplicate of another row in this file. Review it and import again.";
        keepRejected(r, "duplicate", note);
        rows.push({ rowNumber: r.rowNumber, label: r.label, outcome: "not_imported", leadId: null, message: note });
        continue;
      }
      createdByRow.set(r.rowNumber, res.leadId);
      rows.push({
        rowNumber: r.rowNumber,
        label: r.label,
        outcome: res.mode === "added_to_existing" ? "added_to_existing" : "imported",
        leadId: res.leadId,
        message: res.mode === "added_to_existing" ? "Added to the existing lead (nothing overwritten)" : r.warnings.join(" ") || "Imported",
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : "Could not be imported.";
      keepRejected(r, "rejected", why);
      rows.push({ rowNumber: r.rowNumber, label: r.label, outcome: "not_imported", leadId: null, message: why });
    }
  }

  return {
    fileName: plan.options.fileName,
    total: rows.length,
    imported: rows.filter((x) => x.outcome === "imported").length,
    addedToExisting: rows.filter((x) => x.outcome === "added_to_existing").length,
    skipped: rows.filter((x) => x.outcome === "skipped").length,
    notImported: rows.filter((x) => x.outcome === "not_imported").length,
    rows,
  };
}

/** A starter file with the column names the importer recognizes. Example rows are clearly fake. */
export function csvTemplate(): string {
  const headers = ["Business name", "Property name", "Street address", "City", "ZIP", "Facility type", "Opportunity type", "Why it's an opportunity", "Source link", "Contact name", "Contact role", "Phone", "Email", "Property manager", "Square feet", "Potential value", "Notes"];
  const example = ["EXAMPLE Business (delete this row)", "", "100 Example St", "Baton Rouge", "70801", "Office", "New tenant", "EXAMPLE: lease signed for the second floor", "https://example.com/article", "", "", "", "", "", "", "", ""];
  return [headers, example].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
