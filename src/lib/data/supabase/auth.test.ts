/**
 * MOCK TESTS — a fake stands in for Supabase Auth. They check what the app asks for and what it tells
 * the person. Real sign-in (real emails, real codes) is tested against a local Supabase Auth server —
 * see supabase/tests/README.md.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { supabaseAuth } from "./auth";

type Err = { message?: string; status?: number; code?: string; name?: string } | null;

function fakeAuth(over: Partial<{ otpError: Err; verifyError: Err; throwOn: "otp" | "verify" }> = {}) {
  const calls: { otp: unknown[]; verify: unknown[]; signOut: unknown[] } = { otp: [], verify: [], signOut: [] };
  let listener: ((e: string, s: { user: { id: string; email?: string } } | null) => void) | null = null;
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithOtp: async (args: unknown) => {
      calls.otp.push(args);
      if (over.throwOn === "otp") throw new TypeError("Failed to fetch");
      return { error: over.otpError ?? null };
    },
    verifyOtp: async (args: unknown) => {
      calls.verify.push(args);
      if (over.throwOn === "verify") throw new TypeError("Load failed");
      return over.verifyError ? { data: { session: null }, error: over.verifyError } : { data: { session: { user: { id: "u1" } } }, error: null };
    },
    signOut: async (args: unknown) => {
      calls.signOut.push(args);
      return { error: null };
    },
    onAuthStateChange: (cb: typeof listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: () => (listener = null) } } };
    },
  };
  return { auth, calls, fire: (s: { user: { id: string; email?: string } } | null) => listener?.("SIGNED_IN", s) };
}

describe("sign-in (MOCK auth service)", () => {
  it("asks for a code WITHOUT ever creating an account (invite-only)", async () => {
    const f = fakeAuth();
    const r = await supabaseAuth(f.auth, "https://app.example").sendCode("  Kody@Example.TEST ");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(f.calls.otp[0], { email: "kody@example.test", options: { shouldCreateUser: false, emailRedirectTo: "https://app.example" } });
  });

  it("answers an uninvited email exactly like an invited one (no way to probe who has an account)", async () => {
    const f = fakeAuth({ otpError: { message: "Signups not allowed for otp", status: 422, code: "otp_disabled" } });
    assert.deepEqual(await supabaseAuth(f.auth).sendCode("stranger@example.test"), { ok: true });
  });

  it("rejects an invalid email before contacting the service", async () => {
    const f = fakeAuth();
    const r = await supabaseAuth(f.auth).sendCode("not-an-email");
    assert.equal(r.ok, false);
    assert.equal(f.calls.otp.length, 0);
  });

  it("explains rate limits and lost connections in plain words", async () => {
    const limited = await supabaseAuth(fakeAuth({ otpError: { message: "email rate limit exceeded", status: 429 } }).auth).sendCode("a@b.co");
    assert.equal(limited.ok, false);
    if (!limited.ok) assert.match(limited.message, /Too many codes/);
    const offline = await supabaseAuth(fakeAuth({ throwOn: "otp" }).auth).sendCode("a@b.co");
    if (!offline.ok) assert.match(offline.message, /Couldn't reach the sign-in service/);
    else assert.fail("should fail");
  });

  it("verifies the typed code (spaces and dashes ignored) as an email code", async () => {
    const f = fakeAuth();
    const r = await supabaseAuth(f.auth).verifyCode("Kody@example.test", "123 456");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(f.calls.verify[0], { email: "kody@example.test", token: "123456", type: "email" });
  });

  it("a wrong or expired code says so, and too-short codes are caught first", async () => {
    const bad = await supabaseAuth(fakeAuth({ verifyError: { message: "Token has expired or is invalid", status: 403 } }).auth).verifyCode("a@b.co", "000000");
    if (!bad.ok) assert.match(bad.message, /didn't work/);
    else assert.fail();
    const f = fakeAuth();
    const short = await supabaseAuth(f.auth).verifyCode("a@b.co", "123");
    assert.equal(short.ok, false);
    assert.equal(f.calls.verify.length, 0);
  });

  it("signs out this device and reports session changes", async () => {
    const f = fakeAuth();
    const a = supabaseAuth(f.auth);
    const seen: unknown[] = [];
    const off = a.onChange((s) => seen.push(s));
    f.fire({ user: { id: "u1", email: "kody@example.test" } });
    f.fire(null);
    off();
    f.fire({ user: { id: "u2" } });
    assert.deepEqual(seen, [{ userId: "u1", email: "kody@example.test" }, null]);
    assert.deepEqual(await a.signOut(), { ok: true });
    assert.deepEqual(f.calls.signOut[0], { scope: "local" });
  });
});
