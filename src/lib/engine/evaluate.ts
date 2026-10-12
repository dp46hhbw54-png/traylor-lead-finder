import { resolveScoringSettings, type ScoringSettings } from "../config/scoring-settings";
import { SIGNAL_DEFINITIONS } from "../domain/labels";
import type { FollowUp, LeadFinderSnapshot, OpportunitySignal, PipelineStatus, Walkthrough } from "../domain/types";
import { calendarDaysBetween, daysSince, formatDate } from "./dates";
import { getFreshness, lastTouchedAt, type Freshness } from "./freshness";
import { bestContact, buildLeadContexts, hasPublicBusinessContact, lastContactActivity, type LeadContext } from "./lead-context";
import { recommendAction, type RecommendedAction } from "./recommended-action";
import { scoreLead, type LeadScore } from "./scoring";

/** A fully evaluated lead: data + score + explanation + next step. */
export interface LeadView {
  ctx: LeadContext;
  score: LeadScore;
  freshness: Freshness;
  action: RecommendedAction;
  /** 3–5 short reasons this lead is worth pursuing, with the points each one earned. */
  why: WhyReason[];
  /** Time-sensitive reasons to act now. */
  whyNow: string[];
  contact: ReturnType<typeof bestContact>;
  lastContactAt: string | null;
  nextFollowUp: FollowUp | null;
  followUpState: "overdue" | "due_today" | "none";
  walkthroughToday: Walkthrough | null;
  readiness: { ready: boolean; missing: string[] };
}

const STRENGTH_ORDER = { very_strong: 0, medium: 1, weak: 2 } as const;

export interface WhyReason {
  text: string;
  points: number;
}

export function whyThisLead(score: LeadScore): WhyReason[] {
  return score.lines
    .filter((l) => l.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((l) => ({
      points: l.points,
      text:
        l.group === "property" && l.detail
          ? `${l.label} (${l.detail})`
          : l.group === "signal" && l.detail
            ? l.detail.replace(/ \((.*)\)$/, "")
            : l.key === "contact:pm" && l.detail
              ? `Property manager identified (${l.detail})`
              : l.detail && l.group === "freshness"
                ? l.detail
                : l.label,
    }));
}

/** Time-sensitive evidence. Never invents timing — only uses stored signal dates. */
export function whyNow(signals: OpportunitySignal[], now: Date): string[] {
  const out: string[] = [];
  const usable = signals.filter((s) => s.confidence !== "unknown");
  // Timing signals are reported via the "expected in ~N days" line below, so prefer a different signal here.
  const nonTiming = usable.filter((s) => !s.expectedDate);
  const ranked = [...(nonTiming.length > 0 ? nonTiming : usable)]
    .sort(
      (a, b) =>
        STRENGTH_ORDER[SIGNAL_DEFINITIONS[a.type].strength] - STRENGTH_ORDER[SIGNAL_DEFINITIONS[b.type].strength] ||
        b.discoveredAt.localeCompare(a.discoveredAt),
    );
  const top = ranked[0];
  if (top) {
    const age = daysSince(top.discoveredAt, now);
    const when = age <= 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`;
    out.push(`${SIGNAL_DEFINITIONS[top.type].label} — reported ${when}.`);
  }
  const upcoming = signals
    .filter((s) => s.expectedDate && s.confidence !== "unknown")
    .map((s) => ({ s, days: calendarDaysBetween(now, new Date(s.expectedDate!)) }))
    .filter(({ days }) => days >= 0 && days <= 120)
    .sort((a, b) => a.days - b.days)[0];
  if (upcoming) {
    out.push(`Occupancy/opening expected in ~${upcoming.days} days (${formatDate(upcoming.s.expectedDate!)}).`);
  }
  if (out.length === 0) out.push("No time-sensitive signal yet — research needed.");
  return out;
}

export function evaluateLead(ctx: LeadContext, now: Date, settings: ScoringSettings = resolveScoringSettings(undefined)): LeadView {
  const score = scoreLead(ctx, now, settings);
  const nextFollowUp = ctx.openFollowups[0] ?? null;
  const fuDiff = nextFollowUp ? calendarDaysBetween(now, new Date(nextFollowUp.dueAt)) : null;
  const followUpState = fuDiff === null ? "none" : fuDiff < 0 ? "overdue" : fuDiff === 0 ? "due_today" : "none";
  const walkthroughToday =
    ctx.walkthroughs.find((w) => !w.completedAt && calendarDaysBetween(now, new Date(w.scheduledAt)) === 0) ?? null;
  const contact = bestContact(ctx);
  const action = recommendAction(ctx, now);

  const missing: string[] = [];
  if (!ctx.property.name && !ctx.company?.name) missing.push("Business/property name");
  if (!ctx.property.city) missing.push("Location");
  if (!ctx.property.facilityType) missing.push("Facility type");
  if (ctx.signals.length === 0) missing.push("Opportunity signal");
  // A source is required; a URL/reference only "when available" — never a reason to block a lead.
  if (!ctx.source) missing.push("Source");

  return {
    ctx,
    score,
    freshness: getFreshness(ctx.lead, now),
    action,
    why: whyThisLead(score),
    whyNow: whyNow(ctx.signals, now),
    contact,
    lastContactAt: lastContactActivity(ctx)?.occurredAt ?? null,
    nextFollowUp,
    followUpState,
    walkthroughToday,
    readiness: { ready: missing.length === 0, missing },
  };
}

export function evaluateAll(snapshot: LeadFinderSnapshot, now: Date, settings: ScoringSettings = resolveScoringSettings(snapshot.settings)): LeadView[] {
  return buildLeadContexts(snapshot).map((ctx) => evaluateLead(ctx, now, settings));
}

// ---------------------------------------------------------------------------
// TODAY RANKING
// ---------------------------------------------------------------------------

export type TodayGroup = "overdue" | "due_today" | "walkthrough_today" | "quote_needed" | "ranked";

export interface PriorityPart {
  label: string;
  points: number;
}

export interface TodayItem {
  view: LeadView;
  rank: number;
  group: TodayGroup;
  /** Ranking priority. Intentionally NOT clamped so ties at a score of 100 still order correctly. */
  priority: number;
  priorityParts: PriorityPart[];
  rankNote: string;
  /** Days until the soonest expected opening/occupancy date from a usable signal; null if none is stored. */
  urgencyDays: number | null;
}

export interface TodaySummary {
  overdueFollowUps: number;
  followUpsDueToday: number;
  walkthroughsToday: number;
  hotNotContacted: number;
  statusCounts: Record<PipelineStatus, number>;
  openFollowUps: number;
  readyToPursue: number;
  totalLeads: number;
  snoozed: number;
  notAFit: number;
}

export interface TodayResult {
  items: TodayItem[];
  summary: TodaySummary;
  /** Active leads that didn't make the top list. */
  remaining: number;
}

/** Opportunity urgency: how soon is the soonest dated event (opening, occupancy) that a usable signal points to? */
export function urgencyDays(signals: OpportunitySignal[], now: Date, horizonDays = 120): number | null {
  let best: number | null = null;
  for (const sig of signals) {
    if (!sig.expectedDate || sig.confidence === "unknown") continue;
    const d = calendarDaysBetween(now, new Date(sig.expectedDate));
    if (d >= 0 && d <= horizonDays && (best === null || d < best)) best = d;
  }
  return best;
}

const GROUP_ORDER: Record<TodayGroup, number> = { overdue: 0, due_today: 1, walkthrough_today: 2, quote_needed: 3, ranked: 4 };
/** These are never pushed off Today by the list size — someone owes the prospect a next step. */
const PINNED: TodayGroup[] = ["overdue", "due_today", "walkthrough_today", "quote_needed"];

/**
 * A walkthrough is done but the quote step hasn't happened yet: either the outcome isn't recorded,
 * or the prospect is ready for a quote and "Quote requested" hasn't been logged.
 * Stays on Today until Quote requested / Won / Lost / Not a Fit / Nurture.
 */
export function needsQuoteStep(view: LeadView): boolean {
  if (view.ctx.lead.status === "nurture") return false;
  return view.action.kind === "record_outcome" || view.action.kind === "request_quote";
}
const INACTIVE: PipelineStatus[] = ["won", "lost", "not_a_fit"];
const PENALIZABLE: PipelineStatus[] = ["new", "researching", "contacted"];

export function isSnoozed(view: LeadView, now: Date): boolean {
  const until = view.ctx.lead.snoozedUntil;
  return Boolean(until && new Date(until) > now);
}

/**
 * Who should we call today?
 *   1. Overdue follow-ups, then follow-ups due today, then walkthroughs today.
 *   2. Everyone else by priority = score + recently-verified bonus − recent-contact penalty.
 * Excludes Won / Lost / Not a Fit and snoozed leads. Nurture leads appear only when a follow-up is due.
 */
export function buildToday(
  snapshot: LeadFinderSnapshot,
  now: Date,
  settings: ScoringSettings = resolveScoringSettings(snapshot.settings),
): TodayResult {
  const views = evaluateAll(snapshot, now, settings);
  const r = settings.ranking;

  const candidates: TodayItem[] = [];
  for (const view of views) {
    const { lead } = view.ctx;
    if (INACTIVE.includes(lead.status) || isSnoozed(view, now)) continue;

    let group: TodayGroup = "ranked";
    if (view.followUpState === "overdue") group = "overdue";
    else if (view.followUpState === "due_today") group = "due_today";
    else if (view.walkthroughToday) group = "walkthrough_today";
    else if (needsQuoteStep(view)) group = "quote_needed";
    if (lead.status === "nurture" && group === "ranked") continue;

    const parts: PriorityPart[] = [{ label: "Opportunity score", points: view.score.score }];
    if (daysSince(lastTouchedAt(lead), now) <= r.recentlyVerifiedDays) {
      parts.push({ label: `Found/verified in last ${r.recentlyVerifiedDays} days`, points: r.recentlyVerifiedBonus });
    }
    // Interested / walkthrough leads are never pushed down — they need a next step, not a rest.
    if (
      group === "ranked" &&
      PENALIZABLE.includes(lead.status) &&
      view.lastContactAt &&
      daysSince(view.lastContactAt, now) <= r.recentContactDays
    ) {
      parts.push({ label: `Contacted in last ${r.recentContactDays} days`, points: -r.recentContactPenalty });
    }
    const priority = parts.reduce((s, p) => s + p.points, 0);

    let rankNote: string;
    if (group === "overdue") {
      const d = -calendarDaysBetween(now, new Date(view.nextFollowUp!.dueAt));
      rankNote = `Follow-up overdue by ${d} day${d === 1 ? "" : "s"}`;
    } else if (group === "due_today") rankNote = "Follow-up due today";
    else if (group === "walkthrough_today") rankNote = "Walkthrough today";
    else if (group === "quote_needed") rankNote = view.action.kind === "request_quote" ? "Ready for a quote" : "Walkthrough done — record the outcome";
    else rankNote = `Priority ${priority}`;

    candidates.push({ view, rank: 0, group, priority, priorityParts: parts, rankNote, urgencyDays: urgencyDays(view.ctx.signals, now) });
  }

  // Order: overdue → due today → walkthrough today → priority, then (only to break ties):
  // urgency → raw score → displayed score → contactability → freshness → recent activity → age → id.
  candidates.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      (a.group === "overdue" ? a.view.nextFollowUp!.dueAt.localeCompare(b.view.nextFollowUp!.dueAt) : 0) ||
      b.priority - a.priority ||
      (a.urgencyDays ?? Infinity) - (b.urgencyDays ?? Infinity) ||
      b.view.score.raw - a.view.score.raw ||
      b.view.score.score - a.view.score.score ||
      Number(hasPublicBusinessContact(b.view.ctx)) - Number(hasPublicBusinessContact(a.view.ctx)) ||
      lastTouchedAt(b.view.ctx.lead).localeCompare(lastTouchedAt(a.view.ctx.lead)) ||
      (b.view.ctx.activities[0]?.occurredAt ?? "").localeCompare(a.view.ctx.activities[0]?.occurredAt ?? "") ||
      b.view.ctx.lead.discoveredAt.localeCompare(a.view.ctx.lead.discoveredAt) ||
      a.view.ctx.lead.id.localeCompare(b.view.ctx.lead.id),
  );

  // Pinned items are always shown (the list grows rather than hiding them); the rest fill up to the list size.
  const pinnedCount = candidates.filter((c) => PINNED.includes(c.group)).length;
  const items = candidates.slice(0, Math.max(r.todayListSize, pinnedCount)).map((item, i) => ({ ...item, rank: i + 1 }));

  const statusCounts = Object.fromEntries(
    (["new", "researching", "contacted", "interested", "walkthrough", "won", "lost", "nurture", "not_a_fit"] as PipelineStatus[]).map((s) => [s, 0]),
  ) as Record<PipelineStatus, number>;
  for (const v of views) statusCounts[v.ctx.lead.status] += 1;

  const active = views.filter((v) => !INACTIVE.includes(v.ctx.lead.status));
  const summary: TodaySummary = {
    overdueFollowUps: snapshot.followups.filter((f) => !f.completedAt && calendarDaysBetween(now, new Date(f.dueAt)) < 0).length,
    followUpsDueToday: snapshot.followups.filter((f) => !f.completedAt && calendarDaysBetween(now, new Date(f.dueAt)) === 0).length,
    walkthroughsToday: snapshot.walkthroughs.filter((w) => !w.completedAt && calendarDaysBetween(now, new Date(w.scheduledAt)) === 0).length,
    hotNotContacted: active.filter((v) => v.score.tier === "hot" && !v.lastContactAt && !isSnoozed(v, now)).length,
    statusCounts,
    openFollowUps: snapshot.followups.filter((f) => !f.completedAt).length,
    readyToPursue: active.filter((v) => v.readiness.ready).length,
    totalLeads: views.length,
    snoozed: views.filter((v) => isSnoozed(v, now) && !INACTIVE.includes(v.ctx.lead.status)).length,
    notAFit: statusCounts.not_a_fit,
  };

  return { items, summary, remaining: Math.max(0, candidates.length - items.length) };
}
