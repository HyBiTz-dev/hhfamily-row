/**
 * Guild event categories.
 *
 * A party plays an event by having a placement for it (`Party.placements`), and
 * sits in a stored row (`event_rows`). So /siege and /guild-league are not
 * separate lists: they are filters over the same parties and rows. That is why
 * the event/division/row vocabulary lives here instead of inside a component.
 *
 * Nothing here parses a label string any more. The legacy `Party.content`
 * matchers were removed with the one-time migration; `derivePartyContent` only
 * writes that string as a display cache from placements and row names.
 */

import type { EventCategoryId, EventRow, Party, PartyPlacement } from "./types";

export type { EventCategoryId };

/**
 * Where a placement goes when the caller only knows "put it at the end".
 *
 * Positions are dense per scope after `saveParties` normalises them, so this
 * value is never stored; it only has to sort after every real position. JSON
 * cannot carry `Infinity` (it becomes `null`), hence a finite number.
 */
export const APPEND_POSITION = Number.MAX_SAFE_INTEGER;

export interface EventCategory {
  id: EventCategoryId;
  /** Short label — nav, badges, and the canonical Party.content. */
  label: string;
  /** Page heading. */
  title: string;
  description: string;
  /**
   * Splits the event into tabs when set. Guild League has two; Siege has none,
   * which is what keeps one component serving every page.
   */
  divisions?: readonly LeagueDivision[];
  // Every event's rows are stored in `event_rows` and named by the guild
  // master, including the league divisions. There is deliberately no runtime
  // lane list here: a box exists because a row exists.
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
   * Kept so the board can tell the virtual "ว่าง" row (`suffix === ""`) from a
   * real box. A real row's suffix is its name.
   */
  suffix: string;
}

/*
 * Guild League is itself split into two divisions — the game decides how many
 * players each one holds, so `capacity` is a number the game imposes, not a
 * target this site computes. Row names (เลนบน / กลุ่ม A …) are not listed here
 * any more: every box is a row in `event_rows`, created and named on the board.
 */

const RAW_CATEGORIES = [
  {
    id: "siege",
    label: "Siege",
    title: "Siege",
    description: "ทีมที่หัวหน้ากิลด์จัดไว้ลงสนาม",
  },
  {
    id: "guild-league",
    label: "Guild League",
    title: "Guild League",
    description: "ทีมที่หัวหน้ากิลด์จัดไว้ลงสนาม",
    divisions: [
      {
        id: "upper",
        label: "ลีคหลัก",
        title: "ลีคหลัก",
        // Only the division total is fixed by the game; a box can hold any
        // number of players as long as the boxes together stay within 60.
        capacity: 60,
        contentLabel: "Guild League ลีคหลัก",
      },
      {
        id: "lower",
        label: "ลีครอง",
        title: "ลีครอง",
        capacity: 90,
        contentLabel: "Guild League ลีครอง",
      },
    ] satisfies readonly LeagueDivision[],
  },
] satisfies readonly EventCategory[];

export const EVENT_CATEGORIES: readonly EventCategory[] = RAW_CATEGORIES;

/** Guild League's two divisions, for callers that don't walk the categories. */
export const LEAGUE_DIVISIONS: readonly LeagueDivision[] =
  getEventCategory("guild-league")?.divisions ?? [];

export function getEventCategory(id: string): EventCategory | undefined {
  return EVENT_CATEGORIES.find((entry) => entry.id === id);
}

/** The placement of `party` on `event`, or undefined when it does not play it. */
export function partyPlacement(
  party: Party,
  event: EventCategoryId
): PartyPlacement | undefined {
  return party.placements.find((placement) => placement.event === event);
}

/** Every event this party plays, in the order the placements were saved. */
export function partyEvents(party: Party): EventCategoryId[] {
  return party.placements.map((placement) => placement.event);
}

/** The division a party plays on `event`, or null when it names none. */
export function partyDivision(
  party: Party,
  event: EventCategoryId
): string | null {
  return partyPlacement(party, event)?.division ?? null;
}

/** The raw row id on `event`, or null when the party sits in "ว่าง". */
export function partyRowId(
  party: Party,
  event: EventCategoryId
): string | null {
  return partyPlacement(party, event)?.rowId ?? null;
}

/** The row key the board renders: a real row id, or the virtual parking row. */
export function partyRowKey(party: Party, event: EventCategoryId): string {
  return partyRowId(party, event) ?? UNASSIGNED_ROW.id;
}

/**
 * Teams of one scope, in the order the guild master put them in that box.
 *
 * The order is per event: `party_placements.position` is unique per scope, so
 * moving a team up on Siege does not shuffle the same team on Guild League.
 * Ties keep the incoming order (which is `parties.position`), because the sort
 * has to stay stable for rows written before the order existed.
 */
export function sortTeamsForScope(
  teams: Party[],
  event: EventCategoryId
): Party[] {
  return [...teams].sort((a, b) => {
    const left = partyPlacement(a, event)?.position ?? APPEND_POSITION;
    const right = partyPlacement(b, event)?.position ?? APPEND_POSITION;
    return left - right;
  });
}

/**
 * A copy of `party` placed on `event`.
 *
 * One placement per event: replacing the event segment is the same thing the
 * old string editor did, and it is what makes "a team cannot be in two boxes of
 * one event" structural rather than a rule somebody has to remember.
 */
export function setPartyPlacement(
  party: Party,
  event: EventCategoryId,
  division: string,
  rowId: string | null
): Party {
  return {
    ...party,
    placements: [
      ...party.placements.filter((placement) => placement.event !== event),
      // Dropping a team into another box means "put it at the end of that box".
      // A row only changes the placement's row, but the same call also adds an
      // event that was not there before, so appending is the one position that
      // reads correctly for both.
      { event, division, rowId, position: APPEND_POSITION },
    ],
  };
}

/** A copy of `party` with its participation in `event` removed. */
export function withoutPartyPlacement(
  party: Party,
  event: EventCategoryId
): Party {
  return {
    ...party,
    placements: party.placements.filter((placement) => placement.event !== event),
  };
}

export function partiesForEvent(
  parties: Party[],
  id: EventCategoryId
): Party[] {
  return parties.filter((party) =>
    party.placements.some((placement) => placement.event === id)
  );
}

/* ------------------------------------------------------------- divisions */

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
    (party) => partyDivision(party, event) === division
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

/* --------------------------------------------------------- parked rows */

/**
 * The row that holds teams with no box on this event.
 *
 * It has a real id rather than an empty string because it is offered in a
 * `Select` alongside the boxes, and Radix reserves "" for "no value". The
 * empty `suffix` is what makes it different from a real row: the board never
 * offers rename/delete/reorder on it, because deleting a box is what sends its
 * teams here.
 */
export const UNASSIGNED_ROW: LeagueLane = {
  id: "__unassigned",
  label: "ว่าง",
  suffix: "",
};

/** Map a stored row to the shape the lane board renders. */
export function rowToLane(row: EventRow): LeagueLane {
  return { id: row.id, label: row.name, suffix: row.name };
}

/** Rows of one scope, in the order the guild master saved them. */
export function eventRowsFor(
  rows: EventRow[],
  event: EventCategoryId,
  division: LeagueDivisionId | null
): EventRow[] {
  return rows
    .filter((row) => row.event === event && row.division === (division ?? ""))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * The rows of one scope, ending with the virtual "ว่าง" parking spot.
 *
 * The parking row exists on every board, including a league division: a team
 * that has not been dropped into a box yet has somewhere to be, and the row is
 * a drop target. It is never stored in `event_rows`.
 */
export function rowsForScope(
  rows: EventRow[],
  event: EventCategoryId,
  division: LeagueDivisionId | null
): LeagueLane[] {
  return [...eventRowsFor(rows, event, division).map(rowToLane), UNASSIGNED_ROW];
}

/**
 * The display label for a party, derived from its placements and row names.
 *
 * This is the only consumer of `Party.content`; nothing matches against that
 * string any more. Box names come from `event_rows`, so renaming a box changes
 * every label that uses it without touching a single party.
 */
export function derivePartyContent(party: Party, rows: EventRow[]): string {
  const order = new Map(
    EVENT_CATEGORIES.map((category, index) => [category.id, index])
  );
  const rowById = new Map(rows.map((row) => [row.id, row]));

  return [...party.placements]
    .sort((a, b) => (order.get(a.event) ?? 99) - (order.get(b.event) ?? 99))
    .map((placement) => {
      const category = getEventCategory(placement.event);
      if (!category) return "";
      const row = placement.rowId ? rowById.get(placement.rowId) : undefined;

      if (placement.event === "guild-league") {
        const division = placement.division
          ? getDivision(
              placement.event,
              placement.division as LeagueDivisionId
            )
          : undefined;
        const base = division?.contentLabel ?? category.label;
        return row ? `${base} ${row.name}` : base;
      }

      return row ? `${category.label} ${row.name}` : category.label;
    })
    .filter(Boolean)
    .join(" + ");
}
