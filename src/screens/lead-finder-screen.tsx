"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LuArrowRight, LuCircleAlert, LuFileUp, LuLink, LuPlus, LuSearch } from "react-icons/lu";
import { StatusPill, TIER_STYLES } from "@/components/ui/badges";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { PageHeader, WithData } from "@/components/ui/screen";
import { SOURCE_VERIFICATION_LABEL } from "@/lib/domain/labels";
import { relativeDays } from "@/lib/engine/dates";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";
import { presetLeadSearch } from "./leads-screen";

const tile =
  "flex min-h-24 items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand-600";

/** Bringing opportunities in: add one, add from a link, or import a list — then find them. */
export function LeadFinderScreen() {
  const { snapshot, now } = useLeadFinder();
  const views = useEvaluatedLeads();
  const router = useRouter();
  const [q, setQ] = useState("");
  const recent = [...views].filter((v) => !v.ctx.lead.mergedIntoLeadId).sort((a, b) => b.ctx.lead.discoveredAt.localeCompare(a.ctx.lead.discoveredAt)).slice(0, 5);
  const down = snapshot?.sources.filter((s) => s.status === "unavailable") ?? [];

  const search = (e: FormEvent) => {
    e.preventDefault();
    presetLeadSearch(q);
    router.push("/leads");
  };

  return (
    <>
      <PageHeader title="Lead Finder" description="Bring in new commercial opportunities. Every lead keeps its source, is checked for duplicates, and gets a score you can explain." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/lead-finder/add" className={tile}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <LuPlus className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold text-slate-900">Add a lead</span>
            <span className="block text-sm text-slate-600">Five quick things: name, city, type, why, source.</span>
          </span>
        </Link>
        <Link href="/lead-finder/add-from-link" className={tile}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <LuLink className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold text-slate-900">Add from a web link</span>
            <span className="block text-sm text-slate-600">Paste where you saw it, record what it says.</span>
          </span>
        </Link>
        <Link href="/lead-finder/import" className={tile}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <LuFileUp className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold text-slate-900">Import a CSV</span>
            <span className="block text-sm text-slate-600">Map columns, review every row, then import.</span>
          </span>
        </Link>
      </div>

      <form onSubmit={(e: FormEvent) => search(e)} className="mt-4 flex gap-2" role="search">
        <div className="relative flex-1">
          <LuSearch className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input type="search" aria-label="Find a lead" className={`${controlClass} min-h-12 pl-11`} placeholder="Find a lead you already have…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="submit" className={buttonClass("secondary", "lg")}>
          Find
        </button>
      </form>

      <WithData>
        {down.map((s) => (
          <p key={s.id} className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{s.name}: Source temporarily unavailable.</span> Leads from it are unknown, not absent — nothing is being reported as “no opportunities”.
            </span>
          </p>
        ))}

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold text-slate-900">Recently added</h2>
            <Link href="/leads" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              All leads <LuArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">No leads yet. Add one above, or import a list.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {recent.map((v) => {
                const sr = v.ctx.sourceRecord;
                return (
                  <li key={v.ctx.lead.id}>
                    <Link href={`/leads/${v.ctx.lead.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <span className={`w-10 shrink-0 rounded-md py-1 text-center text-sm font-bold text-white tabular-nums ${TIER_STYLES[v.score.tier].badge}`}>{v.score.score}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{v.ctx.company?.name ?? v.ctx.property.name}</span>
                        <span className="block truncate text-sm text-slate-600">
                          {v.ctx.property.city} · {sr?.title ?? v.ctx.source?.name ?? "Source unknown"} · {sr ? SOURCE_VERIFICATION_LABEL[sr.verification] : "Not checked yet"} · {relativeDays(v.ctx.lead.discoveredAt, now)}
                        </span>
                      </span>
                      <StatusPill status={v.ctx.lead.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </WithData>
    </>
  );
}
