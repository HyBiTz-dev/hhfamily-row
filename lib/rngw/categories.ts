/**
 * Guild event categories.
 *
 * A party has no type field — the guild master labels it with `Party.content`
 * ("ดันเจี้ยน / บอสที่จะไป"). So /guild-war, /guild-league and /polarity are not
 * separate lists of their own, they are filters over the same parties tab. That
 * makes "which event does this party belong to?" a rule the whole site has to
 * agree on, which is why it lives here instead of inside a component.
 *
 * The admin editor always writes the canonical `label` back into `content`,
 * so hand-typed variants ("guild war", "GUILD-WAR", "กิลด์วอร์") only have to
 * survive long enough to be recognised, not to be written again.
 */

import type { Party } from "./types";

export type EventCategoryId = "guild-war" | "guild-league" | "polarity";

export interface EventCategory {
  id: EventCategoryId;
  /** Short label — nav, badges, and the canonical Party.content. */
  label: string;
  /** Page heading. */
  title: string;
  description: string;
  /** Substrings that put a party in this category, already compacted. */
  keywords: readonly string[];
  /**
   * Splits the event into tabs when set. Guild League has two; Guild War and
   * Polarity have none, which is what keeps one component serving every page.
   */
  divisions?: readonly LeagueDivision[];
  /**
   * The rows of this event are named by the guild master instead of by the
   * game, so there is no fixed list to put in `lanes` — see `rowsForScope`.
   *
   * Guild War and Polarity are the two: "2 ทีมใหญ่, 1 ทีมสเกา, 1 ทีมเฝ้าห้องหิน"
   * changes from day to day, and there is no box tab in the sheet to keep that
   * in.
   */
  derivedRows?: boolean;
}

export type LeagueDivisionId = "upper" | "lower";

export interface LeagueDivision {
  id: LeagueDivisionId;
  /** Tab label. */
  label: string;
  /** Headline inside the tab. */
  title: string;
  /** How many players the game allows in this division. Fixed, not computed. */
  capacity: number;
  /** Canonical Party.content for a team of this division. */
  contentLabel: string;
  /** Substrings that put a league team in this division, already compacted. */
  keywords: readonly string[];
  /**
   * Rows inside the division when the game splits it further — ลีคหลัก is three
   * lanes, ลีครอง is three groups. Same reason as the tabs above: the sheet only
   * stores a label, so every rule about what a label means lives here.
   */
  lanes?: readonly LeagueLane[];
}

/**
 * Ids come from the data, not from a fixed union: the two divisions name their
 * rows differently (เลนบน/เลนกลาง/เลนล่าง vs กลุ่ม A/B/C), and a shared union would
 * only pretend they share a vocabulary.
 */
export type LeagueLaneId = string;

export interface LeagueLane {
  id: LeagueLaneId;
  /** Row heading. */
  label: string;
  /**
   * Appended to the division's own label to make the party's `content` —
   * derived by `laneContentLabel` rather than written out per division, so a
   * team can never end up labelled with the *other* league's lane.
   */
  suffix: string;
  /** Substrings that put a team in this lane, already compacted. */
  keywords: readonly string[];
}

/** The label a team of this lane carries in the sheet. */
export function laneContentLabel(division: LeagueDivision, lane: LeagueLane): string {
  return `${division.contentLabel} ${lane.suffix}`;
}

/**
 * Where a lane-less team is parked until the guild master drags it somewhere:
 * the middle of the list, so a guess never inflates the top row or deflates the
 * bottom one. Works for both divisions without naming either of them.
 */
export function defaultLaneId(lanes: readonly LeagueLane[]): LeagueLaneId | undefined {
  return lanes[Math.floor(lanes.length / 2)]?.id;
}

/**
 * Order matters only when a label names both events ("วอร์ + ลีก"); the first
 * match wins, which is arbitrary but stable and visible to the admin editing.
 *
 * Guild League is itself split into two divisions — the game decides how many
 * players each one holds, so `capacity` is a number the game imposes, not a
 * target this site computes. Those divisions live here for the same reason the
 * events do: a Party still has no type field, the label is the only thing the
 * whole site has to agree on.
 */

/** ลีคหลัก names its rows as lanes, ลีครอง names them as lettered groups. */
const RAW_UPPER_LANES = [
  { id: "top", label: "เลนบน", suffix: "เลนบน", keywords: ["เลนบน", "เลน 1", "lane top", "top lane"] },
  {
    id: "middle",
    label: "เลนกลาง",
    suffix: "เลนกลาง",
    keywords: ["เลนกลาง", "เลน 2", "lane mid", "middle lane"],
  },
  {
    id: "bottom",
    label: "เลนล่าง",
    suffix: "เลนล่าง",
    keywords: ["เลนล่าง", "เลน 3", "lane bot", "bottom lane"],
  },
] satisfies readonly LeagueLane[];

const RAW_LOWER_LANES = [
  { id: "a", label: "กลุ่ม A", suffix: "กลุ่ม A", keywords: ["กลุ่ม a", "กลุ่ม 1", "group a"] },
  { id: "b", label: "กลุ่ม B", suffix: "กลุ่ม B", keywords: ["กลุ่ม b", "กลุ่ม 2", "group b"] },
  { id: "c", label: "กลุ่ม C", suffix: "กลุ่ม C", keywords: ["กลุ่ม c", "กลุ่ม 3", "group c"] },
] satisfies readonly LeagueLane[];

/*
 * Thai keywords list the current spelling ("กิลด์") plus the old, wrong one
 * ("กิลว์") that rows on the sheet may still carry. `compact` keeps ว/ด but
 * drops the marks, so the two spellings compact differently — both are needed
 * to keep rows written before the fix matched.
 */
const RAW_CATEGORIES = [
  {
    id: "guild-war",
    label: "Guild War",
    title: "Guild War",
    description: "ทีมที่หัวหน้ากิลด์จัดไว้ลงสนาม",
    keywords: ["guild war", "guildwar", "กิลด์วอร์", "กิลว์วอร์", "วอร์"],
    derivedRows: true,
  },
  {
    id: "guild-league",
    label: "Guild League",
    title: "Guild League",
    description: "ทีมที่หัวหน้ากิลด์จัดไว้ลงสนาม",
    keywords: ["guild league", "guilleague", "กิลด์ลีก", "กิลว์ลีก", "ลีก"],
    divisions: [
      {
        id: "upper",
        label: "ลีคหลัก",
        title: "ลีคหลัก",
        capacity: 60,
        contentLabel: "Guild League ลีคหลัก",
        // "ลีคบน" is deliberately gone: a party saved under the old name no
        // longer matches any division, so it lands in "ยังไม่ระบุ" and waits for
        // the guild master to re-label it, rather than being guessed into a
        // division whose rules and capacity differ.
        keywords: ["ลีคหลัก", "ลีค up", "upper", "up league", "main league"],
        // Only the division total is fixed by the game; a lane can hold any
        // number of players as long as the three together stay within 60.
        lanes: RAW_UPPER_LANES,
      },
      {
        id: "lower",
        label: "ลีครอง",
        title: "ลีครอง",
        capacity: 90,
        contentLabel: "Guild League ลีครอง",
        keywords: ["ลีครอง", "ลีค down", "lower", "down league", "second league"],
        lanes: RAW_LOWER_LANES,
      },
    ] satisfies readonly LeagueDivision[],
  },
  {
    id: "polarity",
    label: "Polarity",
    title: "Polarity",
    description: "ทีมที่หัวหน้ากิลด์จัดไว้ลงสนาม",
    keywords: ["polarity", "โพลาริตี้", "โพลา"],
    // Rows are named by the guild master, same as Guild War — see `rowsForScope`.
    derivedRows: true,
  },
] satisfies readonly EventCategory[];

/**
 * Lowercase and drop every separator, so "Guild War", "guild-war",
 * "GUILDWAR" and "กิลด์ วอร์" all collapse to the same needle. Keywords are
 * compacted the same way at module load, so they can be written out readably
 * above instead of as pre-mangled strings.
 */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export const EVENT_CATEGORIES: readonly EventCategory[] = RAW_CATEGORIES.map(
  (entry) => ({
    ...entry,
    keywords: entry.keywords.map(compact),
    divisions: entry.divisions?.map((division) => ({
      ...division,
      keywords: division.keywords.map(compact),
      lanes: division.lanes?.map((lane) => ({
        ...lane,
        keywords: lane.keywords.map(compact),
      })),
    })),
  })
);

/** Guild League's two divisions, for callers that don't walk the categories. */
export const LEAGUE_DIVISIONS: readonly LeagueDivision[] =
  getEventCategory("guild-league")?.divisions ?? [];

export function getEventCategory(id: string): EventCategory | undefined {
  return EVENT_CATEGORIES.find((entry) => entry.id === id);
}

/** Which event a party's label names, or null when it isn't an event party. */
export function matchEventCategory(
  content: string | undefined
): EventCategoryId | null {
  const needle = compact(content ?? "");
  if (!needle) return null;

  for (const category of EVENT_CATEGORIES) {
    if (category.keywords.some((keyword) => needle.includes(keyword))) {
      return category.id;
    }
  }
  return null;
}

/** How the editor joins two event segments in one label. */
export const SEGMENT_SEPARATOR = " + ";

/**
 * The segments of a party's label, split on the "+" the editor writes between
 * events.
 *
 * A party has one `content` string, so "this team plays Guild War and the main
 * league" has to be one string too: `"Guild War + Guild League ลีคหลัก"`. Every
 * rule that reads a label works on one segment at a time — naming an event,
 * finding its box or lane — so a box the guild master happened to name after
 * "วอร์" can never leak into the league's segment, and a league lane never eats
 * a Guild War box.
 */
export function contentSegments(content: string | undefined): string[] {
  return (content ?? "")
    .split(/\s*\+\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Every event a label names, in the order they appear.
 *
 * `matchEventCategory` stays the "which one event is this?" question (first
 * match wins, which is what single-event callers and the derived-row guard
 * want); this is the "which events does it list?" one the event pages ask.
 */
export function matchEventCategories(
  content: string | undefined
): EventCategoryId[] {
  const found: EventCategoryId[] = [];
  for (const segment of contentSegments(content)) {
    const id = matchEventCategory(segment);
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

/** The segment naming `event`, or undefined when the label does not name it. */
export function eventSegment(
  content: string | undefined,
  event: EventCategoryId
): string | undefined {
  return contentSegments(content).find(
    (segment) => matchEventCategory(segment) === event
  );
}

/**
 * Replaces the segment naming `event` with `next`, keeping every other event's
 * segment untouched. Appends when the label does not name the event yet.
 *
 * This is what lets a shared team keep its place in one event while it is
 * dragged into a box or lane of another: only the one segment is rewritten,
 * because a moved team must not quietly drop off the other event's page.
 */
export function setEventSegment(
  content: string | undefined,
  event: EventCategoryId,
  next: string
): string {
  const segments = contentSegments(content);
  const index = segments.findIndex(
    (segment) => matchEventCategory(segment) === event
  );
  if (index >= 0) segments[index] = next.trim();
  else segments.push(next.trim());
  return segments.filter(Boolean).join(SEGMENT_SEPARATOR);
}

/** Drops the segment naming `event`, leaving the rest of the label alone. */
export function clearEventSegment(
  content: string | undefined,
  event: EventCategoryId
): string {
  return contentSegments(content)
    .filter((segment) => matchEventCategory(segment) !== event)
    .join(SEGMENT_SEPARATOR);
}

export function partiesForEvent(
  parties: Party[],
  id: EventCategoryId
): Party[] {
  return parties.filter((party) =>
    matchEventCategories(party.content).includes(id)
  );
}

/**
 * Swaps every party of `id` in `all` for `next`, leaving other events and
 * unlabelled parties alone.
 *
 * PUT /api/admin/parties rewrites the whole parties tab, so posting only this
 * event's teams would silently delete everything else in the guild's sheet —
 * including teams that are merely named after a dungeon. A party naming several
 * events is removed here and travels back in `next`, which carries every team
 * of this event — shared ones included — so the other events it names survive.
 */
export function replaceEventParties(
  all: Party[],
  id: EventCategoryId,
  next: Party[]
): Party[] {
  return [
    ...all.filter((party) => !matchEventCategories(party.content).includes(id)),
    ...next,
  ];
}

/* ------------------------------------------------------------- divisions */

/**
 * Which division of `event` a label names, or null when it names none.
 *
 * Only the event's own segment is read, so "บน" in a guild-war boss name can
 * never leak in here, and a league segment is never confused with another
 * event's text sitting next to it in the label.
 */
export function matchDivision(
  content: string | undefined,
  event: EventCategoryId
): LeagueDivisionId | null {
  const divisions = getEventCategory(event)?.divisions;
  if (!divisions) return null;

  const segment = eventSegment(content, event);
  if (!segment) return null;

  const needle = compact(segment);
  if (!needle) return null;

  for (const division of divisions) {
    if (division.keywords.some((keyword) => needle.includes(keyword))) {
      return division.id;
    }
  }
  return null;
}

export function getDivision(
  event: EventCategoryId,
  id: LeagueDivisionId
): LeagueDivision | undefined {
  return getEventCategory(event)?.divisions?.find((division) => division.id === id);
}

/** Teams of one division of one event. */
export function partiesForDivision(
  parties: Party[],
  event: EventCategoryId,
  division: LeagueDivisionId
): Party[] {
  return parties.filter(
    (party) => matchDivision(party.content, event) === division
  );
}

/** How many players a division already has, counted across its teams. */
export function divisionHeadcount(teams: Party[]): number {
  const names = new Set<string>();
  for (const team of teams) {
    for (const name of team.memberNames) names.add(name);
  }
  return names.size;
}

/**
 * Swaps the teams of one division in `all`, leaving the other division and
 * other events alone.
 *
 * Saving the main league must not empty the other one — that is the whole
 * reason this exists next to `replaceEventParties`, which is too coarse once
 * an event has more than one tab.
 */
export function replaceDivisionParties(
  all: Party[],
  event: EventCategoryId,
  division: LeagueDivisionId,
  next: Party[]
): Party[] {
  return [
    ...all.filter((party) => matchDivision(party.content, event) !== division),
    ...next,
  ];
}

/* ------------------------------------------------------------------ lanes */

/**
 * Which lane of a division a label names, or null when it names none.
 *
 * A team labelled with the division but no lane — or with the old division name
 * ("Guild League ลีคบน"), which no longer matches any division — cannot be
 * placed here at all. Teams that name *no* lane land in the middle lane: the
 * neutral one, so nobody's headcount is inflated by a guess — and the lane header
 * says how many arrived that way, which keeps them visible and draggable instead
 * of lost.
 */
export function matchLane(
  content: string | undefined,
  event: EventCategoryId,
  division: LeagueDivisionId
): LeagueLaneId | null {
  const lanes = getDivision(event, division)?.lanes;
  if (!lanes || matchDivision(content, event) !== division) return null;

  const segment = eventSegment(content, event);
  if (!segment) return null;
  const needle = compact(segment);
  if (!needle) return null;

  for (const lane of lanes) {
    if (lane.keywords.some((keyword) => needle.includes(keyword))) return lane.id;
  }
  return defaultLaneId(lanes) ?? null;
}

/** True when the label says no lane at all — it was parked in the middle one. */
export function hasExplicitLane(
  content: string | undefined,
  event: EventCategoryId,
  division: LeagueDivisionId
): boolean {
  const lanes = getDivision(event, division)?.lanes;
  if (!lanes) return false;
  const segment = eventSegment(content, event);
  if (!segment) return false;
  const needle = compact(segment);
  return lanes.some((lane) => lane.keywords.some((keyword) => needle.includes(keyword)));
}

export function getLane(
  event: EventCategoryId,
  division: LeagueDivisionId,
  lane: LeagueLaneId
): LeagueLane | undefined {
  return getDivision(event, division)?.lanes?.find((entry) => entry.id === lane);
}

export function partiesForLane(
  parties: Party[],
  event: EventCategoryId,
  division: LeagueDivisionId,
  lane: LeagueLaneId
): Party[] {
  return parties.filter(
    (party) => matchLane(party.content, event, division) === lane
  );
}

/* ------------------------------------------------------- derived rows (war) */

/**
 * The row that holds teams whose label names no box.
 *
 * It has a real id rather than an empty string because it is offered in a
 * `Select` alongside the boxes, and Radix reserves "" for "no value". The
 * empty `suffix` is what makes it different: writing a team with it drops the
 * box from the label entirely — which is also how deleting a box works, since
 * nothing stores the list of boxes in the first place.
 */
export const UNASSIGNED_ROW: LeagueLane = {
  id: "__unassigned",
  label: "ว่าง",
  suffix: "",
  keywords: [],
};

/** Letters and digits — the characters `compact` keeps. */
const KEEP = /[\p{L}\p{N}]/u;

/**
 * What follows the event label in a party's `content`.
 *
 * "Guild War ทีมสเกา" → "ทีมสเกา". A league lane is found by matching a fixed
 * keyword list, but a Guild War box is named by the admin, so the only rule
 * that can work is "whatever sits after Guild War".
 *
 * `compact` drops separators, so the two strings can no longer be sliced by
 * index. This walks the original instead and counts only the characters
 * `compact` keeps — otherwise "Guild War" would swallow the first letter of the
 * box name, and "วอร์" (whose ์ is a combining mark, not a letter) would take
 * the mark with it.
 */
export function eventSuffix(content: string | undefined, event: EventCategoryId): string {
  // Only this event's own segment: a label naming several events would
  // otherwise hand a Guild War box the league label that follows it.
  const raw = eventSegment(content, event) ?? "";
  const needle = compact(raw);
  if (!needle) return "";

  const keywords = getEventCategory(event)?.keywords ?? [];
  // Longest first: "กิลววอร" has to win over "วอร", or a box name starting
  // with "วอร" would be eaten by the short keyword.
  const hit = [...keywords].sort((a, b) => b.length - a.length).find((keyword) => needle.startsWith(keyword));
  if (!hit) return raw.trim();

  let kept = 0;
  let index = 0;
  for (const char of raw) {
    if (KEEP.test(char)) {
      if (kept === hit.length) break;
      kept += 1;
    }
    index += 1;
  }

  // Anything left that compact would have dropped — the �์ of "วอร์", leading
  // spaces — goes, or the box would be named "์ทีมสเกา".
  return raw.slice(index).replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/** The canonical label for a team sitting in a derived row. */
export function rowContentLabel(event: EventCategoryId, row: LeagueLane): string {
  const label = getEventCategory(event)?.label ?? "";
  return row.suffix ? `${label} ${row.suffix}` : label;
}

/**
 * A box row for a name the guild master just typed on a derived-row event.
 *
 * There is no box list to append to — a row exists only because a team's label
 * names it (`rowsForScope` derives them all). So this builds the row with the
 * same id `rowsForScope` will compute once a team lands in the box, which is
 * what keeps the empty box on screen and the saved one from ever rendering
 * twice.
 */
export function boxRow(name: string): LeagueLane {
  const suffix = name.trim();
  return { id: compact(suffix), label: suffix, suffix, keywords: [] };
}

/**
 * Which row a team sits in, for both kinds of event.
 *
 * A league division returns `defaultLaneId` rather than null so a team saved
 * before lanes existed still lands somewhere. A derived-row event has no such
 * neutral row, so a label with no box goes to `UNASSIGNED_ROW` instead.
 */
export function matchRow(
  content: string | undefined,
  event: EventCategoryId,
  division: LeagueDivisionId | null
): LeagueLaneId | null {
  if (division) return matchLane(content, event, division);
  if (!getEventCategory(event)?.derivedRows) return null;
  return compact(eventSuffix(content, event)) || UNASSIGNED_ROW.id;
}

/**
 * The rows of one scope, in the order the guild master sees them.
 *
 * A division's rows are fixed. A derived-row event's rows are whatever the
 * teams currently say, in the order the labels first appear — there is no box
 * list anywhere to sort against, so reordering a box means reordering its teams
 * in the sheet (see `EventScope`'s `applyRowOrder`). `UNASSIGNED_ROW` comes
 * last, so the parking spot sits under every named box.
 *
 * Callers pass the teams already scoped to this event, but the category is
 * still checked: a stray party would otherwise invent a box nobody asked for.
 */
export function rowsForScope(
  parties: Party[],
  event: EventCategoryId,
  division: LeagueDivisionId | null
): LeagueLane[] {
  if (division) return [...(getDivision(event, division)?.lanes ?? [])];
  if (!getEventCategory(event)?.derivedRows) return [];

  const rows: LeagueLane[] = [];
  const seen = new Set<string>();
  let unassigned = false;

  for (const party of parties) {
    if (!matchEventCategories(party.content).includes(event)) continue;

    const suffix = eventSuffix(party.content, event);
    const id = compact(suffix);
    if (!id) {
      unassigned = true;
      continue;
    }
    if (seen.has(id)) continue;

    seen.add(id);
    rows.push({ id, label: suffix, suffix, keywords: [] });
  }

  return unassigned ? [...rows, UNASSIGNED_ROW] : rows;
}
