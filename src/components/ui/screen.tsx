"use client";

import type { ReactNode } from "react";
import { LuSparkles } from "react-icons/lu";
import { useLeadFinder } from "@/state/lead-finder-store";
import { ErrorState, LoadingCards } from "./states";

export function PageHeader({ title, description, phase }: { title: string; description: ReactNode; phase?: number }) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
        {phase && phase > 1 && (
          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">Full version: Phase {phase}</span>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
    </header>
  );
}

/** Explains what this screen will do once its phase is built. */
export function ComingSoon({ phase, features }: { phase: number; features: string[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <LuSparkles className="h-4 w-4 text-brand-600" /> Planned for Phase {phase}
      </h2>
      <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PreviewLabel({ children }: { children?: ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Read-only preview of demo data{children ? ` · ${children}` : ""}
    </p>
  );
}

/** Renders loading / error states consistently, then the content once data is ready. */
export function WithData({ children }: { children: ReactNode }) {
  const { state, reload } = useLeadFinder();
  if (state.status === "loading") return <LoadingCards count={2} label="Loading…" />;
  if (state.status === "error") return <ErrorState message={state.message} nextStep={state.nextStep} onRetry={() => void reload()} />;
  return <>{children}</>;
}
