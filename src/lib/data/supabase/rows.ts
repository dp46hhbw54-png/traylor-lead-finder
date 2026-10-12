import type { LeadFinderSnapshot } from "../../domain/types";
import { RepositoryError } from "../../domain/errors";

/** Snapshot list → database table in the `lead_finder` schema. */
export const TABLE_FOR = {
  markets: "markets",
  sources: "sources",
  companies: "companies",
  properties: "properties",
  contacts: "contacts",
  relationships: "property_relationships",
  leads: "leads",
  sourceRecords: "source_records",
  signals: "opportunity_signals",
  scoreBreakdowns: "lead_score_breakdowns",
  provenance: "field_provenance",
  activities: "activities",
  followups: "followups",
  walkthroughs: "walkthroughs",
  auditLog: "audit_log",
  duplicateDecisions: "duplicate_decisions",
  settings: "lead_settings",
  userRoles: "user_roles",
} as const satisfies Record<Exclude<keyof LeadFinderSnapshot, "schemaVersion" | "generatedAt">, string>;

export type SnapshotKey = keyof typeof TABLE_FOR;
export const SNAPSHOT_KEYS = Object.keys(TABLE_FOR) as SnapshotKey[];

/** History: may be added to, never changed (enforced again by the database). */
export const HISTORY_KEYS: readonly SnapshotKey[] = ["scoreBreakdowns", "provenance", "activities", "auditLog", "duplicateDecisions"];
/** Never written by the app's save path (roles are managed by an Owner in the database). */
export const READ_ONLY_KEYS: readonly SnapshotKey[] = ["userRoles"];

export const primaryKeyOf = (key: SnapshotKey) => (key === "settings" ? "key" : "id");

/** Columns holding JSON documents: stored as-is, never renamed inside. */
const JSON_FIELDS = new Set(["lines", "payload", "value"]);

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function toRow(obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) row[toSnake(k)] = v;
  return row;
}

export function fromRow(row: Record<string, unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) obj[toCamel(k)] = JSON_FIELDS.has(k) ? v : v;
  return obj;
}

type Row = Record<string, unknown>;
export interface ChangeSet {
  rows: Record<string, Row[]>;
  /** table → id → updated_at the app last saw. The database refuses the save if it changed since. */
  expected: Record<string, Record<string, string>>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed between the loaded data and the edited copy, as the minimal set of rows to save.
 * New rows are sent whole; changed rows send only their changed fields. Nothing is ever deleted —
 * if a rule tried to remove a row or rewrite history, that's a bug and the save is stopped.
 */
export function computeChanges(before: LeadFinderSnapshot, after: LeadFinderSnapshot): ChangeSet {
  const out: ChangeSet = { rows: {}, expected: {} };
  for (const key of SNAPSHOT_KEYS) {
    const pk = primaryKeyOf(key);
    const table = TABLE_FOR[key];
    const prev = new Map<string, Row>((before[key] as unknown as Row[]).map((r) => [String(r[pk]), r]));
    const next = after[key] as unknown as Row[];
    const nextIds = new Set(next.map((r) => String(r[pk])));
    for (const id of prev.keys()) {
      if (!nextIds.has(id)) throw new RepositoryError("Something tried to delete a record, so nothing was saved.", "Nothing is ever deleted in the Lead Finder. Please report this.");
    }
    const changed: Row[] = [];
    for (const r of next) {
      const id = String(r[pk]);
      const old = prev.get(id);
      if (!old) {
        if (READ_ONLY_KEYS.includes(key)) throw new RepositoryError("Users and roles can't be changed here.", "An Owner manages who has access in the database.");
        changed.push(toRow(r));
        continue;
      }
      const diff: Row = {};
      for (const f of new Set([...Object.keys(old), ...Object.keys(r)])) if (!same(old[f], r[f])) diff[f] = r[f];
      if (Object.keys(diff).length === 0) continue;
      if (HISTORY_KEYS.includes(key)) throw new RepositoryError("History can't be rewritten, so nothing was saved.", "Activity, change history and duplicate decisions are permanent. Please report this.");
      if (READ_ONLY_KEYS.includes(key)) throw new RepositoryError("Users and roles can't be changed here.", "An Owner manages who has access in the database.");
      changed.push(toRow({ [pk]: r[pk], ...diff }));
      if (typeof old.updatedAt === "string") (out.expected[table] ??= {})[id] = old.updatedAt;
    }
    if (changed.length) out.rows[table] = changed;
  }
  return out;
}

export const isEmptyChangeSet = (c: ChangeSet) => Object.keys(c.rows).length === 0;

/** RFC 4122 v4 id. crypto.randomUUID needs https; getRandomValues works everywhere (e.g. a phone on local Wi-Fi). */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
