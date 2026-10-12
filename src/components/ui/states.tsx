import type { ReactNode } from "react";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { Button } from "./button";

export function LoadingCards({ count = 3, label = "Loading opportunities…" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="lf-skeleton h-14 w-14 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="lf-skeleton h-4 w-2/3" />
              <div className="lf-skeleton h-3 w-1/3" />
              <div className="lf-skeleton h-3 w-5/6" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="lf-skeleton h-10" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</div>
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Errors explain what happened, why (if known), and what to do next. */
export function ErrorState({ title, message, nextStep, onRetry }: { title?: string; message: string; nextStep?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-6">
      <div className="flex items-start gap-3">
        <LuTriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
        <div className="min-w-0">
          <h3 className="font-semibold text-red-900">{title ?? "Something went wrong"}</h3>
          <p className="mt-1 text-sm text-red-800">{message}</p>
          {nextStep && (
            <p className="mt-2 text-sm text-red-800">
              <span className="font-semibold">What to do: </span>
              {nextStep}
            </p>
          )}
          {onRetry && (
            <Button className="mt-4" variant="secondary" onClick={onRetry} icon={<LuRefreshCw className="h-4 w-4" />}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
