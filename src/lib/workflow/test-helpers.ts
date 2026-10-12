import { createDemoSnapshot } from "../data/demo/seed";
import type { LeadFinderSnapshot } from "../domain/types";
import type { MutationContext } from "./context";

/** Oct 7 2026, 9:00 local — the fixed "now" used across tests. */
export const NOW = new Date(2026, 9, 7, 9, 0);
export const DAY = 86_400_000;

export const freshSnapshot = (): LeadFinderSnapshot => createDemoSnapshot(NOW);

/** Deterministic mutation context for tests. */
export function testContext(now: Date = NOW, by = "Test user"): MutationContext {
  let n = 0;
  return { now, by, isDemo: true, newId: (prefix) => `${prefix}-t${++n}` };
}

export const clone = <T>(v: T): T => structuredClone(v);
