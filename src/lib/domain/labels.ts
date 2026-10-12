import type {
  ActivityType,
  AppRole,
  ContactMethod,
  DataStatus,
  FacilityType,
  LostReasonCode,
  PipelineStatus,
  PotentialValue,
  RelationshipRole,
  SignalStrength,
  SignalType,
  DuplicateDecisionAction,
  SourceCategory,
  SourceKind,
  SourceStatus,
  SourceVerification,
  WalkthroughOutcome,
} from "./types";

export const PIPELINE_STATUS_LABEL: Record<PipelineStatus, string> = {
  new: "New",
  researching: "Researching",
  contacted: "Contacted",
  interested: "Interested",
  walkthrough: "Walkthrough",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
  not_a_fit: "Not a Fit",
};

/** Columns shown on the primary pipeline. "Not a Fit" is hidden but searchable. */
export const PIPELINE_COLUMNS: PipelineStatus[] = [
  "new",
  "researching",
  "contacted",
  "interested",
  "walkthrough",
  "won",
  "lost",
  "nurture",
];

export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = {
  office: "Office",
  warehouse: "Warehouse",
  distribution_center: "Distribution center",
  industrial: "Industrial",
  manufacturing: "Manufacturing",
  retail_center: "Retail center",
  restaurant: "Restaurant",
  hotel: "Hotel",
  multifamily_common: "Apartment common areas",
  school: "School",
  church: "Church",
  medical_office: "Medical office",
  professional: "Professional building",
  automotive: "Automotive",
  government: "Government",
  multi_tenant: "Multi-tenant commercial",
  other: "Other commercial",
};

export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  verified: "Verified",
  publicly_reported: "Publicly reported",
  estimated: "Estimated",
  unknown: "Unknown",
};

export const RELATIONSHIP_ROLE_LABEL: Record<RelationshipRole, string> = {
  owner: "Owner",
  tenant: "Tenant",
  operator: "Operator",
  property_manager: "Property manager",
  leasing_company: "Leasing company",
};

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  call: "Call",
  email: "Email",
  text: "Text",
  walkthrough: "Walkthrough",
  other: "Other",
};

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  discovered: "Lead discovered",
  call: "Call",
  email: "Email",
  text: "Text",
  note: "Note",
  status_change: "Status change",
  followup_scheduled: "Follow-up scheduled",
  followup_completed: "Follow-up completed",
  walkthrough_scheduled: "Walkthrough scheduled",
  walkthrough_completed: "Walkthrough completed",
  snoozed: "Snoozed",
  unsnoozed: "Snooze removed",
  not_a_fit: "Marked Not a Fit",
  restored: "Restored",
  verified: "Re-verified",
  quote_requested: "Quote requested",
  merged: "Records merged",
  other: "Other",
};

export interface SignalDefinition {
  label: string;
  strength: SignalStrength;
}

export const SIGNAL_DEFINITIONS: Record<SignalType, SignalDefinition> = {
  new_tenant: { label: "New tenant announced", strength: "very_strong" },
  new_business_opening: { label: "New business opening", strength: "very_strong" },
  new_construction: { label: "New commercial construction", strength: "very_strong" },
  construction_nearing_completion: { label: "Construction nearing completion", strength: "very_strong" },
  facility_opening: { label: "New facility opening", strength: "very_strong" },
  major_renovation: { label: "Major renovation", strength: "very_strong" },
  expansion: { label: "Expansion", strength: "very_strong" },
  business_relocation: { label: "Business relocation", strength: "very_strong" },
  new_ownership: { label: "New ownership", strength: "very_strong" },
  new_property_manager: { label: "New property manager", strength: "very_strong" },
  new_management_company: { label: "New management company", strength: "very_strong" },
  facility_reopening: { label: "Facility reopening", strength: "very_strong" },
  major_tenant_change: { label: "Major tenant change", strength: "very_strong" },
  vendor_may_change: { label: "Cleaning vendor may be changing", strength: "very_strong" },
  recently_leased: { label: "Recently leased", strength: "very_strong" },
  occupancy_expected_soon: { label: "Occupancy expected soon", strength: "very_strong" },
  new_development: { label: "New development", strength: "very_strong" },
  rfp_bid: { label: "RFP / bid opportunity", strength: "very_strong" },
  listed_for_lease: { label: "Listed for lease", strength: "medium" },
  new_business_announced: { label: "New business announced", strength: "medium" },
  recently_sold: { label: "Recently sold", strength: "medium" },
  multiple_tenants: { label: "Multiple tenants", strength: "medium" },
  appears_newly_occupied: { label: "Appears newly occupied", strength: "medium" },
  business_growing: { label: "Business appears to be growing", strength: "medium" },
  generic_commercial: { label: "Generic commercial property", strength: "weak" },
};

export const SIGNAL_STRENGTH_LABEL: Record<SignalStrength, string> = {
  very_strong: "Very strong",
  medium: "Medium",
  weak: "Weak",
};

export const POTENTIAL_VALUE_LABEL: Record<PotentialValue, string> = {
  very_high: "Very High Potential",
  high: "High Potential",
  medium: "Medium Potential",
  low: "Low Potential",
  unknown: "Unknown",
};

/** Highest first — used by dropdowns. */
export const POTENTIAL_VALUE_ORDER: PotentialValue[] = ["very_high", "high", "medium", "low", "unknown"];

export const LOST_REASON_LABEL: Record<LostReasonCode, string> = {
  price: "Price",
  competitor: "Chose another cleaning company",
  no_response: "Stopped responding",
  timing: "Timing — not ready",
  building_not_a_fit: "Building isn't a fit for us",
  in_house: "Handling cleaning in-house",
  other: "Other",
};

export const WALKTHROUGH_OUTCOME_LABEL: Record<WalkthroughOutcome, string> = {
  interested: "Interested — keep talking",
  send_to_bid: "Ready for a quote",
  not_interested: "Not interested",
  rescheduled: "Needs to be rescheduled",
};

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  available: "Available",
  unavailable: "Source temporarily unavailable",
  disabled: "Turned off",
};

export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  manual_entry: "Manual entry",
  csv_import: "CSV import",
  url_reference: "URL reference",
  property_data: "Property data",
  permits: "Permits",
  construction: "Construction",
  commercial_listings: "Commercial listings",
  business_directory: "Business directory",
  business_website: "Business website",
  public_records: "Government / public records",
  announcements: "Announcements",
  news: "News",
  development: "Development",
  rfp: "RFPs / bids",
};

export const APP_ROLE_LABEL: Record<AppRole, string> = { owner: "Owner", manager: "Manager", viewer: "Viewer" };

// ---------------------------------------------------------------- Phase 3: intake

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  website: "Website",
  news_article: "News article",
  property_listing: "Property listing",
  public_record: "Public record",
  business_announcement: "Business announcement",
  referral: "Referral",
  manual_research: "Manual research",
  other: "Other",
};
export const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABEL) as SourceKind[];
/** Sources that are public by nature — a fact from them is "publicly reported" unless someone verified it. */
export const PUBLIC_SOURCE_KINDS: SourceKind[] = ["website", "news_article", "property_listing", "public_record", "business_announcement"];

export const SOURCE_VERIFICATION_LABEL: Record<SourceVerification, string> = {
  verified: "Checked by a person",
  not_checked: "Not checked yet",
  unavailable: "Source unavailable",
};

export const DUPLICATE_DECISION_LABEL: Record<DuplicateDecisionAction, string> = {
  create_anyway: "Created anyway",
  link_to_property: "Added as a new opportunity at the same building",
  add_to_existing_lead: "Added to the existing lead",
  merged: "Merged",
  not_duplicate: "Marked “not a duplicate”",
  skipped: "Skipped (not imported)",
};

/** Plain-language opportunity types — groups of the detailed signals. Used for browsing and filtering. */
export type OpportunityType =
  | "new_construction"
  | "new_business"
  | "new_tenant"
  | "renovation"
  | "for_lease"
  | "expansion"
  | "management_change"
  | "vendor_change"
  | "unknown";

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  new_construction: "New construction",
  new_business: "New business",
  new_tenant: "New tenant",
  renovation: "Recently renovated",
  for_lease: "For lease",
  expansion: "Expansion",
  management_change: "New owner / manager",
  vendor_change: "Vendor change / bid",
  unknown: "Unknown",
};

export const OPPORTUNITY_TYPE_OF_SIGNAL: Record<SignalType, OpportunityType> = {
  new_construction: "new_construction",
  construction_nearing_completion: "new_construction",
  new_development: "new_construction",
  new_business_opening: "new_business",
  new_business_announced: "new_business",
  facility_opening: "new_business",
  facility_reopening: "new_business",
  new_tenant: "new_tenant",
  recently_leased: "new_tenant",
  major_tenant_change: "new_tenant",
  appears_newly_occupied: "new_tenant",
  occupancy_expected_soon: "new_tenant",
  business_relocation: "new_tenant",
  major_renovation: "renovation",
  listed_for_lease: "for_lease",
  expansion: "expansion",
  business_growing: "expansion",
  new_ownership: "management_change",
  new_property_manager: "management_change",
  new_management_company: "management_change",
  recently_sold: "management_change",
  multiple_tenants: "management_change",
  vendor_may_change: "vendor_change",
  rfp_bid: "vendor_change",
  generic_commercial: "unknown",
};

/** The short list a manager picks from when adding a lead (everything else is under "Other"). */
export const INTAKE_SIGNAL_CHOICES: SignalType[] = [
  "new_construction",
  "construction_nearing_completion",
  "new_business_opening",
  "new_tenant",
  "recently_leased",
  "major_renovation",
  "expansion",
  "business_relocation",
  "new_property_manager",
  "new_ownership",
  "vendor_may_change",
  "rfp_bid",
  "listed_for_lease",
  "generic_commercial",
];
