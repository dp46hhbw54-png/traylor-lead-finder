import { OPPORTUNITY_TYPE_OF_SIGNAL, type OpportunityType } from "../domain/labels";
import type { FacilityType, LeadFinderSnapshot, PipelineStatus, SignalType } from "../domain/types";
import { SIGNAL_DEFINITIONS } from "../domain/labels";
import { calendarDaysBetween, daysSince } from "./dates";
import type { LeadView } from "./evaluate";
import type { FreshnessLevel } from "./freshness";
import type { Tier } from "./scoring";

/**
 * Finding leads: one forgiving search box + a few filters.
 * Pure functions over already-evaluated leads, so the same logic works on any repository.
 */

// ------------------------------------------------------------------ search

const fold = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Everything a person might type to find this lead: business, property, contacts, phones, emails, websites, address, city, ZIP, title. */
export function searchText(view: LeadView): { text: string; words: string[]; phoneDigits: string[] } {
  const { ctx } = view;
  const orgs = [ctx.company, ctx.propertyManager, ctx.leasingCompany].filter(Boolean);
  const parts: (string | null | undefined)[] = [
    ctx.lead.title,
    ctx.property.name,
    ctx.property.address,
    ctx.property.city,
    ctx.property.zip,
    ctx.property.parish,
    ...orgs.flatMap((o) => [o!.name, o!.email, o!.website]),
    ...ctx.contacts.flatMap((c) => [c.name, c.role, c.email]),
  ];
  const text = fold(parts.filter(Boolean).join(" "));
  const phoneDigits = [...orgs.map((o) => digits(o!.phone)), ...ctx.contacts.map((c) => digits(c.phone))].filter((d) => d.length >= 7);
  return { text, words: [...new Set(text.split(" "))], phoneDigits };
}

/** At most one typo (insert / delete / swap one letter). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Every word typed must be found somewhere (any order, any case, punctuation ignored).
 * Phone numbers match on digits ("225-555-0121" = "2255550121" = "555 0121").
 * Words of 5+ letters tolerate one typo ("warehose" finds "warehouse").
 */
export function matchesSearch(view: LeadView, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  const hay = searchText(view);
  const qDigits = digits(query);
  if (qDigits.length >= 4 && qDigits.length === query.replace(/[\s()+.-]/g, "").length) {
    return hay.phoneDigits.some((p) => p.includes(qDigits)) || hay.text.includes(qDigits);
  }
  return q.split(" ").every((token) => {
    if (hay.text.includes(token)) return true;
    if (/^\d+$/.test(token) && token.length >= 4) return hay.phoneDigits.some((p) => p.includes(token));
    if (token.length >= 5) return hay.words.some((w) => w.length >= 4 && withinOneEdit(token, w.slice(0, token.length + 1)) || withinOneEdit(token, w));
    return false;
  });
}

// ------------------------------------------------------------------ opportunity type

/** A lead's plain-language opportunity type: from its strongest, most recent signal. */
export function opportunityTypeOf(view: LeadView): OpportunityType {
  const order = { very_strong: 0, medium: 1, weak: 2 } as const;
  const top = [...view.ctx.signals].sort(
    (a, b) => order[SIGNAL_DEFINITIONS[a.type].strength] - order[SIGNAL_DEFINITIONS[b.type].strength] || b.discoveredAt.localeCompare(a.discoveredAt),
  )[0];
  return top ? OPPORTUNITY_TYPE_OF_SIGNAL[top.type] : "unknown";
}

// ------------------------------------------------------------------ filters

/** "" always means "any". */
export interface LeadFilters {
  q: string;
  // Primary
  market: string; // market id (city or parish)
  facilityType: FacilityType | "";
  tier: Tier | "";
  /** "open" = everything except Won / Lost / Not a Fit. "closed" = only those. "all" = everything. */
  status: PipelineStatus | "open" | "closed" | "all";
  freshness: FreshnessLevel | "";
  // More filters
  city: string;
  zip: string;
  parish: string;
  opportunityType: OpportunityType | "";
  signal: SignalType | "";
  hasContact: "" | "yes" | "no";
  hasManager: "" | "yes" | "no";
  lastContacted: "" | "never" | "7" | "30" | "over30";
  followUp: "" | "overdue" | "today" | "week" | "none";
  source: string; // source id
}

export const EMPTY_FILTERS: LeadFilters = {
  q: "",
  market: "",
  facilityType: "",
  tier: "",
  status: "open",
  freshness: "",
  city: "",
  zip: "",
  parish: "",
  opportunityType: "",
  signal: "",
  hasContact: "",
  hasManager: "",
  lastContacted: "",
  followUp: "",
  source: "",
};

export const PRIMARY_FILTER_KEYS = ["market", "facilityType", "tier", "status", "freshness"] as const;
export const MORE_FILTER_KEYS = ["city", "zip", "parish", "opportunityType", "signal", "hasContact", "hasManager", "lastContacted", "followUp", "source"] as const;

/** Which filters differ from the defaults (the search box counts too). */
export function activeFilterKeys(f: LeadFilters): (keyof LeadFilters)[] {
  return (Object.keys(EMPTY_FILTERS) as (keyof LeadFilters)[]).filter((k) => f[k] !== EMPTY_FILTERS[k] && String(f[k]).trim() !== "");
}

const CLOSED: PipelineStatus[] = ["won", "lost", "not_a_fit"];

export function hasPublicContact(view: LeadView): boolean {
  return Boolean(view.contact.phone || view.contact.email);
}

export function applyLeadFilters(views: LeadView[], f: LeadFilters, s: LeadFinderSnapshot, now: Date): LeadView[] {
  const market = f.market ? s.markets.find((x) => x.id === f.market) ?? null : null;
  const searching = f.q.trim() !== "";
  return views.filter((v) => {
    const { lead, property } = v.ctx;
    if (lead.mergedIntoLeadId) return false;

    // Status. Not a Fit (and other closed leads) are hidden from the default view — but a search finds them.
    if (f.status === "open") {
      if (CLOSED.includes(lead.status) && !searching) return false;
    } else if (f.status === "closed") {
      if (!CLOSED.includes(lead.status)) return false;
    } else if (f.status !== "all" && lead.status !== f.status) return false;

    if (searching && !matchesSearch(v, f.q)) return false;

    if (market) {
      if (market.kind === "city" && !(property.marketId === market.id || property.city.toLowerCase() === market.name.toLowerCase())) return false;
      if (market.kind === "parish" && property.parish.toLowerCase() !== market.name.toLowerCase()) return false;
    }
    if (f.facilityType && property.facilityType !== f.facilityType) return false;
    if (f.tier && v.score.tier !== f.tier) return false;
    if (f.freshness && v.freshness.level !== f.freshness) return false;

    if (f.city.trim() && !property.city.toLowerCase().includes(f.city.trim().toLowerCase())) return false;
    if (f.zip.trim() && !property.zip.startsWith(f.zip.trim())) return false;
    if (f.parish && property.parish.toLowerCase() !== f.parish.toLowerCase()) return false;
    if (f.opportunityType && opportunityTypeOf(v) !== f.opportunityType) return false;
    if (f.signal && !v.ctx.signals.some((x) => x.type === f.signal)) return false;
    if (f.hasContact === "yes" && !hasPublicContact(v)) return false;
    if (f.hasContact === "no" && hasPublicContact(v)) return false;
    if (f.hasManager === "yes" && !v.ctx.propertyManager) return false;
    if (f.hasManager === "no" && v.ctx.propertyManager) return false;

    if (f.lastContacted) {
      const d = v.lastContactAt ? daysSince(v.lastContactAt, now) : null;
      if (f.lastContacted === "never" && d !== null) return false;
      if (f.lastContacted === "7" && (d === null || d > 7)) return false;
      if (f.lastContacted === "30" && (d === null || d > 30)) return false;
      if (f.lastContacted === "over30" && (d === null || d <= 30)) return false;
    }
    if (f.followUp) {
      const due = v.nextFollowUp ? calendarDaysBetween(now, new Date(v.nextFollowUp.dueAt)) : null;
      if (f.followUp === "none" && due !== null) return false;
      if (f.followUp === "overdue" && !(due !== null && due < 0)) return false;
      if (f.followUp === "today" && due !== 0) return false;
      if (f.followUp === "week" && !(due !== null && due >= 0 && due <= 7)) return false;
    }
    if (f.source) {
      const ids = new Set([lead.sourceId, ...v.ctx.signals.map((x) => x.sourceId), ...s.sourceRecords.filter((r) => r.importedLeadId === lead.id).map((r) => r.sourceId)]);
      if (!ids.has(f.source)) return false;
    }
    return true;
  });
}

export type LeadSort = "score" | "newest" | "follow_up";

export function sortLeads(views: LeadView[], sort: LeadSort): LeadView[] {
  const out = [...views];
  if (sort === "newest") out.sort((a, b) => b.ctx.lead.discoveredAt.localeCompare(a.ctx.lead.discoveredAt) || b.score.score - a.score.score);
  else if (sort === "follow_up")
    out.sort(
      (a, b) =>
        (a.nextFollowUp?.dueAt ?? "9999").localeCompare(b.nextFollowUp?.dueAt ?? "9999") || b.score.score - a.score.score,
    );
  else out.sort((a, b) => b.score.score - a.score.score || b.score.raw - a.score.raw || a.ctx.lead.id.localeCompare(b.ctx.lead.id));
  return out;
}
