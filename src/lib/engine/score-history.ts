import { resolveScoringSettings, scoringSettingsVersion, type ScoringSettings } from "../config/scoring-settings";
import type { LeadFinderSnapshot, LeadScoreBreakdown } from "../domain/types";
import { pushAudit, type MutationContext } from "../workflow/context";
import { buildLeadContexts } from "./lead-context";
import { scoreLead } from "./scoring";

/** Two breakdowns are "the same" when every line earns the same points. */
const signature = (b: Pick<LeadScoreBreakdown, "rawScore" | "lines">) =>
  `${b.rawScore}|${b.lines.map((l) => `${l.key}:${l.points}`).join(",")}`;

export function latestBreakdown(s: LeadFinderSnapshot, leadId: string): LeadScoreBreakdown | null {
  let best: LeadScoreBreakdown | null = null;
  for (const b of s.scoreBreakdowns) if (b.leadId === leadId && (!best || b.computedAt >= best.computedAt)) best = b;
  return best;
}

/**
 * Save a score breakdown for every lead whose score changed, and audit the change.
 *
 * The score itself is ALWAYS computed by the deterministic engine (scoring.ts) — never by AI.
 * Both numbers are kept: `rawScore` (can exceed 100) and `score` (0–100, what people see).
 * Called after every change to the data. The first breakdown a lead gets is saved without an audit row;
 * later changes are audited as "Score changed 62 → 70".
 *
 * Returns how many leads got a new breakdown.
 */
export function recordScoreChanges(s: LeadFinderSnapshot, m: MutationContext, settings?: ScoringSettings): number {
  const rules = settings ?? resolveScoringSettings(s.settings);
  const version = scoringSettingsVersion(s.settings);
  let saved = 0;
  for (const ctx of buildLeadContexts(s)) {
    const score = scoreLead(ctx, m.now, rules);
    const next: LeadScoreBreakdown = {
      id: m.newId("sb"),
      leadId: ctx.lead.id,
      computedAt: m.now.toISOString(),
      rawScore: score.raw,
      score: score.score,
      capped: score.capped,
      tier: score.tier,
      lines: score.lines,
      settingsVersion: version,
    };
    const prev = latestBreakdown(s, ctx.lead.id);
    if (prev && signature(prev) === signature(next)) continue;
    s.scoreBreakdowns.push(next);
    saved += 1;
    if (prev) {
      pushAudit(s, m, {
        entityType: "lead",
        entityId: ctx.lead.id,
        leadId: ctx.lead.id,
        action: "score_change",
        field: "score",
        oldValue: prev.score,
        newValue: next.score,
        note: prev.rawScore !== next.rawScore ? `Raw score ${prev.rawScore} → ${next.rawScore}` : null,
      });
    }
  }
  return saved;
}
