/**
 * Email sign-in with a one-time code — invite-only.
 *
 *  - `shouldCreateUser: false`: asking for a code can NEVER create an account. Only an Owner can add
 *    people (Supabase → Authentication → Users → Invite / Add user). Public sign-ups are also switched
 *    off in the project, so this is enforced twice.
 *  - A code (typed in) is used instead of relying on a link, because on an iPhone a link from Mail can
 *    open in a different browser than the one you're using the app in.
 *  - Messages never reveal whether an email address has an account.
 */
export interface AuthSession {
  userId: string;
  email: string;
}

export type AuthResult = { ok: true } | { ok: false; message: string };

export interface LeadFinderAuth {
  getSession(): Promise<AuthSession | null>;
  sendCode(email: string): Promise<AuthResult>;
  verifyCode(email: string, code: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  /** Called when the session starts, ends or is refreshed. Returns an unsubscribe function. */
  onChange(cb: (session: AuthSession | null) => void): () => void;
}

interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}

interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: { user: { id: string; email?: string | null } } | null }; error: AuthErrorLike | null }>;
  signInWithOtp(args: { email: string; options?: { shouldCreateUser?: boolean; emailRedirectTo?: string } }): Promise<{ error: AuthErrorLike | null }>;
  verifyOtp(args: { email: string; token: string; type: "email" }): Promise<{ data: { session: unknown }; error: AuthErrorLike | null }>;
  signOut(args?: { scope?: "local" | "global" | "others" }): Promise<{ error: AuthErrorLike | null }>;
  onAuthStateChange(cb: (event: string, session: { user: { id: string; email?: string | null } } | null) => void): { data: { subscription: { unsubscribe(): void } } };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const normalizeCode = (c: string) => c.replace(/\D/g, "");

function isNetwork(e: AuthErrorLike | null | undefined, thrown?: unknown) {
  return thrown instanceof TypeError || /fetch|network|Load failed/i.test(e?.message ?? "") || e?.name === "AuthRetryableFetchError" || e?.status === 0;
}

const NETWORK: AuthResult = { ok: false, message: "Couldn't reach the sign-in service. Check your signal or Wi-Fi and try again." };

export function supabaseAuth(auth: SupabaseAuthLike, redirectTo?: string): LeadFinderAuth {
  const toSession = (s: { user: { id: string; email?: string | null } } | null): AuthSession | null => (s ? { userId: s.user.id, email: s.user.email ?? "" } : null);
  return {
    async getSession() {
      const { data } = await auth.getSession();
      return toSession(data.session);
    },
    async sendCode(rawEmail) {
      const email = normalizeEmail(rawEmail);
      if (!EMAIL.test(email)) return { ok: false, message: "Enter a valid email address." };
      try {
        const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
        if (!error) return { ok: true };
        if (isNetwork(error)) return NETWORK;
        if (error.status === 429 || /rate limit|too many|security purposes/i.test(error.message ?? "")) {
          return { ok: false, message: "Too many codes requested. Wait a minute, then try again." };
        }
        // Not invited / sign-ups disabled: answer exactly like success so nobody can probe which emails have accounts.
        if (/signup|sign up|not allowed|not found|otp_disabled|user_not_found/i.test(`${error.message} ${error.code}`)) return { ok: true };
        return { ok: false, message: "Couldn't send a code right now. Try again in a minute." };
      } catch (err) {
        return isNetwork(null, err) ? NETWORK : { ok: false, message: "Couldn't send a code right now. Try again in a minute." };
      }
    },
    async verifyCode(rawEmail, rawCode) {
      const email = normalizeEmail(rawEmail);
      const code = normalizeCode(rawCode);
      if (code.length < 6) return { ok: false, message: "Enter the code from the email (at least 6 digits)." };
      try {
        const { data, error } = await auth.verifyOtp({ email, token: code, type: "email" });
        if (!error && data.session) return { ok: true };
        if (isNetwork(error)) return NETWORK;
        if (error?.status === 429) return { ok: false, message: "Too many tries. Wait a minute, then request a new code." };
        return { ok: false, message: "That code didn't work. It may have expired or been mistyped — request a new code and try again." };
      } catch (err) {
        return isNetwork(null, err) ? NETWORK : { ok: false, message: "Couldn't check the code right now. Try again." };
      }
    },
    async signOut() {
      try {
        const { error } = await auth.signOut({ scope: "local" });
        return error ? { ok: false, message: "Couldn't sign out cleanly. Close the app's tab to be safe." } : { ok: true };
      } catch {
        return { ok: false, message: "Couldn't sign out cleanly. Close the app's tab to be safe." };
      }
    },
    onChange(cb) {
      const { data } = auth.onAuthStateChange((_event, session) => cb(toSession(session)));
      return () => data.subscription.unsubscribe();
    },
  };
}
