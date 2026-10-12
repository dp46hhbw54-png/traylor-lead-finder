"use client";

import { pickIntakeSource } from "../lib/workflow/intake-source";
import clsx from "clsx";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { LuArrowRight, LuCircleCheck, LuCopy, LuInfo, LuLink, LuPlus } from "react-icons/lu";
import { PrimaryActionButton } from "@/components/leads/lead-actions";
import { LeadActionDialog, type ActionMode } from "@/components/today/action-dialogs";
import { DemoTag, PotentialValueTag, ScoreBadge, StatusPill } from "@/components/ui/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { ChoiceChips, controlClass, FieldBlock } from "@/components/ui/form";
import { PageHeader, WithData } from "@/components/ui/screen";
import {
  FACILITY_TYPE_LABEL,
  INTAKE_SIGNAL_CHOICES,
  POTENTIAL_VALUE_LABEL,
  POTENTIAL_VALUE_ORDER,
  PUBLIC_SOURCE_KINDS,
  SIGNAL_DEFINITIONS,
  SOURCE_KIND_LABEL,
  SOURCE_KINDS,
} from "@/lib/domain/labels";
import type { DataStatus, FacilityType, PotentialValue, SignalType, SourceKind, SourceVerification } from "@/lib/domain/types";
import { DUPLICATE_REASON_LABEL } from "@/lib/engine/duplicates";
import { buildToday, type LeadView } from "@/lib/engine/evaluate";
import type { DuplicateCandidate, NewLeadInput } from "@/lib/workflow/ingest";
import { isValidUrl } from "@/lib/workflow/ingest";
import { useLeadFinder } from "@/state/lead-finder-store";
import { useEvaluatedLeads } from "@/state/use-evaluated-leads";

type Mode = "manual" | "link";
type Known = "publicly_reported" | "verified" | "unknown";

interface Draft {
  nameKind: "business" | "building";
  name: string;
  city: string;
  otherCity: string;
  facilityType: FacilityType | "";
  signalType: SignalType | "";
  why: string;
  known: Known | null;
  sourceKind: SourceKind | "";
  sourceUrl: string;
  sourceTitle: string;
  checked: SourceVerification;
  // Optional
  secondName: string;
  address: string;
  zip: string;
  sqft: string;
  sqftStatus: Exclude<DataStatus, "unknown"> | null;
  contactName: string;
  contactRole: string;
  phone: string;
  email: string;
  website: string;
  contactStatus: Exclude<DataStatus, "unknown"> | null;
  propertyManager: string;
  potential: PotentialValue;
  expectedDate: string;
  notes: string;
}

const EMPTY: Draft = {
  nameKind: "business", name: "", city: "", otherCity: "", facilityType: "", signalType: "", why: "", known: null,
  sourceKind: "", sourceUrl: "", sourceTitle: "", checked: "not_checked",
  secondName: "", address: "", zip: "", sqft: "", sqftStatus: null, contactName: "", contactRole: "", phone: "", email: "", website: "",
  contactStatus: null, propertyManager: "", potential: "unknown", expectedDate: "", notes: "",
};

// The half-filled form survives opening an existing lead to compare (in memory only).
const drafts: Record<Mode, Draft | null> = { manual: null, link: null };

type Errors = Partial<Record<keyof Draft | "form", string>>;
const OTHER_CITY = "__other__";

function validate(d: Draft, mode: Mode): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = "Enter the business or building name.";
  if (!d.city || (d.city === OTHER_CITY && !d.otherCity.trim())) e.city = "Choose the city.";
  if (!d.facilityType) e.facilityType = "Choose the facility type.";
  if (!d.signalType) e.signalType = "Pick what kind of opportunity this is.";
  if (!d.why.trim()) e.why = "Describe what you saw in a sentence.";
  if (!d.known) e.known = "Say how sure you are — “Not sure yet” is fine.";
  if (!d.sourceKind) e.sourceKind = "Choose where you found it.";
  if (mode === "link" && !d.sourceUrl.trim()) e.sourceUrl = "Paste the link.";
  if (d.sourceUrl.trim() && !isValidUrl(d.sourceUrl)) e.sourceUrl = "That doesn't look like a web address. Paste the full link, starting with https://";
  if (d.sqft.trim()) {
    const n = Number(d.sqft.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) e.sqft = "Square feet must be a number, like 25000.";
    else if (!d.sqftStatus) e.sqftStatus = "Say how you know the size.";
  }
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = "That email doesn't look right.";
  if (d.phone.trim() && d.phone.replace(/\D/g, "").length < 7) e.phone = "That phone number looks too short.";
  if (d.website.trim() && !isValidUrl(d.website)) e.website = "Paste the full website, starting with https://";
  if ((d.phone.trim() || d.email.trim() || d.website.trim()) && !d.contactStatus) e.contactStatus = "Say how you know these contact details.";
  if ((d.phone.trim() || d.email.trim()) && !d.contactName.trim() && d.nameKind === "building" && !d.secondName.trim() && !d.propertyManager.trim()) {
    e.contactName = "Add the contact's name (or the business) so we know whose phone/email this is.";
  }
  return e;
}

function toInput(d: Draft, sourceId: string): NewLeadInput {
  const city = d.city === OTHER_CITY ? d.otherCity.trim() : d.city;
  const businessName = d.nameKind === "business" ? d.name.trim() : d.secondName.trim();
  const buildingName = d.nameKind === "building" ? d.name.trim() : d.secondName.trim();
  const sqft = d.sqft.trim() ? Math.round(Number(d.sqft.replace(/[,\s]/g, ""))) : null;
  const hasContactDetails = Boolean(d.phone.trim() || d.email.trim());
  const status = d.contactStatus ?? undefined;
  return {
    title: d.why.trim().length > 110 ? `${d.why.trim().slice(0, 107)}…` : d.why.trim(),
    property: {
      name: buildingName || undefined,
      address: d.address.trim() || undefined,
      city,
      zip: d.zip.trim() || undefined,
      facilityType: d.facilityType as FacilityType,
      sqft,
      sqftStatus: sqft ? d.sqftStatus ?? undefined : undefined,
    },
    company: businessName
      ? {
          name: businessName,
          website: d.website.trim() || null,
          phone: !d.contactName.trim() ? d.phone.trim() || null : null,
          email: !d.contactName.trim() ? d.email.trim() || null : null,
          dataStatus: d.website.trim() || (!d.contactName.trim() && hasContactDetails) ? status : undefined,
        }
      : null,
    propertyManager: d.propertyManager.trim()
      ? {
          name: d.propertyManager.trim(),
          phone: !d.contactName.trim() && !businessName ? d.phone.trim() || null : null,
          email: !d.contactName.trim() && !businessName ? d.email.trim() || null : null,
          dataStatus: !d.contactName.trim() && !businessName && hasContactDetails ? status : undefined,
        }
      : null,
    contact: d.contactName.trim()
      ? { name: d.contactName.trim(), role: d.contactRole.trim(), phone: d.phone.trim() || null, email: d.email.trim() || null, dataStatus: hasContactDetails ? status : undefined, employer: businessName ? "company" : "property_manager" }
      : null,
    signals: [
      {
        type: d.signalType as SignalType,
        description: d.why.trim(),
        confidence: d.known ?? "unknown",
        sourceUrl: d.sourceUrl.trim() || null,
        expectedDate: d.expectedDate ? new Date(`${d.expectedDate}T09:00`).toISOString() : null,
      },
    ],
    source: {
      sourceId,
      sourceUrl: d.sourceUrl.trim() || null,
      kind: (d.sourceKind || "other") as SourceKind,
      title: d.sourceTitle.trim() || null,
      verification: d.sourceUrl.trim() ? d.checked : "not_checked",
    },
    potentialValue: d.potential,
    notes: d.notes.trim() || null,
  };
}

export function AddLeadScreen({ mode = "manual" }: { mode?: Mode }) {
  return (
    <>
      <PageHeader
        title={mode === "link" ? "Add from a web link" : "Add a lead"}
        description={
          mode === "link"
            ? "Paste the link where you saw the opportunity, then record what it says. We store the link — we never open or copy websites automatically."
            : "Five things are required. Everything else can be added later."
        }
      />
      <WithData>
        <AddLeadForm mode={mode} />
      </WithData>
    </>
  );
}

function AddLeadForm({ mode }: { mode: Mode }) {
  const { snapshot, repo, actions, busy, now } = useLeadFinder();
  const views = useEvaluatedLeads();
  const fresh = (): Draft => (mode === "link" ? { ...EMPTY, sourceKind: "website", known: "publicly_reported" } : { ...EMPTY });
  const [d, setD] = useState<Draft>(() => drafts[mode] ?? fresh());
  const [errors, setErrors] = useState<Errors>({});
  const [more, setMore] = useState(false);
  const [checking, setChecking] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [savedId, setSavedId] = useState<{ leadId: string; mode: "new_lead" | "added_to_existing" } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => {
      const next = { ...prev, [k]: v };
      // Picking where it came from suggests how sure we are — but only if the person hasn't said.
      if (k === "sourceKind" && !prev.known) next.known = PUBLIC_SOURCE_KINDS.includes(v as SourceKind) ? "publicly_reported" : null;
      if (k === "checked" && v === "verified" && (prev.known === null || prev.known === "publicly_reported")) next.known = prev.known ?? "publicly_reported";
      drafts[mode] = next;
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Filed by KIND of source (web link vs manual), never by a fixed demo id — see pickIntakeSource.
  const sourcePick = snapshot ? pickIntakeSource(snapshot.sources, mode === "link" || d.sourceUrl.trim() !== "") : null;
  const resolvedSourceId = sourcePick?.ok ? sourcePick.source.id : "";
  const cities = snapshot?.markets.filter((m) => m.kind === "city" && m.active) ?? [];

  const save = async (opts?: Parameters<typeof actions.createLead>[1]) => {
    const input = toInput(d, resolvedSourceId);
    const res = await actions.createLead(input, opts ? { ...opts, context: mode === "link" ? "url_reference" : "manual_entry" } : undefined);
    if (!res) return;
    if (res.status === "duplicates_found") {
      setCandidates(res.candidates);
      return;
    }
    drafts[mode] = null;
    setCandidates(null);
    setSavedId({ leadId: res.leadId, mode: res.mode });
    window.scrollTo?.(0, 0);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate(d, mode);
    if (sourcePick && !sourcePick.ok) e.form = sourcePick.message;
    setErrors(e);
    if (Object.keys(e).length > 0) {
      if (e.sqft || e.sqftStatus || e.email || e.phone || e.website || e.contactStatus || e.contactName) setMore(true);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [role='alert']")?.scrollIntoView({ block: "center" }));
      return;
    }
    setChecking(true);
    try {
      const found = await repo.previewDuplicates(toInput(d, resolvedSourceId));
      if (found.length > 0) {
        setCandidates(found);
        requestAnimationFrame(() => document.getElementById("duplicate-check")?.scrollIntoView({ block: "start" }));
        return;
      }
    } catch {
      setErrors({ form: "Couldn't check for duplicates just now. Nothing was saved — try again." });
      return;
    } finally {
      setChecking(false);
    }
    await save();
  };

  if (savedId) {
    const view = views.find((v) => v.ctx.lead.id === savedId.leadId);
    return <SavedResult view={view} mode={savedId.mode} rankOnToday={snapshot ? buildToday(snapshot, now).items.find((i) => i.view.ctx.lead.id === savedId.leadId)?.rank ?? null : null} onAnother={() => { setD(fresh()); setSavedId(null); setErrors({}); setMore(false); }} />;
  }

  const unavailable = sourcePick && !sourcePick.ok ? sourcePick.message : null;
  const err = (k: keyof Draft) => errors[k] ?? null;
  const invalid = (k: keyof Draft) => (errors[k] ? true : undefined);

  return (
    <form ref={formRef} onSubmit={(e: FormEvent) => void submit(e)} noValidate className="space-y-4">
      {errors.form && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {errors.form}
        </p>
      )}
      {Object.keys(errors).filter((k) => errors[k as keyof Errors]).length > 1 && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          A few things need attention before we can save — they're marked in red below.
        </p>
      )}

      {/* ------------------------------------------------ Where it came from (first in link mode) */}
      {mode === "link" && <SourceSection d={d} set={set} err={err} invalid={invalid} mode={mode} />}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="font-semibold text-slate-900">{mode === "link" ? "What it says" : "The opportunity"}</h2>
        <FieldBlock label="Business or building name" htmlFor="al-name" required error={err("name")}>
          <input id="al-name" className={controlClass} value={d.name} aria-invalid={invalid("name")} onChange={(e) => set("name", e.target.value)} placeholder="e.g. ABC Distribution" autoComplete="off" />
          <div className="mt-2">
            <ChoiceChips
              name="This name is a"
              value={d.nameKind}
              onChange={(v) => set("nameKind", v)}
              options={[
                { value: "business", label: "Business" },
                { value: "building", label: "Building / property" },
              ]}
            />
          </div>
        </FieldBlock>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="Location (city)" htmlFor="al-city" required error={err("city")} hint="Street address is optional — add it under more details.">
            <select id="al-city" className={controlClass} value={d.city} aria-invalid={invalid("city")} onChange={(e) => set("city", e.target.value)}>
              <option value="">Choose a city…</option>
              {cities.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} ({c.parish} Parish)
                </option>
              ))}
              <option value={OTHER_CITY}>Other city…</option>
            </select>
            {d.city === OTHER_CITY && (
              <input className={`${controlClass} mt-2`} aria-label="Other city" value={d.otherCity} onChange={(e) => set("otherCity", e.target.value)} placeholder="City name" />
            )}
          </FieldBlock>
          <FieldBlock label="Facility type" htmlFor="al-type" required error={err("facilityType")}>
            <select id="al-type" className={controlClass} value={d.facilityType} aria-invalid={invalid("facilityType")} onChange={(e) => set("facilityType", e.target.value as FacilityType)}>
              <option value="">Choose a type…</option>
              {Object.entries(FACILITY_TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </FieldBlock>
        </div>

        <FieldBlock label="Why is this an opportunity?" htmlFor="al-signal" required error={err("signalType") ?? err("why")}>
          <select id="al-signal" className={controlClass} value={d.signalType} aria-invalid={invalid("signalType")} onChange={(e) => set("signalType", e.target.value as SignalType)}>
            <option value="">Choose what you saw…</option>
            {INTAKE_SIGNAL_CHOICES.map((k) => (
              <option key={k} value={k}>
                {k === "generic_commercial" ? "Other / not sure yet" : SIGNAL_DEFINITIONS[k].label}
              </option>
            ))}
          </select>
          <textarea
            id="al-why"
            aria-label="What did you see?"
            aria-invalid={invalid("why")}
            className={`${controlClass} mt-2 min-h-20`}
            value={d.why}
            onChange={(e) => set("why", e.target.value)}
            placeholder="In one sentence, what did you see? e.g. “Lease signed for the whole building, move-in this spring.”"
          />
        </FieldBlock>

        <FieldBlock label="How sure is this?" required error={err("known")} hint={d.known === "unknown" ? "Saved and shown, but it won't add to the score until it's confirmed." : undefined}>
          <ChoiceChips
            name="How sure is this?"
            columns={3}
            value={d.known}
            onChange={(v) => set("known", v)}
            options={[
              { value: "publicly_reported", label: "Publicly reported", hint: "News, listing, website" },
              { value: "verified", label: "We confirmed it", hint: "Visit, call or record" },
              { value: "unknown", label: "Not sure yet", hint: "Heard it, need to check" },
            ]}
          />
        </FieldBlock>
      </section>

      {mode === "manual" && <SourceSection d={d} set={set} err={err} invalid={invalid} mode={mode} />}

      {/* ------------------------------------------------ Optional */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left font-semibold text-slate-900 sm:px-5">
          <LuPlus className={clsx("h-5 w-5 text-slate-400 transition-transform", more && "rotate-45")} />
          Add more details <span className="font-normal text-slate-500">(optional — contact, address, size, manager…)</span>
        </button>
        {more && (
          <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-2 sm:px-5">
            <FieldBlock label={d.nameKind === "business" ? "Building / property name" : "Business / tenant name"} htmlFor="al-second">
              <input id="al-second" className={controlClass} value={d.secondName} onChange={(e) => set("secondName", e.target.value)} />
            </FieldBlock>
            <FieldBlock label="Street address" htmlFor="al-address">
              <input id="al-address" className={controlClass} value={d.address} onChange={(e) => set("address", e.target.value)} autoComplete="off" />
            </FieldBlock>
            <FieldBlock label="ZIP" htmlFor="al-zip">
              <input id="al-zip" inputMode="numeric" className={controlClass} value={d.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))} />
            </FieldBlock>
            <FieldBlock label="Square feet" htmlFor="al-sqft" error={err("sqft") ?? err("sqftStatus")}>
              <input id="al-sqft" inputMode="numeric" className={controlClass} value={d.sqft} aria-invalid={invalid("sqft")} onChange={(e) => set("sqft", e.target.value)} placeholder="Leave empty if unknown" />
              {d.sqft.trim() && (
                <div className="mt-2">
                  <ChoiceChips
                    name="How do you know the size?"
                    columns={3}
                    value={d.sqftStatus}
                    onChange={(v) => set("sqftStatus", v)}
                    options={[
                      { value: "verified", label: "Verified" },
                      { value: "publicly_reported", label: "Publicly reported" },
                      { value: "estimated", label: "Estimate" },
                    ]}
                  />
                </div>
              )}
            </FieldBlock>
            <FieldBlock label="Contact name" htmlFor="al-cname" error={err("contactName")}>
              <input id="al-cname" className={controlClass} value={d.contactName} onChange={(e) => set("contactName", e.target.value)} autoComplete="off" />
            </FieldBlock>
            <FieldBlock label="Contact role" htmlFor="al-crole">
              <input id="al-crole" className={controlClass} value={d.contactRole} onChange={(e) => set("contactRole", e.target.value)} placeholder="e.g. Property Manager" />
            </FieldBlock>
            <FieldBlock label="Phone" htmlFor="al-phone" error={err("phone")}>
              <input id="al-phone" type="tel" className={controlClass} value={d.phone} aria-invalid={invalid("phone")} onChange={(e) => set("phone", e.target.value)} />
            </FieldBlock>
            <FieldBlock label="Email" htmlFor="al-email" error={err("email")}>
              <input id="al-email" type="email" className={controlClass} value={d.email} aria-invalid={invalid("email")} onChange={(e) => set("email", e.target.value)} />
            </FieldBlock>
            <FieldBlock label="Business website" htmlFor="al-web" error={err("website")}>
              <input id="al-web" type="url" className={controlClass} value={d.website} aria-invalid={invalid("website")} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
            </FieldBlock>
            {(d.phone.trim() || d.email.trim() || d.website.trim()) && (
              <FieldBlock label="How do you know these contact details?" error={err("contactStatus")}>
                <ChoiceChips
                  name="How do you know these contact details?"
                  columns={3}
                  value={d.contactStatus}
                  onChange={(v) => set("contactStatus", v)}
                  options={[
                    { value: "verified", label: "Verified" },
                    { value: "publicly_reported", label: "Public listing" },
                    { value: "estimated", label: "Not confirmed" },
                  ]}
                />
              </FieldBlock>
            )}
            <FieldBlock label="Property manager" htmlFor="al-pm">
              <input id="al-pm" className={controlClass} value={d.propertyManager} onChange={(e) => set("propertyManager", e.target.value)} placeholder="Management company, if known" />
            </FieldBlock>
            <FieldBlock label="Potential opportunity value" htmlFor="al-pv" hint="A quick read — not a quote, not a dollar amount.">
              <select id="al-pv" className={controlClass} value={d.potential} onChange={(e) => set("potential", e.target.value as PotentialValue)}>
                {POTENTIAL_VALUE_ORDER.map((v) => (
                  <option key={v} value={v}>
                    {POTENTIAL_VALUE_LABEL[v]}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label="Expected opening / move-in" htmlFor="al-date">
              <input id="al-date" type="date" className={controlClass} value={d.expectedDate} onChange={(e) => set("expectedDate", e.target.value)} />
            </FieldBlock>
            <FieldBlock label="Notes" htmlFor="al-notes">
              <textarea id="al-notes" className={`${controlClass} min-h-20`} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </FieldBlock>
          </div>
        )}
      </section>

      {unavailable && (
        <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{unavailable}</p>
      )}

      {candidates && candidates.length > 0 ? (
        <DuplicateCheck candidates={candidates} views={views} busy={busy} onDecide={(o) => void save(o)} onCancel={() => setCandidates(null)} />
      ) : (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto sm:min-w-64" disabled={busy || checking}>
            {checking ? "Checking for duplicates…" : busy ? "Saving…" : "Check & save lead"}
          </Button>
        </div>
      )}
    </form>
  );
}

function SourceSection({ d, set, err, invalid, mode }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; err: (k: keyof Draft) => string | null; invalid: (k: keyof Draft) => true | undefined; mode: Mode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <LuLink className="h-5 w-5 text-slate-400" /> Where did you find it?
      </h2>
      <FieldBlock label="Source" required error={err("sourceKind")}>
        <ChoiceChips name="Source" columns={4} value={d.sourceKind || null} onChange={(v) => set("sourceKind", v)} options={SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_KIND_LABEL[k] }))} />
      </FieldBlock>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label="Link" htmlFor="al-url" required={mode === "link"} error={err("sourceUrl")} hint={mode === "manual" ? "Optional, but it lets anyone check the facts later." : undefined}>
          <input id="al-url" type="url" inputMode="url" className={controlClass} value={d.sourceUrl} aria-invalid={invalid("sourceUrl")} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" />
        </FieldBlock>
        <FieldBlock label="Source name" htmlFor="al-stitle" hint="Optional — e.g. the publication or website name.">
          <input id="al-stitle" className={controlClass} value={d.sourceTitle} onChange={(e) => set("sourceTitle", e.target.value)} />
        </FieldBlock>
      </div>
      {d.sourceUrl.trim() && (
        <FieldBlock label="Did you open the link?" hint="We never open links ourselves — only a person can confirm them.">
          <ChoiceChips
            name="Did you open the link?"
            columns={3}
            value={d.checked}
            onChange={(v) => set("checked", v)}
            options={[
              { value: "verified", label: "Yes — it shows this" },
              { value: "not_checked", label: "Not yet" },
              { value: "unavailable", label: "Couldn't open it" },
            ]}
          />
          {d.checked === "unavailable" && (
            <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <LuInfo className="mt-0.5 h-4 w-4 shrink-0" />
              It will be saved as “Source unavailable”. What you record stays unconfirmed — it doesn't mean there's no opportunity.
            </p>
          )}
        </FieldBlock>
      )}
    </section>
  );
}

function DuplicateCheck({
  candidates,
  views,
  busy,
  onDecide,
  onCancel,
}: {
  candidates: DuplicateCandidate[];
  views: LeadView[];
  busy: boolean;
  onDecide: (o: { duplicateAction: "create_anyway" | "link_to_property" | "add_to_existing_lead"; linkPropertyId?: string; existingLeadId?: string }) => void;
  onCancel: () => void;
}) {
  const [review, setReview] = useState<string | null>(null);
  return (
    <section id="duplicate-check" className="scroll-mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 sm:p-5" aria-label="Possible duplicate">
      <h2 className="flex items-center gap-2 text-lg font-bold text-amber-950">
        <LuCopy className="h-5 w-5" /> Possible duplicate
      </h2>
      <p className="text-sm text-amber-950">Nothing has been saved yet. This looks like something we already have — choose what to do.</p>
      <ul className="mt-3 space-y-3">
        {candidates.map((c) => {
          const leads = c.openLeadIds.map((id) => views.find((v) => v.ctx.lead.id === id)).filter((v): v is LeadView => Boolean(v));
          return (
            <li key={c.propertyId} className="rounded-xl bg-white p-3 ring-1 ring-amber-200">
              <p className="font-semibold text-slate-900">{c.propertyName}</p>
              <p className="text-sm text-slate-600">{[c.address, c.city].filter(Boolean).join(", ") || c.city}</p>
              <p className="text-xs text-slate-500">Why it looks the same: {c.reasons.map((r) => DUPLICATE_REASON_LABEL[r]).join(", ")}</p>
              {leads.map((v) => (
                <div key={v.ctx.lead.id} className="mt-2 rounded-lg border border-slate-200 p-2">
                  <p className="text-sm text-slate-800">
                    Existing lead: <span className="font-semibold">Score {v.score.score} — {v.score.tier.toUpperCase()}</span> · <StatusPill status={v.ctx.lead.status} />
                  </p>
                  <p className="text-sm text-slate-700">{v.ctx.lead.title}</p>
                  {review === v.ctx.lead.id && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">
                      <p>
                        <span className="font-semibold">Why now:</span> {v.whyNow[0]}
                      </p>
                      <p>
                        <span className="font-semibold">Contact:</span> {v.contact.name ?? v.contact.organization ?? "none yet"}
                      </p>
                      <p>
                        <span className="font-semibold">Next step:</span> {v.action.label}
                      </p>
                      <Link href={`/leads/${v.ctx.lead.id}`} className="mt-1 inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">
                        Open the full lead (your form is kept) <LuArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                    <Button variant="secondary" className="min-h-11" onClick={() => setReview(review === v.ctx.lead.id ? null : v.ctx.lead.id)}>
                      {review === v.ctx.lead.id ? "Hide" : "Review existing"}
                    </Button>
                    <Button variant="primary" className="min-h-11" disabled={busy} onClick={() => onDecide({ duplicateAction: "add_to_existing_lead", existingLeadId: v.ctx.lead.id })}>
                      Merge into this lead
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Merge adds your source and evidence to the existing lead. Nothing there is overwritten.</p>
                </div>
              ))}
              <Button variant="secondary" className="mt-2 min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => onDecide({ duplicateAction: "link_to_property", linkPropertyId: c.propertyId })}>
                Same building — new opportunity
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
        <Button variant="secondary" className="min-h-11" disabled={busy} onClick={() => onDecide({ duplicateAction: "create_anyway" })}>
          Create anyway — it's different
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          Back to the form
        </Button>
      </div>
      <p className="mt-2 text-xs text-amber-900">Whatever you choose is kept in the lead's history.</p>
    </section>
  );
}

function SavedResult({ view, mode, rankOnToday, onAnother }: { view: LeadView | undefined; mode: "new_lead" | "added_to_existing"; rankOnToday: number | null; onAnother: () => void }) {
  const [dialog, setDialog] = useState<ActionMode | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  if (!view) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
        The lead was saved, but it couldn't be shown here. Open Leads to find it.
      </p>
    );
  }
  const { ctx, score, action } = view;
  return (
    <section className="space-y-4" aria-label="Lead saved">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="flex items-center gap-2 text-lg font-bold text-emerald-900">
          <LuCircleCheck className="h-6 w-6" /> {mode === "added_to_existing" ? "Added to the existing lead" : "Lead saved"}
        </p>
        <p className="text-sm text-emerald-900">
          {mode === "added_to_existing"
            ? "Your source and evidence were added. Nothing was overwritten."
            : rankOnToday
              ? `It's #${rankOnToday} on Today's call list.`
              : "It's in your Leads as New. It will move up Today's list as it gets stronger."}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill status={ctx.lead.status} />
              {ctx.lead.potentialValue !== "unknown" && <PotentialValueTag value={ctx.lead.potentialValue} />}
              {ctx.lead.isDemo && <DemoTag />}
            </div>
            <h2 className="mt-1 text-xl font-bold text-slate-900">{ctx.company?.name ?? ctx.property.name}</h2>
            <p className="text-sm text-slate-600">
              {ctx.company && ctx.company.name !== ctx.property.name ? `${ctx.property.name} · ` : ""}
              {ctx.property.city}
            </p>
            <p className="mt-1 font-medium text-slate-800">{ctx.lead.title}</p>
          </div>
          <ScoreBadge score={score.score} tier={score.tier} />
        </div>

        <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Why it scored {score.score}</h3>
        <ul className="mt-1 space-y-1 text-sm">
          {view.why.length === 0 && <li className="text-slate-600">No confirmed signal yet, so it scores low. Confirm what you saw to raise it.</li>}
          {view.why.slice(0, 3).map((w) => (
            <li key={w.text} className="flex gap-2">
              <span className="h-5 w-8 shrink-0 rounded bg-emerald-50 text-center text-xs font-bold leading-5 text-emerald-700">+{w.points}</span>
              {w.text}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setScoreOpen((v) => !v)} aria-expanded={scoreOpen} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
          {scoreOpen ? "Hide score details" : "View score details"}
        </button>
        {scoreOpen && (
          <ul className="rounded-xl bg-slate-50 p-3 text-sm" aria-label="Score details">
            {score.lines.map((l) => (
              <li key={l.key}>
                <span className="font-bold tabular-nums">{l.points > 0 ? `+${l.points}` : l.points}</span> {l.label}
                {l.detail && <span className="text-slate-500"> — {l.detail}</span>}
              </li>
            ))}
            <li className="mt-1 text-xs text-slate-500">Total before the 0–100 cap: {score.raw}.</li>
          </ul>
        )}

        <div className="mt-3 rounded-xl border-l-4 border-brand-500 bg-brand-50 px-3 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Next step</p>
          <p className="font-semibold text-slate-900">{action.label}</p>
          <p className="text-xs text-slate-600">{action.reason}</p>
          <PrimaryActionButton view={view} onAction={setDialog} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex">
        <Link href={`/leads/${ctx.lead.id}`} className={buttonClass("secondary", "lg")}>
          Open lead page
        </Link>
        <Button variant="secondary" size="lg" onClick={onAnother} icon={<LuPlus className="h-5 w-5" />}>
          Add another lead
        </Button>
        <Link href="/" className={buttonClass("ghost", "lg")}>
          Go to Today
        </Link>
      </div>
      <LeadActionDialog mode={dialog} view={dialog ? view : null} onClose={() => setDialog(null)} />
    </section>
  );
}
