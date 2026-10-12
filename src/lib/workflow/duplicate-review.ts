import { RepositoryError } from "../domain/errors";
import type { DuplicateDecision, LeadFinderSnapshot } from "../domain/types";
import { findLeadDuplicates, type LeadDuplicate } from "../engine/duplicates";
import type { MutationContext } from "./context";
import { recordDuplicateDecision } from "./ingest";
import { mergeLeads, mergeProperties, type MergeSummary } from "./merge";

/**
 * Reviewing a possible duplicate AFTER both leads exist.
 * Merging never deletes anything (see merge.ts); every decision is kept in duplicate_decisions.
 */

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/**
 * Pairs a person already answered — they stop warning:
 *  - "not a duplicate"
 *  - "create anyway" (the new lead vs. every lead it was compared with)
 *  - "same building, new opportunity" (two real opportunities at one building)
 */
export function dismissedPairs(s: LeadFinderSnapshot): Set<string> {
  const out = new Set<string>();
  for (const d of s.duplicateDecisions ?? []) {
    if (d.decision === "not_duplicate" && d.candidateLeadIds.length === 2) out.add(pairKey(d.candidateLeadIds[0], d.candidateLeadIds[1]));
    if ((d.decision === "create_anyway" || d.decision === "link_to_property") && d.resultLeadId) {
      for (const other of d.candidateLeadIds) if (other !== d.resultLeadId) out.add(pairKey(d.resultLeadId, other));
    }
  }
  return out;
}

/** Possible duplicates still waiting for a decision. */
export function openLeadDuplicates(s: LeadFinderSnapshot): LeadDuplicate[] {
  const dismissed = dismissedPairs(s);
  return findLeadDuplicates(s).filter((d) => !dismissed.has(pairKey(d.leadId, d.duplicateId)));
}

/** Possible duplicates of one lead, as the other lead's id. */
export function openDuplicatesOf(s: LeadFinderSnapshot, leadId: string): LeadDuplicate[] {
  return openLeadDuplicates(s).filter((d) => d.leadId === leadId || d.duplicateId === leadId);
}

/**
 * Merge `duplicateId` into `survivorId`. If they sit on two property records that are the same building,
 * the property records are merged first (also non-destructive).
 */
export function mergeDuplicateLeads(s: LeadFinderSnapshot, m: MutationContext, survivorId: string, duplicateId: string): MergeSummary & { decision: DuplicateDecision } {
  const keep = s.leads.find((l) => l.id === survivorId);
  const dup = s.leads.find((l) => l.id === duplicateId);
  if (!keep || !dup) throw new RepositoryError("One of those leads could not be found.", "Refresh the page and try again.");
  const pair = findLeadDuplicates(s).find((d) => pairKey(d.leadId, d.duplicateId) === pairKey(survivorId, duplicateId));
  const notes: string[] = [];
  if (keep.propertyId !== dup.propertyId) {
    const p = mergeProperties(s, m, keep.propertyId, dup.propertyId);
    notes.push(...p.notes);
  }
  const summary = mergeLeads(s, m, survivorId, duplicateId);
  const decision = recordDuplicateDecision(s, m, {
    context: "review",
    decision: "merged",
    subject: `${dup.title} → ${keep.title}`,
    candidatePropertyIds: [...new Set([keep.propertyId, dup.propertyId])],
    candidateLeadIds: [keep.id, dup.id],
    reasons: pair?.reasons ?? [],
    resultLeadId: keep.id,
    resultPropertyId: keep.propertyId,
    sourceRecordId: null,
    note: null,
  });
  return { ...summary, notes: [...notes, ...summary.notes], decision };
}

export function markNotDuplicate(s: LeadFinderSnapshot, m: MutationContext, leadId: string, otherLeadId: string, note?: string): DuplicateDecision {
  const a = s.leads.find((l) => l.id === leadId);
  const b = s.leads.find((l) => l.id === otherLeadId);
  if (!a || !b) throw new RepositoryError("One of those leads could not be found.", "Refresh the page and try again.");
  const pair = findLeadDuplicates(s).find((d) => pairKey(d.leadId, d.duplicateId) === pairKey(leadId, otherLeadId));
  return recordDuplicateDecision(s, m, {
    context: "review",
    decision: "not_duplicate",
    subject: `${a.title} / ${b.title}`,
    candidatePropertyIds: [...new Set([a.propertyId, b.propertyId])],
    candidateLeadIds: [a.id, b.id],
    reasons: pair?.reasons ?? [],
    resultLeadId: null,
    resultPropertyId: null,
    sourceRecordId: null,
    note: note?.trim() || null,
  });
}
