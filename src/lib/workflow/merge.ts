import { RepositoryError } from "../domain/errors";
import { PIPELINE_STATUS_LABEL, POTENTIAL_VALUE_LABEL } from "../domain/labels";
import type { LeadFinderSnapshot, Property } from "../domain/types";
import { pushAudit, setAudited, type MutationContext } from "./context";
import { addActivity } from "./actions";

/**
 * Merging duplicates WITHOUT losing history.
 *
 * Nothing is deleted. The duplicate record stays in the data, marked `mergedInto…` and hidden from every list.
 * Everything attached to it — leads, signals, activities, follow-ups, walkthroughs, notes, sources and
 * field provenance — is moved to the surviving record. Where both records disagree, the survivor's value
 * is kept and the other value is written into the audit log so it can be recovered.
 */

export interface MergeSummary {
  survivorId: string;
  duplicateId: string;
  moved: Record<string, number>;
  /** Plain-language notes about values that were kept or filled in. */
  notes: string[];
}

export function mergeProperties(s: LeadFinderSnapshot, m: MutationContext, survivorId: string, duplicateId: string): MergeSummary {
  if (survivorId === duplicateId) throw new RepositoryError("Pick two different properties to merge.", "Choose the record to keep and the one to merge into it.");
  const keep = s.properties.find((p) => p.id === survivorId);
  const dup = s.properties.find((p) => p.id === duplicateId);
  if (!keep || !dup) throw new RepositoryError("One of those properties could not be found.", "Refresh the page and try again.");
  if (keep.mergedIntoId || dup.mergedIntoId) throw new RepositoryError("One of those properties was already merged.", "Pick two active properties.");

  const notes: string[] = [];
  const moved: Record<string, number> = { leads: 0, relationships: 0, contacts: 0, walkthroughs: 0, provenance: 0 };

  // Facts: fill gaps from the duplicate; never overwrite what the survivor knows.
  const fill = <K extends keyof Property & string>(field: K, label: string) => {
    const a = keep[field];
    const b = dup[field];
    const empty = a === null || a === "" || a === undefined;
    if (empty && b !== null && b !== "" && b !== undefined) {
      setAudited(s, m, "property", keep, field, b, null, `Filled from merged record ${dup.name}`);
      notes.push(`${label} filled in from the duplicate.`);
    } else if (!empty && b !== null && b !== "" && b !== undefined && a !== b) {
      pushAudit(s, m, { entityType: "property", entityId: keep.id, action: "merge", field, oldValue: String(b), newValue: String(a), note: `Kept this value; merged record ${dup.name} had a different ${label}` });
      notes.push(`Kept your ${label}; the duplicate said something different (saved in the change history).`);
    }
  };
  // Square footage is only filled together with how we know it.
  if (keep.sqft === null && dup.sqft !== null) {
    setAudited(s, m, "property", keep, "sqft", dup.sqft, null, `Filled from merged record ${dup.name}`);
    setAudited(s, m, "property", keep, "sqftStatus", dup.sqftStatus, null, `Filled from merged record ${dup.name}`);
    notes.push("Square footage filled in from the duplicate.");
  } else if (keep.sqft !== null && dup.sqft !== null && keep.sqft !== dup.sqft) {
    pushAudit(s, m, { entityType: "property", entityId: keep.id, action: "merge", field: "sqft", oldValue: dup.sqft, newValue: keep.sqft, note: `Kept this value; merged record ${dup.name} had a different square footage` });
    notes.push("Kept your square footage; the duplicate said something different (saved in the change history).");
  }
  fill("constructionStatus", "construction status");
  fill("lat", "latitude");
  fill("lng", "longitude");
  fill("marketId", "market");

  // Attached records move to the survivor.
  for (const l of s.leads) {
    if (l.propertyId !== dup.id) continue;
    setAudited(s, m, "lead", l, "propertyId", keep.id, l.id, `Property records merged: ${dup.name} → ${keep.name}`);
    addActivity(s, m, l.id, "merged", `Property record “${dup.name}” was merged into “${keep.name}”`);
    moved.leads += 1;
  }
  for (const w of s.walkthroughs) if (w.propertyId === dup.id) { w.propertyId = keep.id; w.updatedAt = m.now.toISOString(); moved.walkthroughs += 1; }
  for (const c of s.contacts) if (c.propertyId === dup.id) { c.propertyId = keep.id; c.updatedAt = m.now.toISOString(); moved.contacts += 1; }

  // Relationships: re-point; if the survivor already has the same company+role, keep the survivor's row and move the duplicate's provenance onto it.
  for (const r of [...s.relationships]) {
    if (r.propertyId !== dup.id) continue;
    const twin = s.relationships.find((x) => x.id !== r.id && x.propertyId === keep.id && x.companyId === r.companyId && x.role === r.role);
    if (twin) {
      for (const fp of s.provenance) if (fp.entityType === "relationship" && fp.entityId === r.id) fp.entityId = twin.id;
      s.relationships = s.relationships.filter((x) => x.id !== r.id);
      pushAudit(s, m, { entityType: "relationship", entityId: twin.id, action: "merge", note: "Identical relationship on the merged record was combined into this one" });
    } else {
      r.propertyId = keep.id;
      r.updatedAt = m.now.toISOString();
      moved.relationships += 1;
    }
  }

  for (const fp of s.provenance) {
    if (fp.entityType === "property" && fp.entityId === dup.id) { fp.entityId = keep.id; moved.provenance += 1; }
  }

  dup.mergedIntoId = keep.id;
  dup.updatedAt = m.now.toISOString();
  keep.updatedAt = m.now.toISOString();
  pushAudit(s, m, { entityType: "property", entityId: dup.id, action: "merge", field: "mergedIntoId", newValue: keep.id, note: `Merged into ${keep.name}` });
  pushAudit(s, m, { entityType: "property", entityId: keep.id, action: "merge", note: `Absorbed ${dup.name}` });
  return { survivorId: keep.id, duplicateId: dup.id, moved, notes };
}

const ADVANCEMENT: Record<string, number> = { new: 0, researching: 1, contacted: 2, interested: 3, walkthrough: 4, nurture: 1 };

export function mergeLeads(s: LeadFinderSnapshot, m: MutationContext, survivorId: string, duplicateId: string): MergeSummary {
  if (survivorId === duplicateId) throw new RepositoryError("Pick two different leads to merge.", "Choose the lead to keep and the one to merge into it.");
  const keep = s.leads.find((l) => l.id === survivorId);
  const dup = s.leads.find((l) => l.id === duplicateId);
  if (!keep || !dup) throw new RepositoryError("One of those leads could not be found.", "Refresh the page and try again.");
  if (keep.mergedIntoLeadId || dup.mergedIntoLeadId) throw new RepositoryError("One of those leads was already merged.", "Pick two active leads.");
  if (keep.propertyId !== dup.propertyId) {
    throw new RepositoryError("These leads are on different property records.", "If they are the same building, merge the two property records first.");
  }

  const notes: string[] = [];
  const moved: Record<string, number> = { signals: 0, activities: 0, followups: 0, walkthroughs: 0, sourceRecords: 0, provenance: 0 };

  for (const x of s.signals) if (x.leadId === dup.id) { x.leadId = keep.id; x.updatedAt = m.now.toISOString(); moved.signals += 1; }
  for (const x of s.activities) if (x.leadId === dup.id) { x.leadId = keep.id; moved.activities += 1; }
  for (const x of s.followups) if (x.leadId === dup.id) { x.leadId = keep.id; x.updatedAt = m.now.toISOString(); moved.followups += 1; }
  for (const x of s.walkthroughs) if (x.leadId === dup.id) { x.leadId = keep.id; x.updatedAt = m.now.toISOString(); moved.walkthroughs += 1; }
  for (const x of s.sourceRecords) if (x.importedLeadId === dup.id) { x.importedLeadId = keep.id; x.status = "duplicate"; x.updatedAt = m.now.toISOString(); moved.sourceRecords += 1; }
  for (const x of s.provenance) if (x.entityType === "lead" && x.entityId === dup.id) { x.entityId = keep.id; moved.provenance += 1; }
  for (const x of s.auditLog) if (x.leadId === dup.id) x.leadId = keep.id; // keep the change history together (rows themselves are untouched)

  // Fill gaps; never overwrite.
  const fillId = <K extends "companyId" | "primaryContactId">(field: K, label: string) => {
    if (keep[field] === null && dup[field] !== null) {
      setAudited(s, m, "lead", keep, field, dup[field], keep.id, `Filled from merged lead ${dup.title}`);
      notes.push(`${label} filled in from the duplicate.`);
    }
  };
  fillId("companyId", "Business");
  fillId("primaryContactId", "Contact");

  if (new Date(dup.discoveredAt) < new Date(keep.discoveredAt)) setAudited(s, m, "lead", keep, "discoveredAt", dup.discoveredAt, keep.id, "Kept the earliest discovery date");
  if (dup.lastVerifiedAt && (!keep.lastVerifiedAt || new Date(dup.lastVerifiedAt) > new Date(keep.lastVerifiedAt))) {
    setAudited(s, m, "lead", keep, "lastVerifiedAt", dup.lastVerifiedAt, keep.id, "Kept the most recent verification date");
    keep.lastVerifiedBy = dup.lastVerifiedBy;
  }
  if (keep.potentialValue === "unknown" && dup.potentialValue !== "unknown") {
    setAudited(s, m, "lead", keep, "potentialValue", dup.potentialValue, keep.id, `Filled from merged lead (${POTENTIAL_VALUE_LABEL[dup.potentialValue]})`);
  }
  if (dup.notes) {
    const merged = `${keep.notes ? `${keep.notes}\n\n` : ""}— From merged lead “${dup.title}”:\n${dup.notes}`;
    setAudited(s, m, "lead", keep, "notes", merged, keep.id, "Notes combined — nothing removed");
  }
  // If the duplicate was further along, say so rather than silently changing the survivor's status.
  if (dup.status !== keep.status) {
    const dupAhead = (ADVANCEMENT[dup.status] ?? -1) > (ADVANCEMENT[keep.status] ?? -1);
    pushAudit(s, m, { entityType: "lead", entityId: keep.id, leadId: keep.id, action: "merge", field: "status", oldValue: dup.status, newValue: keep.status, note: `Kept status ${PIPELINE_STATUS_LABEL[keep.status]}; merged lead was ${PIPELINE_STATUS_LABEL[dup.status]}` });
    if (dupAhead) notes.push(`The duplicate was further along (${PIPELINE_STATUS_LABEL[dup.status]}). Check this lead's status.`);
  }

  dup.mergedIntoLeadId = keep.id;
  dup.updatedAt = m.now.toISOString();
  keep.updatedAt = m.now.toISOString();
  addActivity(s, m, keep.id, "merged", `Merged duplicate lead “${dup.title}” into this lead — signals, notes, follow-ups and history were kept`);
  pushAudit(s, m, { entityType: "lead", entityId: dup.id, leadId: keep.id, action: "merge", field: "mergedIntoLeadId", newValue: keep.id, note: `Merged into ${keep.title}` });
  return { survivorId: keep.id, duplicateId: dup.id, moved, notes };
}

