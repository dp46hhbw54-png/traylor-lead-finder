import { DEFAULT_SCORING_SETTINGS, type ScoringSettings, type SignalCategory } from "../config/scoring-settings";
import { DATA_STATUS_LABEL, SIGNAL_DEFINITIONS } from "../domain/labels";
import type { ScoreLine, Tier } from "../domain/types";
import { daysSince } from "./dates";
import { lastTouchedAt } from "./freshness";
import { hasAnyContactPath, hasPublicBusinessContact, type LeadContext } from "./lead-context";

export type { ScoreLine, Tier };

export interface LeadScore {
  /** Clamped 0–100 — what the user sees. */
  score: number;
  /** Unclamped sum of every line — preserved for transparency. */
  raw: number;
  capped: boolean;
  tier: Tier;
  lines: ScoreLine[];
}

export const TIER_LABEL: Record<Tier, string> = { hot: "Hot", high: "High", medium: "Medium", low: "Low" };

export function tierFor(score: number, settings: ScoringSettings = DEFAULT_SCORING_SETTINGS): Tier {
  if (score >= settings.tiers.hot) return "hot";
  if (score >= settings.tiers.high) return "high";
  if (score >= settings.tiers.medium) return "medium";
  return "low";
}

const fmtSqft = (n: number) => `${n.toLocaleString("en-US")} sq ft`;

/**
 * Explainable, additive 0–100 opportunity score.
 * Each scoring category counts once. Unknown square footage scores 0 — never a penalty.
 */
export function scoreLead(
  ctx: LeadContext,
  now: Date,
  settings: ScoringSettings = DEFAULT_SCORING_SETTINGS,
): LeadScore {
  const lines: ScoreLine[] = [];

  // --- Opportunity signals (one line per category, strongest evidence wins) ---
  const seen = new Set<SignalCategory>();
  const sortedSignals = [...ctx.signals].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  for (const signal of sortedSignals) {
    if (signal.confidence === "unknown") continue; // Unconfirmed rumours don't score.
    const category = settings.signalCategoryByType[signal.type];
    if (!category || seen.has(category)) continue;
    seen.add(category);
    lines.push({
      key: `signal:${category}`,
      group: "signal",
      label: settings.signalCategoryLabel[category],
      points: settings.signalPoints[category],
      detail: `${SIGNAL_DEFINITIONS[signal.type].label} (${DATA_STATUS_LABEL[signal.confidence].toLowerCase()})`,
    });
  }

  // --- Property size ---
  const { sqft, sqftStatus } = ctx.property;
  if (sqft !== null && sqftStatus !== "unknown") {
    const status = DATA_STATUS_LABEL[sqftStatus].toLowerCase();
    if (sqft >= settings.size.largeMinSqft) {
      lines.push({ key: "size", group: "property", label: "Large building", points: settings.size.largePoints, detail: `${fmtSqft(sqft)}, ${status}` });
    } else if (sqft >= settings.size.mediumMinSqft) {
      lines.push({ key: "size", group: "property", label: "Medium building", points: settings.size.mediumPoints, detail: `${fmtSqft(sqft)}, ${status}` });
    }
  }

  // --- Contactability ---
  if (ctx.propertyManager) {
    lines.push({
      key: "contact:pm",
      group: "contact",
      label: "Property manager identified",
      points: settings.contact.propertyManagerIdentified,
      detail: ctx.propertyManager.name,
    });
  }
  if (hasPublicBusinessContact(ctx)) {
    lines.push({
      key: "contact:public",
      group: "contact",
      label: "Public business contact",
      points: settings.contact.publicBusinessContact,
      detail: "Public phone or email on file",
    });
  } else if (!hasAnyContactPath(ctx)) {
    lines.push({
      key: "contact:none",
      group: "contact",
      label: "No contact path",
      points: settings.contact.noContactPath,
      detail: "No property manager, contact, phone, email or website yet",
    });
  }

  // --- Freshness ---
  const age = daysSince(lastTouchedAt(ctx.lead), now);
  if (age <= settings.freshness.freshWithinDays) {
    lines.push({
      key: "freshness",
      group: "freshness",
      label: "Fresh opportunity",
      points: settings.freshness.freshPoints,
      detail: age === 0 ? "Found or verified today" : `Found or verified ${age} days ago`,
    });
  } else if (age > settings.freshness.staleAfterDays) {
    lines.push({
      key: "freshness",
      group: "freshness",
      label: "Information is stale",
      points: settings.freshness.stalePoints,
      detail: `Last verified ${age} days ago`,
    });
  }

  const raw = lines.reduce((sum, l) => sum + l.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, raw, capped: raw !== score, tier: tierFor(score, settings), lines };
}
