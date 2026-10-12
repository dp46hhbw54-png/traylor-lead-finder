import type { Lead } from "../domain/types";
import { daysSince } from "./dates";

export type FreshnessLevel = "today" | "week" | "aging" | "stale";

export interface Freshness {
  level: FreshnessLevel;
  icon: string;
  label: string;
  /** Days since the lead was discovered or last verified, whichever is more recent. */
  ageDays: number;
}

/** Most recent of discovered / last verified. */
export function lastTouchedAt(lead: Pick<Lead, "discoveredAt" | "lastVerifiedAt">): string {
  if (!lead.lastVerifiedAt) return lead.discoveredAt;
  return new Date(lead.lastVerifiedAt) > new Date(lead.discoveredAt) ? lead.lastVerifiedAt : lead.discoveredAt;
}

/**
 * 🔥 Today · 🟢 within 7 days · 🟡 8–90 days · 🔴 more than 90 days.
 * Freshness decays automatically — nothing stays fresh forever.
 */
export function getFreshness(lead: Pick<Lead, "discoveredAt" | "lastVerifiedAt">, now: Date): Freshness {
  const ageDays = Math.max(0, daysSince(lastTouchedAt(lead), now));
  // Only say "verified" when a person actually verified it; otherwise it was just found.
  const verb = lead.lastVerifiedAt && lastTouchedAt(lead) === lead.lastVerifiedAt ? "Verified" : "Found";
  if (ageDays === 0) return { level: "today", icon: "🔥", label: verb === "Verified" ? "Verified today" : "Found today", ageDays };
  if (ageDays <= 7) return { level: "week", icon: "🟢", label: `${verb} ${ageDays}d ago`, ageDays };
  if (ageDays <= 90) return { level: "aging", icon: "🟡", label: `${verb} ${ageDays}d ago`, ageDays };
  return { level: "stale", icon: "🔴", label: `Needs verification (${ageDays}d)`, ageDays };
}
