"use client";

import clsx from "clsx";
import Link from "next/link";
import { LuArrowRight, LuHourglass, LuPhone, LuUserX } from "react-icons/lu";
import { DemoTag, PotentialValueTag, StatusPill, TIER_STYLES } from "@/components/ui/badges";
import { FACILITY_TYPE_LABEL, OPPORTUNITY_TYPE_LABEL } from "@/lib/domain/labels";
import type { LeadView } from "@/lib/engine/evaluate";
import { hasPublicContact, opportunityTypeOf } from "@/lib/engine/lead-search";
import { TIER_LABEL } from "@/lib/engine/scoring";

/** One lead in a list: who, where, what kind of opportunity, why now, how good, potential, status, freshness, contact, next step. */
export function LeadRow({ view }: { view: LeadView }) {
  const { ctx, score, freshness, action, contact } = view;
  const { lead, property, company } = ctx;
  const headline = company?.name ?? property.name;
  const opp = opportunityTypeOf(view);
  const reachable = hasPublicContact(view);
  return (
    <li data-lead-row={lead.id} className="min-w-0">
      <Link
        href={`/leads/${lead.id}`}
        className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/30 focus-visible:outline-2 focus-visible:outline-brand-600 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-snug text-slate-900">{headline}</p>
            <p className="text-sm text-slate-600">
              {company && company.name !== property.name ? `${property.name} · ` : ""}
              {property.city} · {FACILITY_TYPE_LABEL[property.facilityType]}
            </p>
          </div>
          <div className={clsx("flex shrink-0 flex-col items-center rounded-lg px-2.5 py-1", TIER_STYLES[score.tier].badge)} aria-label={`Score ${score.score}, ${TIER_LABEL[score.tier]}`}>
            <span className="text-lg font-bold leading-none tabular-nums">{score.score}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide">{TIER_LABEL[score.tier]}</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-slate-900 px-2 py-0.5 font-semibold text-white">{OPPORTUNITY_TYPE_LABEL[opp]}</span>
          <StatusPill status={lead.status} />
          {lead.potentialValue !== "unknown" && <PotentialValueTag value={lead.potentialValue} />}
          <span className="font-medium text-slate-600">
            {freshness.icon} {freshness.label}
          </span>
          {lead.isDemo && <DemoTag />}
        </div>

        <p className="mt-2 text-sm font-medium text-slate-800">{lead.title}</p>
        <p className="mt-1 flex gap-1.5 text-sm text-amber-900">
          <LuHourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{view.whyNow[0]}</span>
        </p>

        <div className="mt-3 grid grid-cols-1 gap-1 border-t border-slate-100 pt-2 text-sm sm:grid-cols-2 sm:gap-3">
          <p className={clsx("flex min-w-0 items-center gap-1.5", reachable ? "text-slate-700" : "text-slate-500")}>
            {reachable ? <LuPhone className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <LuUserX className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">
              {reachable ? `Contact: ${contact.name ?? contact.organization}` : contact.name || contact.organization ? `${contact.name ?? contact.organization} — no public phone/email` : "No contact yet"}
            </span>
          </p>
          <p className="flex min-w-0 items-center gap-1.5 font-semibold text-brand-800">
            <LuArrowRight className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{action.label}</span>
          </p>
        </div>
      </Link>
    </li>
  );
}
