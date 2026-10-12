"use client";

import clsx from "clsx";
import { useId, useState, type ReactNode } from "react";
import { LuChevronDown } from "react-icons/lu";

/** Inputs are at least 44px tall and use 16px text on phones (no iOS zoom). */
export const controlClass =
  "block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:text-sm";

export function FieldBlock({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-slate-800">
          {label}
          {required && <span className="ml-1 text-xs font-medium text-slate-500">(required)</span>}
        </label>
      ) : (
        <p className="mb-1 text-sm font-semibold text-slate-800">
          {label}
          {required && <span className="ml-1 text-xs font-medium text-slate-500">(required)</span>}
        </p>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A row of big buttons that behave like radio buttons — fewer taps than a dropdown, no typing. */
export function ChoiceChips<T extends string>({
  name,
  options,
  value,
  onChange,
  columns = 2,
}: {
  name: string;
  options: { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={clsx("grid gap-2", columns === 2 && "grid-cols-2", columns === 3 && "grid-cols-2 sm:grid-cols-3", columns === 4 && "grid-cols-2 sm:grid-cols-4")}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
            value === o.value ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {o.label}
          {o.hint && <span className="block text-xs font-normal text-slate-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** A section that starts closed. The header is a 48px tap target. */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
  icon,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
      >
        {icon && <span className="text-slate-400">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900">{title}</span>
          {summary && !open && <span className="block truncate text-sm text-slate-500">{summary}</span>}
        </span>
        <LuChevronDown className={clsx("h-5 w-5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="border-t border-slate-100 px-4 py-4 text-sm text-slate-700 sm:px-5">
          {children}
        </div>
      )}
    </section>
  );
}
