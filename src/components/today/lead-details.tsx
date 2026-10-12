"use client";

import { LuExternalLink } from "react-icons/lu";
import { DataStatusTag } from "@/components/ui/badges";
import { inputClass } from "@/components/ui/dialog";
import { ACTIVITY_TYPE_LABEL, PIPELINE_STATUS_LABEL, POTENTIAL_VALUE_LABEL, POTENTIAL_VALUE_ORDER, RELATIONSHIP_ROLE_LABEL } from "@/lib/domain/labels";
import type { AuditEntry, PipelineStatus, PotentialValue } from "@/lib/domain/types";
import { formatDate } from "@/lib/engine/dates";
import type { LeadView } from "@/lib/engine/evaluate";
import { useLeadFinder } from "@/state/lead-finder-store";

const FIELD_LABEL: Record<string, string> = {
  sqft: "Square footage",
  phone: "Phone",
  email: "Email",
  website: "Website",
  property_manager: "Property manager",
  leasing_company: "Leasing company",
  tenant: "Tenant",
  owner: "Owner",
  operator: "Operator",
};

const AUDIT_FIELD_LABEL: Record<string, string> = {
  potentialValue: "Potential value",
  snoozedUntil: "Snoozed until",
  lastVerifiedAt: "Last verified",
  lostReason: "Lost reason",
  lostReasonCode: "Lost reason",
  notAFitReason: "Not-a-fit reason",
  completedAt: "Completed",
  outcome: "Outcome",
  notes: "Notes",
  sqft: "Square footage",
  sqftStatus: "Square footage confidence",
  propertyId: "Property",
  quoteRequested: "Quote requested",
};

const shortDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatDate(v) : v);

/** Plain-language sentence for one audit row. */
export function describeAudit(e: AuditEntry): string {
  const field = e.field ? AUDIT_FIELD_LABEL[e.field] ?? e.field : null;
  switch (e.action) {
    case "status_change":
      return `Status: ${PIPELINE_STATUS_LABEL[e.oldValue as PipelineStatus] ?? e.oldValue ?? "—"} → ${PIPELINE_STATUS_LABEL[e.newValue as PipelineStatus] ?? e.newValue ?? "—"}${e.note ? ` (${e.note})` : ""}`;
    case "score_change":
      return `Score ${e.oldValue ?? "—"} → ${e.newValue ?? "—"}${e.note ? ` (${e.note.toLowerCase()})` : ""}`;
    case "create":
      return `${e.entityType === "lead" ? "Lead" : e.entityType[0].toUpperCase() + e.entityType.slice(1)} created${e.note ? ` — ${e.note}` : ""}`;
    case "merge":
      return e.note ?? "Records merged";
    case "restore":
      return `Restored to ${PIPELINE_STATUS_LABEL[e.newValue as PipelineStatus] ?? e.newValue ?? "previous status"}`;
    default: {
      const fmt = (v: string | null) =>
        v === null ? "nothing" : e.field === "potentialValue" ? POTENTIAL_VALUE_LABEL[v as PotentialValue] ?? v : shortDate(v) ?? v;
      return `${field ?? "Record"} changed: ${fmt(e.oldValue)} → ${fmt(e.newValue)}${e.note ? ` (${e.note})` : ""}`;
    }
  }
}

/** Behind "Show details": potential value, where key facts came from, and who changed what. Plain language, no database terms. */
export function LeadDetails({ view }: { view: LeadView }) {
  const { snapshot, actions, busy } = useLeadFinder();
  if (!snapshot) return null;
  const { ctx } = view;
  const { lead, property } = ctx;

  // Where did the key facts come from?
  const relationshipIds = snapshot.relationships.filter((r) => r.propertyId === property.id).map((r) => r.id);
  const contactIds = ctx.contacts.map((c) => c.id);
  const companyIds = [ctx.company?.id, ctx.propertyManager?.id, ctx.leasingCompany?.id].filter(Boolean) as string[];
  const wanted = new Set([property.id, lead.id, ...relationshipIds, ...contactIds, ...companyIds]);
  const sourceName = (id: string | null) => snapshot.sources.find((s) => s.id === id)?.name ?? null;
  const entityName = (entityType: string, id: string): string => {
    if (entityType === "property") return property.name;
    if (entityType === "contact") return snapshot.contacts.find((c) => c.id === id)?.name ?? "Contact";
    if (entityType === "company") return snapshot.companies.find((c) => c.id === id)?.name ?? "Business";
    return "Property";
  };
  // Newest note per (record, field) wins; older ones stay in the data as history.
  const latest = new Map<string, (typeof snapshot.provenance)[number]>();
  for (const fp of snapshot.provenance) {
    if (!wanted.has(fp.entityId)) continue;
    const key = `${fp.entityId}:${fp.field}`;
    const prev = latest.get(key);
    if (!prev || fp.recordedAt >= prev.recordedAt) latest.set(key, fp);
  }
  const facts = [...latest.values()].sort((a, b) => a.entityType.localeCompare(b.entityType) || a.field.localeCompare(b.field));

  const history = snapshot.auditLog
    .filter((e) => e.leadId === lead.id || e.entityId === lead.id || e.entityId === property.id)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, 10);

  return (
    <div className="grid gap-5 border-t border-slate-100 bg-white px-4 py-4 text-sm sm:px-5 md:grid-cols-2">
      <section className="space-y-4">
        <div>
          <label htmlFor={`pv-${lead.id}`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Potential opportunity value
          </label>
          <select
            id={`pv-${lead.id}`}
            className={inputClass}
            value={lead.potentialValue}
            disabled={busy}
            onChange={(e) => void actions.setPotentialValue(lead.id, e.target.value as PotentialValue)}
          >
            {POTENTIAL_VALUE_ORDER.map((v) => (
              <option key={v} value={v}>
                {POTENTIAL_VALUE_LABEL[v]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">A quick read for prioritizing — not a quote and not a dollar amount.</p>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Where the key facts came from</h4>
          {facts.length === 0 ? (
            <p className="text-slate-500">Nothing recorded yet. Facts without a source stay “Unknown”.</p>
          ) : (
            <ul className="space-y-1.5">
              {facts.map((fp) => (
                <li key={fp.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {entityName(fp.entityType, fp.entityId)} · {FIELD_LABEL[fp.field] ?? RELATIONSHIP_ROLE_LABEL[fp.field as keyof typeof RELATIONSHIP_ROLE_LABEL] ?? fp.field}
                    </span>
                    <DataStatusTag status={fp.status} />
                  </p>
                  <p className="text-xs text-slate-600">
                    {fp.valueNote ?? "—"}
                    {sourceName(fp.sourceId) && <> · {sourceName(fp.sourceId)}</>}
                    {fp.verifiedAt && <> · verified {formatDate(fp.verifiedAt)}</>}
                    {fp.sourceUrl && (
                      <a href={fp.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Source <LuExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Change history</h4>
        {history.length === 0 ? (
          <p className="text-slate-500">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {history.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <p className="text-slate-800">{describeAudit(e)}</p>
                <p className="text-xs text-slate-500">
                  {e.changedBy} · {formatDate(e.changedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent activity</h4>
        <ul className="space-y-1 text-slate-700">
          {ctx.activities.slice(0, 5).map((a) => (
            <li key={a.id}>
              <span className="font-medium">{ACTIVITY_TYPE_LABEL[a.type]}</span> · <span className="text-slate-600">{a.summary}</span>{" "}
              <span className="text-xs text-slate-500">({formatDate(a.occurredAt)})</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
