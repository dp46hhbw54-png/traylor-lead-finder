"use client";

import clsx from "clsx";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LuMail, LuMessageSquare, LuPhone } from "react-icons/lu";
import { AnchorButton, Button } from "@/components/ui/button";
import { Dialog, Field, inputClass } from "@/components/ui/dialog";
import type { ContactMethod, LostReasonCode, PipelineStatus, WalkthroughOutcome } from "@/lib/domain/types";
import { CONTACT_METHOD_LABEL, LOST_REASON_LABEL, PIPELINE_STATUS_LABEL, WALKTHROUGH_OUTCOME_LABEL } from "@/lib/domain/labels";
import type { LeadView } from "@/lib/engine/evaluate";
import { useLeadFinder } from "@/state/lead-finder-store";

export type ActionMode = "call" | "email" | "text" | "log" | "followup" | "walkthrough" | "snooze" | "not_a_fit" | "status" | "walkthrough_outcome";

/** yyyy-MM-ddTHH:mm in local time, for <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function daysFromNowAt(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function nextBusinessDayAt(hour: number, plusDays = 2): Date {
  const d = daysFromNowAt(plusDays, hour);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

const CALL_OUTCOMES = ["Connected", "Left voicemail", "No answer", "Wrong number", "Not interested right now"];
const NOT_A_FIT_REASONS = [
  "Too small for us",
  "Outside our service area",
  "Residential, not commercial",
  "Cleaning handled in-house",
  "Services we don't offer",
  "Other",
];
const SNOOZE_OPTIONS: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
];

/** Stages a person can move a lead to by hand. "Not a Fit" has its own button because it needs a reason. */
const MOVABLE_STATUSES: PipelineStatus[] = ["new", "researching", "contacted", "interested", "walkthrough", "nurture", "won", "lost"];
const LOST_CODES = Object.keys(LOST_REASON_LABEL) as LostReasonCode[];
const OUTCOMES = Object.keys(WALKTHROUGH_OUTCOME_LABEL) as WalkthroughOutcome[];

const textareaClass = clsx(inputClass, "min-h-[80px]");

function Who({ view }: { view: LeadView }) {
  const c = view.contact;
  return (
    <span>
      {c.name ? `${c.name}${c.role ? ` · ${c.role}` : ""}` : c.organization ?? "No contact identified"}
      {c.name && c.organization ? ` · ${c.organization}` : ""}
    </span>
  );
}

function DemoContactNote() {
  return <p className="mt-2 text-xs text-amber-700">Demo record — this is a fictional 555 number / example.com address.</p>;
}

function FollowUpToggle({ checked, onChange, when, setWhen }: { checked: boolean; onChange: (v: boolean) => void; when: string; setWhen: (v: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Schedule a follow-up
      </label>
      {checked && <input type="datetime-local" className={clsx(inputClass, "mt-2")} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Follow-up date and time" />}
    </div>
  );
}

function ChoiceGrid({ options, value, onChange, name }: { options: string[]; value: string; onChange: (v: string) => void; name: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={clsx(
            "rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
            value === o ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100" : "border-slate-200 text-slate-700 hover:bg-slate-50",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function LeadActionDialog({ mode, view, onClose }: { mode: ActionMode | null; view: LeadView | null; onClose: () => void }) {
  const { actions, busy } = useLeadFinder();

  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [notes, setNotes] = useState("");
  const [withFollowUp, setWithFollowUp] = useState(true);
  const [when, setWhen] = useState(toLocalInput(nextBusinessDayAt(9)));
  const [method, setMethod] = useState<ContactMethod>("call");
  const [logType, setLogType] = useState<"call" | "email" | "text" | "note">("note");
  const [attendees, setAttendees] = useState("");
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [reason, setReason] = useState(NOT_A_FIT_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [newStatus, setNewStatus] = useState<PipelineStatus>("contacted");
  const [lostCode, setLostCode] = useState<LostReasonCode>("price");
  const [wtOutcome, setWtOutcome] = useState<WalkthroughOutcome>("interested");
  const [nextAction, setNextAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a dialog opens.
  useEffect(() => {
    if (!mode || !view) return;
    setOutcome(CALL_OUTCOMES[0]);
    setNotes("");
    setWithFollowUp(true);
    setWhen(toLocalInput(mode === "walkthrough" ? nextBusinessDayAt(10, 3) : nextBusinessDayAt(9)));
    setMethod(view.contact.phone ? "call" : "email");
    setLogType("note");
    setAttendees(`Traylor Pro sales${view.contact.name ? ` + ${view.contact.name}` : ""}`);
    setSnoozeDays(7);
    setReason(NOT_A_FIT_REASONS[0]);
    setOtherReason("");
    setNewStatus(MOVABLE_STATUSES.find((st) => st !== view.ctx.lead.status) ?? "contacted");
    setLostCode("price");
    setWtOutcome("interested");
    setNextAction("");
    setError(null);
  }, [mode, view]);

  if (!mode || !view) return null;

  const { ctx, contact } = view;
  const leadId = ctx.lead.id;
  const contactId = ctx.primaryContact?.id ?? ctx.propertyManagerContact?.id ?? null;
  const subjectLine = `Commercial cleaning for ${ctx.property.name}`;
  const who = contact.name ?? contact.organization ?? "the business";
  // The walkthrough an outcome is being recorded for: done-without-outcome first, else the next one due today or earlier.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const openWalkthrough =
    ctx.walkthroughs.find((w) => w.completedAt && !w.outcome) ?? ctx.walkthroughs.find((w) => !w.completedAt && new Date(w.scheduledAt) <= endOfToday) ?? null;
  const subtitle = (
    <>
      {ctx.company?.name ?? ctx.property.name} · {ctx.property.city}
    </>
  );

  const future = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Pick a date and time.";
    if (d.getTime() < Date.now() - 60_000) return "Pick a time in the future.";
    return null;
  };

  const maybeFollowUp = async (m: ContactMethod) => {
    if (!withFollowUp) return true;
    return actions.scheduleFollowUp(leadId, contactId, new Date(when).toISOString(), m, notes ? `Re: ${notes}` : "");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let ok = false;
    switch (mode) {
      case "call": {
        if (withFollowUp && future(when)) return setError(future(when));
        ok = await actions.logActivity(leadId, "call", `Called ${who}${notes ? ` — ${notes}` : ""}`, outcome);
        if (ok) ok = await maybeFollowUp("call");
        break;
      }
      case "email":
      case "text": {
        if (withFollowUp && future(when)) return setError(future(when));
        ok = await actions.logActivity(leadId, mode, `${mode === "email" ? "Emailed" : "Texted"} ${who}${notes ? ` — ${notes}` : ""}`, null);
        if (ok) ok = await maybeFollowUp(mode);
        break;
      }
      case "log": {
        if (!notes.trim()) return setError("Add a short note about what happened.");
        ok = await actions.logActivity(leadId, logType, notes.trim(), logType === "call" ? outcome : null);
        break;
      }
      case "followup": {
        const err = future(when);
        if (err) return setError(err);
        ok = await actions.scheduleFollowUp(leadId, contactId, new Date(when).toISOString(), method, notes.trim());
        break;
      }
      case "walkthrough": {
        const err = future(when);
        if (err) return setError(err);
        ok = await actions.scheduleWalkthrough(leadId, contactId, new Date(when).toISOString(), attendees.trim(), notes.trim());
        break;
      }
      case "snooze": {
        const until = daysFromNowAt(snoozeDays, 6);
        const label = SNOOZE_OPTIONS.find((o) => o.days === snoozeDays)?.label ?? `${snoozeDays} days`;
        ok = await actions.snooze(leadId, until.toISOString(), `Hidden from Today for ${label.toLowerCase()}`);
        break;
      }
      case "status": {
        if (newStatus === "lost" && !lostCode) return setError("Choose why the lead was lost.");
        ok = await actions.changeStatus(leadId, newStatus, ctx.lead.status, { lostCode: newStatus === "lost" ? lostCode : undefined, note: notes.trim() || undefined });
        break;
      }
      case "walkthrough_outcome": {
        if (!openWalkthrough) return setError("There's no walkthrough to record an outcome for.");
        ok = await actions.completeWalkthrough(openWalkthrough.id, wtOutcome, nextAction, notes);
        break;
      }
      case "not_a_fit": {
        const finalReason = reason === "Other" ? otherReason.trim() : reason;
        if (!finalReason) return setError("Tell us why this isn't a fit.");
        ok = await actions.notAFit(leadId, finalReason, ctx.lead.status, ctx.company?.name ?? ctx.property.name);
        break;
      }
    }
    if (ok) onClose();
  }

  const footer = (submitLabel: string, variant: "primary" | "danger" = "primary") => (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant={variant} type="submit" form="lead-action-form" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </>
  );

  let title = "";
  let body: ReactNode = null;
  let foot: ReactNode = null;

  switch (mode) {
    case "call":
      title = "Call";
      body = (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600"><Who view={view} /></p>
            {contact.phone ? (
              <>
                <AnchorButton href={`tel:${contact.phone}`} variant="primary" size="lg" className="mt-3 w-full" icon={<LuPhone className="h-5 w-5" />}>
                  Dial {contact.phone}
                </AnchorButton>
                <DemoContactNote />
              </>
            ) : (
              <p className="mt-2 text-sm font-medium text-amber-800">No public phone on file. Try email, or research the contact first.</p>
            )}
          </div>
          <Field label="How did it go?" group>
            <ChoiceGrid name="Call outcome" options={CALL_OUTCOMES} value={outcome} onChange={setOutcome} />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who you spoke with, what they said…" />
          </Field>
          <FollowUpToggle checked={withFollowUp} onChange={setWithFollowUp} when={when} setWhen={setWhen} />
        </div>
      );
      foot = footer("Log call");
      break;
    case "email":
    case "text": {
      const isEmail = mode === "email";
      const target = isEmail ? contact.email : contact.phone;
      title = isEmail ? "Email" : "Text";
      body = (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600"><Who view={view} /></p>
            {target ? (
              <>
                <AnchorButton
                  href={isEmail ? `mailto:${target}?subject=${encodeURIComponent(subjectLine)}` : `sms:${target}`}
                  variant="primary"
                  size="lg"
                  className="mt-3 w-full"
                  icon={isEmail ? <LuMail className="h-5 w-5" /> : <LuMessageSquare className="h-5 w-5" />}
                >
                  {isEmail ? `Open email to ${target}` : `Text ${target}`}
                </AnchorButton>
                <DemoContactNote />
              </>
            ) : (
              <p className="mt-2 text-sm font-medium text-amber-800">
                No public {isEmail ? "email" : "mobile number"} on file. {isEmail ? "Try calling instead." : "Try calling or emailing instead."}
              </p>
            )}
          </div>
          <Field label="What did you send? (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isEmail ? "Intro email with capabilities…" : "Quick intro text…"} />
          </Field>
          <FollowUpToggle checked={withFollowUp} onChange={setWithFollowUp} when={when} setWhen={setWhen} />
        </div>
      );
      foot = footer(isEmail ? "Log email sent" : "Log text sent");
      break;
    }
    case "log":
      title = "Log activity";
      body = (
        <div className="space-y-4">
          <Field label="Type" group>
            <ChoiceGrid name="Activity type" options={["Note", "Call", "Email", "Text"]} value={logType[0].toUpperCase() + logType.slice(1)} onChange={(v) => setLogType(v.toLowerCase() as typeof logType)} />
          </Field>
          {logType === "call" && (
            <Field label="Outcome">
              <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {CALL_OUTCOMES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="What happened?">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Drove by — signage up, opening soon." />
          </Field>
        </div>
      );
      foot = footer("Save activity");
      break;
    case "followup":
      title = "Schedule follow-up";
      body = (
        <div className="space-y-4">
          <Field label="When">
            <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="How" group>
            <ChoiceGrid name="Method" options={(["call", "email", "text", "walkthrough", "other"] as ContactMethod[]).map((m) => CONTACT_METHOD_LABEL[m])} value={CONTACT_METHOD_LABEL[method]} onChange={(v) => setMethod(v.toLowerCase() as ContactMethod)} />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to ask about next time…" />
          </Field>
          <p className="text-sm text-slate-500">With: <Who view={view} /></p>
        </div>
      );
      foot = footer("Schedule follow-up");
      break;
    case "walkthrough":
      title = "Schedule walkthrough";
      body = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {ctx.property.name} · {ctx.property.address}, {ctx.property.city}
          </p>
          <Field label="When">
            <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Attendees">
            <input className={inputClass} value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Areas to see, access instructions…" />
          </Field>
          <p className="text-xs text-slate-500">Scheduling moves the lead to the Walkthrough stage.</p>
        </div>
      );
      foot = footer("Schedule walkthrough");
      break;
    case "snooze":
      title = "Snooze";
      body = (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Hide this lead from Today. It comes back automatically.</p>
          <ChoiceGrid name="Snooze for" options={SNOOZE_OPTIONS.map((o) => o.label)} value={SNOOZE_OPTIONS.find((o) => o.days === snoozeDays)?.label ?? ""} onChange={(v) => setSnoozeDays(SNOOZE_OPTIONS.find((o) => o.label === v)?.days ?? 7)} />
        </div>
      );
      foot = footer("Snooze");
      break;
    case "status":
      title = "Change status";
      body = (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Now: <strong>{PIPELINE_STATUS_LABEL[ctx.lead.status]}</strong>. Moving a lead is saved to its history, and you can undo it.
          </p>
          <Field label="Move to" group>
            <ChoiceGrid
              name="New status"
              options={MOVABLE_STATUSES.filter((st) => st !== ctx.lead.status).map((st) => PIPELINE_STATUS_LABEL[st])}
              value={PIPELINE_STATUS_LABEL[newStatus]}
              onChange={(v) => setNewStatus(MOVABLE_STATUSES.find((st) => PIPELINE_STATUS_LABEL[st] === v) ?? "contacted")}
            />
          </Field>
          {newStatus === "lost" && (
            <Field label="Why was it lost?" group>
              <ChoiceGrid name="Lost reason" options={LOST_CODES.map((c) => LOST_REASON_LABEL[c])} value={LOST_REASON_LABEL[lostCode]} onChange={(v) => setLostCode(LOST_CODES.find((c) => LOST_REASON_LABEL[c] === v) ?? "other")} />
            </Field>
          )}
          <Field label="Note (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering…" />
          </Field>
        </div>
      );
      foot = footer("Move lead");
      break;
    case "walkthrough_outcome":
      title = "Record walkthrough outcome";
      body = (
        <div className="space-y-4">
          {openWalkthrough ? (
            <p className="text-sm text-slate-600">
              {ctx.property.name} · walkthrough {openWalkthrough.completedAt ? "completed" : "scheduled"} {new Date(openWalkthrough.completedAt ?? openWalkthrough.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          ) : (
            <p className="text-sm font-medium text-amber-800">No walkthrough is waiting for an outcome.</p>
          )}
          <Field label="How did it go?" group>
            <ChoiceGrid name="Outcome" options={OUTCOMES.map((o) => WALKTHROUGH_OUTCOME_LABEL[o])} value={WALKTHROUGH_OUTCOME_LABEL[wtOutcome]} onChange={(v) => setWtOutcome(OUTCOMES.find((o) => WALKTHROUGH_OUTCOME_LABEL[o] === v) ?? "interested")} />
          </Field>
          <Field label="Next step (optional)">
            <input className={inputClass} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Send our information packet" />
          </Field>
          <Field label="Notes (optional)">
            <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sizes, special areas, who decides…" />
          </Field>
        </div>
      );
      foot = footer("Save outcome");
      break;
    case "not_a_fit":
      title = "Not a Fit";
      body = (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Hides the lead from Today and the pipeline. It stays searchable, and the reason helps us learn what to skip.</p>
          <ChoiceGrid name="Reason" options={NOT_A_FIT_REASONS} value={reason} onChange={setReason} />
          {reason === "Other" && <input className={inputClass} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Reason" aria-label="Other reason" />}
        </div>
      );
      foot = footer("Mark Not a Fit", "danger");
      break;
  }

  return (
    <Dialog open title={title} subtitle={subtitle} onClose={onClose} footer={foot}>
      <form id="lead-action-form" onSubmit={submit} noValidate>
        {body}
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
