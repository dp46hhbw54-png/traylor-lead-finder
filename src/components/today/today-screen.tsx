"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { LuCalendarCheck, LuCircleCheck, LuFlame, LuInfo, LuSearch, LuTriangleAlert, LuListTodo } from "react-icons/lu";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingCards } from "@/components/ui/states";
import { resolveScoringSettings, type ScoringSettings } from "@/lib/config/scoring-settings";
import { buildToday, type LeadView, type TodaySummary } from "@/lib/engine/evaluate";
import { useLeadFinder } from "@/state/lead-finder-store";
import { LeadActionDialog, type ActionMode } from "./action-dialogs";
import { OpportunityCard } from "./opportunity-card";

/** One slim line — only what needs attention today. Zero counts are not shown. */
function AttentionLine({ summary }: { summary: TodaySummary }) {
  const items = [
    { n: summary.overdueFollowUps, one: "overdue follow-up", many: "overdue follow-ups", tone: "bg-red-100 text-red-800" },
    { n: summary.followUpsDueToday, one: "follow-up due today", many: "follow-ups due today", tone: "bg-amber-100 text-amber-900" },
    { n: summary.walkthroughsToday, one: "walkthrough today", many: "walkthroughs today", tone: "bg-violet-100 text-violet-800" },
    { n: summary.hotNotContacted, one: "hot lead not yet contacted", many: "hot leads not yet contacted", tone: "bg-brand-50 text-brand-800" },
  ].filter((i) => i.n > 0);
  if (items.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-2 text-sm font-medium" aria-label="Needs attention today">
      {items.map((i) => (
        <span key={i.one} className={clsx("rounded-full px-3 py-1", i.tone)}>
          {i.n} {i.n === 1 ? i.one : i.many}
        </span>
      ))}
    </p>
  );
}

function RankingExplainer({ rules }: { rules: ScoringSettings }) {
  const r = rules.ranking;
  return (
    <details id="how-ranked" className="group rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-800">
        <LuInfo className="h-4 w-4 text-slate-500" /> How is this list ranked?
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li>
          <strong>Overdue follow-ups</strong>, then <strong>follow-ups due today</strong>, then <strong>walkthroughs today</strong> — always on top.
        </li>
        <li>
          Everyone else by <strong>priority = opportunity score + {r.recentlyVerifiedBonus} if found/verified in the last {r.recentlyVerifiedDays} days − {r.recentContactPenalty} if contacted in the last {r.recentContactDays} days</strong> (no follow-up due yet).
        </li>
        <li>
          The <strong>opportunity score</strong> (0–100) adds points for signals, size, contactability and freshness. Tap “Show score breakdown” on any card to see every point.
        </li>
        <li>
          If two leads tie, the one with the <strong>sooner opening or occupancy date</strong> goes first, then the higher raw score, a way to reach them, fresher information, and more recent activity.
        </li>
        <li>Won, Lost, Not a Fit and snoozed leads are hidden. Nurture leads only appear when a follow-up is due.</li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">Rules are deterministic — no AI decides the ranking.</p>
    </details>
  );
}

export function TodayScreen() {
  const { state, snapshot, now, reload } = useLeadFinder();
  const [dialog, setDialog] = useState<{ mode: ActionMode; view: LeadView } | null>(null);

  const today = useMemo(() => (snapshot ? buildToday(snapshot, now) : null), [snapshot, now]);
  const rules = useMemo(() => resolveScoringSettings(snapshot?.settings), [snapshot]);
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium text-slate-500">{dateLabel}</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">Who should we call today?</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          The top {rules.ranking.todayListSize} commercial opportunities for Traylor Pro — ranked by opportunity, timing, fit, contactability, evidence and freshness.{" "}
          <button
            type="button"
            className="font-medium text-brand-700 hover:underline"
            onClick={() => {
              const el = document.getElementById("how-ranked") as HTMLDetailsElement | null;
              if (!el) return;
              el.open = true;
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            How ranking works
          </button>
        </p>
      </header>

      {state.status === "loading" && <LoadingCards />}

      {state.status === "error" && <ErrorState title="Couldn't load today's list" message={state.message} nextStep={state.nextStep} onRetry={() => void reload()} />}

      {state.status === "ready" && today && (
        <>
          <AttentionLine summary={today.summary} />

          {today.items.length === 0 ? (
            today.summary.totalLeads === 0 ? (
              <EmptyState
                icon={<LuSearch className="h-6 w-6" />}
                title="No leads yet"
                description="Add leads by hand or import a CSV in the Lead Finder (Phase 5). For this demo you can reload the fictional records from Settings."
                action={
                  <Link href="/settings" className={buttonClass("primary")}>
                    Go to Settings
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<LuCircleCheck className="h-6 w-6" />}
                title="You're all caught up"
                description={
                  <>
                    Nothing needs a call right now.
                    {today.summary.snoozed > 0 && ` ${today.summary.snoozed} lead${today.summary.snoozed === 1 ? " is" : "s are"} snoozed and will come back automatically.`}
                  </>
                }
                action={
                  <Link href="/leads" className={buttonClass("secondary")}>
                    Review all leads
                  </Link>
                }
              />
            )
          ) : (
            <section aria-label="Today's opportunities" className="space-y-4">
              {today.items.map((item) => (
                <OpportunityCard key={item.view.ctx.lead.id} item={item} onAction={(mode) => setDialog({ mode, view: item.view })} />
              ))}
            </section>
          )}

          <RankingExplainer rules={rules} />

          <p className="text-center text-xs text-slate-500">
            {today.remaining > 0 && `${today.remaining} more active lead${today.remaining === 1 ? "" : "s"} not shown · `}
            {today.summary.snoozed} snoozed · {today.summary.notAFit} marked Not a Fit ·{" "}
            <Link href="/leads" className="font-medium text-brand-700 hover:underline">
              See all leads
            </Link>
          </p>
        </>
      )}

      <LeadActionDialog mode={dialog?.mode ?? null} view={dialog?.view ?? null} onClose={() => setDialog(null)} />
    </div>
  );
}
