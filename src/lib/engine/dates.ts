const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Local calendar-day start for a date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Calendar days elapsed since an ISO date (0 = today). */
export function daysSince(iso: string, now: Date): number {
  return calendarDaysBetween(new Date(iso), now);
}

export function isSameDay(a: Date, b: Date): boolean {
  return calendarDaysBetween(a, b) === 0;
}

export function relativeDays(iso: string, now: Date): string {
  const days = calendarDaysBetween(now, new Date(iso));
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}
