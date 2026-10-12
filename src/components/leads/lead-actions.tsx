"use client";

import { useState, type ReactNode } from "react";
import {
  LuArrowRightLeft,
  LuBadgeCheck,
  LuBan,
  LuCalendarCheck,
  LuCalendarPlus,
  LuClipboardCheck,
  LuClock,
  LuEllipsis,
  LuMail,
  LuMessageSquare,
  LuNotebookPen,
  LuPhone,
  LuUser,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import type { ActionMode } from "@/components/today/action-dialogs";
import type { LeadView } from "@/lib/engine/evaluate";
import { useLeadFinder } from "@/state/lead-finder-store";

/**
 * ONE recommended action per lead (chosen by the deterministic action engine), then a few smaller ones,
 * then everything else under "More". Used on Today and on the lead page so it works the same everywhere.
 */

interface Primary {
  label: string;
  icon: ReactNode;
  run: () => void;
}

export function usePrimaryAction(view: LeadView, onAction: (mode: ActionMode) => void): Primary {
  const { actions } = useLeadFinder();
  const { action, contact, ctx } = view;
  const firstName = contact.name?.split(" ")[0];
  const callOrEmail = (): Primary => {
    if (contact.phone) return { label: firstName ? `Call ${firstName}` : "Call", icon: <LuPhone className="h-5 w-5" />, run: () => onAction("call") };
    if (contact.email) return { label: firstName ? `Email ${firstName}` : "Email", icon: <LuMail className="h-5 w-5" />, run: () => onAction("email") };
    return { label: "Log what happened", icon: <LuNotebookPen className="h-5 w-5" />, run: () => onAction("log") };
  };
  switch (action.kind) {
    case "record_outcome":
      return { label: "Record walkthrough outcome", icon: <LuClipboardCheck className="h-5 w-5" />, run: () => onAction("walkthrough_outcome") };
    case "request_quote":
      return { label: "Record “Quote requested”", icon: <LuClipboardCheck className="h-5 w-5" />, run: () => void actions.requestQuote(ctx.lead.id) };
    case "prepare_walkthrough":
      return view.walkthroughToday
        ? { label: "Walkthrough done", icon: <LuClipboardCheck className="h-5 w-5" />, run: () => onAction("walkthrough_outcome") }
        : callOrEmail();
    case "schedule_walkthrough":
      return { label: "Schedule walkthrough", icon: <LuCalendarCheck className="h-5 w-5" />, run: () => onAction("walkthrough") };
    case "schedule_follow_up":
      return { label: "Schedule follow-up", icon: <LuCalendarPlus className="h-5 w-5" />, run: () => onAction("followup") };
    case "verify":
      return { label: "Re-verify lead", icon: <LuBadgeCheck className="h-5 w-5" />, run: () => void actions.markVerified(ctx.lead.id) };
    case "research_pm":
      return { label: "Find property manager", icon: <LuUser className="h-5 w-5" />, run: () => onAction("log") };
    case "find_contact":
      return { label: "Find contact info", icon: <LuUser className="h-5 w-5" />, run: () => onAction("log") };
    case "record_lost_reason":
    case "customer":
      return { label: "Change status", icon: <LuArrowRightLeft className="h-5 w-5" />, run: () => onAction("status") };
    case "review":
      return { label: "Log what happened", icon: <LuNotebookPen className="h-5 w-5" />, run: () => onAction("log") };
    default:
      return callOrEmail();
  }
}

export function PrimaryActionButton({ view, onAction, className }: { view: LeadView; onAction: (mode: ActionMode) => void; className?: string }) {
  const { busy } = useLeadFinder();
  const primary = usePrimaryAction(view, onAction);
  return (
    <Button size="lg" variant="primary" disabled={busy} onClick={primary.run} icon={primary.icon} className={className ?? "mt-3 w-full sm:w-auto sm:min-w-56"} data-primary-action>
      {primary.label}
    </Button>
  );
}

const SECONDARY_BTN = "h-12 flex-col whitespace-nowrap px-1 sm:px-3.5 gap-0.5 text-xs sm:h-10 sm:flex-row sm:gap-1.5 sm:text-sm";

export function SecondaryActions({ view, onAction }: { view: LeadView; onAction: (mode: ActionMode) => void }) {
  const [more, setMore] = useState(false);
  const primary = usePrimaryAction(view, onAction);
  return (
    <>
      <div className="mt-3 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Other actions">
        {view.action.kind !== "email" && !primary.label.startsWith("Email") && (
          <Button variant="subtle" onClick={() => onAction("email")} icon={<LuMail className="h-4 w-4" />} className={SECONDARY_BTN}>
            Email
          </Button>
        )}
        <Button variant="subtle" onClick={() => onAction("text")} icon={<LuMessageSquare className="h-4 w-4" />} className={SECONDARY_BTN}>
          Text
        </Button>
        <Button variant="subtle" onClick={() => onAction("followup")} icon={<LuCalendarPlus className="h-4 w-4" />} className={SECONDARY_BTN}>
          Follow-Up
        </Button>
        <Button variant="subtle" onClick={() => setMore((v) => !v)} aria-expanded={more} icon={<LuEllipsis className="h-4 w-4" />} className={SECONDARY_BTN}>
          More
        </Button>
      </div>
      {more && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-3" role="group" aria-label="More actions">
          {!primary.label.startsWith("Call") && view.contact.phone && (
            <Button variant="secondary" onClick={() => onAction("call")} icon={<LuPhone className="h-4 w-4" />} className="h-11">
              Call
            </Button>
          )}
          <Button variant="secondary" onClick={() => onAction("log")} icon={<LuNotebookPen className="h-4 w-4" />} className="h-11">
            Log activity
          </Button>
          <Button variant="secondary" onClick={() => onAction("walkthrough")} icon={<LuCalendarCheck className="h-4 w-4" />} className="h-11">
            Schedule walkthrough
          </Button>
          <Button variant="secondary" onClick={() => onAction("status")} icon={<LuArrowRightLeft className="h-4 w-4" />} className="h-11">
            Change status
          </Button>
          <Button variant="secondary" onClick={() => onAction("snooze")} icon={<LuClock className="h-4 w-4" />} className="h-11">
            Snooze
          </Button>
          <Button variant="secondary" onClick={() => onAction("not_a_fit")} icon={<LuBan className="h-4 w-4" />} className="h-11 text-slate-600">
            Not a Fit
          </Button>
        </div>
      )}
    </>
  );
}
