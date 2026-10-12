import type { AuditAction, AuditEntity, AuditEntry, LeadFinderSnapshot } from "../domain/types";

/**
 * Everything a workflow rule needs to know about "who is doing this and when".
 * Injected so tests are deterministic and the Supabase repository can pass the signed-in user.
 */
export interface MutationContext {
  now: Date;
  /** Display name of the person (or system) making the change. */
  by: string;
  newId: (prefix: string) => string;
  /** True in the local demo — every record created gets flagged `isDemo` so it can never pass as real. */
  isDemo: boolean;
}

let counter = 0;
/** Unique-enough ids for local demo data. The database generates UUIDs instead. */
export function defaultNewId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface AuditInput {
  entityType: AuditEntity;
  entityId: string;
  leadId?: string | null;
  action: AuditAction;
  field?: string | null;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  note?: string | null;
}

/** Append one row to the audit log. The log is never edited or trimmed. */
export function pushAudit(s: LeadFinderSnapshot, m: MutationContext, e: AuditInput): AuditEntry {
  const entry: AuditEntry = {
    id: m.newId("aud"),
    entityType: e.entityType,
    entityId: e.entityId,
    leadId: e.leadId ?? null,
    action: e.action,
    field: e.field ?? null,
    oldValue: e.oldValue === undefined || e.oldValue === null ? null : String(e.oldValue),
    newValue: e.newValue === undefined || e.newValue === null ? null : String(e.newValue),
    changedBy: m.by,
    changedAt: m.now.toISOString(),
    note: e.note ?? null,
  };
  s.auditLog.push(entry);
  return entry;
}

/** Set a field and, if the value really changed, audit it. Returns true when something changed. */
export function setAudited<T extends { id: string; updatedAt: string }, K extends keyof T & string>(
  s: LeadFinderSnapshot,
  m: MutationContext,
  entityType: AuditEntity,
  row: T,
  field: K,
  value: T[K],
  leadId: string | null = null,
  note: string | null = null,
): boolean {
  const old = row[field];
  if (old === value) return false;
  row[field] = value;
  row.updatedAt = m.now.toISOString();
  pushAudit(s, m, {
    entityType,
    entityId: row.id,
    leadId,
    action: "update",
    field,
    oldValue: old as string | number | null,
    newValue: value as string | number | null,
    note,
  });
  return true;
}
