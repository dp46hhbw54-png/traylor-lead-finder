import type {
  Activity,
  Company,
  Contact,
  FollowUp,
  Lead,
  LeadFinderSnapshot,
  OpportunitySignal,
  Property,
  Source,
  SourceRecord,
  Walkthrough,
} from "../domain/types";

/** A lead with all of its related records resolved. Pure data — no scoring yet. */
export interface LeadContext {
  lead: Lead;
  property: Property;
  /** Tenant / business / operator. */
  company: Company | null;
  primaryContact: Contact | null;
  propertyManager: Company | null;
  propertyManagerContact: Contact | null;
  leasingCompany: Company | null;
  /** Every contact linked to the property or business, primary first. */
  contacts: Contact[];
  signals: OpportunitySignal[];
  source: Source | null;
  /** The record this lead was created from (a CSV row, URL reference, manual entry). */
  sourceRecord: SourceRecord | null;
  /** Newest first. */
  activities: Activity[];
  /** Open (not completed) follow-ups, soonest first. */
  openFollowups: FollowUp[];
  walkthroughs: Walkthrough[];
}

const CONTACT_ACTIVITY_TYPES = new Set(["call", "email", "text"]);

export function isContactActivity(a: Activity): boolean {
  return CONTACT_ACTIVITY_TYPES.has(a.type);
}

export function buildLeadContexts(snapshot: LeadFinderSnapshot): LeadContext[] {
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const companies = byId(snapshot.companies);
  const properties = byId(snapshot.properties);
  const contacts = byId(snapshot.contacts);
  const sources = byId(snapshot.sources);
  const sourceRecords = byId(snapshot.sourceRecords);

  const out: LeadContext[] = [];
  for (const lead of snapshot.leads) {
    if (lead.mergedIntoLeadId) continue; // Merged away — kept in the data, hidden from every list.
    const property = properties.get(lead.propertyId);
    if (!property) continue; // Orphaned lead — never render half a record.

    const rels = snapshot.relationships.filter((r) => r.propertyId === property.id);
    const pmRel = rels.find((r) => r.role === "property_manager");
    const leasingRel = rels.find((r) => r.role === "leasing_company");
    const propertyManager = pmRel ? companies.get(pmRel.companyId) ?? null : null;
    const leasingCompany = leasingRel ? companies.get(leasingRel.companyId) ?? null : null;
    const company = lead.companyId ? companies.get(lead.companyId) ?? null : null;
    const primaryContact = lead.primaryContactId ? contacts.get(lead.primaryContactId) ?? null : null;

    const relatedCompanyIds = new Set(
      [company?.id, propertyManager?.id, leasingCompany?.id].filter(Boolean) as string[],
    );
    const relatedContacts = snapshot.contacts.filter(
      (c) => c.propertyId === property.id || (c.companyId !== null && relatedCompanyIds.has(c.companyId)),
    );
    const orderedContacts = primaryContact
      ? [primaryContact, ...relatedContacts.filter((c) => c.id !== primaryContact.id)]
      : relatedContacts;

    const propertyManagerContact =
      propertyManager ? orderedContacts.find((c) => c.companyId === propertyManager.id) ?? null : null;

    out.push({
      lead,
      property,
      company,
      primaryContact,
      propertyManager,
      propertyManagerContact,
      leasingCompany,
      contacts: orderedContacts,
      signals: snapshot.signals.filter((s) => s.leadId === lead.id),
      source: sources.get(lead.sourceId) ?? null,
      sourceRecord: lead.sourceRecordId ? sourceRecords.get(lead.sourceRecordId) ?? null : null,
      activities: snapshot.activities
        .filter((a) => a.leadId === lead.id)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      openFollowups: snapshot.followups
        .filter((f) => f.leadId === lead.id && !f.completedAt)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      walkthroughs: snapshot.walkthroughs
        .filter((w) => w.leadId === lead.id)
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    });
  }
  return out;
}

/** Most recent call / email / text logged on the lead. */
export function lastContactActivity(ctx: LeadContext): Activity | null {
  return ctx.activities.find(isContactActivity) ?? null;
}

/** True when some public way to reach the business or property exists. */
export function hasPublicBusinessContact(ctx: LeadContext): boolean {
  const contactHasInfo = ctx.contacts.some((c) => Boolean(c.phone || c.email));
  const companyHasInfo = [ctx.company, ctx.propertyManager, ctx.leasingCompany].some((c) =>
    Boolean(c && (c.phone || c.email)),
  );
  return contactHasInfo || companyHasInfo;
}

export function hasAnyContactPath(ctx: LeadContext): boolean {
  return (
    hasPublicBusinessContact(ctx) ||
    Boolean(ctx.propertyManager) ||
    Boolean(ctx.leasingCompany) ||
    Boolean(ctx.company?.website)
  );
}

/** Best person/company to call, in order: primary contact → PM contact → any contact → company. */
export function bestContact(ctx: LeadContext): {
  name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  organization: string | null;
} {
  const person = ctx.primaryContact ?? ctx.propertyManagerContact ?? ctx.contacts.find((c) => c.phone || c.email) ?? null;
  const org =
    (person?.companyId &&
      [ctx.company, ctx.propertyManager, ctx.leasingCompany].find((c) => c?.id === person.companyId)) ||
    ctx.propertyManager ||
    ctx.company ||
    ctx.leasingCompany ||
    null;
  return {
    name: person?.name ?? null,
    role: person?.role ?? null,
    phone: person?.phone ?? org?.phone ?? null,
    email: person?.email ?? org?.email ?? null,
    website: org?.website ?? ctx.company?.website ?? null,
    organization: org?.name ?? null,
  };
}
