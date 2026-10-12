"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LuDatabase, LuLogOut, LuTriangleAlert } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { getDataBackend, switchToDemo, type DataBackend, type LeadFinderRepository } from "@/lib/data";
import type { AuthSession, LeadFinderAuth } from "@/lib/data/supabase/auth";
import { SignInScreen } from "./sign-in-screen";

/**
 * Decides what the person sees before any lead data loads:
 *   demo            → the app, on fictional data (clearly labelled)
 *   database        → sign-in first; the app only after a valid session
 *   not set up      → a plain explanation, never a silent switch to demo data
 */
interface BackendState {
  mode: "demo" | "supabase";
  repo: LeadFinderRepository;
  session: AuthSession | null;
  /** Ends the session on this device and returns to the sign-in screen. */
  signOut: () => Promise<void>;
  /** The data layer found the session had ended (expired or signed out elsewhere). */
  sessionLost: () => void;
}

const Ctx = createContext<BackendState | null>(null);

export function useBackend(): BackendState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBackend must be used inside <BackendGate>");
  return ctx;
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">{children}</div>;
}

function Checking() {
  return (
    <FullScreen>
      <div role="status" className="flex items-center gap-3 text-sm font-medium text-slate-600">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
        Checking your sign-in…
      </div>
    </FullScreen>
  );
}

function NotSetUp({ problem, fix, onDemo }: { problem: string; fix: string; onDemo: () => void }) {
  return (
    <FullScreen>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-red-700">
          <LuTriangleAlert className="h-5 w-5" />
          <h1 className="text-base font-bold">The Lead Finder isn't connected</h1>
        </div>
        <p role="alert" className="mt-3 text-sm text-slate-800">{problem}</p>
        <p className="mt-2 text-sm text-slate-600">{fix}</p>
        <p className="mt-2 text-sm text-slate-600">Nothing can be saved until this is fixed.</p>
        <Button variant="secondary" size="lg" className="mt-5 w-full" icon={<LuDatabase className="h-4 w-4" />} onClick={onDemo}>
          Open the demo instead (fictional data)
        </Button>
      </div>
    </FullScreen>
  );
}

export function BackendGate({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<DataBackend | null>(null);
  const [session, setSession] = useState<AuthSession | null | "checking">("checking");

  useEffect(() => setBackend(getDataBackend()), []);

  const auth: LeadFinderAuth | null = backend?.auth ?? null;

  useEffect(() => {
    if (!auth) return;
    let alive = true;
    auth
      .getSession()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null));
    const off = auth.onChange((s) => alive && setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, [auth]);

  const signOut = useCallback(async () => {
    if (auth) await auth.signOut();
    setSession(null);
  }, [auth]);
  const sessionLost = useCallback(() => setSession(null), []);

  const value = useMemo<BackendState | null>(() => {
    if (!backend?.repo) return null;
    if (backend.config.mode === "demo") return { mode: "demo", repo: backend.repo, session: null, signOut: async () => undefined, sessionLost: () => undefined };
    if (session === "checking" || session === null) return null;
    return { mode: "supabase", repo: backend.repo, session, signOut, sessionLost };
  }, [backend, session, signOut, sessionLost]);

  if (!backend) return <Checking />;
  if (backend.config.mode === "misconfigured") {
    return <NotSetUp problem={backend.config.problem} fix={backend.config.fix} onDemo={() => setBackend(switchToDemo())} />;
  }
  if (backend.config.mode === "supabase") {
    if (session === "checking") return <Checking />;
    if (session === null) return <SignInScreen auth={auth!} />;
  }
  if (!value) return <Checking />;
  // Keyed by user, so signing in as someone else never shows the previous person's data.
  return (
    <Ctx.Provider value={value} key={value.session?.userId ?? "demo"}>
      {children}
    </Ctx.Provider>
  );
}

export function SignOutButton({ className, dark = false }: { className?: string; dark?: boolean }) {
  const { mode, signOut } = useBackend();
  const [busy, setBusy] = useState(false);
  if (mode !== "supabase") return null;
  return (
    <Button
      variant={dark ? "ghost" : "secondary"}
      size="lg"
      className={dark ? `w-full justify-start text-slate-200 hover:bg-white/10 hover:text-white ${className ?? ""}` : className}
      icon={<LuLogOut className="h-4 w-4" />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
