"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LuMenu, LuX } from "react-icons/lu";
import { APP_NAME, CURRENT_PHASE, NAV_ITEMS } from "./nav-items";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-black tracking-tight text-white">TP</div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-bold text-white">Traylor Pro</p>
        {!compact && <p className="truncate text-xs text-slate-400">Commercial Lead Finder</p>}
      </div>
    </div>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className={clsx("h-[18px] w-[18px]", active ? "text-brand-100" : "text-slate-400")} />
            <span className="flex-1">{item.label}</span>
            {item.phase > CURRENT_PHASE && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950 sm:text-sm">
      <span className="mr-1.5 rounded bg-amber-950 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-amber-300">Demo / Local data</span>
      Fictional records only · No database connected · Nothing here is a real prospect
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen">
      <DemoBanner />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden">
        <Brand compact />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-slate-200 hover:bg-white/10"
          aria-label="Open menu"
          aria-expanded={open}
        >
          <LuMenu className="h-6 w-6" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-slate-900 px-3 py-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between px-2">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Close menu">
                <LuX className="h-5 w-5" />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 px-3 py-5 lg:flex">
          <div className="px-2">
            <Brand />
          </div>
          <div className="mt-6 flex-1 overflow-y-auto">
            <NavList pathname={pathname} />
          </div>
          <p className="px-3 text-[11px] leading-snug text-slate-500">Phase {CURRENT_PHASE} · Local demo build</p>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pt-8">{children}</div>
        </main>
      </div>
      <span className="sr-only">{APP_NAME}</span>
    </div>
  );
}
