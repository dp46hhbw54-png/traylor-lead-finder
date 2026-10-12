/**
 * Which data backend the app runs on, decided from PUBLIC build-time settings only.
 *
 *   NEXT_PUBLIC_DATA_SOURCE            "demo" (default) or "supabase"
 *   NEXT_PUBLIC_SUPABASE_URL           the dedicated Lead Finder project's URL          (public)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY      its public "anon" / "publishable" key           (public)
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  accepted instead of the anon key             (public)
 *
 * The app needs NO server secrets. Every read and write runs as the signed-in person, and the
 * database's row-level security decides what they may see and change. If a secret key is ever pasted
 * into a public setting by mistake, the app refuses to start rather than ship it to every browser.
 */
export type DataSourceConfig =
  | { mode: "demo" }
  | { mode: "supabase"; url: string; publicKey: string }
  | { mode: "misconfigured"; problem: string; fix: string };

export interface PublicEnv {
  NEXT_PUBLIC_DATA_SOURCE?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** Next.js only inlines NEXT_PUBLIC_* values written out literally like this. */
export function readPublicEnv(): PublicEnv {
  return {
    NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

function decodeJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = typeof atob === "function" ? atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")) : Buffer.from(parts[1], "base64url").toString("utf8");
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/** True for keys that must never reach a browser (service-role JWTs and new-style secret keys). */
export function isSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const role = decodeJwtRole(key);
  return role !== null && role !== "anon";
}

export function resolveDataSource(env: PublicEnv = readPublicEnv()): DataSourceConfig {
  const source = (env.NEXT_PUBLIC_DATA_SOURCE ?? "demo").trim().toLowerCase();
  if (source === "" || source === "demo") return { mode: "demo" };
  if (source !== "supabase") {
    return { mode: "misconfigured", problem: `Unknown data source “${source}”.`, fix: "Set NEXT_PUBLIC_DATA_SOURCE to “supabase” (or “demo” for fictional data) and redeploy." };
  }
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const publicKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !publicKey) {
    return {
      mode: "misconfigured",
      problem: "The database connection isn't set up yet.",
      fix: "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    };
  }
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    return { mode: "misconfigured", problem: "The database address must start with https://.", fix: "Copy the Project URL exactly from Supabase → Project Settings → Data API." };
  }
  if (isSecretKey(publicKey)) {
    return {
      mode: "misconfigured",
      problem: "A SECRET database key was put in a public setting. The app refused to start so it isn't shared with every browser.",
      fix: "Replace it with the anon / publishable key, then rotate the secret key in Supabase (Project Settings → API Keys).",
    };
  }
  return { mode: "supabase", url, publicKey };
}
