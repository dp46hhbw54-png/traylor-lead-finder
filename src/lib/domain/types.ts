/**
 * Domain types for the Traylor Pro Commercial Lead Finder.
 *
 * These mirror the planned `lead_finder` schema in the dedicated Supabase
 * project (see supabase/migrations/20261012000001_lead_finder_schema.sql — a DRAFT that has not been run).
 * Field names are the camelCase of the future snake_case columns, so the
 * Supabase repository is a drop-in swap. A test keeps the two in sync.
 *
 * Dates are ISO-8601 strings.
 */

export type ISODate = string;

/** Bump when the snapshot shape changes. Old browser-saved demo data is discarded, never half-read. */
export const SCHEMA_VERSION = 3;

/** created_at / updated_at on every stored record. */
export interface Timestamps {
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** How trustworthy a piece of information is. Never present data as more certain than this. */
export type DataStatus = "verified" | "publicly_reported" | "estimated" | "unknown";

export type PipelineStatus =
  | "new"
  | "researching"
  | "contacted"
  | "interested"
  | "walkthrough"
  | "won"
  | "lost"
  | "nurture"
  | "not_a_fit";

export type FacilityType =
  | "office"
  | "warehouse"
  | "distribution_center"
  | "industrial"
  | "manufacturing"
  | "retail_center"
  | "restaurant"
  | "hotel"
  | "multifamily_common"
  | "school"
  | "church"
  | "medical_office"
  | "professional"
  | "automotive"
  | "government"
  | "multi_tenant"
  | "other";

export type SignalStrength = "very_strong" | "medium" | "weak";

export type SignalType =
  // Very strong
  | "new_tenant"
  | "new_business_opening"
  | "new_construction"
  | "construction_nearing_completion"
  | "facility_opening"
  | "major_renovation"
  | "expansion"
  | "business_relocation"
  | "new_ownership"
  | "new_property_manager"
  | "new_management_company"
  | "facility_reopening"
  | "major_tenant_change"
  | "vendor_may_change"
  | "recently_leased"
  | "occupancy_expected_soon"
  | "new_development"
  | "rfp_bid"
  // Medium
  | "listed_for_lease"
  | "new_business_announced"
  | "recently_sold"
  | "multiple_tenants"
  | "appears_newly_occupied"
  | "business_growing"
  // Weak
  | "generic_commercial";

/** V1 source types. Anything automated comes later and must respect each site's terms. */
export type SourceType = "manual" | "csv" | "url";

/** What kind of information a source provides (for the future adapter framework). */
export type SourceCategory =
  | "manual_entry"
  | "csv_import"
  | "url_reference"
  | "property_data"
  | "permits"
  | "construction"
  | "commercial_listings"
  | "business_directory"
  | "business_website"
  | "public_records"
  | "announcements"
  | "news"
  | "development"
  | "rfp";

/** What kind of place a manager found an opportunity (manual entry / URL reference). */
export type SourceKind =
  | "website"
  | "news_article"
  | "property_listing"
  | "public_record"
  | "business_announcement"
  | "referral"
  | "manual_research"
  | "other";

/**
 * Has anyone actually checked this source?
 *  - "verified"     a person opened it and it supports the lead (who + when are stored)
 *  - "not_checked"  stored as given; nobody has confirmed it yet
 *  - "unavailable"  the link could not be opened — the facts are unconfirmed, NOT disproven
 * The app never fetches links itself (no scraping), so it never marks anything verified on its own.
 */
export type SourceVerification = "verified" | "not_checked" | "unavailable";

/** A source that failed is "unavailable" — never silently treated as "no leads found". */
export type SourceStatus = "available" | "unavailable" | "disabled";

/** A company's role at a property. One company can hold many roles at many properties. */
export type RelationshipRole = "owner" | "tenant" | "operator" | "property_manager" | "leasing_company";

export type ActivityType =
  | "discovered"
  | "call"
  | "email"
  | "text"
  | "note"
  | "status_change"
  | "followup_scheduled"
  | "followup_completed"
  | "walkthrough_scheduled"
  | "walkthrough_completed"
  | "snoozed"
  | "unsnoozed"
  | "not_a_fit"
  | "restored"
  | "verified"
  | "quote_requested"
  | "merged"
  | "other";

export type ContactMethod = "call" | "email" | "text" | "walkthrough" | "other";

/**
 * Management's quick read on how valuable an opportunity could be.
 * NOT a quote and NOT a dollar estimate — there is deliberately no dollar field anywhere.
 */
export type PotentialValue = "very_high" | "high" | "medium" | "low" | "unknown";

export type LostReasonCode = "price" | "competitor" | "no_response" | "timing" | "building_not_a_fit" | "in_house" | "other";

export type AppRole = "owner" | "manager" | "viewer";

export type Tier = "hot" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------------------------

/** Service area is data, not code. Add a city or parish by adding a row. */
export interface Market extends Timestamps {
  id: string;
  name: string;
  kind: "city" | "parish";
  /** Parish the city belongs to (cities only). */
  parish?: string;
  active: boolean;
}

export interface Source extends Timestamps {
  id: string;
  name: string;
  type: SourceType;
  category: SourceCategory;
  url: string | null;
  status: SourceStatus;
  /** Plain-language reason when a source is unavailable or disabled. */
  statusNote: string | null;
  lastCheckedAt: ISODate | null;
  lastSuccessAt: ISODate | null;
  /**
   * Has a person confirmed this source's terms allow automated access?
   * `null` = not reviewed → treat as NOT allowed. V1 sources are manual, so `false`.
   */
  automatedAccessAllowed: boolean | null;
  isDemo: boolean;
}

/** One record as it arrived from a source (a CSV row, a URL reference, a manual entry). */
export interface SourceRecord extends Timestamps {
  id: string;
  sourceId: string;
  /** source_name — kept on the record so history survives if the source is renamed. */
  sourceName: string;
  sourceUrl: string | null;
  /** source_record_id — the source's own identifier for this record, when it has one. */
  externalId: string | null;
  discoveredAt: ISODate;
  lastVerifiedAt: ISODate | null;
  status: "new" | "imported" | "duplicate" | "rejected";
  importedLeadId: string | null;
  /** Website, news article, property listing… (manual / URL entries). */
  kind: SourceKind | null;
  /** Who published it or what it is, e.g. "Business journal article" or the CSV file name. */
  title: string | null;
  verification: SourceVerification;
  verifiedBy: string | null;
  /** Why a record was rejected or skipped, in plain language. */
  note: string | null;
  /** What was received, exactly as received. Never edited. */
  payload: Record<string, string | number | null> | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------------------------
// Who and where
// ---------------------------------------------------------------------------------------------

export interface Company extends Timestamps {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  sourceId: string | null;
  /** Set when this record was merged into another. The record is kept, never deleted. */
  mergedIntoId: string | null;
  isDemo: boolean;
}

export interface Property extends Timestamps {
  id: string;
  name: string;
  address: string;
  /** Lower-cased street address with abbreviations and unit numbers removed — used to find duplicates. */
  normalizedAddress: string;
  city: string;
  parish: string;
  zip: string;
  marketId: string | null;
  facilityType: FacilityType;
  sqft: number | null;
  sqftStatus: DataStatus;
  constructionStatus: string | null;
  lat: number | null;
  lng: number | null;
  mergedIntoId: string | null;
  isDemo: boolean;
}

export interface Contact extends Timestamps {
  id: string;
  name: string;
  role: string;
  companyId: string | null;
  propertyId: string | null;
  phone: string | null;
  email: string | null;
  dataStatus: DataStatus;
  sourceId: string;
  isDemo: boolean;
}

export interface PropertyRelationship extends Timestamps {
  id: string;
  propertyId: string;
  companyId: string;
  role: RelationshipRole;
  dataStatus: DataStatus;
}

/**
 * Where a specific fact came from. Lets us answer "where did this number come from?"
 * for one field of one record. Rows are history — newer rows do not delete older ones.
 */
export interface FieldProvenance extends Timestamps {
  id: string;
  entityType: "property" | "company" | "contact" | "lead" | "relationship";
  entityId: string;
  /** e.g. "sqft", "phone", "email", "property_manager". */
  field: string;
  status: DataStatus;
  sourceId: string | null;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  /** Human-readable value at the time, e.g. "45,000 sq ft". */
  valueNote: string | null;
  recordedAt: ISODate;
  verifiedAt: ISODate | null;
  verifiedBy: string | null;
}

// ---------------------------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------------------------

export interface OpportunitySignal extends Timestamps {
  id: string;
  leadId: string;
  type: SignalType;
  description: string;
  sourceId: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  discoveredAt: ISODate;
  verifiedAt: ISODate | null;
  verifiedBy: string | null;
  confidence: DataStatus;
  /** Optional future date the signal points to (e.g. expected occupancy / opening). */
  expectedDate: ISODate | null;
}

export interface Lead extends Timestamps {
  id: string;
  /** Short headline, e.g. "New tenant moving into warehouse". */
  title: string;
  propertyId: string;
  /** The business/tenant/operator, if known. */
  companyId: string | null;
  /** Best person to contact, if publicly identified. */
  primaryContactId: string | null;
  status: PipelineStatus;
  potentialValue: PotentialValue;
  sourceId: string;
  /** The SourceRecord this lead was created from. */
  sourceRecordId: string | null;
  discoveredAt: ISODate;
  lastVerifiedAt: ISODate | null;
  lastVerifiedBy: string | null;
  snoozedUntil: ISODate | null;
  notAFitReason: string | null;
  lostReasonCode: LostReasonCode | null;
  lostReason: string | null;
  /** When the lead reached Won, Lost or Not a Fit. Null while open. */
  closedAt: ISODate | null;
  notes: string | null;
  /** Set when this lead was merged into another. The record is kept, never deleted. */
  mergedIntoLeadId: string | null;
  /** Future quoting hooks — plain text references, no foreign keys into other systems. */
  externalQuoteRef: string | null;
  convertedCustomerRef: string | null;
  isDemo: boolean;
}

export interface ScoreLine {
  key: string;
  group: "signal" | "property" | "contact" | "freshness";
  label: string;
  points: number;
  /** Plain-language evidence behind the points. */
  detail: string | null;
}

/** A saved copy of how a lead scored at a moment in time, with every point explained. */
export interface LeadScoreBreakdown {
  id: string;
  leadId: string;
  computedAt: ISODate;
  /** Unclamped total — never thrown away. */
  rawScore: number;
  /** What the user sees: raw clamped to 0–100. */
  score: number;
  capped: boolean;
  tier: Tier;
  lines: ScoreLine[];
  /** Version of the scoring rules used (lead_settings.version). */
  settingsVersion: number;
}

// ---------------------------------------------------------------------------------------------
// Sales activity
// ---------------------------------------------------------------------------------------------

export interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  summary: string;
  outcome: string | null;
  occurredAt: ISODate;
  performedBy: string;
}

export interface FollowUp extends Timestamps {
  id: string;
  leadId: string;
  contactId: string | null;
  dueAt: ISODate;
  method: ContactMethod;
  notes: string;
  completedAt: ISODate | null;
  completedBy: string | null;
  completionNote: string | null;
}

export type WalkthroughOutcome = "interested" | "not_interested" | "send_to_bid" | "rescheduled";

export interface Walkthrough extends Timestamps {
  id: string;
  leadId: string;
  propertyId: string;
  contactId: string | null;
  scheduledAt: ISODate;
  attendees: string;
  notes: string;
  outcome: WalkthroughOutcome | null;
  nextAction: string | null;
  completedAt: ISODate | null;
}

// ---------------------------------------------------------------------------------------------
// Accountability and configuration
// ---------------------------------------------------------------------------------------------

export type AuditEntity =
  | "lead"
  | "property"
  | "company"
  | "contact"
  | "relationship"
  | "signal"
  | "followup"
  | "walkthrough"
  | "source_record"
  | "setting"
  | "user_role";

export type AuditAction = "create" | "update" | "status_change" | "score_change" | "merge" | "restore";

/** Who changed what, and when. Append-only: rows are never edited or removed. */
export interface AuditEntry {
  id: string;
  entityType: AuditEntity;
  entityId: string;
  /** The lead this change belongs to, when there is one — makes a lead's change history one query. */
  leadId: string | null;
  action: AuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: ISODate;
  note: string | null;
}

/** What a person decided when the app warned "this might be a duplicate". Append-only history. */
export type DuplicateDecisionAction =
  | "create_anyway"
  | "link_to_property"
  | "add_to_existing_lead"
  | "merged"
  | "not_duplicate"
  | "skipped";

export interface DuplicateDecision {
  id: string;
  /** Where the warning came up. */
  context: "manual_entry" | "url_reference" | "csv_import" | "review";
  decision: DuplicateDecisionAction;
  /** What was being added or reviewed, in words, e.g. "ABC Distribution — 123 Main St, Baton Rouge". */
  subject: string;
  /** The records the warning pointed at. */
  candidatePropertyIds: string[];
  candidateLeadIds: string[];
  /** Why they looked alike (same_address, similar_name, …). */
  reasons: string[];
  /** What the decision produced or touched. */
  resultLeadId: string | null;
  resultPropertyId: string | null;
  sourceRecordId: string | null;
  decidedBy: string;
  decidedAt: ISODate;
  note: string | null;
}

/** Tunable settings stored as data (scoring rules live here once Supabase is connected). */
export interface LeadSetting {
  key: string;
  value: unknown;
  version: number;
  updatedAt: ISODate;
  updatedBy: string;
}

/** Who may use the app and at what level. `userId` links to Supabase Auth later. */
export interface UserRole extends Timestamps {
  id: string;
  userId: string | null;
  email: string;
  displayName: string;
  role: AppRole;
  active: boolean;
  isDemo: boolean;
}

/** Everything the UI needs, loaded in one go. Mirrors the future lead_finder schema tables. */
export interface LeadFinderSnapshot {
  schemaVersion: number;
  generatedAt: ISODate;
  markets: Market[];
  sources: Source[];
  sourceRecords: SourceRecord[];
  companies: Company[];
  properties: Property[];
  contacts: Contact[];
  relationships: PropertyRelationship[];
  provenance: FieldProvenance[];
  leads: Lead[];
  signals: OpportunitySignal[];
  scoreBreakdowns: LeadScoreBreakdown[];
  activities: Activity[];
  followups: FollowUp[];
  walkthroughs: Walkthrough[];
  auditLog: AuditEntry[];
  duplicateDecisions: DuplicateDecision[];
  settings: LeadSetting[];
  userRoles: UserRole[];
}
