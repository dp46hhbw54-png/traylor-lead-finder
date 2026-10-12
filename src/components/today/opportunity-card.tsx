"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import {
  LuArrowRight,
  LuCalendarCheck,
  LuChevronDown,
  LuClock,
  LuGlobe,
  LuHourglass,
  LuMail,
  LuPhone,
  LuTarget,
  LuUser,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { DataStatusTag, DemoTag, PotentialValueTag, ScoreBadge, SignalChip, StatusPill } from "@/components/ui/badges";
import { CONTACT_METHOD_LABEL, FACILITY_TYPE_LABEL } from "@/lib/domain/labels";
import { formatDate, formatDateTime, relativeDays } from "@/lib/engine/dates";
import type { TodayItem } from "@/lib/engine/evaluate";
import { useLeadFinder } from "@/state/lead-finder-store";
import type { ActionMode } from "./action-dialogs";
import { ScoreBreakdown } from "./score-breakdown";
import { PrimaryActionButton, SecondaryActions } from "@/components/leads/lead-actions";

const GROUP_CHIP: Record<TodayItem["group"], string | null> = {
  overdue: "bg-red-100 text-red-800",
  due_today: "bg-amber-100 text-amber-900",
  walkthrough_today: "bg-violet-100 text-violet-800",
  quote_needed: "bg-emerald-100 text-emerald-800",
  ranked: null,
};

export function OpportunityCard({ item, onAction }: { item: TodayItem; onAction: (mode: ActionMode) => void }) {
  const { view } = item;
  const { ctx, score, freshness, action, contact } = view;
  const { property, company, lead } = ctx;
  const [details, setDetails] = useState(false);
  const [history, setHistory] = useState(false);
  const { now } = useLeadFinder();
  const chip = GROUP_CHIP[item.group];
  const headline = company?.name ?? property.name;

  const hasContact = Boolean(contact.name || contact.organization);

  return (
    <article data-lead-id={lead.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby={`lead-${lead.id}-title`}>
      <div className="p-4 sm:p-5">
        {/* LEVEL 1 — who · where · opportunity · how good · potential */}
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white" aria-label={`Rank ${item.rank}`}>
            {item.rank}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {chip && <span className={clsx("rounded-full px-2 py-0.5 font-semibold", chip)}>{item.rankNote}</span>}
              <StatusPill status={lead.status} />
              {lead.potentialValue !== "unknown" && <PotentialValueTag value={lead.potentialValue} />}
              {lead.isDemo && <DemoTag />}
            </div>
            <h3 id={`lead-${lead.id}-title`} className="mt-1 text-lg font-bold leading-snug text-slate-900">
              {headline}
            </h3>
            <p className="text-sm text-slate-600">
              {company && company.name !== property.name ? `${property.name} · ` : ""}
              {property.city}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">{lead.title}</p>
          </div>
          <ScoreBadge score={score.score} tier={score.tier} />
        </div>

        {/* Why now */}
        {view.whyNow.length > 0 && (
          <section className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-100">
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              <LuHourglass className="h-3.5 w-3.5" /> Why now
            </h4>
            <ul className="space-y-1 text-sm text-amber-950">
              {view.whyNow.slice(0, 2).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Who to contact (one line; phone/email are one tap) */}
        <section className="mt-3 text-sm">
          <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <LuUser className="h-3.5 w-3.5" /> Who to contact
          </h4>
          {hasContact ? (
            <p className="text-slate-700">
              {contact.name && <span className="font-medium text-slate-900">{contact.name}</span>}
              {contact.role && <span className="text-slate-600"> — {contact.role}</span>}
              {!contact.name && contact.organization && <span className="font-medium text-slate-900">{contact.organization}</span>}
              {!contact.phone && !contact.email && <span className="text-slate-500"> · no public phone or email yet</span>}
            </p>
          ) : (
            <p className="text-slate-500">No public contact found yet.</p>
          )}
          {(contact.phone || contact.email) && (
            <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
              {contact.phone && (
                <a className="inline-flex min-h-8 items-center gap-1 text-brand-700 hover:underline" href={`tel:${contact.phone}`}>
                  <LuPhone className="h-3.5 w-3.5" />
                  {contact.phone}
                </a>
              )}
              {contact.email && (
                <a className="inline-flex min-h-8 items-center gap-1 break-all text-brand-700 hover:underline" href={`mailto:${contact.email}`}>
                  <LuMail className="h-3.5 w-3.5 shrink-0" />
                  {contact.email}
                </a>
              )}
            </p>
          )}
        </section>

        {/* Next step — ONE obvious button */}
        <div className="mt-4 rounded-xl border-l-4 border-brand-500 bg-brand-50 px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Next step</p>
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <LuArrowRight className="h-4 w-4 shrink-0 text-brand-600" />
            {action.label}
          </p>
          <p className="text-xs text-slate-600">{action.reason}</p>
          <PrimaryActionButton view={view} onAction={onAction} />
        </div>

        {/* Smaller actions */}
        <SecondaryActions view={view} onAction={onAction} />
      </div>

      {/* LEVEL 2 — nice to know, one tap away */}
      <button
        type="button"
        onClick={() => setDetails((v) => !v)}
        aria-expanded={details}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      >
        {details ? "Hide details" : "View details"}
        <LuChevronDown className={clsx("h-4 w-4 transition-transform", details && "rotate-180")} />
      </button>
      {details && (
        <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-700 sm:px-5">
          <div className="grid gap-4 md:grid-cols-2">
            <section>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <LuTarget className="h-3.5 w-3.5" /> Why this lead
              </h4>
              <ul className="space-y-1">
                {view.why.length === 0 && <li className="text-slate-500">No positive signals yet.</li>}
                {view.why.map((w) => (
                  <li key={w.text} className="flex gap-2">
                    <span className="mt-px h-5 w-8 shrink-0 self-start rounded bg-emerald-50 text-center text-xs font-bold leading-5 text-emerald-700 tabular-nums">+{w.points}</span>
                    <span>{w.text}</span>
                  </li>
                ))}
              </ul>
              {ctx.signals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Opportunity signals">
                  {[...new Map(ctx.signals.map((sg) => [sg.type, sg])).values()].map((sg) => (
                    <SignalChip key={sg.type} type={sg.type} />
                  ))}
                </div>
              )}
            </section>
            <section className="space-y-1">
              <p>
                <span className="text-slate-500">Building: </span>
                {FACILITY_TYPE_LABEL[property.facilityType]}
                {property.sqft !== null && property.sqftStatus !== "unknown" ? ` · ${property.sqft.toLocaleString("en-US")} sq ft ` : " · size unknown "}
                <DataStatusTag status={property.sqftStatus} />
              </p>
              <p>
                <span className="text-slate-500">Property manager: </span>
                {ctx.propertyManager?.name ?? <span className="text-slate-400">Not identified</span>}
              </p>
              {ctx.leasingCompany && (
                <p>
                  <span className="text-slate-500">Leasing: </span>
                  {ctx.leasingCompany.name}
                </p>
              )}
              <p className="flex items-center gap-1.5">
                <LuClock className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-500">Last contact: </span>
                {view.lastContactAt ? relativeDays(view.lastContactAt, now) : "Never"}
              </p>
              <p className="flex items-center gap-1.5">
                <LuCalendarCheck className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-500">Next follow-up: </span>
                {view.nextFollowUp ? (
                  <span className={clsx(view.followUpState === "overdue" && "font-semibold text-red-700", view.followUpState === "due_today" && "font-semibold text-amber-800")}>
                    {CONTACT_METHOD_LABEL[view.nextFollowUp.method]} · {formatDateTime(view.nextFollowUp.dueAt)}
                  </span>
                ) : (
                  "None scheduled"
                )}
              </p>
              {view.walkthroughToday && (
                <p className="font-medium text-violet-800">Walkthrough today at {new Date(view.walkthroughToday.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
              )}
              <p>
                <span className="text-slate-500">Found: </span>
                <span title={freshness.label}>
                  {freshness.icon} {freshness.label}
                </span>
              </p>
              {contact.website && (
                <p>
                  <a className="inline-flex min-h-8 items-center gap-1 text-brand-700 hover:underline" href={contact.website} target="_blank" rel="noreferrer">
                    <LuGlobe className="h-3.5 w-3.5" />
                    Website
                  </a>
                </p>
              )}
            </section>
          </div>
          <Link
            href={`/leads/${lead.id}`}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-white text-sm font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50"
          >
            Open full lead page <LuArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setHistory((v) => !v)}
            aria-expanded={history}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            {history ? "Hide source & history" : "View source & history"}
            <LuChevronDown className={clsx("h-4 w-4 transition-transform", history && "rotate-180")} />
          </button>
        </div>
      )}
      {details && history && <ScoreBreakdown item={item} />}
      <span className="sr-only">Discovered {formatDate(lead.discoveredAt)}</span>
    </article>
  );
}
