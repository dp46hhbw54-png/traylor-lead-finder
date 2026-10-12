import type { Source } from "../domain/types";

export type IntakeSourcePick =
  | { ok: true; source: Source }
  | { ok: false; message: string };

/**
 * Which source a hand-entered lead is filed under.
 *
 * Chosen by the source's KIND ("url" for a web link, "manual" otherwise) — never by a fixed id,
 * because ids differ between the demo data and the real database.
 *
 * A lead that came from a web link is never quietly filed as a manual entry: if no web-link source is
 * available, the save is refused with a plain explanation instead of mislabelling where it came from.
 */
export function pickIntakeSource(sources: readonly Source[], hasLink: boolean): IntakeSourcePick {
  const type = hasLink ? "url" : "manual";
  const usable = sources.filter((s) => s.type === type && s.status === "available");
  if (usable.length > 0) {
    // Prefer the plain, built-in one (non-demo first, then oldest) so the choice is stable.
    const [source] = [...usable].sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || a.createdAt.localeCompare(b.createdAt));
    return { ok: true, source };
  }
  const exists = sources.some((s) => s.type === type);
  const what = hasLink ? "Web-link" : "Manual";
  return {
    ok: false,
    message: exists
      ? `${what} saving is turned off right now (see Sources). Nothing was saved.`
      : `${what} saving isn't set up yet. Ask the Owner to add the “${hasLink ? "Web link" : "Manual entry"}” source. Nothing was saved.`,
  };
}
