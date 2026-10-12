import { RepositoryError } from "../domain/errors";
import type {
  Activity,
  Company,
  Contact,
  DataStatus,
  DuplicateDecision,
  FacilityType,
  FieldProvenance,
  Lead,
  LeadFinderSnapshot,
  OpportunitySignal,
  PotentialValue,
  Property,
  PropertyRelationship,
  SignalType,
  SourceKind,
  SourceRecord,
  SourceVerification,
} from "../domain/types";
import { FACILITY_TYPE_LABEL, SIGNAL_DEFINITIONS, SOURCE_KIND_LABEL } from "../domain/labels";
import {
  findPropertyMatchesFor,
  normalizeAddress,
  normalizePhone,
  websiteDomain,
  type DuplicateReason,
  type DuplicateStrength,
  type PropertyFacts,
} from "../engine/duplicates";
import { pushAudit, setAudited, type MutationContext } from "./context";
import { addActivity } from "./actions";

/**
 * Putting a new commercial opportunity into the system.
 *
 * Rules that protect data truth:
 *  - Nothing is invented. Anything not supplied stays empty / "unknown".
 *  - Square footage, phones, emails and websites must say HOW we know them (verified / publicly reported / estimated).
 *  - A signal's confidence defaults to "unknown", which means it is shown but never scores.
 *  - Probable duplicates are reported BEFORE anything is saved; the caller decides what to do,
 *    and that decision is kept as a permanent duplicate-decision record.
 *  - The app never opens links itself. A source is "verified" only when a person says they checked it.
 */

export interface ExistingRef {
  existingId: string;
}

export interface NewCompanyInput {
  name: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Required when a website, phone or email is given. */
  dataStatus?: DataStatus;
}

export interface NewPropertyInput {
  name?: string;
  /** Optional — the city is the minimum location. Unknown is fine. */
  address?: string;
  city: string;
  parish?: string;
  zip?: string;
  facilityType: FacilityType;
  sqft?: number | null;
  /** Required when sqft is given. */
  sqftStatus?: DataStatus;
  constructionStatus?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface NewContactInput {
  name: string;
  role?: string;
  phone?: string | null;
  email?: string | null;
  /** Required when a phone or email is given. */
  dataStatus?: DataStatus;
  /** Whose employee this is. Defaults to the business, or the property manager if there is no business. */
  employer?: "company" | "property_manager";
}

export interface NewSignalInput {
  type: SignalType;
  description: string;
  sourceUrl?: string | null;
  discoveredAt?: string;
  expectedDate?: string | null;
  /** Defaults to "unknown" — shown as evidence but does not add to the score. */
  confidence?: DataStatus;
}

export interface NewLeadInput {
  title: string;
  property: ExistingRef | NewPropertyInput;
  company?: ExistingRef | NewCompanyInput | null;
  propertyManager?: ExistingRef | NewCompanyInput | null;
  contact?: NewContactInput | null;
  signals?: NewSignalInput[];
  source: NewSourceInput;
  potentialValue?: PotentialValue;
  notes?: string | null;
}

export interface NewSourceInput {
  sourceId: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  payload?: Record<string, string | number | null> | null;
  /** Website, news article, property listing… */
  kind?: SourceKind | null;
  /** Who published it / what it is (e.g. "Business journal article", or the CSV file name). */
  title?: string | null;
  /** Did a person open the source and see this? Defaults to "not checked". */
  verification?: SourceVerification;
}

export type DuplicateAction = "create_anyway" | "link_to_property" | "add_to_existing_lead";

export interface CreateLeadOptions {
  duplicateAction?: DuplicateAction;
  /** link_to_property: which building (defaults to the best match). */
  linkPropertyId?: string;
  /** add_to_existing_lead: which lead receives the new information. */
  existingLeadId?: string;
  /** Where the duplicate warning came up — saved with the decision. */
  context?: DuplicateDecision["context"];
  decisionNote?: string | null;
}

export interface DuplicateCandidate {
  propertyId: string;
  propertyName: string;
  address: string;
  city: string;
  strength: DuplicateStrength;
  reasons: DuplicateReason[];
  openLeadIds: string[];
}

export type CreateLeadResult =
  | {
      status: "created";
      /** "new_lead" = a lead was created; "added_to_existing" = the information was added to an existing lead instead. */
      mode: "new_lead" | "added_to_existing";
      leadId: string;
      propertyId: string;
      reusedProperty: boolean;
      possibleDuplicateOf: string[];
      decisionId: string | null;
    }
  | { status: "duplicates_found"; candidates: DuplicateCandidate[] };

const isRef = (v: unknown): v is ExistingRef => typeof v === "object" && v !== null && "existingId" in v;
const blank = (v: string | null | undefined) => !v || !v.trim();
const fail = (message: string, nextStep: string): never => {
  throw new RepositoryError(message, nextStep);
};

function needStatus(label: string, hasValue: boolean, status: DataStatus | undefined) {
  if (hasValue && (!status || status === "unknown")) {
    fail(`Say how you know the ${label}.`, "Choose Verified, Publicly reported or Estimated — or leave the field empty if you don't know it.");
  }
}

/** A web address must look like one — we store it exactly, and never open it ourselves. */
export function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

const SOURCE_KINDS = new Set(Object.keys(SOURCE_KIND_LABEL));

/** Same checks as createLead, without saving or throwing: null when the input is fine. */
export function checkNewLead(s: LeadFinderSnapshot, input: NewLeadInput): { message: string; nextStep: string } | null {
  try {
    validate(s, input);
    return null;
  } catch (err) {
    if (err instanceof RepositoryError) return { message: err.message, nextStep: err.nextStep };
    throw err;
  }
}

function validate(s: LeadFinderSnapshot, input: NewLeadInput): void {
  if (blank(input.title)) fail("Say why this is an opportunity.", "For example: “New tenant moving into warehouse”.");
  const source = s.sources.find((x) => x.id === input.source.sourceId);
  if (!source) fail("Every lead needs a source.", "Choose where you found it (website, news article, listing, referral…).");
  else if (source.status === "disabled") fail(`${source.name} is turned off.`, "Turn it on in Sources, or pick a different source.");
  else if (source.status === "unavailable") fail("Source temporarily unavailable.", "Try again later, or enter this lead as a manual entry.");
  if (input.source.kind && !SOURCE_KINDS.has(input.source.kind)) fail("That source type isn't one we know.", "Pick one from the list.");
  if (!blank(input.source.sourceUrl) && !isValidUrl(input.source.sourceUrl!)) {
    fail("That web address doesn't look right.", "Paste the full link, starting with https:// — or leave it empty.");
  }

  if (isRef(input.property)) {
    const existing = s.properties.find((p) => p.id === (input.property as ExistingRef).existingId);
    if (!existing || existing.mergedIntoId) fail("That property could not be found.", "Pick a property from the list, or enter a new one.");
  } else {
    const p = input.property;
    const businessName = input.company && !isRef(input.company) ? input.company.name : input.company ? "known" : "";
    if (blank(p.name) && blank(businessName)) fail("Enter the business or property name.", "A business name, a building name, or both.");
    if (blank(p.city)) fail("Enter the location (city).", "Pick the city. The street address is optional.");
    if (!p.facilityType || !(p.facilityType in FACILITY_TYPE_LABEL)) fail("Choose the facility type.", "For example Office, Warehouse or Retail center.");
    if (p.sqft !== null && p.sqft !== undefined) {
      if (!Number.isFinite(p.sqft) || p.sqft <= 0) fail("Square footage must be a positive number.", "Fix the number, or leave it empty if you don't know it.");
      needStatus("square footage", true, p.sqftStatus);
    }
  }
  for (const c of [input.company, input.propertyManager]) {
    if (c && !isRef(c)) {
      if (blank(c.name)) fail("A business needs a name.", "Enter the business name.");
      needStatus("business contact details", !blank(c.website) || !blank(c.phone) || !blank(c.email), c.dataStatus);
      if (!blank(c.website) && !isValidUrl(c.website!)) fail("That website doesn't look right.", "Paste the full link, starting with https:// — or leave it empty.");
    } else if (c && isRef(c) && !s.companies.some((x) => x.id === c.existingId && !x.mergedIntoId)) {
      fail("That business could not be found.", "Pick a business from the list, or enter a new one.");
    }
  }
  if (input.contact) {
    if (blank(input.contact.name)) fail("A contact needs a name.", "Enter the contact's name, or remove the contact.");
    needStatus("contact's phone or email", !blank(input.contact.phone) || !blank(input.contact.email), input.contact.dataStatus);
    if (!blank(input.contact.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact.email!.trim())) {
      fail("That email address doesn't look right.", "Check it, or leave it empty.");
    }
    if (!blank(input.contact.phone) && input.contact.phone!.replace(/\D/g, "").length < 7) {
      fail("That phone number looks too short.", "Check it, or leave it empty.");
    }
  }
  if (!input.signals || input.signals.length === 0) {
    fail("Say why this is an opportunity.", "Pick what you saw (new construction, new tenant, renovation…) and describe it in a sentence.");
  }
  for (const sig of input.signals ?? []) {
    if (!(sig.type in SIGNAL_DEFINITIONS)) fail("That opportunity type isn't one we know.", "Pick one from the list.");
    if (blank(sig.description)) fail("Describe what you saw in a sentence.", "For example: “Lease signed for the whole building” — we never guess.");
  }
}

function incomingFacts(input: NewLeadInput, s: LeadFinderSnapshot): PropertyFacts {
  const p = input.property as NewPropertyInput;
  const orgs = [input.company, input.propertyManager].map((c) => (c ? (isRef(c) ? s.companies.find((x) => x.id === c.existingId) : c) : null));
  const business = input.company ? (isRef(input.company) ? s.companies.find((x) => x.id === (input.company as ExistingRef).existingId)?.name : input.company.name) : null;
  const phones = [...orgs.map((o) => normalizePhone(o?.phone)), normalizePhone(input.contact?.phone)].filter((x): x is string => Boolean(x));
  const domains = orgs.map((o) => websiteDomain(o?.website)).filter((x): x is string => Boolean(x));
  return {
    name: propertyNameFor(input, s),
    normalizedAddress: normalizeAddress(p.address ?? ""),
    city: p.city,
    zip: p.zip ?? "",
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    phones,
    domains,
    businessNames: business ? [business] : [],
  };
}

/** The building's display name: its own name, else the business name, else the street address. Never invented. */
function propertyNameFor(input: NewLeadInput, s: LeadFinderSnapshot): string {
  const p = input.property as NewPropertyInput;
  const business = input.company ? (isRef(input.company) ? s.companies.find((x) => x.id === (input.company as ExistingRef).existingId)?.name : input.company.name) : null;
  return p.name?.trim() || business?.trim() || p.address?.trim() || "Unnamed property";
}

/** One line describing what is being added, for duplicate-decision history. */
export function describeIncoming(s: LeadFinderSnapshot, input: NewLeadInput): string {
  if (isRef(input.property)) return s.properties.find((p) => p.id === (input.property as ExistingRef).existingId)?.name ?? "Existing property";
  const p = input.property;
  const where = [p.address?.trim(), p.city?.trim()].filter(Boolean).join(", ");
  return `${propertyNameFor(input, s)}${where ? ` — ${where}` : ""}`;
}

/** Existing properties that look like the building in `input`. Read-only. */
export function previewDuplicates(s: LeadFinderSnapshot, input: NewLeadInput): DuplicateCandidate[] {
  if (isRef(input.property)) return [];
  return findPropertyMatchesFor(s, incomingFacts(input, s)).map(({ propertyId, match }) => {
    const p = s.properties.find((x) => x.id === propertyId)!;
    return {
      propertyId,
      propertyName: p.name,
      address: p.address,
      city: p.city,
      strength: match.strength,
      reasons: match.reasons,
      openLeadIds: s.leads.filter((l) => l.propertyId === propertyId && !l.mergedIntoLeadId && !["won", "lost", "not_a_fit"].includes(l.status)).map((l) => l.id),
    };
  });
}

export function createLead(s: LeadFinderSnapshot, m: MutationContext, input: NewLeadInput, opts: CreateLeadOptions = {}): CreateLeadResult {
  validate(s, input);

  // 1) Duplicates are reported before anything is written.
  const candidates = previewDuplicates(s, input);
  if (candidates.length > 0 && !opts.duplicateAction) return { status: "duplicates_found", candidates };

  let existingLead: Lead | null = null;
  if (opts.duplicateAction === "link_to_property") {
    const target = opts.linkPropertyId ?? candidates[0]?.propertyId;
    if (!target || !s.properties.some((p) => p.id === target && !p.mergedIntoId)) {
      fail("There is no matching property to link to.", "Choose “Create anyway”, or pick the property to link.");
    }
  }
  if (opts.duplicateAction === "add_to_existing_lead") {
    existingLead = s.leads.find((l) => l.id === opts.existingLeadId && !l.mergedIntoLeadId) ?? null;
    if (!existingLead) fail("That existing lead could not be found.", "Pick the lead to add this information to, or choose “Create anyway”.");
  }

  const ts = m.now.toISOString();
  const stamp = { createdAt: ts, updatedAt: ts };
  const sourceId = input.source.sourceId;
  const source = s.sources.find((x) => x.id === sourceId)!;
  const verification: SourceVerification = input.source.verification ?? "not_checked";

  // 2) Source record — exactly what was received, and whether a PERSON checked it.
  const sr: SourceRecord = {
    id: m.newId("sr"), sourceId, sourceName: source.name, sourceUrl: input.source.sourceUrl?.trim() || null, externalId: input.source.externalId ?? null,
    discoveredAt: ts, lastVerifiedAt: verification === "verified" ? ts : null, status: existingLead ? "duplicate" : "imported", importedLeadId: null,
    payload: input.source.payload ?? null, kind: input.source.kind ?? null, title: input.source.title?.trim() || null, verification,
    verifiedBy: verification === "verified" ? m.by : null,
    note: verification === "unavailable" ? "The link could not be opened when this was entered — the facts are unconfirmed, not disproven." : null,
    isDemo: m.isDemo, ...stamp,
  };
  s.sourceRecords.push(sr);

  const prov = (p: Pick<FieldProvenance, "entityType" | "entityId" | "field" | "status" | "valueNote">) => {
    const row: FieldProvenance = {
      id: m.newId("fp"), ...p, sourceId, sourceRecordId: sr.id, sourceUrl: sr.sourceUrl, recordedAt: ts, verifiedAt: p.status === "verified" ? ts : null,
      verifiedBy: p.status === "verified" ? m.by : null, ...stamp,
    };
    s.provenance.push(row);
  };

  // 3) Property — reuse or create.
  let property: Property;
  let reusedProperty = false;
  const possibleDuplicateOf: string[] = [];
  const np = isRef(input.property) ? null : input.property;
  const fillPropertyGaps = (target: Property) => {
    if (!np) return;
    // Only fill what we don't already know — never overwrite existing facts.
    if (target.sqft === null && np.sqft && np.sqftStatus && np.sqftStatus !== "unknown") {
      setAudited(s, m, "property", target, "sqft", np.sqft);
      setAudited(s, m, "property", target, "sqftStatus", np.sqftStatus);
      prov({ entityType: "property", entityId: target.id, field: "sqft", status: np.sqftStatus, valueNote: `${np.sqft.toLocaleString("en-US")} sq ft` });
    }
    if (!target.address && np.address?.trim()) {
      setAudited(s, m, "property", target, "address", np.address.trim());
      setAudited(s, m, "property", target, "normalizedAddress", normalizeAddress(np.address));
    }
    if (!target.zip && np.zip?.trim()) setAudited(s, m, "property", target, "zip", np.zip.trim());
  };
  if (isRef(input.property)) {
    property = s.properties.find((p) => p.id === (input.property as ExistingRef).existingId)!;
    reusedProperty = true;
  } else if (existingLead) {
    property = s.properties.find((p) => p.id === existingLead!.propertyId)!;
    reusedProperty = true;
    fillPropertyGaps(property);
  } else if (opts.duplicateAction === "link_to_property") {
    property = s.properties.find((p) => p.id === (opts.linkPropertyId ?? candidates[0].propertyId))!;
    reusedProperty = true;
    fillPropertyGaps(property);
  } else {
    const p = np!;
    const cityMarket = s.markets.find((x) => x.kind === "city" && x.name.toLowerCase() === p.city.trim().toLowerCase()) ?? null;
    property = {
      id: m.newId("p"), name: propertyNameFor(input, s), address: p.address?.trim() ?? "", normalizedAddress: normalizeAddress(p.address ?? ""),
      city: p.city.trim(), parish: p.parish?.trim() || cityMarket?.parish || "", zip: p.zip?.trim() ?? "", marketId: cityMarket?.id ?? null, facilityType: p.facilityType,
      sqft: p.sqft ?? null, sqftStatus: p.sqft ? p.sqftStatus ?? "unknown" : "unknown", constructionStatus: p.constructionStatus ?? null,
      lat: p.lat ?? null, lng: p.lng ?? null, mergedIntoId: null, isDemo: m.isDemo, ...stamp,
    };
    s.properties.push(property);
    pushAudit(s, m, {
      entityType: "property", entityId: property.id, action: "create",
      note: candidates.length > 0 ? `Created anyway — possible duplicate of ${candidates.map((c) => c.propertyName).join(", ")}` : null,
    });
    if (property.sqft && property.sqftStatus !== "unknown") {
      prov({ entityType: "property", entityId: property.id, field: "sqft", status: property.sqftStatus, valueNote: `${property.sqft.toLocaleString("en-US")} sq ft` });
    }
    for (const c of candidates) possibleDuplicateOf.push(c.propertyId);
  }

  // 4) Businesses — reuse an existing one with the same name instead of creating a twin.
  const resolveCompany = (c: ExistingRef | NewCompanyInput | null | undefined): Company | null => {
    if (!c) return null;
    if (isRef(c)) return s.companies.find((x) => x.id === c.existingId)!;
    const twin = s.companies.find((x) => !x.mergedIntoId && x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (twin) {
      // Fill gaps on the existing business only — never overwrite.
      for (const field of ["website", "phone", "email"] as const) {
        const v = c[field]?.trim();
        if (v && !twin[field]) {
          setAudited(s, m, "company", twin, field, v);
          prov({ entityType: "company", entityId: twin.id, field, status: c.dataStatus ?? "unknown", valueNote: v });
        }
      }
      return twin;
    }
    const company: Company = {
      id: m.newId("co"), name: c.name.trim(), industry: c.industry ?? null, website: c.website?.trim() || null, phone: c.phone?.trim() || null,
      email: c.email?.trim() || null, sourceId, mergedIntoId: null, isDemo: m.isDemo, ...stamp,
    };
    s.companies.push(company);
    pushAudit(s, m, { entityType: "company", entityId: company.id, action: "create" });
    for (const field of ["website", "phone", "email"] as const) {
      if (company[field]) prov({ entityType: "company", entityId: company.id, field, status: c.dataStatus ?? "unknown", valueNote: company[field] });
    }
    return company;
  };
  const company = resolveCompany(input.company);
  const manager = resolveCompany(input.propertyManager);

  const statusOf = (c: ExistingRef | NewCompanyInput | null | undefined): DataStatus => (c && !isRef(c) ? c.dataStatus ?? "unknown" : "unknown");
  const link = (co: Company | null, role: PropertyRelationship["role"], ref: ExistingRef | NewCompanyInput | null | undefined) => {
    if (!co) return;
    if (s.relationships.some((r) => r.propertyId === property.id && r.companyId === co.id && r.role === role)) return;
    // A different manager is already on file: add, but never replace.
    const status = statusOf(ref);
    const rel: PropertyRelationship = { id: m.newId("r"), propertyId: property.id, companyId: co.id, role, dataStatus: status, ...stamp };
    s.relationships.push(rel);
    pushAudit(s, m, { entityType: "relationship", entityId: rel.id, action: "create", note: `${co.name} → ${role}` });
    prov({ entityType: "relationship", entityId: rel.id, field: role, status, valueNote: co.name });
  };
  link(company, "tenant", input.company);
  link(manager, "property_manager", input.propertyManager);

  // 5) Contact.
  let contact: Contact | null = null;
  if (input.contact) {
    const c = input.contact;
    const employer = (c.employer === "property_manager" ? manager : company) ?? manager ?? company;
    const sameName = (k: Contact) => k.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (k.companyId === (employer?.id ?? null) || k.propertyId === property.id);
    contact = s.contacts.find(sameName) ?? null;
    if (!contact) {
      contact = {
        id: m.newId("k"), name: c.name.trim(), role: c.role?.trim() ?? "", companyId: employer?.id ?? null, propertyId: employer ? null : property.id,
        phone: c.phone?.trim() || null, email: c.email?.trim() || null, dataStatus: c.dataStatus ?? "unknown", sourceId, isDemo: m.isDemo, ...stamp,
      };
      s.contacts.push(contact);
      pushAudit(s, m, { entityType: "contact", entityId: contact.id, action: "create" });
      for (const field of ["phone", "email"] as const) {
        if (contact[field]) prov({ entityType: "contact", entityId: contact.id, field, status: contact.dataStatus, valueNote: contact[field] });
      }
    } else {
      for (const field of ["phone", "email"] as const) {
        const v = c[field]?.trim();
        if (v && !contact[field]) {
          setAudited(s, m, "contact", contact, field, v);
          prov({ entityType: "contact", entityId: contact.id, field, status: c.dataStatus ?? "unknown", valueNote: v });
        }
      }
    }
  }

  // 6) Lead — new, or the existing one that receives this information.
  let lead: Lead;
  if (existingLead) {
    lead = existingLead;
    if (!lead.companyId && company) setAudited(s, m, "lead", lead, "companyId", company.id, lead.id, `Filled from new information (${source.name})`);
    if (!lead.primaryContactId && contact) setAudited(s, m, "lead", lead, "primaryContactId", contact.id, lead.id, `Filled from new information (${source.name})`);
    if (lead.potentialValue === "unknown" && input.potentialValue && input.potentialValue !== "unknown") {
      setAudited(s, m, "lead", lead, "potentialValue", input.potentialValue, lead.id, "Filled from new information");
    }
    if (verification === "verified") {
      setAudited(s, m, "lead", lead, "lastVerifiedAt", ts, lead.id, "Source checked by a person");
      lead.lastVerifiedBy = m.by;
    }
    if (input.notes?.trim()) {
      const merged = `${lead.notes ? `${lead.notes}\n\n` : ""}— Added from ${sr.title ?? source.name}:\n${input.notes.trim()}`;
      setAudited(s, m, "lead", lead, "notes", merged, lead.id, "Notes added — nothing removed");
    }
    addActivity(s, m, lead.id, "other", `New information added from ${sr.title ?? source.name}${sr.sourceUrl ? ` (${sr.sourceUrl})` : ""} — it looked like this same opportunity`);
  } else {
    lead = {
      id: m.newId("l"), title: input.title.trim(), propertyId: property.id, companyId: company?.id ?? null, primaryContactId: contact?.id ?? null,
      status: "new", potentialValue: input.potentialValue ?? "unknown", sourceId, sourceRecordId: sr.id, discoveredAt: ts,
      lastVerifiedAt: verification === "verified" ? ts : null, lastVerifiedBy: verification === "verified" ? m.by : null,
      snoozedUntil: null, notAFitReason: null, lostReasonCode: null, lostReason: null, closedAt: null, notes: input.notes?.trim() || null,
      mergedIntoLeadId: null, externalQuoteRef: null, convertedCustomerRef: null, isDemo: m.isDemo, ...stamp,
    };
    s.leads.push(lead);
    pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "create", note: `From ${sr.title ?? source.name}` });
    s.activities.push({
      id: m.newId("act"), leadId: lead.id, type: "discovered", summary: `Lead discovered via ${sr.title ? `${sr.title} (${source.name})` : source.name}`,
      outcome: null, occurredAt: ts, performedBy: m.by,
    });
  }
  sr.importedLeadId = lead.id;

  // 7) Evidence.
  for (const sig of input.signals ?? []) {
    const row: OpportunitySignal = {
      id: m.newId("sig"), leadId: lead.id, type: sig.type, description: sig.description.trim(), sourceId, sourceRecordId: sr.id,
      sourceUrl: sig.sourceUrl ?? sr.sourceUrl, discoveredAt: sig.discoveredAt ?? ts, verifiedAt: sig.confidence === "verified" ? ts : null,
      verifiedBy: sig.confidence === "verified" ? m.by : null, confidence: sig.confidence ?? "unknown", expectedDate: sig.expectedDate ?? null, ...stamp,
    };
    s.signals.push(row);
    pushAudit(s, m, { entityType: "signal", entityId: row.id, leadId: lead.id, action: "create", note: sig.type });
  }

  // 8) The duplicate warning and what the person decided — kept forever.
  let decisionId: string | null = null;
  if (candidates.length > 0 && opts.duplicateAction) {
    const decision: DuplicateDecision = {
      id: m.newId("dd"),
      context: opts.context ?? "manual_entry",
      decision: opts.duplicateAction,
      subject: describeIncoming(s, input),
      candidatePropertyIds: candidates.map((c) => c.propertyId),
      candidateLeadIds: [...new Set(candidates.flatMap((c) => c.openLeadIds))],
      reasons: [...new Set(candidates.flatMap((c) => c.reasons))],
      resultLeadId: lead.id,
      resultPropertyId: property.id,
      sourceRecordId: sr.id,
      decidedBy: m.by,
      decidedAt: ts,
      note: opts.decisionNote?.trim() || null,
    };
    s.duplicateDecisions.push(decision);
    decisionId = decision.id;
  }

  return { status: "created", mode: existingLead ? "added_to_existing" : "new_lead", leadId: lead.id, propertyId: property.id, reusedProperty, possibleDuplicateOf, decisionId };
}

/** Record a decision that didn't create anything (e.g. a CSV row the person chose to skip, or "not a duplicate"). */
export function recordDuplicateDecision(
  s: LeadFinderSnapshot,
  m: MutationContext,
  input: Omit<DuplicateDecision, "id" | "decidedBy" | "decidedAt">,
): DuplicateDecision {
  const row: DuplicateDecision = { ...input, id: m.newId("dd"), decidedBy: m.by, decidedAt: m.now.toISOString() };
  s.duplicateDecisions.push(row);
  return row;
}
