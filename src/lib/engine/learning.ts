import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from "../config/scoring-settings";
import type { FacilityType, LeadFinderSnapshot, LostReasonCode, SignalType } from "../domain/types";
import { bestContact, buildLeadContexts, isContactActivity } from "./lead-context";

/**
 * Clean data for learning later — NO machine learning here.
 *
 * One flat row per closed lead (Won, Lost or Not a Fit) with the facts that might explain the outcome:
 * what kind of building, how big, which market, which signals, who we spoke to, where it came from,
 * and how long each step took. Later phases can chart these; a future phase may learn from them.
 */

export type SizeBand = "unknown" | "small" | "medium" | "large";

export interface OutcomeRecord {
  leadId: string;
  outcome: "won" | "lost" | "not_a_fit";
  reasonCode: LostReasonCode | null;
  reason: string | null;
  facilityType: FacilityType;
  sqft: number | null;
  sizeBand: SizeBand;
  market: string;
  parish: string;
  signalTypes: SignalType[];
  contactRole: string | null;
  sourceId: string;
  sourceName: string | null;
  potentialValue: string;
  daysToFirstContact: number | null;
  daysToWalkthrough: number | null;
  daysToOutcome: number | null;
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY));

export function sizeBand(sqft: number | null, settings: ScoringSettings = DEFAULT_SCORING_SETTINGS): SizeBand {
  if (sqft === null) return "unknown";
  if (sqft >= settings.size.largeMinSqft) return "large";
  if (sqft >= settings.size.mediumMinSqft) return "medium";
  return "small";
}

export function buildOutcomeRecords(s: LeadFinderSnapshot, settings: ScoringSettings = DEFAULT_SCORING_SETTINGS): OutcomeRecord[] {
  const markets = new Map(s.markets.map((x) => [x.id, x]));
  const out: OutcomeRecord[] = [];
  for (const ctx of buildLeadContexts(s)) {
    const { lead, property } = ctx;
    if (lead.status !== "won" && lead.status !== "lost" && lead.status !== "not_a_fit") continue;
    const chronological = [...ctx.activities].reverse();
    const firstContact = chronological.find(isContactActivity);
    const firstWalkthrough = chronological.find((a) => a.type === "walkthrough_scheduled");
    out.push({
      leadId: lead.id,
      outcome: lead.status,
      reasonCode: lead.lostReasonCode,
      reason: lead.status === "lost" ? lead.lostReason : lead.status === "not_a_fit" ? lead.notAFitReason : null,
      facilityType: property.facilityType,
      sqft: property.sqftStatus === "unknown" ? null : property.sqft,
      sizeBand: sizeBand(property.sqftStatus === "unknown" ? null : property.sqft, settings),
      market: (property.marketId && markets.get(property.marketId)?.name) || property.city,
      parish: property.parish,
      signalTypes: [...new Set(ctx.signals.map((x) => x.type))],
      contactRole: bestContact(ctx).role,
      sourceId: lead.sourceId,
      sourceName: ctx.source?.name ?? null,
      potentialValue: lead.potentialValue,
      daysToFirstContact: firstContact ? daysBetween(lead.discoveredAt, firstContact.occurredAt) : null,
      daysToWalkthrough: firstWalkthrough ? daysBetween(lead.discoveredAt, firstWalkthrough.occurredAt) : null,
      daysToOutcome: lead.closedAt ? daysBetween(lead.discoveredAt, lead.closedAt) : null,
    });
  }
  return out;
}
