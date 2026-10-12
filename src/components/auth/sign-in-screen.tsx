"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LuMail } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { normalizeEmail, type LeadFinderAuth } from "@/lib/data/supabase/auth";

const RESEND_SECONDS = 60;

/**
 * Two steps, built for a phone: type your email → type the code from the email.
 * Only people the Owner has invited can get in; this screen can't create accounts.
 */
export function SignInScreen({ auth }: { auth: LeadFinderAuth }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const send = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setError(null);
    setBusy(true);
    const r = await auth.sendCode(email);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setEmail(normalizeEmail(email));
    setCode("");
    setStep("code");
    setWait(RESEND_SECONDS);
  };

  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    const r = await auth.verifyCode(email, code);
    setBusy(false);
    if (!r.ok) setError(r.message);
    // On success the session listener swaps this screen for the app.
  };

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-100 px-4 pb-10 pt-12 sm:items-center sm:pt-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-base font-black text-white">TP</div>
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900">Traylor Pro</p>
            <p className="text-sm text-slate-500">Commercial Lead Finder</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {step === "email" ? (
            <form onSubmit={(e: FormEvent) => void send(e)} noValidate>
              <h1 className="text-lg font-bold text-slate-900">Sign in</h1>
              <p className="mt-1 text-sm text-slate-600">We'll email you a sign-in code. Only invited Traylor Pro accounts can sign in.</p>
              <label htmlFor="si-email" className="mt-4 block text-sm font-medium text-slate-800">
                Email
              </label>
              <input
                id="si-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={`${controlClass} mt-1`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                required
              />
              {error && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={busy || email.trim() === ""} icon={<LuMail className="h-4 w-4" />}>
                {busy ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={(e: FormEvent) => void verify(e)} noValidate>
              <h1 className="text-lg font-bold text-slate-900">Check your email</h1>
              <p className="mt-1 text-sm text-slate-600">
                If <span className="font-semibold text-slate-800">{email}</span> has access, a sign-in code is on its way. It can take a minute — check Junk too.
              </p>
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">First time?</span> Open the invitation email and tap <span className="font-semibold">Accept invitation</span> first — codes only arrive after that.
              </p>
              <label htmlFor="si-code" className="mt-4 block text-sm font-medium text-slate-800">
                Code from the email
              </label>
              <input
                id="si-code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={12}
                className={`${controlClass} mt-1 text-center text-2xl font-semibold tracking-[0.3em]`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-invalid={error ? true : undefined}
                required
              />
              {error && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={busy || code.length < 6}>
                {busy ? "Checking…" : "Sign in"}
              </Button>
              <div className="mt-3 grid grid-cols-2 gap-2 [&>button]:whitespace-nowrap [&>button]:px-2 [&>button]:text-sm">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                  }}
                >
                  Change email
                </Button>
                <Button variant="ghost" size="lg" disabled={busy || wait > 0} onClick={() => void send()}>
                  {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
                </Button>
              </div>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Need access? Ask the Owner to invite your email.</p>
      </div>
    </main>
  );
}
