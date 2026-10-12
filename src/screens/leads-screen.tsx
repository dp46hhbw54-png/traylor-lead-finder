"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { LuFileUp, LuFilter, LuPlus, LuSearch, LuX } from "react-icons/lu";
import { LeadRow } from "@/components/leads/lead-row";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { PageHeader, WithData } from "@/components/ui/screen";
import { EmptyState } from "@/components/ui/states";
import { FACILITY_TYPE_LABEL, OPPORTUNITY_TYPE_LABEL, PIPELINE_STATUS_LABEL, SIGNAL_DEFINITIONS } from "@/lib/domain/labels";
import type { FacilityType, PipelineStatus, SignalType } from "@/lib/domain/types";
import {
  activeFilterKeys,
  applyLeadFilters,
  EMPTY_FILTERS,
  MORE_FILTER_KEYS,
  sortLeads,
  type LeadFilters,
  type LeadSort,
} from "@/lib/engine/lead-search";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";

// Filters survive opening a lead and coming back (in memory only).
let remembered: { filters: LeadFilters; sort: LeadSort; more: boolean } = { filters: { ...EMPTY_FILTERS }, sort: "score", more: false };

/** Open the Leads screen with a search already typed (used by the Lead Finder search box). */
export function presetLeadSearch(q: string) {
  remembered = { ...remembered, filters: { ...EMPTY_FILTERS, q } };
}

const STATUS_OPTIONS: [LeadFilters["status"], string][] = [
  ["open", "Open leads"],
  ...(["new", "researching", "contacted", "interested", "walkthrough", "nurture"] as PipelineStatus[]).map((s) => [s, PIPELINE_STATUS_LABEL[s]] as [PipelineStatus, string]),
  ["won", "Won"],
  ["lost", "Lost"],
  ["not_a_fit", "Not a Fit"],
  ["closed", "Closed (Won, Lost, Not a Fit)"],
  ["all", "All leads"],
];

const FILTER_LABEL: Record<keyof LeadFilters, string> = {
  q: "Search",
  market: "Market",
  facilityType: "Property type",
  tier: "Score",
  status: "Status",
  freshness: "Freshness",
  city: "City",
  zip: "ZIP",
  parish: "Parish",
  opportunityType: "Opportunity type",
  signal: "Signal",
  hasContact: "Has contact",
  hasManager: "Has property manager",
  lastContacted: "Last contacted",
  followUp: "Follow-up",
  source: "Source",
};

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <select id={id} className={controlClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

export function LeadsScreen() {
  const { snapshot, now } = useLeadFinder();
  const views = useEvaluatedLeads();
  const [filters, setFiltersState] = useState<LeadFilters>(remembered.filters);
  const [sort, setSortState] = useState<LeadSort>(remembered.sort);
  const [more, setMoreState] = useState(remembered.more);
  const setFilters = (f: LeadFilters) => {
    remembered = { ...remembered, filters: f };
    setFiltersState(f);
  };
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) => setFilters({ ...filters, [k]: v });
  const setSort = (s: LeadSort) => {
    remembered = { ...remembered, sort: s };
    setSortState(s);
  };
  const setMore = (m: boolean) => {
    remembered = { ...remembered, more: m };
    setMoreState(m);
  };

  const results = useMemo(() => (snapshot ? sortLeads(applyLeadFilters(views, filters, snapshot, now), sort) : []), [views, filters, snapshot, now, sort]);
  const active = activeFilterKeys(filters);
  const moreActive = active.filter((k) => (MORE_FILTER_KEYS as readonly string[]).includes(k)).length;
  const total = views.filter((v) => !v.ctx.lead.mergedIntoLeadId).length;
  const clear = () => setFilters({ ...EMPTY_FILTERS });

  const cities = snapshot?.markets.filter((m) => m.kind === "city" && m.active) ?? [];
  const parishes = snapshot?.markets.filter((m) => m.kind === "parish" && m.active) ?? [];

  return (
    <>
      <PageHeader title="Leads" description="Every opportunity in one place. Search, filter, and open a lead to work it." />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Link href="/lead-finder/add" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
          <LuPlus className="h-5 w-5" /> Add a lead
        </Link>
        <Link href="/lead-finder/import" className={buttonClass("secondary", "lg", "w-full sm:w-auto")}>
          <LuFileUp className="h-5 w-5" /> Import CSV
        </Link>
      </div>

      <WithData>
        {/* Search */}
        <div className="relative">
          <LuSearch className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search business, property, contact, phone, email, website or address"
            className={`${controlClass} min-h-12 pl-11 pr-11 text-base`}
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
          />
          {filters.q && (
            <button type="button" aria-label="Clear search" onClick={() => set("q", "")} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <LuX className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* The five most useful filters */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Filters">
          <Select id="f-market" label="Market" value={filters.market} onChange={(v) => set("market", v)}>
            <option value="">All markets</option>
            <optgroup label="Cities">
              {cities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Parishes">
              {parishes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} Parish
                </option>
              ))}
            </optgroup>
          </Select>
          <Select id="f-type" label="Property type" value={filters.facilityType} onChange={(v) => set("facilityType", v as FacilityType | "")}>
            <option value="">All types</option>
            {Object.entries(FACILITY_TYPE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Select id="f-score" label="Score" value={filters.tier} onChange={(v) => set("tier", v as LeadFilters["tier"])}>
            <option value="">Any score</option>
            <option value="hot">Hot (80–100)</option>
            <option value="high">High (60–79)</option>
            <option value="medium">Medium (40–59)</option>
            <option value="low">Low (below 40)</option>
          </Select>
          <Select id="f-status" label="Status" value={filters.status} onChange={(v) => set("status", v as LeadFilters["status"])}>
            {STATUS_OPTIONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Select id="f-fresh" label="Freshness" value={filters.freshness} onChange={(v) => set("freshness", v as LeadFilters["freshness"])}>
            <option value="">Any</option>
            <option value="today">🔥 Found or verified today</option>
            <option value="week">🟢 This week</option>
            <option value="aging">🟡 8–90 days</option>
            <option value="stale">🔴 Needs verification</option>
          </Select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className={buttonClass("subtle", "md", "min-h-11")}>
            <LuFilter className="h-4 w-4" /> More filters{moreActive > 0 ? ` (${moreActive})` : ""}
          </button>
          {active.length > 0 && (
            <button type="button" onClick={clear} className={buttonClass("secondary", "md", "min-h-11 border-brand-300 text-brand-800")}>
              <LuX className="h-4 w-4" /> Clear filters
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="f-sort" className="text-sm text-slate-600">
              Sort
            </label>
            <select id="f-sort" className={`${controlClass} w-auto`} value={sort} onChange={(e) => setSort(e.target.value as LeadSort)}>
              <option value="score">Highest score</option>
              <option value="newest">Newest</option>
              <option value="follow_up">Follow-up date</option>
            </select>
          </div>
        </div>

        {more && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="More filters">
            <div>
              <label htmlFor="f-city" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                City
              </label>
              <input id="f-city" className={controlClass} value={filters.city} onChange={(e) => set("city", e.target.value)} placeholder="Any city" />
            </div>
            <div>
              <label htmlFor="f-zip" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                ZIP
              </label>
              <input id="f-zip" inputMode="numeric" className={controlClass} value={filters.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Any ZIP" />
            </div>
            <Select id="f-parish" label="Parish" value={filters.parish} onChange={(v) => set("parish", v)}>
              <option value="">Any parish</option>
              {parishes.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Select id="f-opp" label="Opportunity type" value={filters.opportunityType} onChange={(v) => set("opportunityType", v as LeadFilters["opportunityType"])}>
              <option value="">Any</option>
              {Object.entries(OPPORTUNITY_TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select id="f-signal" label="Signal" value={filters.signal} onChange={(v) => set("signal", v as SignalType | "")}>
              <option value="">Any</option>
              {Object.entries(SIGNAL_DEFINITIONS).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.label}
                </option>
              ))}
            </Select>
            <Select id="f-contact" label="Has contact" value={filters.hasContact} onChange={(v) => set("hasContact", v as LeadFilters["hasContact"])}>
              <option value="">Any</option>
              <option value="yes">Yes — phone or email</option>
              <option value="no">No contact yet</option>
            </Select>
            <Select id="f-pm" label="Property manager" value={filters.hasManager} onChange={(v) => set("hasManager", v as LeadFilters["hasManager"])}>
              <option value="">Any</option>
              <option value="yes">Identified</option>
              <option value="no">Not identified</option>
            </Select>
            <Select id="f-last" label="Last contacted" value={filters.lastContacted} onChange={(v) => set("lastContacted", v as LeadFilters["lastContacted"])}>
              <option value="">Any time</option>
              <option value="never">Never</option>
              <option value="7">In the last 7 days</option>
              <option value="30">In the last 30 days</option>
              <option value="over30">More than 30 days ago</option>
            </Select>
            <Select id="f-fu" label="Follow-up" value={filters.followUp} onChange={(v) => set("followUp", v as LeadFilters["followUp"])}>
              <option value="">Any</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Due in the next 7 days</option>
              <option value="none">None scheduled</option>
            </Select>
            <Select id="f-source" label="Source" value={filters.source} onChange={(v) => set("source", v)}>
              <option value="">Any source</option>
              {(snapshot?.sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <p className="col-span-2 self-end text-xs text-slate-500 sm:col-span-3 lg:col-span-5">Distance (“within X miles”) arrives with the map — it needs map coordinates, which we never guess.</p>
          </div>
        )}

        {/* What's showing */}
        <div className="mt-4 mb-2 flex flex-wrap items-baseline justify-between gap-2" aria-live="polite">
          <p className="text-sm font-semibold text-slate-800">
            {results.length === total ? `${total} leads` : `${results.length} of ${total} leads`}
            {filters.status === "open" && !filters.q && <span className="font-normal text-slate-500"> · open leads only</span>}
            {filters.q && filters.status === "open" && <span className="font-normal text-slate-500"> · search includes closed leads</span>}
          </p>
          {active.length > 0 && (
            <p className="text-xs text-slate-500">
              Filtered by: {active.map((k) => FILTER_LABEL[k]).join(", ")}
            </p>
          )}
        </div>

        {total === 0 ? (
          <EmptyState
            icon={<LuSearch className="h-6 w-6" />}
            title="No leads yet"
            description="Add your first commercial opportunity by hand, or bring in a list."
            action={
              <>
                <Link href="/lead-finder/add" className={buttonClass("primary")}>
                  Add a lead
                </Link>
                <Link href="/lead-finder/import" className={buttonClass("secondary")}>
                  Import CSV
                </Link>
              </>
            }
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<LuSearch className="h-6 w-6" />}
            title="No leads match your filters."
            description="Try clearing the filters — or add this opportunity if it's new."
            action={
              <>
                <button type="button" onClick={clear} className={buttonClass("primary")}>
                  Clear filters
                </button>
                <Link href="/lead-finder/add" className={buttonClass("secondary")}>
                  Add a lead
                </Link>
                <Link href="/lead-finder/import" className={buttonClass("secondary")}>
                  Import CSV
                </Link>
              </>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {results.map((v) => (
              <LeadRow key={v.ctx.lead.id} view={v} />
            ))}
          </ul>
        )}
      </WithData>
    </>
  );
}
