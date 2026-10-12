"use client";

import clsx from "clsx";
import { LuExternalLink } from "react-icons/lu";
import { DataStatusTag } from "@/components/ui/badges";
import { SIGNAL_DEFINITIONS } from "@/lib/domain/labels";
import { formatDate } from "@/lib/engine/dates";
import type { TodayItem } from "@/lib/engine/evaluate";
import { LeadDetails } from "./lead-details";

/** Every point explained, plus the evidence behind every signal. */
export function ScoreBreakdown({ item }: { item: TodayItem }) {
  const { view } = item;
  const { score, ctx } = view;
  const sources = new Map([...(ctx.source ? [ctx.source] : [])].map((s) => [s.id, s]));

  return (
    <>
    <div className="grid gap-5 border-t border-slate-100 bg-slate-50/70 px-4 py-4 text-sm sm:px-5 md:grid-cols-2">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Score breakdown</h4>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {score.lines.map((l) => (
            <li key={l.key} className="flex items-start gap-3 px-3 py-2">
              <span className={clsx("w-9 shrink-0 text-right font-semibold tabular-nums", l.points >= 0 ? "text-emerald-700" : "text-red-700")}>
                {l.points > 0 ? `+${l.points}` : l.points}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{l.label}</span>
                {l.detail && <span className="block text-xs text-slate-500">{l.detail}</span>}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 bg-slate-50 px-3 py-2 font-semibold">
            <span className="w-9 shrink-0 text-right tabular-nums">{score.score}</span>
            <span>
              Opportunity score
              {score.capped && <span className="ml-1 font-normal text-slate-500">(raw {score.raw} → capped at {score.raw > 100 ? 100 : 0})</span>}
            </span>
          </li>
        </ul>

        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Today ranking</h4>
        <ul className="space-y-1 text-slate-700">
          {item.group !== "ranked" && <li className="font-medium">↑ Pinned to the top: {item.rankNote.toLowerCase()}</li>}
          {item.priorityParts.map((p) => (
            <li key={p.label} className="flex gap-2">
              <span className={clsx("w-9 text-right tabular-nums", p.points < 0 && "text-red-700")}>{p.points > 0 && p.label !== "Opportunity score" ? `+${p.points}` : p.points}</span>
              <span>{p.label}</span>
            </li>
          ))}
          <li className="flex gap-2 font-semibold">
            <span className="w-9 text-right tabular-nums">{item.priority}</span>
            <span>Priority</span>
          </li>
        </ul>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence (signals)</h4>
        {ctx.signals.length === 0 ? (
          <p className="text-slate-500">No signals recorded.</p>
        ) : (
          <ul className="space-y-2">
            {ctx.signals.map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{SIGNAL_DEFINITIONS[s.type].label}</span>
                  <DataStatusTag status={s.confidence} />
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{s.description}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>Found {formatDate(s.discoveredAt)}</span>
                  <span>{s.verifiedAt ? `Verified ${formatDate(s.verifiedAt)}` : "Not verified"}</span>
                  {s.expectedDate && <span>Expected {formatDate(s.expectedDate)}</span>}
                  {s.sourceUrl && (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      Source <LuExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Lead source: {ctx.source?.name ?? "Unknown"}
          {ctx.sourceRecord?.externalId && ` · record ${ctx.sourceRecord.externalId}`}
          {ctx.sourceRecord?.sourceUrl && (
            <>
              {" · "}
              <a href={ctx.sourceRecord.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                original listing
              </a>
            </>
          )}
          {sources.size === 0 && " · source missing"}
        </p>
        <p className="mt-1 text-xs text-amber-700">Demo evidence — the example.com links are placeholders.</p>
      </section>
    </div>
    <LeadDetails view={view} />
    </>
  );
}
