"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { LeadFinderProvider } from "@/state/lead-finder-store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <LeadFinderProvider>
        <AppShell>{children}</AppShell>
      </LeadFinderProvider>
    </ToastProvider>
  );
}
