import type { LeadSetting, SignalType } from "../domain/types";

/**
 * Default scoring + ranking settings.
 *
 * These become rows in `lead_finder.lead_settings` once Supabase is connected,
 * so they can be tuned without code changes. Every point awarded must be
 * explainable — the engine records a breakdown line for each one.
 */

/** Scoring categories. Each category counts at most once per lead (no stacking). */
export type SignalCategory =
  | "new_construction"
  | "new_tenant_or_business"
  | "occupancy_soon"
  | "recently_renovated"
  | "expansion"
  | "for_lease"
  | "vendor_may_change";

export interface ScoringSettings {
  signalPoints: Record<SignalCategory, number>;
  signalCategoryLabel: Record<SignalCategory, string>;
  /** Which signal types feed which scoring category. Unmapped types are shown as evidence but score 0. */
  signalCategoryByType: Partial<Record<SignalType, SignalCategory>>;
  size: { largeMinSqft: number; largePoints: number; mediumMinSqft: number; mediumPoints: number };
  contact: { propertyManagerIdentified: number; publicBusinessContact: number; noContactPath: number };
  freshness: { freshWithinDays: number; freshPoints: number; staleAfterDays: number; stalePoints: number };
  ranking: {
    /** Extra priority for leads verified/discovered very recently. */
    recentlyVerifiedDays: number;
    recentlyVerifiedBonus: number;
    /** Lower priority for leads contacted recently that have no follow-up due yet. */
    recentContactDays: number;
    recentContactPenalty: number;
    todayListSize: number;
  };
  tiers: { hot: number; high: number; medium: number };
}

export const DEFAULT_SCORING_SETTINGS: ScoringSettings = {
  signalPoints: {
    new_construction: 20,
    new_tenant_or_business: 20,
    occupancy_soon: 10,
    recently_renovated: 15,
    expansion: 10,
    for_lease: 10,
    vendor_may_change: 10,
  },
  signalCategoryLabel: {
    new_construction: "New construction",
    new_tenant_or_business: "New tenant / new business",
    occupancy_soon: "Nearing completion / occupancy within 90 days",
    recently_renovated: "Recently renovated",
    expansion: "Expansion",
    for_lease: "For lease",
    vendor_may_change: "Evidence vendor may be changing",
  },
  signalCategoryByType: {
    new_construction: "new_construction",
    new_tenant: "new_tenant_or_business",
    new_business_opening: "new_tenant_or_business",
    facility_opening: "new_tenant_or_business",
    business_relocation: "new_tenant_or_business",
    recently_leased: "new_tenant_or_business",
    major_tenant_change: "new_tenant_or_business",
    facility_reopening: "new_tenant_or_business",
    construction_nearing_completion: "occupancy_soon",
    occupancy_expected_soon: "occupancy_soon",
    major_renovation: "recently_renovated",
    expansion: "expansion",
    business_growing: "expansion",
    listed_for_lease: "for_lease",
    vendor_may_change: "vendor_may_change",
    rfp_bid: "vendor_may_change",
    // A new owner or new management company often re-bids vendors.
    new_ownership: "vendor_may_change",
    new_property_manager: "vendor_may_change",
    new_management_company: "vendor_may_change",
    // new_development is shown as evidence but scores 0 until a person decides how much a plan-stage project is worth.
  },
  size: { largeMinSqft: 20_000, largePoints: 15, mediumMinSqft: 5_000, mediumPoints: 8 },
  contact: { propertyManagerIdentified: 10, publicBusinessContact: 5, noContactPath: -10 },
  freshness: { freshWithinDays: 30, freshPoints: 10, staleAfterDays: 90, stalePoints: -10 },
  ranking: {
    recentlyVerifiedDays: 7,
    recentlyVerifiedBonus: 5,
    recentContactDays: 7,
    recentContactPenalty: 15,
    todayListSize: 10,
  },
  tiers: { hot: 80, high: 60, medium: 40 },
};

/** The key of the scoring row in `lead_settings`. */
export const SCORING_SETTING_KEY = "scoring";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Overlay stored values onto defaults. A stored value is only used when it has the same type as the default. */
function overlay<T>(defaults: T, stored: unknown): T {
  if (isPlainObject(defaults)) {
    if (!isPlainObject(stored)) return defaults;
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(stored)) {
      out[key] = key in defaults ? overlay((defaults as Record<string, unknown>)[key], stored[key]) : stored[key];
    }
    return out as T;
  }
  if (typeof defaults === "number") return (typeof stored === "number" && Number.isFinite(stored) ? stored : defaults) as T;
  if (typeof defaults === "string") return (typeof stored === "string" ? stored : defaults) as T;
  return defaults;
}

/**
 * The scoring rules in force: defaults, overlaid with whatever is stored in `lead_settings`.
 * Bad or missing stored values fall back to the defaults, so a settings typo can never break scoring.
 */
export function resolveScoringSettings(rows: LeadSetting[] | undefined): ScoringSettings {
  const row = rows?.find((r) => r.key === SCORING_SETTING_KEY);
  if (!row) return DEFAULT_SCORING_SETTINGS;
  const merged = overlay(DEFAULT_SCORING_SETTINGS, row.value);
  // Drop mappings that point at a category that doesn't exist.
  const mapping: ScoringSettings["signalCategoryByType"] = {};
  for (const [type, cat] of Object.entries(merged.signalCategoryByType)) {
    if (typeof cat === "string" && cat in merged.signalPoints) mapping[type as SignalType] = cat as SignalCategory;
  }
  return { ...merged, signalCategoryByType: mapping };
}

/** Version number of the rules in force, saved with every score breakdown. */
export function scoringSettingsVersion(rows: LeadSetting[] | undefined): number {
  return rows?.find((r) => r.key === SCORING_SETTING_KEY)?.version ?? 1;
}
