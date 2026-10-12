"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBuilding2,
  LuCalendarCheck,
  LuChevronDown,
  LuCopy,
  LuExternalLink,
  LuHistory,
  LuHourglass,
  LuLink,
  LuMail,
  LuPhone,
  LuTarget,
  LuUser,
} from "react-icons/lu";
import { PrimaryActionButton, SecondaryActions } from "@/components/leads/lead-actions";
import { LeadActionDialog, type ActionMode } from "@/components/today/action-dialogs";
import { describeAudit } from "@/components/today/lead-details";
import { DataStatusTag, DemoTag, PotentialValueTag, ScoreBadge, SignalChip, StatusPill } from "@/components/ui/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { controlClass, Disclosure } from "@/components/ui/form";
import { WithData } from "@/components/ui/screen";
import { EmptyState } from "@/components/ui/states";
import {
  ACTIVITY_TYPE_LABEL,
  CONTACT_METHOD_LABEL,
  DATA_STATUS_LABEL,
  DUPLICATE_DECISION_LABEL,
  FACILITY_TYPE_LABEL,
  OPPORTUNITY_TYPE_LABEL,
  POTENTIAL_VALUE_LABEL,
  POTENTIAL_VALUE_ORDER,
  RELATIONSHIP_ROLE_LABEL,
  SIGNAL_DEFINITIONS,
  SOURCE_KIND_LABEL,
  SOURCE_VERIFICATION_LABEL,
  WALKTHROUGH_OUTCOME_LABEL,
} from "@/lib/domain/labels";
import type { PotentialValue } from "@/lib/domain/types";
import { formatDate, formatDateTime } from "@/lib/engine/dates";
import { DUPLICATE_REASON_LABEL, type DuplicateReason } from "@/lib/engine/duplicates";
import type { LeadView } from "@/lib/engine/evaluate";
import { opportunityTypeOf } from "@/lib/engine/lead-search";
import { openDuplicatesOf } from "@/lib/workflow/duplicate-review";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";

const sectionTitle = "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500";
const unknown = <span className="text-slate-400">Unknown</span>;

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const views = useEvaluatedLeads();
  const { snapshot } = useLeadFinder();
  const view = views.find((v) => v.ctx.lead.id === leadId);
  const merged = snapshot?.leads.find((l) => l.id === leadId && l.mergedIntoLeadId);
  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
        <LuArrowLeft className="h-4 w-4" /> All leads
      </Link>
      <WithData>
        {merged ? (
          <EmptyState
            title="This lead was merged into another one"
            description="Nothing was deleted — its sources, activity, notes and history now live on the lead it was merged into."
            action={
              <Link href={`/leads/${merged.mergedIntoLeadId}`} className={buttonClass("primary")}>
                Open that lead
              </Link>
            }
          />
        ) : !view ? (
          <EmptyState
            title="We couldn't find that lead"
            description="It may have been removed from this demo (for example after “Reset demo data”)."
            action={
              <Link href="/leads" className={buttonClass("primary")}>
                Go to all leads
              </Link>
            }
          />
        ) : (
          <LeadDetail view={view} />
        )}
      </WithData>
    </>
  );
}

function LeadDetail({ view }: { view: LeadView }) {
  const { snapshot, actions, busy, now } = useLeadFinder();
  const views = useEvaluatedLeads();
  const [dialog, setDialog] = useState<ActionMode | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  const { ctx, score, action, contact } = view;
  const { lead, property, company } = ctx;
  const headline = company?.name ?? property.name;
  const opp = opportunityTypeOf(view);
  const s = snapshot!;

  const duplicates = useMemo(() => openDuplicatesOf(s, lead.id), [s, lead.id]);
  const sourceRecords = s.sourceRecords.filter((r) => r.importedLeadId === lead.id || r.id === lead.sourceRecordId);
  const mergedLeadIds = s.leads.filter((l) => l.mergedIntoLeadId === lead.id).map((l) => l.id);
  const decisions = (s.duplicateDecisions ?? []).filter((d) => d.resultLeadId === lead.id || d.candidateLeadIds.includes(lead.id));
  const breakdowns = s.scoreBreakdowns.filter((b) => b.leadId === lead.id || mergedLeadIds.includes(b.leadId)).sort((a, b) => b.computedAt.localeCompare(a.computedAt));
  const audit = s.auditLog.filter((e) => e.leadId === lead.id || e.entityId === lead.id || e.entityId === property.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const relationshipIds = s.relationships.filter((r) => r.propertyId === property.id).map((r) => r.id);
  const provenance = s.provenance
    .filter((fp) => [property.id, lead.id, company?.id, ctx.propertyManager?.id, ...relationshipIds, ...ctx.contacts.map((c) => c.id)].includes(fp.entityId))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const tenants = s.relationships.filter((r) => r.propertyId === property.id && ["tenant", "owner", "operator"].includes(r.role));
  const companyName = (id: string) => s.companies.find((c) => c.id === id)?.name ?? "Unknown";
  const sourceName = (id: string | null) => (id ? s.sources.find((x) => x.id === id)?.name ?? null : null);

  return (
    <article data-lead-detail={lead.id} className="space-y-3">
      {/* ------------------------------------------------ TOP: what you need to decide */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <StatusPill status={lead.status} />
              {lead.potentialValue !== "unknown" ? <PotentialValueTag value={lead.potentialValue} /> : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Potential: Unknown</span>}
              <span className="font-medium text-slate-600">
                {view.freshness.icon} {view.freshness.label}
              </span>
              {lead.isDemo && <DemoTag />}
            </div>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-slate-900">{headline}</h1>
            <p className="text-sm text-slate-600">
              {company && company.name !== property.name ? `${property.name} · ` : ""}
              {property.city}
            </p>
            <p className="mt-2 text-base font-medium text-slate-800">
              <span className="mr-2 rounded-full bg-slate-900 px-2 py-0.5 align-middle text-xs font-semibold text-white">{OPPORTUNITY_TYPE_LABEL[opp]}</span>
              {lead.title}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ScoreBadge score={score.score} tier={score.tier} size="lg" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setScoreOpen((v) => !v)}
          aria-expanded={scoreOpen}
          className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
        >
          {scoreOpen ? "Hide score details" : "View score details"} <LuChevronDown className={clsx("h-4 w-4 transition-transform", scoreOpen && "rotate-180")} />
        </button>
        {scoreOpen && (
          <div className="mt-1 rounded-xl bg-slate-50 p-3 text-sm" aria-label="Score details">
            <ul className="space-y-1">
              {score.lines.map((l) => (
                <li key={l.key} className="flex gap-2">
                  <span className={clsx("w-10 shrink-0 text-right font-bold tabular-nums", l.points >= 0 ? "text-emerald-700" : "text-red-700")}>
                    {l.points > 0 ? `+${l.points}` : l.points}
                  </span>
                  <span>
                    {l.label}
                    {l.detail && <span className="text-slate-500"> — {l.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Total before the 0–100 cap: {score.raw}. Shown score: {score.score}. Rule-based — the same facts always give the same score.
            </p>
          </div>
        )}

        <section className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-100">
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
            <LuHourglass className="h-3.5 w-3.5" /> Why now
          </h2>
          <ul className="space-y-1 text-sm text-amber-950">
            {view.whyNow.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>

        <div className="mt-3 rounded-xl border-l-4 border-brand-500 bg-brand-50 px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Next step</p>
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <LuArrowRight className="h-4 w-4 shrink-0 text-brand-600" />
            {action.label}
          </p>
          <p className="text-xs text-slate-600">{action.reason}</p>
          {(contact.name || contact.phone || contact.email) && (
            <p className="mt-2 text-sm text-slate-700">
              {contact.name && <span className="font-medium text-slate-900">{contact.name}</span>}
              {contact.role && <span> — {contact.role}</span>}
              {contact.phone && (
                <a className="ml-3 inline-flex min-h-8 items-center gap-1 text-brand-700 hover:underline" href={`tel:${contact.phone}`}>
                  <LuPhone className="h-3.5 w-3.5" /> {contact.phone}
                </a>
              )}
            </p>
          )}
          <PrimaryActionButton view={view} onAction={setDialog} />
        </div>
        <SecondaryActions view={view} onAction={setDialog} />
      </section>

      {/* ------------------------------------------------ Possible duplicates (only when there are some) */}
      {duplicates.length > 0 && (
        <DuplicateReview leadId={lead.id} pairs={duplicates.map((d) => ({ otherId: d.leadId === lead.id ? d.duplicateId : d.leadId, reasons: d.reasons }))} views={views} />
      )}

      {/* ------------------------------------------------ Details, closed until asked */}
      <Disclosure title="Property" icon={<LuBuilding2 className="h-5 w-5" />} summary={`${FACILITY_TYPE_LABEL[property.facilityType]} · ${property.sqft ? `${property.sqft.toLocaleString("en-US")} sq ft` : "size unknown"} · ${ctx.propertyManager ? `Manager: ${ctx.propertyManager.name}` : "manager not identified"}`}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row label="Address">{property.address || unknown}</Row>
          <Row label="City / ZIP">{[property.city, property.zip].filter(Boolean).join(" ") || unknown}</Row>
          <Row label="Parish">{property.parish || unknown}</Row>
          <Row label="Type">{FACILITY_TYPE_LABEL[property.facilityType]}</Row>
          <Row label="Size">
            {property.sqft ? `${property.sqft.toLocaleString("en-US")} sq ft ` : <span className="text-slate-400">Unknown </span>}
            <DataStatusTag status={property.sqftStatus} />
          </Row>
          <Row label="Construction">{property.constructionStatus || unknown}</Row>
          <Row label="Property manager">{ctx.propertyManager?.name ?? <span className="text-slate-400">Not identified</span>}</Row>
          <Row label="Leasing company">{ctx.leasingCompany?.name ?? unknown}</Row>
          <Row label="Tenant / business">{tenants.length ? tenants.map((r) => `${companyName(r.companyId)} (${RELATIONSHIP_ROLE_LABEL[r.role]})`).join(", ") : unknown}</Row>
        </dl>
      </Disclosure>

      <Disclosure title="Contact" icon={<LuUser className="h-5 w-5" />} summary={contact.name ? `${contact.name}${contact.role ? ` — ${contact.role}` : ""}` : "No public contact found yet"}>
        {ctx.contacts.length === 0 && !company?.phone && !company?.email ? (
          <p className="text-slate-500">No public contact found yet. Nothing is guessed — add one when you find it.</p>
        ) : (
          <ul className="space-y-3">
            {ctx.contacts.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 px-3 py-2">
                <p className="font-semibold text-slate-900">
                  {c.name} {c.role && <span className="font-normal text-slate-600">— {c.role}</span>}
                </p>
                <p className="text-xs text-slate-500">{c.companyId ? companyName(c.companyId) : property.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="inline-flex min-h-8 items-center gap-1 text-brand-700 hover:underline">
                      <LuPhone className="h-3.5 w-3.5" /> {c.phone}
                    </a>
                  ) : (
                    <span className="text-slate-400">No public phone</span>
                  )}
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="inline-flex min-h-8 items-center gap-1 break-all text-brand-700 hover:underline">
                      <LuMail className="h-3.5 w-3.5" /> {c.email}
                    </a>
                  ) : (
                    <span className="text-slate-400">No public email</span>
                  )}
                  <DataStatusTag status={c.dataStatus} />
                </p>
              </li>
            ))}
            {[company, ctx.propertyManager].filter(Boolean).map((co) => (
              <li key={co!.id} className="text-slate-700">
                <span className="font-medium">{co!.name}</span>
                {co!.phone && <> · <a href={`tel:${co!.phone}`} className="text-brand-700 hover:underline">{co!.phone}</a></>}
                {co!.email && <> · <a href={`mailto:${co!.email}`} className="text-brand-700 hover:underline">{co!.email}</a></>}
                {co!.website && (
                  <>
                    {" "}·{" "}
                    <a href={co!.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      Website <LuExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      <Disclosure title="Opportunity" icon={<LuTarget className="h-5 w-5" />} summary={`${ctx.signals.length} signal${ctx.signals.length === 1 ? "" : "s"} · ${POTENTIAL_VALUE_LABEL[lead.potentialValue]}`}>
        <div className="space-y-4">
          <div>
            <p className={sectionTitle}>Why this lead</p>
            <ul className="space-y-1">
              {view.why.length === 0 && <li className="text-slate-500">No confirmed signals yet — unconfirmed ones are listed below but don't add points.</li>}
              {view.why.map((w) => (
                <li key={w.text} className="flex gap-2">
                  <span className="h-5 w-8 shrink-0 rounded bg-emerald-50 text-center text-xs font-bold leading-5 text-emerald-700 tabular-nums">+{w.points}</span>
                  {w.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={sectionTitle}>Signals (the evidence)</p>
            <ul className="space-y-2">
              {ctx.signals.map((g) => (
                <li key={g.id} className="rounded-xl border border-slate-200 px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <SignalChip type={g.type} />
                    <DataStatusTag status={g.confidence} />
                  </p>
                  <p className="mt-1">{g.description}</p>
                  <p className="text-xs text-slate-500">
                    {sourceName(g.sourceId) ?? "Source unknown"} · found {formatDate(g.discoveredAt)}
                    {g.expectedDate && <> · expected {formatDate(g.expectedDate)}</>}
                    {g.verifiedAt && <> · verified {formatDate(g.verifiedAt)}{g.verifiedBy ? ` by ${g.verifiedBy}` : ""}</>}
                    {g.sourceUrl && (
                      <a href={g.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Source <LuExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="max-w-sm">
            <label htmlFor={`pv-${lead.id}`} className={sectionTitle + " block"}>
              Potential opportunity value
            </label>
            <select id={`pv-${lead.id}`} className={controlClass} value={lead.potentialValue} disabled={busy} onChange={(e) => void actions.setPotentialValue(lead.id, e.target.value as PotentialValue)}>
              {POTENTIAL_VALUE_ORDER.map((v) => (
                <option key={v} value={v}>
                  {POTENTIAL_VALUE_LABEL[v]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">A quick read for prioritizing — not a quote and not a dollar amount.</p>
          </div>
          {lead.notes && (
            <div>
              <p className={sectionTitle}>Notes</p>
              <p className="whitespace-pre-line">{lead.notes}</p>
            </div>
          )}
        </div>
      </Disclosure>

      <Disclosure title="Sources" icon={<LuLink className="h-5 w-5" />} summary={sourceRecords.map((r) => r.title ?? r.sourceName).join(" · ") || "Source unknown"}>
        <ul className="space-y-2">
          {sourceRecords.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 px-3 py-2" data-source-record={r.id}>
              <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {r.title ?? r.sourceName}
                {r.kind && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{SOURCE_KIND_LABEL[r.kind]}</span>}
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    r.verification === "verified" ? "bg-emerald-50 text-emerald-800" : r.verification === "unavailable" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {SOURCE_VERIFICATION_LABEL[r.verification]}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {r.sourceName} · found {formatDate(r.discoveredAt)}
                {r.lastVerifiedAt ? ` · checked ${formatDate(r.lastVerifiedAt)}${r.verifiedBy ? ` by ${r.verifiedBy}` : ""}` : " · not checked yet"}
                {r.externalId && ` · reference ${r.externalId}`}
              </p>
              {r.sourceUrl ? (
                <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-8 items-center gap-1 break-all text-brand-700 hover:underline">
                  {r.sourceUrl} <LuExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-xs text-slate-500">No link was given.</p>
              )}
              {r.note && <p className="mt-1 text-xs text-amber-900">{r.note}</p>}
            </li>
          ))}
        </ul>
        <Button className="mt-3 min-h-11" variant="secondary" disabled={busy} onClick={() => void actions.markVerified(lead.id)}>
          I checked this lead's information today
        </Button>
        <p className="mt-1 text-xs text-slate-500">The app never opens links itself — only a person can mark information as checked.</p>
      </Disclosure>

      <Disclosure title="Activity" icon={<LuCalendarCheck className="h-5 w-5" />} summary={view.lastContactAt ? `Last contact ${formatDate(view.lastContactAt)}` : "Never contacted"}>
        <div className="space-y-4">
          {(ctx.openFollowups.length > 0 || ctx.walkthroughs.length > 0) && (
            <div>
              <p className={sectionTitle}>Scheduled</p>
              <ul className="space-y-1">
                {ctx.openFollowups.map((f) => (
                  <li key={f.id}>
                    Follow-up ({CONTACT_METHOD_LABEL[f.method]}) · {formatDateTime(f.dueAt)} {f.notes && <span className="text-slate-500">— {f.notes}</span>}
                  </li>
                ))}
                {ctx.walkthroughs.map((w) => (
                  <li key={w.id}>
                    Walkthrough · {formatDateTime(w.scheduledAt)}
                    {w.completedAt ? ` · done${w.outcome ? `: ${WALKTHROUGH_OUTCOME_LABEL[w.outcome]}` : " (outcome not recorded)"}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className={sectionTitle}>Timeline</p>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
              {ctx.activities.map((a) => (
                <li key={a.id}>
                  <p>
                    <span className="font-semibold">{ACTIVITY_TYPE_LABEL[a.type]}</span> · {a.summary}
                    {a.outcome && <span className="text-slate-500"> — {a.outcome}</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(a.occurredAt)} · {a.performedBy}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Disclosure>

      <Disclosure title="History" icon={<LuHistory className="h-5 w-5" />} summary="Status and score changes, where facts came from, duplicate decisions">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className={sectionTitle}>Changes</p>
            {audit.length === 0 ? (
              <p className="text-slate-500">No changes recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {audit.slice(0, 25).map((e) => (
                  <li key={e.id}>
                    {describeAudit(e)}
                    <span className="block text-xs text-slate-500">
                      {e.changedBy} · {formatDateTime(e.changedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className={sectionTitle + " mt-4"}>Score history</p>
            <ul className="space-y-1">
              {breakdowns.map((b) => (
                <li key={b.id}>
                  {b.score} ({b.tier}){b.capped && ` — capped from ${b.rawScore}`} <span className="text-xs text-slate-500">· {formatDateTime(b.computedAt)}{b.leadId !== lead.id ? " · from a merged lead" : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={sectionTitle}>Where the facts came from</p>
            {provenance.length === 0 ? (
              <p className="text-slate-500">Nothing recorded. Facts without a source stay “Unknown”.</p>
            ) : (
              <ul className="space-y-1.5">
                {provenance.map((fp) => (
                  <li key={fp.id}>
                    {fp.valueNote ?? fp.field} <DataStatusTag status={fp.status} />
                    <span className="block text-xs text-slate-500">
                      {DATA_STATUS_LABEL[fp.status]} · {sourceName(fp.sourceId) ?? "source unknown"} · {formatDate(fp.recordedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className={sectionTitle + " mt-4"}>Duplicate decisions</p>
            {decisions.length === 0 ? (
              <p className="text-slate-500">None.</p>
            ) : (
              <ul className="space-y-1.5">
                {decisions.map((d) => (
                  <li key={d.id}>
                    {DUPLICATE_DECISION_LABEL[d.decision]} — {d.subject}
                    <span className="block text-xs text-slate-500">
                      {d.reasons.map((r) => DUPLICATE_REASON_LABEL[r as DuplicateReason] ?? (r === "same_file_row" ? "Same building in the same file" : r)).join(", ")} · {d.decidedBy} · {formatDateTime(d.decidedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Disclosure>

      <LeadActionDialog mode={dialog} view={dialog ? view : null} onClose={() => setDialog(null)} />
      <span className="sr-only">Generated {formatDate(now.toISOString())}</span>
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}

function DuplicateReview({ leadId, pairs, views }: { leadId: string; pairs: { otherId: string; reasons: DuplicateReason[] }[]; views: LeadView[] }) {
  const { actions, busy } = useLeadFinder();
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5" aria-label="Possible duplicate">
      <h2 className="flex items-center gap-2 font-semibold text-amber-950">
        <LuCopy className="h-5 w-5" /> Possible duplicate
      </h2>
      <ul className="mt-2 space-y-3">
        {pairs.map(({ otherId, reasons }) => {
          const other = views.find((v) => v.ctx.lead.id === otherId);
          if (!other) return null;
          const label = other.ctx.company?.name ?? other.ctx.property.name;
          return (
            <li key={otherId} className="rounded-xl bg-white p-3 ring-1 ring-amber-200">
              <p className="font-semibold text-slate-900">{label}</p>
              <p className="text-sm text-slate-600">
                {[other.ctx.property.address, other.ctx.property.city].filter(Boolean).join(", ")} · {other.ctx.lead.title}
              </p>
              <p className="text-sm text-slate-700">
                Existing lead: Score {other.score.score} — {other.score.tier.toUpperCase()} · <StatusPill status={other.ctx.lead.status} />
              </p>
              <p className="text-xs text-slate-500">Why it looks the same: {reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(", ")}</p>
              {confirming === otherId ? (
                <div className="mt-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">
                  <p className="font-semibold">Merge “{label}” into this lead?</p>
                  <p>Nothing is deleted: its sources, activity, notes, follow-ups and history move to this lead. The other record is kept and marked as merged.</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
                    <Button variant="primary" className="min-h-11" disabled={busy} onClick={() => void actions.mergeDuplicateLeads(leadId, otherId, label).then(() => setConfirming(null))}>
                      Yes, merge
                    </Button>
                    <Button variant="secondary" className="min-h-11" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                  <Link href={`/leads/${otherId}`} className={buttonClass("secondary", "md", "min-h-11")}>
                    Review existing
                  </Link>
                  <Button variant="secondary" className="min-h-11" onClick={() => setConfirming(otherId)}>
                    Merge into this lead
                  </Button>
                  <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void actions.markNotDuplicate(leadId, otherId)}>
                    Not a duplicate
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
