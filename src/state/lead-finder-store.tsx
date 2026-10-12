"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import { getRepository, RepositoryError, type LeadFinderRepository } from "@/lib/data";
import type { CreateLeadOptions, CreateLeadResult, CsvImportPlan, CsvImportResult, NewLeadInput } from "@/lib/data/repository";
import { LOST_REASON_LABEL, PIPELINE_STATUS_LABEL } from "@/lib/domain/labels";
import type { ContactMethod, LeadFinderSnapshot, LostReasonCode, PipelineStatus, PotentialValue, WalkthroughOutcome } from "@/lib/domain/types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; nextStep: string }
  | { status: "ready" };

interface LeadFinderStore {
  repo: LeadFinderRepository;
  state: LoadState;
  snapshot: LeadFinderSnapshot | null;
  /** The moment the current view was computed. Recomputed after every change. */
  now: Date;
  busy: boolean;
  reload: () => Promise<void>;
  actions: {
    logActivity: (leadId: string, type: "call" | "email" | "text" | "note", summary: string, outcome?: string | null) => Promise<boolean>;
    scheduleFollowUp: (leadId: string, contactId: string | null, dueAt: string, method: ContactMethod, notes: string) => Promise<boolean>;
    scheduleWalkthrough: (leadId: string, contactId: string | null, scheduledAt: string, attendees: string, notes: string) => Promise<boolean>;
    snooze: (leadId: string, until: string, label: string) => Promise<boolean>;
    notAFit: (leadId: string, reason: string, previous: PipelineStatus, label: string) => Promise<boolean>;
    requestQuote: (leadId: string) => Promise<boolean>;
    /** Move a lead to another stage. Lost needs a reason. Undo puts it back where it was. */
    changeStatus: (leadId: string, status: PipelineStatus, previous: PipelineStatus, opts?: { lostCode?: LostReasonCode; note?: string }) => Promise<boolean>;
    completeWalkthrough: (walkthroughId: string, outcome: WalkthroughOutcome, nextAction: string, notes: string) => Promise<boolean>;
    markVerified: (leadId: string) => Promise<boolean>;
    setPotentialValue: (leadId: string, value: PotentialValue) => Promise<boolean>;
    /** Null when it failed (the reason is shown). "duplicates_found" saves nothing and shows no toast — the screen asks what to do. */
    createLead: (input: NewLeadInput, options?: CreateLeadOptions) => Promise<CreateLeadResult | null>;
    importCsv: (plan: CsvImportPlan) => Promise<CsvImportResult | null>;
    mergeDuplicateLeads: (survivorId: string, duplicateId: string, label: string) => Promise<boolean>;
    markNotDuplicate: (leadId: string, otherLeadId: string) => Promise<boolean>;
    resetDemo: () => Promise<void>;
  };
}

const Ctx = createContext<LeadFinderStore | null>(null);

function explain(err: unknown): { message: string; nextStep: string } {
  if (err instanceof RepositoryError) return { message: err.message, nextStep: err.nextStep };
  return {
    message: err instanceof Error ? err.message : "An unexpected error occurred.",
    nextStep: "Try again. If it keeps happening, reset the demo data in Settings.",
  };
}

export function LeadFinderProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => getRepository(), []);
  const toast = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [snapshot, setSnapshot] = useState<LeadFinderSnapshot | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setState({ status: "loading" });
      try {
        const snap = await repo.loadSnapshot();
        if (!mounted.current) return;
        setSnapshot(snap);
        setNow(new Date());
        setState({ status: "ready" });
      } catch (err) {
        if (!mounted.current) return;
        setState({ status: "error", ...explain(err) });
      }
    },
    [repo],
  );

  useEffect(() => {
    mounted.current = true;
    void load(true);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** Runs a mutation, refreshes the view, and always reports success or failure. */
  const run = useCallback(
    async (fn: () => Promise<unknown>, success: { title: string; description?: string; undo?: () => Promise<unknown> }) => {
      setBusy(true);
      try {
        await fn();
        await load(false);
        toast.push({
          kind: "success",
          title: success.title,
          description: success.description,
          action: success.undo
            ? {
                label: "Undo",
                onClick: () => {
                  void (async () => {
                    try {
                      await success.undo!();
                      await load(false);
                      toast.push({ kind: "info", title: "Undone" });
                    } catch (err) {
                      const e = explain(err);
                      toast.push({ kind: "error", title: "Couldn't undo", description: `${e.message} ${e.nextStep}` });
                    }
                  })();
                },
              }
            : undefined,
        });
        return true;
      } catch (err) {
        const e = explain(err);
        toast.push({ kind: "error", title: "That didn't save", description: `${e.message} ${e.nextStep}` });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  /** Like `run`, but hands back the result; the caller decides what success looks like. */
  const runFor = useCallback(
    async <T,>(fn: () => Promise<T>, success: (result: T) => { title: string; description?: string } | null): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await fn();
        await load(false);
        const msg = success(result);
        if (msg) toast.push({ kind: "success", ...msg });
        return result;
      } catch (err) {
        const e = explain(err);
        toast.push({ kind: "error", title: "That didn't save", description: `${e.message} ${e.nextStep}` });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const actions = useMemo<LeadFinderStore["actions"]>(
    () => ({
      logActivity: (leadId, type, summary, outcome) =>
        run(() => repo.logActivity({ leadId, type, summary, outcome }), { title: "Activity logged", description: summary }),
      scheduleFollowUp: (leadId, contactId, dueAt, method, notes) =>
        run(() => repo.scheduleFollowUp({ leadId, contactId, dueAt, method, notes }), {
          title: "Follow-up scheduled",
          description: new Date(dueAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        }),
      scheduleWalkthrough: (leadId, contactId, scheduledAt, attendees, notes) =>
        run(() => repo.scheduleWalkthrough({ leadId, contactId, scheduledAt, attendees, notes }), {
          title: "Walkthrough scheduled",
          description: new Date(scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        }),
      snooze: (leadId, until, label) =>
        run(() => repo.snooze(leadId, until), { title: "Snoozed", description: label, undo: () => repo.unsnooze(leadId) }),
      notAFit: (leadId, reason, previous, label) =>
        run(() => repo.markNotAFit(leadId, reason), {
          title: "Marked Not a Fit",
          description: `${label} — hidden from Today and the pipeline (still searchable).`,
          undo: () => repo.restoreStatus(leadId, previous),
        }),
      requestQuote: (leadId) =>
        run(() => repo.requestQuote(leadId), { title: "Quote requested", description: "Logged on the timeline. Quoting is a separate future system." }),
      changeStatus: (leadId, status, previous, opts) =>
        run(
          () => {
            if (status === "lost") {
              if (!opts?.lostCode) throw new RepositoryError("Choose why the lead was lost.", "Pick a reason so we can learn from it.");
              return repo.markLost(leadId, opts.lostCode, opts.note);
            }
            if (status === "won") return repo.markWon(leadId, opts?.note);
            return repo.setStatus(leadId, status, opts?.note);
          },
          {
            title: `Moved to ${PIPELINE_STATUS_LABEL[status]}`,
            description: status === "lost" && opts?.lostCode ? LOST_REASON_LABEL[opts.lostCode] : undefined,
            undo: () => repo.restoreStatus(leadId, previous),
          },
        ),
      completeWalkthrough: (walkthroughId, outcome, nextAction, notes) =>
        run(() => repo.completeWalkthrough({ walkthroughId, outcome, nextAction, notes }), { title: "Walkthrough outcome recorded" }),
      markVerified: (leadId) => run(() => repo.markVerified(leadId), { title: "Marked re-verified", description: "The freshness clock restarted." }),
      setPotentialValue: (leadId, value) => run(() => repo.setPotentialValue(leadId, value), { title: "Potential value saved" }),
      createLead: (input, options) =>
        runFor(
          () => repo.createLead(input, options),
          (r) =>
            r.status === "duplicates_found"
              ? null
              : r.mode === "added_to_existing"
                ? { title: "Added to the existing lead", description: "New source and evidence added. Nothing was overwritten." }
                : { title: "Lead saved", description: "Scored and added to your leads." },
        ),
      importCsv: (plan) =>
        runFor(
          () => repo.importCsv(plan),
          (r) => ({
            title: r.imported + r.addedToExisting > 0 ? "Import finished" : "Nothing was imported",
            description: `${r.imported} imported · ${r.addedToExisting} added to existing · ${r.skipped} skipped · ${r.notImported} not imported`,
          }),
        ),
      mergeDuplicateLeads: (survivorId, duplicateId, label) =>
        run(() => repo.mergeDuplicateLeads(survivorId, duplicateId), {
          title: "Duplicates merged",
          description: `${label} — sources, activity, notes, follow-ups and history were kept.`,
        }),
      markNotDuplicate: (leadId, otherLeadId) =>
        run(() => repo.markNotDuplicate(leadId, otherLeadId), { title: "Marked “not a duplicate”", description: "We won't flag this pair again." }),
      resetDemo: async () => {
        await repo.reset?.();
        await load(true);
        toast.push({ kind: "success", title: "Demo data reset", description: "Fictional demo records reloaded." });
      },
    }),
    [repo, run, runFor, load, toast],
  );

  const value = useMemo<LeadFinderStore>(
    () => ({ repo, state, snapshot, now, busy, reload: () => load(true), actions }),
    [repo, state, snapshot, now, busy, load, actions],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeadFinder() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLeadFinder must be used inside <LeadFinderProvider>");
  return ctx;
}
