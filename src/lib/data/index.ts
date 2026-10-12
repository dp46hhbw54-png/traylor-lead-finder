import { LocalDemoRepository } from "./demo/local-demo-repository";
import type { LeadFinderRepository } from "./repository";
import type { LeadFinderAuth } from "./supabase/auth";
import { connectSupabase } from "./supabase/client";
import { resolveDataSource, type DataSourceConfig } from "./supabase/config";
import { SupabaseRepository } from "./supabase/supabase-repository";

export type { LeadFinderRepository } from "./repository";
export { RepositoryError } from "./repository";
export { NoAccessError, SignedOutError } from "./supabase/supabase-repository";

/**
 * Picks the data backend from public build settings (see supabase/config.ts):
 *
 *   NEXT_PUBLIC_DATA_SOURCE unset or "demo"  → fictional demo data in this browser (the fallback)
 *   NEXT_PUBLIC_DATA_SOURCE = "supabase"     → the dedicated Lead Finder database, with sign-in
 *
 * If "supabase" is asked for but not set up correctly, the app does NOT quietly fall back to demo
 * data (real leads typed into the demo would be lost). It shows what's wrong instead.
 */
export interface DataBackend {
  config: DataSourceConfig;
  repo: LeadFinderRepository | null;
  auth: LeadFinderAuth | null;
}

let instance: DataBackend | null = null;

export function getDataBackend(): DataBackend {
  if (instance) return instance;
  const config = resolveDataSource();
  if (config.mode === "supabase") {
    const { db, auth } = connectSupabase(config.url, config.publicKey);
    instance = { config, repo: new SupabaseRepository(db), auth };
  } else if (config.mode === "demo") {
    instance = { config, repo: new LocalDemoRepository(), auth: null };
  } else {
    instance = { config, repo: null, auth: null };
  }
  return instance;
}

/** Open the fictional demo on purpose (from the "not set up" screen). Clearly labelled as demo everywhere. */
export function switchToDemo(): DataBackend {
  instance = { config: { mode: "demo" }, repo: new LocalDemoRepository(), auth: null };
  return instance;
}

export function getRepository(): LeadFinderRepository {
  const { repo } = getDataBackend();
  if (!repo) throw new Error("No data backend is configured.");
  return repo;
}
