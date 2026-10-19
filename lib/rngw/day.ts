/**
 * Formatting for guild-local calendar days.
 *
 * `date` from the database is a guild-local day ("2026-10-14"), not an instant
 * — so it is parsed as UTC midnight and formatted as UTC, to avoid shifting it
 * back a day for viewers west of Greenwich. Kept out of the components because
 * the attendance page and the event pages' check-in dialog must agree.
 */
export function formatGuildDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parsed)
}