import type { Company, Contact, LeadFinderSnapshot, Property } from "../domain/types";

/**
 * Duplicate FOUNDATION (Phase 2): finds records that probably describe the same building.
 * It never changes anything — merging is a separate, history-preserving step (workflow/merge.ts).
 *
 * Signals used: normalized address · coordinates within ~50 m · name similarity · phone · website domain.
 */

export type DuplicateReason = "same_address" | "within_50m" | "similar_name" | "same_phone" | "same_website" | "same_business";
export type DuplicateStrength = "exact" | "likely";

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  same_address: "Same street address",
  within_50m: "Within about 50 meters",
  similar_name: "Very similar name",
  same_phone: "Same phone number",
  same_website: "Same website",
  same_business: "Same business name in the same area",
};

export interface PropertyFacts {
  id?: string;
  name: string;
  normalizedAddress: string;
  city: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  /** Phone numbers (digits only, last 10) of the businesses and contacts tied to this building. */
  phones: string[];
  /** Website hosts (no "www.") of the businesses tied to this building. */
  domains: string[];
  /** Names of the businesses that occupy/own/operate it (not managers or leasing agents). Used only when checking a NEW lead. */
  businessNames?: string[];
}

export interface DuplicateMatch {
  strength: DuplicateStrength;
  reasons: DuplicateReason[];
}

export interface PropertyDuplicate extends DuplicateMatch {
  propertyId: string;
  duplicateId: string;
}

// ---------------------------------------------------------------------------------------------
// Normalizing
// ---------------------------------------------------------------------------------------------

const SUFFIX: Record<string, string> = {
  street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", court: "ct", circle: "cir",
  highway: "hwy", parkway: "pkwy", place: "pl", way: "way", trail: "trl", terrace: "ter", square: "sq",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};

/**
 * "1200 Demo Industrial Boulevard, Suite 200" and "1200 DEMO INDUSTRIAL BLVD." normalize to the same text.
 * Unit/suite numbers are dropped on purpose: two suites in one building are one property.
 */
export function normalizeAddress(address: string): string {
  const lowered = address.toLowerCase().replace(/[.,]/g, " ");
  // Drop unit designators and everything after them ("suite 200", "ste b", "unit 4", "#12", "bldg a").
  const noUnit = lowered.replace(/\s(?:suite|ste|unit|apt|bldg|building|floor|fl|room|rm)\b.*$/, "").replace(/\s#.*$/, "");
  return noUnit
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIX[w] ?? w)
    .join(" ");
}

const NAME_WORDS: Record<string, string> = { ctr: "center", cntr: "center", bldg: "building", ste: "suite", mgmt: "management", dist: "distribution", assoc: "associates" };
const NAME_STOP = new Set(["the", "of", "and", "llc", "inc", "co", "corp", "company"]);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => NAME_WORDS[w] ?? w)
      .filter((w) => !NAME_STOP.has(w)),
  );
}

/** 0–1 overlap between two names after expanding common abbreviations. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Great-circle distance in meters. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------------------------

/** Collect the phones and website domains of everything tied to a property. */
export function factsForProperty(s: LeadFinderSnapshot, p: Property): PropertyFacts {
  const companyIds = new Set<string>();
  for (const r of s.relationships) if (r.propertyId === p.id) companyIds.add(r.companyId);
  for (const l of s.leads) if (l.propertyId === p.id && l.companyId) companyIds.add(l.companyId);
  const companies = s.companies.filter((c: Company) => companyIds.has(c.id));
  const contacts = s.contacts.filter((c: Contact) => c.propertyId === p.id || (c.companyId !== null && companyIds.has(c.companyId)));
  const phones = new Set<string>();
  const domains = new Set<string>();
  for (const c of companies) {
    const ph = normalizePhone(c.phone);
    const dom = websiteDomain(c.website);
    if (ph) phones.add(ph);
    if (dom) domains.add(dom);
  }
  for (const c of contacts) {
    const ph = normalizePhone(c.phone);
    if (ph) phones.add(ph);
  }
  const occupantIds = new Set<string>();
  for (const r of s.relationships) if (r.propertyId === p.id && (r.role === "tenant" || r.role === "owner" || r.role === "operator")) occupantIds.add(r.companyId);
  for (const l of s.leads) if (l.propertyId === p.id && l.companyId) occupantIds.add(l.companyId);
  const businessNames = s.companies.filter((c) => occupantIds.has(c.id)).map((c) => c.name);
  return { id: p.id, name: p.name, normalizedAddress: p.normalizedAddress, city: p.city, zip: p.zip, lat: p.lat, lng: p.lng, phones: [...phones], domains: [...domains], businessNames };
}

const sameArea = (a: PropertyFacts, b: PropertyFacts) =>
  (a.zip && b.zip && a.zip === b.zip) || a.city.trim().toLowerCase() === b.city.trim().toLowerCase();

/**
 * Do these two describe the same building?
 *  - exact:  same normalized street address in the same ZIP/city
 *  - likely: within 50 m · or a very similar name in the same area · or a shared phone/website in the same area
 * Shared phone/website alone is NOT enough across different cities (a company can have many buildings).
 */
export function compareProperties(a: PropertyFacts, b: PropertyFacts, opts: { matchBusinessNames?: boolean } = {}): DuplicateMatch | null {
  const reasons: DuplicateReason[] = [];
  const area = sameArea(a, b);

  const addressMatch = a.normalizedAddress !== "" && a.normalizedAddress === b.normalizedAddress && area;
  if (addressMatch) reasons.push("same_address");

  const near = a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null && distanceMeters(a.lat, a.lng, b.lat, b.lng) <= 50;
  if (near) reasons.push("within_50m");

  const nameMatch = area && nameSimilarity(a.name, b.name) >= 0.8;
  if (nameMatch) reasons.push("similar_name");

  const samePhone = area && a.phones.some((p) => b.phones.includes(p));
  if (samePhone) reasons.push("same_phone");
  const sameSite = area && a.domains.some((d) => b.domains.includes(d));
  if (sameSite) reasons.push("same_website");

  // New-lead check only: "ABC Distribution" typed as the business may match the building where ABC Distribution already is.
  let businessMatch = false;
  if (opts.matchBusinessNames && area && !nameMatch) {
    const an = [a.name, ...(a.businessNames ?? [])].filter(Boolean);
    const bn = [b.name, ...(b.businessNames ?? [])].filter(Boolean);
    businessMatch = an.some((x) => bn.some((y) => nameSimilarity(x, y) >= 0.8));
    if (businessMatch) reasons.push("same_business");
  }

  if (reasons.length === 0) return null;
  if (addressMatch) return { strength: "exact", reasons };
  // Phone/website alone at different addresses is the "company with many buildings" case — not a duplicate.
  if (near || nameMatch || businessMatch) return { strength: "likely", reasons };
  return null;
}

/** All probable duplicate property pairs among active (not merged) properties. */
export function findPropertyDuplicates(s: LeadFinderSnapshot): PropertyDuplicate[] {
  const active = s.properties.filter((p) => !p.mergedIntoId);
  const facts = active.map((p) => factsForProperty(s, p));
  const out: PropertyDuplicate[] = [];
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const match = compareProperties(facts[i], facts[j]);
      if (match) out.push({ propertyId: facts[i].id!, duplicateId: facts[j].id!, ...match });
    }
  }
  return out;
}

export interface LeadDuplicate {
  leadId: string;
  duplicateId: string;
  /** "same_property" = both leads sit on one property record; "duplicate_property" = on records that look like one building. */
  kind: "same_property" | "duplicate_property";
  strength: DuplicateStrength;
  reasons: DuplicateReason[];
}

/** Open leads that probably describe the same opportunity. */
export function findLeadDuplicates(s: LeadFinderSnapshot): LeadDuplicate[] {
  const leads = s.leads.filter((l) => !l.mergedIntoLeadId && l.status !== "won" && l.status !== "lost" && l.status !== "not_a_fit");
  const propertyPairs = findPropertyDuplicates(s);
  const out: LeadDuplicate[] = [];
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i];
      const b = leads[j];
      if (a.propertyId === b.propertyId) {
        out.push({ leadId: a.id, duplicateId: b.id, kind: "same_property", strength: "exact", reasons: ["same_address"] });
        continue;
      }
      const pair = propertyPairs.find(
        (p) => (p.propertyId === a.propertyId && p.duplicateId === b.propertyId) || (p.propertyId === b.propertyId && p.duplicateId === a.propertyId),
      );
      if (pair) out.push({ leadId: a.id, duplicateId: b.id, kind: "duplicate_property", strength: pair.strength, reasons: pair.reasons });
    }
  }
  return out;
}

/** Existing properties that look like the same building as a new one about to be added. */
export function findPropertyMatchesFor(s: LeadFinderSnapshot, incoming: PropertyFacts): { propertyId: string; match: DuplicateMatch }[] {
  const out: { propertyId: string; match: DuplicateMatch }[] = [];
  for (const p of s.properties) {
    if (p.mergedIntoId) continue;
    const match = compareProperties(incoming, factsForProperty(s, p), { matchBusinessNames: true });
    if (match) out.push({ propertyId: p.id, match });
  }
  return out.sort((x, y) => (x.match.strength === y.match.strength ? 0 : x.match.strength === "exact" ? -1 : 1));
}
