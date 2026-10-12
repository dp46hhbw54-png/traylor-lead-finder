import { createClient } from "@supabase/supabase-js";
import { supabaseAuth, type LeadFinderAuth } from "./auth";
import { supabaseDb, type LeadFinderDb, type SupabaseLikeClient } from "./db";

/**
 * The single Supabase connection for this browser — to the DEDICATED Lead Finder project only.
 *
 * Uses the PUBLIC key. There is no secret key anywhere in the app: every request carries the signed-in
 * person's session, and the database's row-level security decides what they can read and change.
 * Only the `lead_finder` schema is used.
 */
export interface LeadFinderBackend {
  db: LeadFinderDb;
  auth: LeadFinderAuth;
}

let backend: LeadFinderBackend | null = null;

export function connectSupabase(url: string, publicKey: string): LeadFinderBackend {
  if (backend) return backend;
  const client = createClient(url, publicKey, {
    db: { schema: "lead_finder" },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // lets an emailed invite link sign the person in
      storageKey: "traylor-lead-finder-auth",
    },
  });
  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  backend = {
    db: supabaseDb(client as unknown as SupabaseLikeClient),
    auth: supabaseAuth(client.auth as unknown as Parameters<typeof supabaseAuth>[0], redirectTo),
  };
  return backend;
}
