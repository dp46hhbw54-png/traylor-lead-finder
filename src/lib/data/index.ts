import { LocalDemoRepository } from "./demo/local-demo-repository";
import type { LeadFinderRepository } from "./repository";

export type { LeadFinderRepository } from "./repository";
export { RepositoryError } from "./repository";

/**
 * Picks the data backend. Phase 1 supports ONLY the local demo repository.
 *
 * When the dedicated Lead Finder Supabase project is approved, add a
 * `SupabaseRepository` implementing `LeadFinderRepository` and return it here
 * when NEXT_PUBLIC_DATA_SOURCE === "supabase". No screen code needs to change.
 */
let instance: LeadFinderRepository | null = null;

export function getRepository(): LeadFinderRepository {
  if (instance) return instance;
  const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "demo";
  if (source !== "demo") {
    // Warn loudly. The UI keeps showing the DEMO / LOCAL DATA banner, so it never pretends to be connected.
    console.warn(
      `[Lead Finder] NEXT_PUBLIC_DATA_SOURCE="${source}" is not available yet. Using local demo data. ` +
        "Supabase support arrives after the dedicated Lead Finder project is approved.",
    );
  }
  instance = new LocalDemoRepository();
  return instance;
}
