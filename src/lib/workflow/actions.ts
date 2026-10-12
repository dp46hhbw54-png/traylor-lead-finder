import { LOST_REASON_LABEL, PIPELINE_STATUS_LABEL, POTENTIAL_VALUE_LABEL, WALKTHROUGH_OUTCOME_LABEL } from "../domain/labels";
import { RepositoryError } from "../domain/errors";
import type {
  Activity,
  ActivityType,
  ContactMethod,
  FollowUp,
  Lead,
  LeadFinderSnapshot,
  LostReasonCode,
  PipelineStatus,
  PotentialValue,
  Walkthrough,
  WalkthroughOutcome,
} from "../domain/types";
import { pushAudit, setAudited, type MutationContext } from "./context";

/**
 * Every sales action, as a plain function on a snapshot.
 *
 * These are the business rules ("a call moves a New lead to Contacted", "every status change is audited").
 * They contain no storage code, so the local demo repository and the future Supabase repository
 * run exactly the same rules.
 */

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CLOSED: PipelineStatus[] = ["won", "lost", "not_a_fit"];

export function getLead(s: LeadFinderSnapshot, id: string): Lead {
  const lead = s.leads.find((l) => l.id === id);
  if (!lead) throw new RepositoryError("That lead could not be found.", "Refresh the page. If it keeps happening, reset the demo data in Settings.");
  return lead;
}

export function addActivity(
  s: LeadFinderSnapshot,
  m: MutationContext,
  leadId: string,
  type: ActivityType,
  summary: string,
  outcome: string | null = null,
): Activity {
  const activity: Activity = { id: m.newId("act"), leadId, type, summary, outcome, occurredAt: m.now.toISOString(), performedBy: m.by };
  s.activities.push(activity);
  return activity;
}

/** Move a lead to a new status. Always leaves a timeline entry AND an audit row. */
export function changeStatus(s: LeadFinderSnapshot, m: MutationContext, lead: Lead, status: PipelineStatus, note?: string): void {
  if (lead.status === status) return;
  const from = lead.status;
  addActivity(s, m, lead.id, "status_change", `Status: ${PIPELINE_STATUS_LABEL[from]} → ${PIPELINE_STATUS_LABEL[status]}${note ? ` — ${note}` : ""}`);
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "status_change", field: "status", oldValue: from, newValue: status, note: note ?? null });
  lead.status = status;
  lead.updatedAt = m.now.toISOString();
  // Closing a lead stamps the time (used later to learn how long deals take); reopening clears it.
  const closedAt = CLOSED.includes(status) ? m.now.toISOString() : null;
  if (lead.closedAt !== closedAt) lead.closedAt = closedAt;
}

export function logActivity(
  s: LeadFinderSnapshot,
  m: MutationContext,
  input: { leadId: string; type: ActivityType; summary: string; outcome?: string | null },
): Activity {
  const lead = getLead(s, input.leadId);
  const activity = addActivity(s, m, lead.id, input.type, input.summary, input.outcome ?? null);
  const isOutreach = input.type === "call" || input.type === "email" || input.type === "text";
  // Reaching out moves early-stage leads to Contacted.
  if (isOutreach && (lead.status === "new" || lead.status === "researching")) changeStatus(s, m, lead, "contacted");
  // Contacting someone about a due follow-up completes it.
  if (isOutreach) {
    const endOfToday = new Date(m.now);
    endOfToday.setHours(23, 59, 59, 999);
    for (const f of s.followups) {
      if (f.leadId === lead.id && !f.completedAt && new Date(f.dueAt) <= endOfToday) completeFollowUpRow(s, m, f, `Completed by logging a ${input.type}`);
    }
  }
  return activity;
}

function completeFollowUpRow(s: LeadFinderSnapshot, m: MutationContext, f: FollowUp, note: string | null): void {
  f.completedAt = m.now.toISOString();
  f.completedBy = m.by;
  f.completionNote = note;
  f.updatedAt = m.now.toISOString();
  addActivity(s, m, f.leadId, "followup_completed", "Follow-up completed");
  pushAudit(s, m, { entityType: "followup", entityId: f.id, leadId: f.leadId, action: "update", field: "completedAt", oldValue: null, newValue: f.completedAt });
}

export function completeFollowUp(s: LeadFinderSnapshot, m: MutationContext, followUpId: string, note?: string): FollowUp {
  const f = s.followups.find((x) => x.id === followUpId);
  if (!f) throw new RepositoryError("That follow-up could not be found.", "Refresh the page and try again.");
  if (f.completedAt) throw new RepositoryError("That follow-up is already completed.", "Nothing to do — it's done.");
  completeFollowUpRow(s, m, f, note?.trim() || null);
  return f;
}

export function scheduleFollowUp(
  s: LeadFinderSnapshot,
  m: MutationContext,
  input: { leadId: string; contactId: string | null; dueAt: string; method: ContactMethod; notes: string },
): FollowUp {
  const lead = getLead(s, input.leadId);
  if (Number.isNaN(new Date(input.dueAt).getTime())) throw new RepositoryError("That follow-up date isn't valid.", "Pick a date and time.");
  const ts = m.now.toISOString();
  const fu: FollowUp = {
    id: m.newId("fu"), leadId: lead.id, contactId: input.contactId, dueAt: input.dueAt, method: input.method, notes: input.notes,
    completedAt: null, completedBy: null, completionNote: null, createdAt: ts, updatedAt: ts,
  };
  s.followups.push(fu);
  addActivity(s, m, lead.id, "followup_scheduled", `Follow-up scheduled (${input.method}) for ${when(input.dueAt)}`);
  pushAudit(s, m, { entityType: "followup", entityId: fu.id, leadId: lead.id, action: "create", note: `${input.method} on ${when(input.dueAt)}` });
  return fu;
}

export function scheduleWalkthrough(
  s: LeadFinderSnapshot,
  m: MutationContext,
  input: { leadId: string; contactId: string | null; scheduledAt: string; attendees: string; notes: string },
): Walkthrough {
  const lead = getLead(s, input.leadId);
  if (Number.isNaN(new Date(input.scheduledAt).getTime())) throw new RepositoryError("That walkthrough date isn't valid.", "Pick a date and time.");
  const ts = m.now.toISOString();
  const wt: Walkthrough = {
    id: m.newId("wt"), leadId: lead.id, propertyId: lead.propertyId, contactId: input.contactId, scheduledAt: input.scheduledAt,
    attendees: input.attendees, notes: input.notes, outcome: null, nextAction: null, completedAt: null, createdAt: ts, updatedAt: ts,
  };
  s.walkthroughs.push(wt);
  addActivity(s, m, lead.id, "walkthrough_scheduled", `Walkthrough scheduled for ${when(input.scheduledAt)}`);
  pushAudit(s, m, { entityType: "walkthrough", entityId: wt.id, leadId: lead.id, action: "create", note: when(input.scheduledAt) });
  changeStatus(s, m, lead, "walkthrough");
  return wt;
}

export function completeWalkthrough(
  s: LeadFinderSnapshot,
  m: MutationContext,
  input: { walkthroughId: string; outcome: WalkthroughOutcome; nextAction?: string | null; notes?: string | null },
): Walkthrough {
  const wt = s.walkthroughs.find((w) => w.id === input.walkthroughId);
  if (!wt) throw new RepositoryError("That walkthrough could not be found.", "Refresh the page and try again.");
  const lead = getLead(s, wt.leadId);
  const firstTime = !wt.completedAt;
  if (firstTime) wt.completedAt = m.now.toISOString();
  wt.outcome = input.outcome;
  wt.nextAction = input.nextAction?.trim() || null;
  if (input.notes?.trim()) wt.notes = wt.notes ? `${wt.notes}\n${input.notes.trim()}` : input.notes.trim();
  wt.updatedAt = m.now.toISOString();
  addActivity(
    s, m, lead.id, "walkthrough_completed",
    `Walkthrough ${firstTime ? "completed" : "outcome recorded"}: ${WALKTHROUGH_OUTCOME_LABEL[input.outcome]}${wt.nextAction ? ` — next: ${wt.nextAction}` : ""}`,
    input.outcome,
  );
  pushAudit(s, m, { entityType: "walkthrough", entityId: wt.id, leadId: lead.id, action: "update", field: "outcome", oldValue: null, newValue: input.outcome });
  return wt;
}

export function setStatus(s: LeadFinderSnapshot, m: MutationContext, leadId: string, status: PipelineStatus, note?: string): void {
  const lead = getLead(s, leadId);
  if (status === "lost") throw new RepositoryError("Choose why the lead was lost.", "Use “Lost” with a reason so we can learn from it.");
  if (status === "not_a_fit") throw new RepositoryError("Tell us why this isn't a fit.", "Use “Not a Fit” with a reason so we can learn what to skip.");
  changeStatus(s, m, lead, status, note);
}

export function markWon(s: LeadFinderSnapshot, m: MutationContext, leadId: string, note?: string): void {
  const lead = getLead(s, leadId);
  changeStatus(s, m, lead, "won", note);
}

export function markLost(s: LeadFinderSnapshot, m: MutationContext, leadId: string, code: LostReasonCode, note?: string): void {
  const lead = getLead(s, leadId);
  if (!(code in LOST_REASON_LABEL)) throw new RepositoryError("That isn't a known lost reason.", "Pick one of the listed reasons.");
  const text = note?.trim() ? `${LOST_REASON_LABEL[code]} — ${note.trim()}` : LOST_REASON_LABEL[code];
  setAudited(s, m, "lead", lead, "lostReasonCode", code, lead.id);
  setAudited(s, m, "lead", lead, "lostReason", text, lead.id);
  changeStatus(s, m, lead, "lost", LOST_REASON_LABEL[code]);
}

export function snooze(s: LeadFinderSnapshot, m: MutationContext, leadId: string, until: string): void {
  const lead = getLead(s, leadId);
  const old = lead.snoozedUntil;
  lead.snoozedUntil = until;
  lead.updatedAt = m.now.toISOString();
  addActivity(s, m, lead.id, "snoozed", `Snoozed until ${new Date(until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "update", field: "snoozedUntil", oldValue: old, newValue: until });
}

export function unsnooze(s: LeadFinderSnapshot, m: MutationContext, leadId: string): void {
  const lead = getLead(s, leadId);
  const old = lead.snoozedUntil;
  lead.snoozedUntil = null;
  lead.updatedAt = m.now.toISOString();
  addActivity(s, m, lead.id, "unsnoozed", "Snooze removed");
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "update", field: "snoozedUntil", oldValue: old, newValue: null });
}

export function markNotAFit(s: LeadFinderSnapshot, m: MutationContext, leadId: string, reason: string): void {
  const lead = getLead(s, leadId);
  if (!reason.trim()) throw new RepositoryError("Tell us why this isn't a fit.", "Pick a reason so we can learn what to skip.");
  setAudited(s, m, "lead", lead, "notAFitReason", reason.trim(), lead.id);
  addActivity(s, m, lead.id, "not_a_fit", `Marked Not a Fit — ${reason.trim()}`);
  changeStatus(s, m, lead, "not_a_fit");
}

/** Undo for Not a Fit / Lost / status changes: puts the lead back and clears the reasons that went with the change. */
export function restoreStatus(s: LeadFinderSnapshot, m: MutationContext, leadId: string, status: PipelineStatus): void {
  const lead = getLead(s, leadId);
  lead.notAFitReason = null;
  lead.lostReason = null;
  lead.lostReasonCode = null;
  changeStatus(s, m, lead, status);
  addActivity(s, m, lead.id, "restored", "Restored (undo)");
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "restore", field: "status", newValue: status });
}

export function requestQuote(s: LeadFinderSnapshot, m: MutationContext, leadId: string): void {
  const lead = getLead(s, leadId);
  addActivity(s, m, lead.id, "quote_requested", "Quote requested — quoting is a separate future system");
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "update", field: "quoteRequested", newValue: "yes" });
}

export function setPotentialValue(s: LeadFinderSnapshot, m: MutationContext, leadId: string, value: PotentialValue): void {
  const lead = getLead(s, leadId);
  if (!(value in POTENTIAL_VALUE_LABEL)) throw new RepositoryError("That isn't a valid potential value.", "Pick one from the list.");
  setAudited(s, m, "lead", lead, "potentialValue", value, lead.id);
}

/** "I checked and this is still accurate." Resets the freshness clock. */
export function markVerified(s: LeadFinderSnapshot, m: MutationContext, leadId: string, note?: string): void {
  const lead = getLead(s, leadId);
  const old = lead.lastVerifiedAt;
  lead.lastVerifiedAt = m.now.toISOString();
  lead.lastVerifiedBy = m.by;
  lead.updatedAt = m.now.toISOString();
  addActivity(s, m, lead.id, "verified", note?.trim() ? `Re-verified — ${note.trim()}` : "Re-verified");
  pushAudit(s, m, { entityType: "lead", entityId: lead.id, leadId: lead.id, action: "update", field: "lastVerifiedAt", oldValue: old, newValue: lead.lastVerifiedAt });
}
