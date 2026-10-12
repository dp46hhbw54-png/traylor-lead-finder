"use client";

import type { ReactNode } from "react";
import { BackendGate } from "@/components/auth/backend-gate";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { LeadFinderProvider } from "@/state/lead-finder-store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <BackendGate>
        <LeadFinderProvider>
          <AppShell>{children}</AppShell>
        </LeadFinderProvider>
      </BackendGate>
    </ToastProvider>
  );
}
