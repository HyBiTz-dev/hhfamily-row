/**
 * Pure attendance logic — no I/O, so it stays testable.
 *
 * The `attendance` table is an append-only ledger. We never overwrite a row:
 * every submission adds one, and the newest row per member wins when reading.
 * That is what keeps two members submitting at the same instant from
 * clobbering each other.
 */

import type { AttendanceRow, AttendanceStatus, Member, MemberStatus } from "./types";

/**
 * Intl formatters, kept per key rather than rebuilt per call.
 *
 * Building a `DateTimeFormat` costs ~70x more than using one (0.028ms vs
 * 0.0004ms measured), and these run once per attendance row on the way in and
 * once per table row on the way out — so the construction, not the formatting,
 * was the cost. Keyed by locale + zone + options because a formatter is
 * immutable and reusable.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string,
  key: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const cached = formatters.get(key);
  if (cached) return cached;
  const built = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, built);
  return built;
}

/** Guild-local calendar day, e.g. "2026-10-14". */
export function guildDateKey(now: Date = new Date(), timeZone = "Asia/Bangkok"): string {
  // en-CA formats as YYYY-MM-DD.
  return formatter("en-CA", `en-CA|${timeZone}|ymd`, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A local-midnight Date for a guild day key — what the date picker selects.
 *
 * Built from the parts rather than `new Date("2026-10-14")`, which parses as
 * UTC midnight and can land on the previous day in a browser behind UTC. The
 * calendar renders local days, so local midnight round-trips through
 * `keyFromDate` unchanged whatever the device's timezone.
 */
export function dateFromKey(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** The guild day key for a Date the picker returned, in the browser's local day. */
export function keyFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Thai display form of a guild day key, e.g. "พ. 14 ต.ค.".
 *
 * Formatted as UTC because the key was parsed as a UTC instant — without the
 * fixed zone a browser behind UTC would render the day before. The weekday
 * comes from the date itself, never from a hand-typed name.
 */
export function guildDateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  }
): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  // The options are part of the key: this is called both with and without the
  // weekday, and a formatter is only reusable when it was built for them.
  return formatter("th-TH", `th-TH|UTC|${JSON.stringify(options)}`, {
    timeZone: "UTC",
    ...options,
  }).format(parsed);
}

/**
 * The time of a submission, e.g. "20:15", in the guild's timezone.
 *
 * The ledger stores epoch milliseconds, so the moment a member pressed the
 * button is recoverable — that is the whole point of the audit log. Rows with
 * no readable timestamp (a bad write, or a row from before timestamps were
 * stored) show a dash rather than an invented time.
 */
export function guildTimeLabel(epoch: number, timeZone = "Asia/Bangkok"): string {
  if (!epoch) return "—";
  return formatter("th-TH", `th-TH|${timeZone}|hm`, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epoch));
}

/**
 * Newest row per member. Ties (same millisecond) are broken by the row with the
 * higher `seq` — the read returns rows in submit order.
 */
export function latestByMember(rows: AttendanceRow[]): Map<string, AttendanceRow> {
  const latest = new Map<string, AttendanceRow>();
  for (const row of rows) {
    const current = latest.get(row.name);
    if (!current || row.submittedAt >= current.submittedAt) {
      latest.set(row.name, row);
    }
  }
  return latest;
}

/** Today's status per member; members with no submission are "unknown". */
export function statusesForDate(
  rows: AttendanceRow[],
  date: string
): Map<string, AttendanceStatus> {
  const status = new Map<string, AttendanceStatus>();
  for (const [name, row] of latestByMember(rows.filter((row) => row.date === date))) {
    status.set(name, row.status);
  }
  return status;
}

/** Roster joined with their status for a given day. */
export function rosterWithStatus(
  members: Member[],
  rows: AttendanceRow[],
  date: string
): MemberStatus[] {
  const latest = latestByMember(rows.filter((row) => row.date === date));
  return members.map((member) => {
    const row = latest.get(member.name);
    return row
      ? { ...member, status: row.status, note: row.note, updatedAt: row.submittedAt }
      : { ...member, status: "unknown" as AttendanceStatus };
  });
}

/**
 * How many members are showing up — the number the party builder cares about.
 */
export function presentCount(roster: MemberStatus[]): number {
  return roster.filter((member) => member.status === "present").length;
}

/* ----------------------------------------------------------------- absence */

/**
 * The days the guild actually plays: Tuesday, Thursday, Sunday.
 *
 * Silence on a Wednesday is not a no-show, nobody was going to play. Keeping the
 * play days here — rather than inferring "a day happened" from the ledger —
 * means the rule survives a week where the guild skipped a session.
 */
export const GUILD_DAYS: readonly number[] = [2, 4, 0];

/** Thai weekday names, indexed the way `Date.getDay()` is. */
export const GUILD_DAY_NAMES = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
] as const;

/**
 * "อังคาร · พฤหัสบดี · อาทิตย์", straight from GUILD_DAYS.
 *
 * The UI reads the weekday names from here instead of typing them. A
 * hand-written list is exactly how "อังคาร" became "จันทร์" in the copy while
 * the rule said one thing and the text another — two places to keep in sync,
 * and nothing to catch it when they drift.
 */
export function guildDayLabel(separator = " · "): string {
  return GUILD_DAYS.map((day) => GUILD_DAY_NAMES[day]).join(separator);
}

/**
 * Absences that turn the warning red.
 *
 * Nothing happens to a member at this number — no archiving, no automatic
 * anything. It is the line the guild drew for itself, so the warnings tab can
 * sort by it and the guild master can decide who to talk to. The old automatic
 * bench was removed: silently dropping someone from the roster over a counter
 * was the wrong kind of decision to make without a human pressing the button.
 */
export const ABSENCE_ALERT_AFTER = 3;

/** Weekday of a guild-local date key. UTC midnight, since a date has one weekday. */
export function weekdayOf(date: string): number {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? -1 : parsed.getUTCDay();
}

export interface Absences {
  /** Guild days already gone by that the member never answered. */
  count: number;
  /** Those days, oldest first — the evidence behind the warning. */
  dates: string[];
  /**
   * First day they ever answered, which is where counting starts. A member
   * added to the roster last week must not be charged for the weeks before it.
   * `undefined` when they have never answered at all, in which case there is
   * nothing to judge them on — they are not counted as absent.
   */
  firstSeen?: string;
}

/**
 * Per-member absence counts, from the ledger alone.
 *
 * A day counts as missed when all of these hold:
 * - it is a guild day (GUILD_DAYS),
 * - it is already over (`today` itself is never counted — the evening has not
 *   happened yet),
 * - somebody did answer that day, so the day really was played rather than
 *   the tool simply sitting unused,
 * - and this member did not.
 */
export function absencesFor(
  members: Member[],
  rows: AttendanceRow[],
  today: string
): Map<string, Absences> {
  const answered = new Map<string, Set<string>>();
  const liveDays = new Set<string>();
  for (const row of rows) {
    liveDays.add(row.date);
    const days = answered.get(row.name);
    if (days) days.add(row.date);
    else answered.set(row.name, new Set([row.date]));
  }

  const playDays = [...liveDays]
    .filter((date) => date < today && GUILD_DAYS.includes(weekdayOf(date)))
    .sort();

  const result = new Map<string, Absences>();
  for (const member of members) {
    const days = answered.get(member.name);
    const firstSeen = days ? [...days].sort()[0] : undefined;
    if (!firstSeen) {
      result.set(member.name, { count: 0, dates: [] });
      continue;
    }

    const missed = playDays.filter((date) => date >= firstSeen && !days!.has(date));
    result.set(member.name, { count: missed.length, dates: missed, firstSeen });
  }

  return result;
}

/** Whether a member has gone quiet often enough to be worth a word. */
export function pastAlertLine(absences: Absences | undefined): boolean {
  return (absences?.count ?? 0) >= ABSENCE_ALERT_AFTER;
}
