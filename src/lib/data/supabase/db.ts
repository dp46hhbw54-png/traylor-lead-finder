import type { ChangeSet } from "./rows";

type Row = Record<string, unknown>;

/** Why a database call failed, in terms the app can explain. */
export type DbErrorKind =
  | "network" //       couldn't reach the database at all
  | "signed_out" //    no valid session (expired or signed out)
  | "denied" //        row-level security / permissions said no
  | "conflict" //      someone else changed the record first
  | "invalid" //       the data broke a database rule (bad value, missing field)
  | "unknown";

export class DbError extends Error {
  constructor(
    readonly kind: DbErrorKind,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "DbError";
  }
}

export interface SignedInUser {
  id: string;
  email: string;
}

/** The only things the repository needs from a database. Real: Supabase. Tests: a fake or a local test stack. */
export interface LeadFinderDb {
  currentUser(): Promise<SignedInUser | null>;
  /** Every row the signed-in person may see (row-level security filters the rest). */
  selectAll(table: string, orderBy: string): Promise<Row[]>;
  /** One all-or-nothing save through lead_finder.apply_changes. */
  applyChanges(changes: ChangeSet): Promise<void>;
}

/** Classify a PostgREST / Supabase error (or a thrown fetch error). */
export function classifyDbError(err: unknown, status?: number): DbError {
  if (err instanceof DbError) return err;
  const e = (err ?? {}) as { code?: string; message?: string; details?: string; hint?: string; name?: string };
  const code = typeof e.code === "string" ? e.code : null;
  const text = [e.message, e.details, e.hint].filter(Boolean).join(" ");
  if (err instanceof TypeError || /Failed to fetch|NetworkError|fetch failed|Load failed|network/i.test(text) || e.name === "AbortError") {
    return new DbError("network", text || "Network error", code);
  }
  if (code === "PT409" || /LF_CONFLICT/.test(text) || status === 409) return new DbError("conflict", text, code);
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303" || /JWT expired|invalid JWT|JWSError/i.test(text) || status === 401) {
    return new DbError("signed_out", text, code);
  }
  if (code === "42501" || /LF_NO_ROLE|LF_DENIED|permission denied|row-level security/i.test(text) || status === 403) return new DbError("denied", text, code);
  if (code && /^(22|23|P0001|PGRST1)/.test(code)) return new DbError("invalid", text, code);
  if (/LF_BAD_REQUEST/.test(text)) return new DbError("invalid", text, code);
  return new DbError("unknown", text || "Unknown database error", code);
}

/** Structural type of the parts of the Supabase client library used here (keeps tests free of the real package). */
export interface SupabaseLikeClient {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string; email?: string | null } } | null }; error: unknown }>;
  };
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): {
        range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: unknown; status: number }>;
      };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: unknown; status: number }>;
}

const PAGE = 1000;

export function supabaseDb(client: SupabaseLikeClient): LeadFinderDb {
  return {
    async currentUser() {
      const { data, error } = await client.auth.getSession();
      if (error) throw classifyDbError(error);
      const u = data.session?.user;
      return u ? { id: u.id, email: u.email ?? "" } : null;
    },
    async selectAll(table, orderBy) {
      const all: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        let res: { data: Row[] | null; error: unknown; status: number };
        try {
          res = await client.from(table).select("*").order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
        } catch (err) {
          throw classifyDbError(err);
        }
        if (res.error) throw classifyDbError(res.error, res.status);
        const rows = res.data ?? [];
        all.push(...rows);
        if (rows.length < PAGE) return all;
      }
    },
    async applyChanges(changes) {
      let res: { error: unknown; status: number };
      try {
        res = await client.rpc("apply_changes", { changes });
      } catch (err) {
        throw classifyDbError(err);
      }
      if (res.error) throw classifyDbError(res.error, res.status);
    },
  };
}
