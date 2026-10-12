"use client";

import { ErrorState } from "@/components/ui/states";

export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="This screen crashed"
      message={error.message || "An unexpected error occurred."}
      nextStep="Try again. If it keeps happening, reset the demo data in Settings."
      onRetry={reset}
    />
  );
}
