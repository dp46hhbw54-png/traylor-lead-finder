import { RepositoryError } from "../domain/errors";
import type {
  Activity,
  ActivityType,
  ContactMethod,
  FollowUp,
  LeadFinderSnapshot,
  LostReasonCode,
  PipelineStatus,
  PotentialValue,
  Walkthrough,
  WalkthroughOutcome,
} from "../domain/types";
import type { CsvImportPlan, CsvImportResult } from "../workflow/csv-import";
import type { CreateLeadOptions, CreateLeadResult, DuplicateAction, DuplicateCandidate, NewLeadInput } from "../workflow/ingest";
import type { MergeSummary } from "../workflow/merge";

export { RepositoryError };
export type { CreateLeadOptions, CreateLeadResult, CsvImportPlan, CsvImportResult, DuplicateAction, DuplicateCandidate, MergeSummary, NewLeadInput };

/**
 * The ONE seam between the UI and wherever data lives.
 *
 * Today:  `LocalDemoRepository` (in-browser, fictional data).
 * Later:  `SupabaseRepository` against the dedicated Lead Finder project's `lead_finder` schema.
 *
 * The UI only ever talks to this interface, so swapping the backend does not touch screens.
 * The business rules themselves (src/lib/workflow) are plain functions both repositories share —
 * a repository's job is only to load, save and enforce who is allowed to do what.
 *
 * Every method that changes data:
 *   - checks the signed-in user's role (Viewers can look, not change),
 *   - leaves a timeline entry and/or an audit-log row,
 *   - is all-or-nothing: if it fails, nothing is half-saved.
 */
export interface LeadFinderRepository {
  readonly kind: "demo" | "supabase";
  readonly label: string;

  loadSnapshot(): Promise<LeadFinderSnapshot>;

  // ---- Working a lead
  logActivity(input: { leadId: string; type: ActivityType; summary: string; outcome?: string | null }): Promise<Activity>;
  scheduleFollowUp(input: { leadId: string; contactId: string | null; dueAt: string; method: ContactMethod; notes: string }): Promise<FollowUp>;
  completeFollowUp(followUpId: string, note?: string): Promise<FollowUp>;
  scheduleWalkthrough(input: { leadId: string; contactId: string | null; scheduledAt: string; attendees: string; notes: string }): Promise<Walkthrough>;
  completeWalkthrough(input: { walkthroughId: string; outcome: WalkthroughOutcome; nextAction?: string | null; notes?: string | null }): Promise<Walkthrough>;
  setStatus(leadId: string, status: PipelineStatus, note?: string): Promise<void>;
  markWon(leadId: string, note?: string): Promise<void>;
  markLost(leadId: string, code: LostReasonCode, note?: string): Promise<void>;
  snooze(leadId: string, until: string): Promise<void>;
  unsnooze(leadId: string): Promise<void>;
  markNotAFit(leadId: string, reason: string): Promise<void>;
  /** Undo for Not a Fit / Lost / status changes — restores the previous status. */
  restoreStatus(leadId: string, status: PipelineStatus): Promise<void>;
  requestQuote(leadId: string): Promise<void>;
  setPotentialValue(leadId: string, value: PotentialValue): Promise<void>;
  markVerified(leadId: string, note?: string): Promise<void>;

  // ---- Bringing opportunities in
  /** Existing properties that look like the building in `input`. Changes nothing. */
  previewDuplicates(input: NewLeadInput): Promise<DuplicateCandidate[]>;
  /**
   * Creates the lead + property + business + contact + evidence + source record.
   * Reports probable duplicates instead of saving, unless told what to do — and then keeps that decision on record.
   */
  createLead(input: NewLeadInput, options?: CreateLeadOptions): Promise<CreateLeadResult>;
  /** Imports a mapped CSV. Every row ends up imported, added to an existing lead, skipped, or not imported (with the reason). */
  importCsv(plan: CsvImportPlan): Promise<CsvImportResult>;

  // ---- Cleaning up duplicates (history-preserving — nothing is deleted)
  mergeProperties(survivorId: string, duplicateId: string): Promise<MergeSummary>;
  mergeLeads(survivorId: string, duplicateId: string): Promise<MergeSummary>;
  /** Merge two leads that are the same opportunity (merging their property records first when needed). Recorded as a duplicate decision. */
  mergeDuplicateLeads(survivorId: string, duplicateId: string): Promise<MergeSummary>;
  /** "These are not the same" — stops the warning and records the decision. */
  markNotDuplicate(leadId: string, otherLeadId: string, note?: string): Promise<void>;

  /** Demo only: wipe local changes and reload the fictional dataset. */
  reset?(): Promise<void>;
}
