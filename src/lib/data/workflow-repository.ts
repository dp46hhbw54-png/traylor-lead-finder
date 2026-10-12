import type { Permission } from "../domain/permissions";
import type { LeadFinderSnapshot } from "../domain/types";
import type { MutationContext } from "../workflow/context";
import * as flow from "../workflow/actions";
import { importCsv, type CsvImportPlan } from "../workflow/csv-import";
import { markNotDuplicate, mergeDuplicateLeads } from "../workflow/duplicate-review";
import { createLead, previewDuplicates, type CreateLeadOptions, type NewLeadInput } from "../workflow/ingest";
import { mergeLeads, mergeProperties } from "../workflow/merge";
import type { LeadFinderRepository } from "./repository";

/**
 * Every action the app can take, written once.
 *
 * Each action is a plain business rule (src/lib/workflow) run inside `change()`. The demo and the
 * database repositories differ ONLY in how `change()` loads, checks permission and saves — so the
 * rules people test in the demo are exactly the rules that run against the real database.
 */
export abstract class WorkflowRepository implements LeadFinderRepository {
  abstract readonly kind: "demo" | "supabase";
  abstract readonly label: string;

  abstract loadSnapshot(): Promise<LeadFinderSnapshot>;
  /** Run one all-or-nothing change on a copy of the data, then save it. */
  protected abstract change<T>(permission: Permission, fn: (s: LeadFinderSnapshot, m: MutationContext) => T): Promise<T>;
  /** The data as last loaded, for read-only checks such as duplicate previews. */
  protected abstract current(): Promise<LeadFinderSnapshot>;

  logActivity(input: Parameters<LeadFinderRepository["logActivity"]>[0]) {
    return this.change("work_leads", (s, m) => flow.logActivity(s, m, input));
  }
  scheduleFollowUp(input: Parameters<LeadFinderRepository["scheduleFollowUp"]>[0]) {
    return this.change("work_leads", (s, m) => flow.scheduleFollowUp(s, m, input));
  }
  completeFollowUp(followUpId: string, note?: string) {
    return this.change("work_leads", (s, m) => flow.completeFollowUp(s, m, followUpId, note));
  }
  scheduleWalkthrough(input: Parameters<LeadFinderRepository["scheduleWalkthrough"]>[0]) {
    return this.change("work_leads", (s, m) => flow.scheduleWalkthrough(s, m, input));
  }
  completeWalkthrough(input: Parameters<LeadFinderRepository["completeWalkthrough"]>[0]) {
    return this.change("work_leads", (s, m) => flow.completeWalkthrough(s, m, input));
  }
  async setStatus(leadId: string, status: Parameters<LeadFinderRepository["setStatus"]>[1], note?: string) {
    await this.change("work_leads", (s, m) => flow.setStatus(s, m, leadId, status, note));
  }
  async markWon(leadId: string, note?: string) {
    await this.change("work_leads", (s, m) => flow.markWon(s, m, leadId, note));
  }
  async markLost(leadId: string, code: Parameters<LeadFinderRepository["markLost"]>[1], note?: string) {
    await this.change("work_leads", (s, m) => flow.markLost(s, m, leadId, code, note));
  }
  async snooze(leadId: string, until: string) {
    await this.change("work_leads", (s, m) => flow.snooze(s, m, leadId, until));
  }
  async unsnooze(leadId: string) {
    await this.change("work_leads", (s, m) => flow.unsnooze(s, m, leadId));
  }
  async markNotAFit(leadId: string, reason: string) {
    await this.change("work_leads", (s, m) => flow.markNotAFit(s, m, leadId, reason));
  }
  async restoreStatus(leadId: string, status: Parameters<LeadFinderRepository["restoreStatus"]>[1]) {
    await this.change("work_leads", (s, m) => flow.restoreStatus(s, m, leadId, status));
  }
  async requestQuote(leadId: string) {
    await this.change("work_leads", (s, m) => flow.requestQuote(s, m, leadId));
  }
  async setPotentialValue(leadId: string, value: Parameters<LeadFinderRepository["setPotentialValue"]>[1]) {
    await this.change("edit_records", (s, m) => flow.setPotentialValue(s, m, leadId, value));
  }
  async markVerified(leadId: string, note?: string) {
    await this.change("work_leads", (s, m) => flow.markVerified(s, m, leadId, note));
  }

  async previewDuplicates(input: NewLeadInput) {
    return previewDuplicates(await this.current(), input);
  }
  createLead(input: NewLeadInput, options?: CreateLeadOptions) {
    return this.change("edit_records", (s, m) => createLead(s, m, input, options));
  }
  importCsv(plan: CsvImportPlan) {
    return this.change("edit_records", (s, m) => importCsv(s, m, plan));
  }

  mergeProperties(survivorId: string, duplicateId: string) {
    return this.change("merge_records", (s, m) => mergeProperties(s, m, survivorId, duplicateId));
  }
  mergeLeads(survivorId: string, duplicateId: string) {
    return this.change("merge_records", (s, m) => mergeLeads(s, m, survivorId, duplicateId));
  }
  mergeDuplicateLeads(survivorId: string, duplicateId: string) {
    return this.change("merge_records", (s, m) => mergeDuplicateLeads(s, m, survivorId, duplicateId));
  }
  async markNotDuplicate(leadId: string, otherLeadId: string, note?: string) {
    await this.change("merge_records", (s, m) => markNotDuplicate(s, m, leadId, otherLeadId, note));
  }
}
