"use client";

import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LuCircleCheck, LuInfo, LuTriangleAlert, LuX } from "react-icons/lu";

export type ToastKind = "success" | "error" | "info";

export interface ToastInput {
  kind: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface Toast extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ push: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { ...input, id }]);
      // Errors stay until dismissed — never hide a failure.
      if (input.kind !== "error") setTimeout(() => dismiss(id), input.durationMs ?? (input.action ? 7000 : 4000));
    },
    [dismiss],
  );

  // A dialog's buttons must never be hidden under a lingering toast: opening a dialog clears non-error toasts.
  useEffect(() => {
    const clear = () => setToasts((all) => all.filter((t) => t.kind === "error"));
    window.addEventListener("lead-finder:dialog-open", clear);
    return () => window.removeEventListener("lead-finder:dialog-open", clear);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:bottom-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1",
              t.kind === "success" && "bg-slate-900 text-white ring-slate-800",
              t.kind === "info" && "bg-white text-slate-800 ring-slate-200",
              t.kind === "error" && "bg-red-50 text-red-900 ring-red-200",
            )}
          >
            {t.kind === "success" && <LuCircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />}
            {t.kind === "info" && <LuInfo className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />}
            {t.kind === "error" && <LuTriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.title}</p>
              {t.description && <p className={clsx("mt-0.5", t.kind === "success" ? "text-slate-300" : "opacity-80")}>{t.description}</p>}
            </div>
            {t.action && (
              <button
                type="button"
                className={clsx("shrink-0 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline", t.kind === "success" ? "text-emerald-300" : "text-brand-700")}
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" onClick={() => dismiss(t.id)} className="-m-1 shrink-0 rounded p-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
              <LuX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
