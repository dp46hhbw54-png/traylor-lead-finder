"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { LuDatabase, LuRefreshCw } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/screen";
import { resolveScoringSettings } from "@/lib/config/scoring-settings";
import { APP_ROLE_LABEL } from "@/lib/domain/labels";
import type { AppRole } from "@/lib/domain/types";
import { getDemoSimulation, setDemoSimulation, type DemoSimulation } from "@/lib/data/demo/local-demo-repository";
import { useLeadFinder } from "@/state/lead-finder-store";

const card = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsScreen() {
  const { repo, actions, reload, snapshot } = useLeadFinder();
  const [sim, setSim] = useState<DemoSimulation | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => setSim(getDemoSimulation()), []);

  const update = (patch: Partial<DemoSimulation>) => {
    if (!sim) return;
    const next = { ...sim, ...patch };
    setSim(next);
    setDemoSimulation(next);
    void reload();
  };

  const s = resolveScoringSettings(snapshot?.settings);
  const weightRows: [string, number][] = [
    ...(Object.keys(s.signalPoints) as (keyof typeof s.signalPoints)[]).map((k) => [s.signalCategoryLabel[k], s.signalPoints[k]] as [string, number]),
    [`Large building (≥ ${s.size.largeMinSqft.toLocaleString()} sq ft)`, s.size.largePoints],
    [`Medium building (${s.size.mediumMinSqft.toLocaleString()}–${(s.size.largeMinSqft - 1).toLocaleString()} sq ft)`, s.size.mediumPoints],
    ["Unknown square footage", 0],
    ["Property manager identified", s.contact.propertyManagerIdentified],
    ["Public business contact", s.contact.publicBusinessContact],
    ["No contact path", s.contact.noContactPath],
    [`Found/verified within ${s.freshness.freshWithinDays} days`, s.freshness.freshPoints],
    [`Last verified > ${s.freshness.staleAfterDays} days`, s.freshness.stalePoints],
  ];

  return (
    <>
      <PageHeader title="Settings" description="Data source, demo controls, service area and scoring rules." />

      <div className="space-y-4">
        <section className={card}>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <LuDatabase className="h-4 w-4 text-slate-500" /> Data source
          </h2>
          <p className="mt-1 text-sm text-slate-700">{repo.label}</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>• No Supabase project is connected. No SQL, migrations or database objects exist for this app yet.</li>
            <li>• Not connected to the Employee Operations, Supply, Inventory, Command Center or Client Portal systems.</li>
            <li>• Your demo changes are saved only in this browser.</li>
            <li>• Sign-in arrives with the dedicated Lead Finder Supabase project. Until then, use “Pretend I'm signed in as” below to see what each role can do.</li>
          </ul>
        </section>

        <section className={card}>
          <h2 className="font-semibold text-slate-900">Demo controls</h2>
          <p className="mt-1 text-sm text-slate-600">Use these to review loading, empty and error states.</p>
          {sim && (
            <div className="mt-2 divide-y divide-slate-100">
              <Toggle label="Simulate load error" description="Every screen shows its error state with a retry." checked={sim.failLoads} onChange={(v) => update({ failLoads: v })} />
              <Toggle label="Simulate empty database" description="Shows the empty states." checked={sim.emptyDataset} onChange={(v) => update({ emptyDataset: v })} />
              <label className="flex items-start justify-between gap-4 py-2">
                <span>
                  <span className="block text-sm font-medium text-slate-800">Pretend I'm signed in as</span>
                  <span className="block text-xs text-slate-500">Viewers can look but not change anything. Managers can work leads and merge duplicates. Owners can also manage settings.</span>
                </span>
                <select
                  className="mt-1 h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                  value={sim.role}
                  onChange={(e) => update({ role: e.target.value as AppRole })}
                  aria-label="Pretend to be signed in as"
                >
                  {(["owner", "manager", "viewer"] as AppRole[]).map((r) => (
                    <option key={r} value={r}>
                      {APP_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle label="Simulate slow network" description="Adds a 2-second delay so loading states are visible." checked={sim.latencyMs >= 2000} onChange={(v) => update({ latencyMs: v ? 2000 : 350 })} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={resetting}
              icon={<LuRefreshCw className={clsx("h-4 w-4", resetting && "animate-spin")} />}
              onClick={async () => {
                setResetting(true);
                await actions.resetDemo();
                setResetting(false);
              }}
            >
              Reset demo data
            </Button>
            <span className="text-xs text-slate-500">Restores the 22 fictional demo leads and clears your demo changes.</span>
          </div>
        </section>

        <section className={card}>
          <h2 className="font-semibold text-slate-900">Service area</h2>
          <p className="mt-1 text-sm text-slate-600">Stored as data, not hard-coded. New markets can be added later without code changes.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {snapshot?.markets.map((m) => (
              <span key={m.id} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", m.kind === "parish" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700")}>
                {m.name}
                {m.kind === "parish" ? " Parish" : ""}
              </span>
            ))}
          </div>
        </section>

        <details className={card}>
          <summary className="cursor-pointer font-semibold text-slate-900">Data foundation (advanced)</summary>
          <p className="mt-2 text-sm text-slate-600">
            What this app stores, ready to move to the dedicated Lead Finder database. Nothing is connected yet — this is the demo copy in your browser.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {(
              [
                ["Markets", snapshot?.markets.length],
                ["Companies", snapshot?.companies.length],
                ["Properties", snapshot?.properties.length],
                ["Contacts", snapshot?.contacts.length],
                ["Property relationships", snapshot?.relationships.length],
                ["Leads", snapshot?.leads.length],
                ["Opportunity signals", snapshot?.signals.length],
                ["Saved score breakdowns", snapshot?.scoreBreakdowns.length],
                ["Sources", snapshot?.sources.length],
                ["Source records", snapshot?.sourceRecords.length],
                ["Fact sources (provenance)", snapshot?.provenance.length],
                ["Activities", snapshot?.activities.length],
                ["Follow-ups", snapshot?.followups.length],
                ["Walkthroughs", snapshot?.walkthroughs.length],
                ["Change-history entries", snapshot?.auditLog.length],
                ["Settings rows", snapshot?.settings.length],
                ["Users & roles", snapshot?.userRoles.length],
              ] as [string, number | undefined][]
            ).map(([label, n]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{n ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-500">Database design (not run anywhere): <code className="rounded bg-slate-100 px-1">supabase/migrations/20261012000001_lead_finder_schema.sql</code></p>
        </details>

        <section className={card}>
          <h2 className="font-semibold text-slate-900">Scoring rules</h2>
          <p className="mt-1 text-sm text-slate-600">
            Explainable 0–100 score. Each signal category counts once. Editable in a later phase (stored in <code className="rounded bg-slate-100 px-1">lead_settings</code>).
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {weightRows.map(([label, pts]) => (
                <tr key={label}>
                  <td className="py-1.5 pr-3 text-slate-700">{label}</td>
                  <td className={clsx("py-1.5 text-right font-semibold tabular-nums", pts > 0 ? "text-emerald-700" : pts < 0 ? "text-red-700" : "text-slate-500")}>
                    {pts > 0 ? `+${pts}` : pts}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Tiers: Hot ≥ {s.tiers.hot} · High {s.tiers.high}–{s.tiers.hot - 1} · Medium {s.tiers.medium}–{s.tiers.high - 1} · Low &lt; {s.tiers.medium}
          </p>
        </section>
      </div>
    </>
  );
}
