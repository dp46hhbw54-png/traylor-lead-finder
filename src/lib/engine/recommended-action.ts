import { CONTACT_METHOD_LABEL } from "../domain/labels";
import { calendarDaysBetween, daysSince, formatDate, formatDateTime } from "./dates";
import { lastTouchedAt } from "./freshness";
import { bestContact, hasPublicBusinessContact, lastContactActivity, type LeadContext } from "./lead-context";

/**
 * RULE-BASED recommended next action. Not AI.
 * All rules live in this one file so they are easy to read and adjust.
 * Rules are evaluated top to bottom; the first match wins.
 */

export type ActionKind =
  | "record_lost_reason"
  | "customer"
  | "record_outcome"
  | "request_quote"
  | "prepare_walkthrough"
  | "schedule_walkthrough"
  | "follow_up"
  | "verify"
  | "research_pm"
  | "find_contact"
  | "call"
  | "email"
  | "schedule_follow_up"
  | "review";

export interface RecommendedAction {
  kind: ActionKind;
  label: string;
  /** Why this action was chosen — shown under the action. */
  reason: string;
}

const STALE_AFTER_DAYS = 90;

export function recommendAction(ctx: LeadContext, now: Date): RecommendedAction {
  const { lead } = ctx;
  const contact = bestContact(ctx);
  const who = contact.name ? `${contact.name}${contact.role ? ` (${contact.role})` : ""}` : contact.organization ?? "the business";

  if (lead.status === "lost") {
    return { kind: "record_lost_reason", label: "Record lost reason / optionally nurture", reason: lead.lostReason ? `Lost: ${lead.lostReason}` : "Lost reason not recorded yet" };
  }
  if (lead.status === "won") {
    return { kind: "customer", label: "Won — hand off to onboarding", reason: "This lead became a customer" };
  }

  const completedWithoutOutcome = ctx.walkthroughs.find((w) => w.completedAt && !w.outcome);
  if (completedWithoutOutcome) {
    return { kind: "record_outcome", label: "Record walkthrough outcome / prepare for bid", reason: `Walkthrough completed ${formatDate(completedWithoutOutcome.completedAt!)}` };
  }

  // Walkthrough went well and the prospect wants a price → record "Quote requested" (quoting itself is a separate system).
  const readyForQuote = ctx.walkthroughs.find((w) => w.completedAt && w.outcome === "send_to_bid");
  if (readyForQuote && !ctx.activities.some((a) => a.type === "quote_requested")) {
    return { kind: "request_quote", label: "Record “Quote requested”", reason: `Walkthrough on ${formatDate(readyForQuote.completedAt!)} — ready for a quote` };
  }

  const upcomingWalkthrough = ctx.walkthroughs.find((w) => !w.completedAt && new Date(w.scheduledAt) >= startOfToday(now));
  if (upcomingWalkthrough) {
    const isToday = calendarDaysBetween(now, new Date(upcomingWalkthrough.scheduledAt)) === 0;
    return {
      kind: "prepare_walkthrough",
      label: isToday ? "Walkthrough today — confirm and attend" : "Prepare for walkthrough",
      reason: `Walkthrough scheduled ${formatDateTime(upcomingWalkthrough.scheduledAt)}`,
    };
  }

  if (lead.status === "interested") {
    return { kind: "schedule_walkthrough", label: "Schedule walkthrough", reason: "Prospect said they're interested" };
  }

  const dueFollowUp = ctx.openFollowups.find((f) => calendarDaysBetween(now, new Date(f.dueAt)) <= 0);
  if (dueFollowUp) {
    const diff = calendarDaysBetween(now, new Date(dueFollowUp.dueAt));
    return {
      kind: "follow_up",
      label: `Follow up — ${CONTACT_METHOD_LABEL[dueFollowUp.method].toLowerCase()} ${who}`,
      reason: diff < 0 ? `Follow-up overdue by ${-diff} day${diff === -1 ? "" : "s"}` : "Follow-up due today",
    };
  }

  if (daysSince(lastTouchedAt(lead), now) > STALE_AFTER_DAYS) {
    return { kind: "verify", label: "Re-verify information", reason: `Last verified more than ${STALE_AFTER_DAYS} days ago` };
  }

  const hasContactInfo = hasPublicBusinessContact(ctx);
  if (!ctx.propertyManager && !hasContactInfo) {
    return { kind: "research_pm", label: "Research property manager", reason: "No property manager or public contact identified yet" };
  }
  if (!hasContactInfo) {
    return { kind: "find_contact", label: "Find public contact information", reason: `${ctx.propertyManager?.name ?? "Manager"} identified, but no public phone or email yet` };
  }

  const lastContact = lastContactActivity(ctx);
  if (!lastContact) {
    if (contact.phone) return { kind: "call", label: `Call ${who}`, reason: "Never contacted" };
    return { kind: "email", label: `Email ${who}`, reason: "Never contacted — no public phone" };
  }

  if (ctx.openFollowups.length === 0) {
    return { kind: "schedule_follow_up", label: "Schedule next follow-up", reason: `Last contacted ${formatDate(lastContact.occurredAt)}; nothing scheduled` };
  }

  return { kind: "review", label: "Wait for scheduled follow-up", reason: `Next follow-up ${formatDate(ctx.openFollowups[0].dueAt)}` };
}

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
