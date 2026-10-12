"use client";

import clsx from "clsx";
import { LuMapPin, LuSearch } from "react-icons/lu";
import { DataStatusTag, DemoTag, StatusPill, TIER_STYLES, TierPill } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/states";
import { ComingSoon, PageHeader, PreviewLabel, WithData } from "@/components/ui/screen";
import {
  CONTACT_METHOD_LABEL,
  FACILITY_TYPE_LABEL,
  SOURCE_CATEGORY_LABEL,
  SOURCE_STATUS_LABEL,
  PIPELINE_COLUMNS,
  PIPELINE_STATUS_LABEL,
  RELATIONSHIP_ROLE_LABEL,
} from "@/lib/domain/labels";
import { calendarDaysBetween, formatDate, formatDateTime } from "@/lib/engine/dates";
import { DUPLICATE_REASON_LABEL, findPropertyDuplicates } from "@/lib/engine/duplicates";
import { TIER_LABEL, type Tier } from "@/lib/engine/scoring";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";

const card = "rounded-2xl border border-slate-200 bg-white";

// ----------------------------------------------------------------------------- Map
export function MapScreen() {
  const { snapshot } = useLeadFinder();
  const views = useEvaluatedLeads();
  const counts = views.reduce<Record<Tier, number>>((acc, v) => ({ ...acc, [v.score.tier]: acc[v.score.tier] + 1 }), { hot: 0, high: 0, medium: 0, low: 0 });
  const ungeocoded = snapshot?.properties.filter((p) => p.lat === null).length ?? 0;
  return (
    <>
      <PageHeader title="Map" phase={8} description="Opportunities on a map, colored by tier." />
      <ComingSoon
        phase={8}
        features={["Leaflet + OpenStreetMap", "Pins colored by Hot / High / Medium / Low", "Tap a pin for a lead summary", "Server-side geocoding (lib/geocode.ts, Census default)", "Manual pin adjustment", "Geocode failures flagged — never guessed"]}
      />
      <WithData>
        <div className={clsx(card, "flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center")}>
          <LuMapPin className="h-10 w-10 text-slate-300" />
          <p className="max-w-md text-sm text-slate-600">
            No map tiles are loaded in Phase 1 (no external requests). {ungeocoded} demo properties have no coordinates yet — they will be geocoded in Phase 8, not guessed.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            {(Object.keys(counts) as Tier[]).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={clsx("h-3 w-3 rounded-full", TIER_STYLES[t].dot)} /> {TIER_LABEL[t]} ({counts[t]})
              </span>
            ))}
          </div>
        </div>
      </WithData>
    </>
  );
}

// ----------------------------------------------------------------------------- Pipeline
export function PipelineScreen() {
  const views = useEvaluatedLeads();
  return (
    <>
      <PageHeader title="Pipeline" phase={7} description="Every lead by sales stage. Not a Fit is hidden here but stays searchable." />
      <ComingSoon phase={7} features={["Drag-and-drop (status dropdown fallback)", "Every move logged to timeline + audit", "Lost reasons captured", "Time-in-stage tracking for future learning"]} />
      <WithData>
        <PreviewLabel>Drag-and-drop arrives in Phase 7</PreviewLabel>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex gap-3" style={{ minWidth: `${PIPELINE_COLUMNS.length * 13}rem` }}>
            {PIPELINE_COLUMNS.map((status) => {
              const items = views.filter((v) => v.ctx.lead.status === status).sort((a, b) => b.score.score - a.score.score);
              return (
                <section key={status} className="w-52 shrink-0 rounded-xl bg-slate-200/60 p-2">
                  <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                    {PIPELINE_STATUS_LABEL[status]} <span className="rounded-full bg-white px-2 text-slate-700">{items.length}</span>
                  </h2>
                  <div className="space-y-2">
                    {items.map((v) => (
                      <div key={v.ctx.lead.id} className="rounded-lg bg-white p-2.5 text-sm shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold leading-snug text-slate-900">{v.ctx.company?.name ?? v.ctx.property.name}</p>
                          <TierPill tier={v.score.tier} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{v.ctx.property.city} · {v.score.score}</p>
                        <p className="mt-1 text-xs text-slate-500">{v.action.label}</p>
                      </div>
                    ))}
                    {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-slate-500">Empty</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </WithData>
    </>
  );
}

// ----------------------------------------------------------------------------- Follow-ups
export function FollowUpsScreen() {
  const { snapshot, now } = useLeadFinder();
  const views = useEvaluatedLeads();
  const byLead = new Map(views.map((v) => [v.ctx.lead.id, v]));
  const open = (snapshot?.followups ?? []).filter((f) => !f.completedAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const groups: { label: string; test: (d: number) => boolean; tone: string }[] = [
    { label: "Overdue", test: (d) => d < 0, tone: "text-red-700" },
    { label: "Today", test: (d) => d === 0, tone: "text-amber-800" },
    { label: "Tomorrow", test: (d) => d === 1, tone: "text-slate-800" },
    { label: "This week", test: (d) => d > 1 && d <= 7, tone: "text-slate-800" },
    { label: "Upcoming", test: (d) => d > 7, tone: "text-slate-800" },
  ];
  return (
    <>
      <PageHeader title="Follow-Ups" phase={7} description="Every scheduled follow-up, so nothing slips." />
      <ComingSoon phase={7} features={["Complete a follow-up in one tap", "“Schedule next follow-up?” prompt", "Walkthrough tracking with outcomes", "Filter by method and owner"]} />
      <WithData>
        <PreviewLabel>Follow-ups you schedule on Today show up here</PreviewLabel>
        {open.length === 0 ? (
          <EmptyState title="No follow-ups scheduled" description="Schedule one from any card on Today." />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const rows = open.filter((f) => g.test(calendarDaysBetween(now, new Date(f.dueAt))));
              if (rows.length === 0) return null;
              return (
                <section key={g.label}>
                  <h2 className={clsx("mb-1.5 text-sm font-bold", g.tone)}>
                    {g.label} ({rows.length})
                  </h2>
                  <ul className={clsx(card, "divide-y divide-slate-100")}>
                    {rows.map((f) => {
                      const v = byLead.get(f.leadId);
                      return (
                        <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                          <div>
                            <p className="font-semibold text-slate-900">{v?.ctx.company?.name ?? v?.ctx.property.name ?? "Unknown lead"}</p>
                            <p className="text-slate-600">
                              {CONTACT_METHOD_LABEL[f.method]} · {formatDateTime(f.dueAt)}
                              {f.notes && ` · ${f.notes}`}
                            </p>
                          </div>
                          {v && <StatusPill status={v.ctx.lead.status} />}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </WithData>
    </>
  );
}

// ----------------------------------------------------------------------------- Companies
export function CompaniesScreen() {
  const { snapshot } = useLeadFinder();
  return (
    <>
      <PageHeader title="Companies" phase={4} description="Businesses, tenants, property managers and leasing companies. A company can have many properties." />
      <ComingSoon phase={4} features={["Create and edit companies", "Linked properties and roles", "Contacts per company", "Merge duplicates (Phase 6)"]} />
      <WithData>
        <PreviewLabel>{snapshot?.companies.length ?? 0} demo companies</PreviewLabel>
        <ul className="grid gap-3 sm:grid-cols-2">
          {snapshot?.companies.map((c) => {
            const rels = snapshot.relationships.filter((r) => r.companyId === c.id);
            return (
              <li key={c.id} className={clsx(card, "p-4 text-sm")}>
                <p className="font-semibold text-slate-900">
                  {c.name} <DemoTag className="ml-1 align-middle" />
                </p>
                <p className="text-slate-600">{c.industry ?? "Industry unknown"}</p>
                <ul className="mt-2 space-y-0.5 text-slate-700">
                  {rels.length === 0 && <li className="text-slate-400">No linked properties</li>}
                  {rels.map((r) => (
                    <li key={r.id}>
                      <span className="text-slate-500">{RELATIONSHIP_ROLE_LABEL[r.role]} at </span>
                      {snapshot.properties.find((p) => p.id === r.propertyId)?.name}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </WithData>
    </>
  );
}

// ----------------------------------------------------------------------------- Properties
export function PropertiesScreen() {
  const { snapshot } = useLeadFinder();
  const active = snapshot?.properties.filter((p) => !p.mergedIntoId) ?? [];
  const duplicates = snapshot ? findPropertyDuplicates(snapshot) : [];
  return (
    <>
      <PageHeader title="Properties" phase={4} description="Physical buildings. A property can have tenants, a property manager, a leasing company and many leads over time." />
      <ComingSoon phase={4} features={["Create and edit properties", "Tenants, manager and leasing relationships", "Review and merge duplicates (Phase 6) — nothing is ever deleted"]} />
      <WithData>
        <PreviewLabel>{active.length} demo properties{duplicates.length > 0 ? ` · ${duplicates.length} possible duplicate${duplicates.length === 1 ? "" : "s"} found` : ""}</PreviewLabel>
        <ul className={clsx(card, "divide-y divide-slate-100")}>
          {active.map((p) => {
            const rels = snapshot!.relationships.filter((r) => r.propertyId === p.id);
            const leads = snapshot!.leads.filter((l) => l.propertyId === p.id && !l.mergedIntoLeadId).length;
            const dups = duplicates.filter((d) => d.propertyId === p.id || d.duplicateId === p.id);
            return (
              <li key={p.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <DemoTag />
                  {dups.map((d) => {
                    const otherId = d.propertyId === p.id ? d.duplicateId : d.propertyId;
                    return (
                      <span key={otherId} className="rounded bg-violet-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-violet-800" title={d.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(" · ")}>
                        {d.strength === "exact" ? "Duplicate of" : "Possible duplicate of"} {snapshot!.properties.find((x) => x.id === otherId)?.name}
                      </span>
                    );
                  })}
                </div>
                <p className="text-slate-600">
                  {p.address}, {p.city} · {FACILITY_TYPE_LABEL[p.facilityType]} · {p.sqft !== null ? `${p.sqft.toLocaleString("en-US")} sq ft` : "Size unknown"} <DataStatusTag status={p.sqftStatus} />
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {rels.map((r) => `${RELATIONSHIP_ROLE_LABEL[r.role]}: ${snapshot!.companies.find((c) => c.id === r.companyId)?.name}`).join(" · ") || "No relationships yet"} · {leads} lead{leads === 1 ? "" : "s"}
                </p>
              </li>
            );
          })}
        </ul>
      </WithData>
    </>
  );
}

// ----------------------------------------------------------------------------- Sources
export function SourcesScreen() {
  const { snapshot } = useLeadFinder();
  const down = snapshot?.sources.filter((x) => x.status !== "available") ?? [];
  return (
    <>
      <PageHeader title="Sources" phase={9} description="Where every lead and signal came from. You should always be able to answer “where did this come from?”" />
      <ComingSoon
        phase={9}
        features={["V1 sources: Manual, CSV, URL reference (Phase 5)", "Adapter framework for future sources", "Enabled / disabled, last run, record counts, errors", "Respects Terms of Service and robots.txt", "No uncontrolled scraping"]}
      />
      <WithData>
        {down.length > 0 && (
          <div role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{down.length === 1 ? "A source is" : `${down.length} sources are`} not available right now.</p>
            <p>Leads from {down.length === 1 ? "it are" : "them are"} unknown, not absent — this app never reports “no leads” when a source has failed.</p>
          </div>
        )}
        <PreviewLabel>Demo sources</PreviewLabel>
        <ul className={clsx(card, "divide-y divide-slate-100")}>
          {snapshot?.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-slate-900">{s.name}</p>
                <p className="text-slate-600">
                  {SOURCE_CATEGORY_LABEL[s.category]} · {s.automatedAccessAllowed === true ? "Automated access approved" : "No automated access"}
                </p>
                <p className={clsx("mt-0.5 text-xs font-medium", s.status === "available" ? "text-emerald-700" : "text-amber-800")}>
                  {SOURCE_STATUS_LABEL[s.status]}
                  {s.status === "available" && s.lastSuccessAt ? ` · last checked ${formatDate(s.lastSuccessAt)}` : ""}
                  {s.statusNote ? ` — ${s.statusNote}` : ""}
                </p>
              </div>
              <span className="text-slate-600">
                {snapshot.sourceRecords.filter((r) => r.sourceId === s.id).length} records · {snapshot.leads.filter((l) => l.sourceId === s.id).length} leads · {snapshot.signals.filter((g) => g.sourceId === s.id).length} signals
              </span>
            </li>
          ))}
        </ul>
      </WithData>
    </>
  );
}
