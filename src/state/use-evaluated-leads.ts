"use client";

import { useMemo } from "react";
import { evaluateAll, type LeadView } from "@/lib/engine/evaluate";
import { useLeadFinder } from "./lead-finder-store";

/** All leads, scored and explained, newest computation. */
export function useEvaluatedLeads(): LeadView[] {
  const { snapshot, now } = useLeadFinder();
  return useMemo(() => (snapshot ? evaluateAll(snapshot, now) : []), [snapshot, now]);
}
