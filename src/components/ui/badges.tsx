import clsx from "clsx";
import { DATA_STATUS_LABEL, PIPELINE_STATUS_LABEL, POTENTIAL_VALUE_LABEL, SIGNAL_DEFINITIONS } from "@/lib/domain/labels";
import type { DataStatus, PipelineStatus, PotentialValue, SignalType } from "@/lib/domain/types";
import { TIER_LABEL, type Tier } from "@/lib/engine/scoring";

export const TIER_STYLES: Record<Tier, { badge: string; ring: string; text: string; dot: string }> = {
  hot: { badge: "bg-red-600 text-white", ring: "ring-red-200", text: "text-red-700", dot: "bg-red-600" },
  high: { badge: "bg-orange-500 text-white", ring: "ring-orange-200", text: "text-orange-700", dot: "bg-orange-500" },
  medium: { badge: "bg-sky-600 text-white", ring: "ring-sky-200", text: "text-sky-700", dot: "bg-sky-600" },
  low: { badge: "bg-slate-400 text-white", ring: "ring-slate-200", text: "text-slate-600", dot: "bg-slate-400" },
};

export function ScoreBadge({ score, tier, size = "md" }: { score: number; tier: Tier; size?: "md" | "lg" }) {
  const s = TIER_STYLES[tier];
  return (
    <div className={clsx("flex shrink-0 flex-col items-center justify-center rounded-xl ring-4", s.badge, s.ring, size === "lg" ? "h-16 w-16" : "h-14 w-14")}>
      <span className={clsx("font-bold leading-none tabular-nums", size === "lg" ? "text-2xl" : "text-xl")}>{score}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-90">{TIER_LABEL[tier]}</span>
    </div>
  );
}

export function TierPill({ tier }: { tier: Tier }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TIER_STYLES[tier].badge)}>
      {TIER_LABEL[tier]}
    </span>
  );
}

const STATUS_STYLE: Record<PipelineStatus, string> = {
  new: "bg-slate-100 text-slate-700",
  researching: "bg-violet-50 text-violet-700",
  contacted: "bg-sky-50 text-sky-700",
  interested: "bg-emerald-50 text-emerald-700",
  walkthrough: "bg-amber-50 text-amber-800",
  won: "bg-emerald-600 text-white",
  lost: "bg-slate-200 text-slate-600",
  nurture: "bg-indigo-50 text-indigo-700",
  not_a_fit: "bg-slate-200 text-slate-500",
};

export function StatusPill({ status }: { status: PipelineStatus }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {PIPELINE_STATUS_LABEL[status]}
    </span>
  );
}

const DATA_STATUS_STYLE: Record<DataStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  publicly_reported: "border-sky-200 bg-sky-50 text-sky-700",
  estimated: "border-amber-200 bg-amber-50 text-amber-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-500",
};

/** Shows how trustworthy a value is. Never hide this. */
export function DataStatusTag({ status }: { status: DataStatus }) {
  return (
    <span className={clsx("inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", DATA_STATUS_STYLE[status])}>
      {DATA_STATUS_LABEL[status]}
    </span>
  );
}

export function SignalChip({ type }: { type: SignalType }) {
  const def = SIGNAL_DEFINITIONS[type];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        def.strength === "very_strong" && "bg-brand-50 text-brand-800 ring-1 ring-brand-100",
        def.strength === "medium" && "bg-slate-100 text-slate-700",
        def.strength === "weak" && "bg-slate-50 text-slate-500",
      )}
      title={`${def.strength === "very_strong" ? "Very strong" : def.strength === "medium" ? "Medium" : "Weak"} signal`}
    >
      {def.strength === "very_strong" && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />}
      {def.label}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded bg-amber-400 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-amber-950", className)}>
      Demo
    </span>
  );
}

const POTENTIAL_STYLE: Record<PotentialValue, string> = {
  very_high: "bg-violet-100 text-violet-900",
  high: "bg-violet-50 text-violet-800",
  medium: "bg-slate-100 text-slate-700",
  low: "bg-slate-50 text-slate-500",
  unknown: "bg-slate-50 text-slate-400",
};

/** Management's quick read on how valuable an opportunity could be. Not a quote and not a dollar figure. */
export function PotentialValueTag({ value }: { value: PotentialValue }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", POTENTIAL_STYLE[value])}>{POTENTIAL_VALUE_LABEL[value]}</span>;
}
