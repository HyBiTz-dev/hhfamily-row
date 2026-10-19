/**
 * Party composition helpers.
 *
 * `Party.placements` says which events a team plays; the normal rows and
 * `event_rows` say where it sits. `parseParties`/`parseEventRows` are the
 * guards on the way in from a request body.
 */

import { JOBS } from "./rngw/jobs";
import {
  APPEND_POSITION,
  EVENT_CATEGORIES,
  LEAGUE_DIVISIONS,
  getDivision,
  getEventCategory,
  type EventCategoryId,
  type LeagueDivisionId,
} from "./rngw/categories";
import type { EventRow, MemberStatus, Party, PartyPlacement } from "./rngw/types";

/* --------------------------------------------------------- pure helpers */

export type JobCount = { job: string; count: number };

/**
 * How many of each class are in the party, most common first. Ties follow the
 * canonical job order from jobs.ts so the layout doesn't shuffle between
 * renders.
 *
 * Keyed by `Member.job`, which is the class name. A class jobs.ts doesn't know
 * sorts last: it has no canonical position, and putting it in the middle would
 * make the layout jump around depending on who is in the party.
 */
export function countByJob(members: MemberStatus[]): JobCount[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    counts.set(member.job, (counts.get(member.job) ?? 0) + 1);
  }
  const order = new Map(JOBS.map((job, index) => [job.name, index]));

  return [...counts.entries()]
    .map(([job, count]) => ({ job, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (order.get(a.job) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.job) ?? Number.MAX_SAFE_INTEGER)
    );
}

/** Classes that commonly carry support or tank duty — a nudge, not a rule. */
const COMMON_ROLES: Record<string, string> = {
  "High Priest": "บัฟ",
  Clown: "บัฟ",
  Gypsy: "บัฟ",
  "Lord Knight": "แทงก์",
  Paladin: "แทงก์",
};

/**
 * How many players one team holds.
 *
 * The game caps a party at five, so the board stops offering the "add" field
 * once a team is full rather than letting the guild master write a sixth name
 * the game would only reject.
 */
export const TEAM_MAX_MEMBERS = 5;

export function roleHint(job: string): string | undefined {
  return COMMON_ROLES[job];
}

/* ---------------------------------------------------------- event labels */

/**
 * The event scopes a party's label can name, as tappable chips.
 *
 * A party has no type field, so this is the same vocabulary
 * `lib/rngw/categories.ts` matches against ("Guild War", "Polarity", "Guild
 * League ลีคหลัก/ลีครอง"). The chips exist so the guild master never has to spell
 * a label that has to survive `compact`. Guild War and Polarity carry no box
 * name here: a box is added on the event board by dragging a team into it, so a
 * chip must not invent one.
 */
export interface PartyLabelOption {
  /** Doubles as the React key. */
  id: string;
  /** The event this chip belongs to — several chips may share one (the two
   * leagues), which is why the id, not this, is what a chip is keyed by. */
  event: EventCategoryId;
  /** `''` for events without league tabs. */
  division: string;
  /** Chip text. */
  label: string;
}

export function partyLabelOptions(): PartyLabelOption[] {
  return [
    {
      id: "guild-war",
      event: "guild-war",
      division: "",
      label: "Guild War",
    },
    {
      id: "polarity",
      event: "polarity",
      division: "",
      label: "Polarity",
    },
    ...LEAGUE_DIVISIONS.map((division) => ({
      id: `guild-league:${division.id}`,
      event: "guild-league" as EventCategoryId,
      division: division.id,
      label: division.label,
    })),
  ];
}

/**
 * The same chips, grouped by the page they belong to, in page order.
 *
 * One flat row of four buttons made "Guild League" look like a fourth event
 * beside "Guild War" and "Polarity", which is exactly the confusion the two
 * league chips cause: they are the same event with two divisions. The group
 * heading comes from `EVENT_CATEGORIES` rather than being typed here, so it
 * cannot drift from the page title.
 */
export interface PartyLabelGroup {
  event: EventCategoryId;
  /** How the page names this event. */
  title: string;
  options: PartyLabelOption[];
}

export function partyLabelGroups(): PartyLabelGroup[] {
  const options = partyLabelOptions();
  return EVENT_CATEGORIES.map((category) => ({
    event: category.id,
    title: category.title,
    options: options.filter((option) => option.event === category.id),
  })).filter((group) => group.options.length > 0);
}

/** Every chip a set of placements lights, in placement order. */
export function activeLabelIds(placements: PartyPlacement[]): string[] {
  const ids: string[] = [];
  for (const placement of placements) {
    const id = placement.division
      ? `${placement.event}:${placement.division}`
      : placement.event;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Adds one event to the placements, or takes it back out — the chip toggle.
 *
 * Only that event's placement is touched: ticking Guild League on a Guild War
 * party appends it and leaves the war box alone, and unticking it removes only
 * the league entry. Switching ลีคหลัก to ลีครอง replaces that one placement, and
 * the box resets to "ว่าง" because a box belongs to one division.
 */
export function togglePartyLabel(
  placements: PartyPlacement[],
  option: PartyLabelOption
): PartyPlacement[] {
  const active = placements.some(
    (placement) =>
      placement.event === option.event && placement.division === option.division
  );

  if (active) {
    return placements.filter(
      (placement) =>
        !(
          placement.event === option.event &&
          placement.division === option.division
        )
    );
  }

  const others = placements.filter((placement) => placement.event !== option.event);
  return [
    ...others,
    {
      event: option.event,
      division: option.division,
      rowId: null,
      // A newly ticked event goes after the teams already on that board. The
      // board sorts by this per scope, so a fixed 0 would slip it in front of
      // a team the guild master placed first on purpose.
      position: APPEND_POSITION,
    },
  ];
}

/* ------------------------------------------------------------- placement */

/**
 * Member name → the parties they already sit on, joined for display.
 *
 * The "add someone to a team" dropdown sorts by this: a player on no team at
 * all is the natural pick for a fresh team, and anyone spotted here as already
 * placed carries their party's name so a tap is a deliberate move, not a
 * surprise. A member may be on more than one party (different events), so the
 * names are joined rather than the last one winning.
 */
export function placementByMember(parties: Party[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const party of parties) {
    for (const name of party.memberNames) {
      map.set(name, map.has(name) ? `${map.get(name)}, ${party.name}` : party.name);
    }
  }
  return map;
}

/* --------------------------------------------------------- member order */

/**
 * Puts `second` where `first` sits and vice versa, keeping every seat filled.
 *
 * The array order of `Party.memberNames` *is* the stored slot order: `saveParties`
 * writes each name's index into `party_members.slot`, and the event boards read
 * it back for their "ตามลำดับที่จัดไว้" member order. Reordering the array is
 * therefore the whole feature — there is no second field to keep in sync.
 *
 * Returns the input unchanged when either name is missing or both are the same,
 * so a stale name or a drop on itself can never reorder the list. Pure, so the
 * rule is readable (and testable) without a browser.
 */
export function swapMemberSeats(
  memberNames: string[],
  first: string,
  second: string
): string[] {
  const from = memberNames.indexOf(first);
  const to = memberNames.indexOf(second);
  if (from < 0 || to < 0 || from === to) return memberNames;

  const next = [...memberNames];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/* ------------------------------------------------------------------ locks */

/**
 * The parties a delete is allowed to take.
 *
 * Split out of the components because the two ways to delete ("the trash
 * button" and "delete every party") must agree on what "locked" means — the
 * first is in the builder, the second is one step away from wiping the tab.
 */
export function unlockedParties(parties: Party[]): Party[] {
  return parties.filter((party) => !party.locked);
}

/** The parties kept back from a delete, in board order. */
export function lockedParties(parties: Party[]): Party[] {
  return parties.filter((party) => party.locked === true);
}

/* -------------------------------------------------------- random teams */

/**
 * The classes every auto-formed team draws from, one slot per group, in order:
 * a healer, then a tank — *either* tank class, so a guild short on knights does
 * not end up with healer-only teams while paladins stand unplaced. Everything
 * after these two slots is filled at random.
 *
 * Class **names**, matching `Member.job`. These strings are the same ones in
 * jobs.ts: renaming one there silently stops that class counting as a core job.
 */
export const CORE_PARTY_JOBS: readonly (readonly string[])[] = [
  ["High Priest"], // the healer every team needs
  ["Lord Knight", "Paladin"], // either one counts as the tank
];

/** How many slots are still free for random fillers on a full team. */
export const RANDOM_FILL_COUNT = TEAM_MAX_MEMBERS - CORE_PARTY_JOBS.length;

/**
 * The label a thrown-together team gets: every event, with the league pinned to
 * the second division.
 *
 * Built from `partyLabelOptions()` rather than typed out, so it matches what the
 * event pages will read back — the same reason the chips exist. The ids are
 * chosen here, not by the option list, because picking "whichever league chip
 * comes last" would silently move everyone to ลีคหลัก whenever the list changed.
 */
const RANDOM_PARTY_LABEL_IDS: readonly string[] = [
  "guild-war",
  "polarity",
  "guild-league:lower",
];

export function randomPartyPlacements(): PartyPlacement[] {
  const options = partyLabelOptions();
  return RANDOM_PARTY_LABEL_IDS.map((id) =>
    options.find((option) => option.id === id)
  )
    .filter((option): option is PartyLabelOption => Boolean(option))
    .map((option) => ({
      event: option.event,
      division: option.division,
      rowId: null,
      // A thrown-together team joins the end of every board it plays.
      position: APPEND_POSITION,
    }));
}

/**
 * A team of one is not a team, so the last odd person out is reported instead
 * of being written to the database as a party nobody asked for.
 *
 * Exported because the UI says the number too — the warning over the party grid
 * explains why "สุ่มปาร์ตี้" is disabled, and it must be the same 2 the planner
 * used rather than a second number somebody typed into a sentence.
 */
export const MIN_RANDOM_TEAM_SIZE = 2;

export interface RandomPartyPlan {
  /** New parties to add, already named, labelled and filled. */
  parties: Party[];
  /** Everyone the plan puts on a team. */
  placed: string[];
  /** Names the pool had but the plan could not use. */
  leftOver: string[];
}

/** Fisher–Yates, so the shuffle is a real one rather than a sorted list. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Throws the party-less members into teams of five, one per core job.
 *
 * The pool is every member on no team at all — the same set the builder
 * counts as "ยังไม่ถูกจัด" — but the ones who came today lead it, so the teams
 * fill with players who will actually be there and the absent ones only cover
 * what is left. Inside that, order is random on purpose: shuffling is the whole
 * feature, and a deterministic order would quietly rebuild the same teams on
 * every press.
 *
 * Each team takes one of each core group it can — scanning from the front of
 * the pool, so the healer and the tank come from today's players when there are
 * any, and where both tank classes are free the shuffle decides which one this
 * team takes. The rest of the slots go to whoever is next, at random. A group
 * nobody is left in simply goes without, and so does a party for the last lonely
 * member.
 *
 * Pure: it plans and does not write. The builder confirms first, then PUTs.
 */
export function planRandomParties(
  members: MemberStatus[],
  existing: Party[],
  random: () => number = Math.random
): RandomPartyPlan {
  const taken = new Set(existing.flatMap((party) => party.memberNames));
  const free = members.filter((member) => !taken.has(member.name));
  const pool = [
    ...shuffle(free.filter((member) => member.status === "present"), random),
    ...shuffle(free.filter((member) => member.status !== "present"), random),
  ];

  const now = new Date().toISOString();
  const parties: Party[] = [];
  const placed: string[] = [];

  while (pool.length >= MIN_RANDOM_TEAM_SIZE) {
    const team: MemberStatus[] = [];
    for (const group of CORE_PARTY_JOBS) {
      const at = pool.findIndex((member) => group.includes(member.job));
      if (at >= 0) team.push(...pool.splice(at, 1));
    }
    while (team.length < TEAM_MAX_MEMBERS && pool.length > 0) {
      team.push(...pool.splice(0, 1));
    }

    const names = team.map((member) => member.name);
    placed.push(...names);
    parties.push({
      id: crypto.randomUUID(),
      name: `ปาร์ตี้ ${existing.length + parties.length + 1}`,
      placements: randomPartyPlacements(),
      memberNames: names,
      updatedAt: now,
    });
  }

  return { parties, placed, leftOver: pool.map((member) => member.name) };
}

const EVENT_IDS = new Set<string>(EVENT_CATEGORIES.map((category) => category.id));
const DIVISION_IDS = new Set<string>(LEAGUE_DIVISIONS.map((division) => division.id));

/**
 * Untrusted input from PUT /api/admin/parties.
 *
 * Everything structural is re-derived here: one placement per event, a
 * placement only on an event the site knows, and a division only on Guild
 * League. `rowId` is checked against the rows that actually exist later, in
 * `saveParties` — a stale id becomes the "ว่าง" row rather than a dangling card.
 */
export function parseParties(raw: string): Party[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(toParty);
  } catch {
    return [];
  }
}

function toParty(value: unknown): Party[] {
  if (!value || typeof value !== "object") return [];
  const party = value as Partial<Party>;
  if (typeof party.id !== "string" || !party.id || typeof party.name !== "string") {
    return [];
  }

  const byEvent = new Map<EventCategoryId, PartyPlacement>();
  if (Array.isArray(party.placements)) {
    party.placements.forEach((raw) => {
      const placement = toPlacement(raw);
      if (placement) byEvent.set(placement.event, placement);
    });
  }

  const seen = new Set<string>();
  const memberNames = (Array.isArray(party.memberNames) ? party.memberNames : [])
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });

  return [
    {
      id: party.id,
      name: party.name,
      // A display cache. `saveParties` recomputes it from placements and rows.
      content: undefined,
      placements: [...byEvent.values()],
      memberNames,
      // Only a real `true` locks. Anything else (missing, "false", 0) is an
      // unlocked party, because the alternative — a typo silently protecting a
      // team from deletion — is the worse mistake.
      locked: party.locked === true,
      updatedAt:
        typeof party.updatedAt === "string"
          ? party.updatedAt
          : new Date().toISOString(),
    },
  ];
}

function toPlacement(value: unknown): PartyPlacement | null {
  if (!value || typeof value !== "object") return null;
  const placement = value as Partial<PartyPlacement>;
  if (typeof placement.event !== "string" || !EVENT_IDS.has(placement.event)) {
    return null;
  }

  const event = placement.event as EventCategoryId;
  const division = typeof placement.division === "string" ? placement.division : "";
  if (event === "guild-league") {
    if (division !== "" && !DIVISION_IDS.has(division)) return null;
  } else if (division !== "") {
    return null;
  }

  return {
    event,
    division,
    rowId:
      typeof placement.rowId === "string" && placement.rowId
        ? placement.rowId
        : null,
    position:
      typeof placement.position === "number" && Number.isFinite(placement.position)
        ? placement.position
        : // No position from the client means "a placement we have not placed
          // yet"; appending is the only order that cannot reorder the board.
          APPEND_POSITION,
  };
}

/* ------------------------------------------------------------------ boxes */

/**
 * Case- and space-insensitive key for a box name inside one scope.
 *
 * `event_rows` has a UNIQUE index on `(event, division, name)`, but it is
 * case-sensitive: "ทีม A" and "ทีม a" both fit there while reading as the same
 * box to a person. The board has always refused the second one (it folds with
 * `toLocaleLowerCase`); folding here is what makes the server agree. Plain
 * `toLowerCase`, not the locale-aware one, so the mapping cannot change with the
 * machine's locale.
 */
export function foldRowName(name: string): string {
  return name.trim().toLowerCase();
}

/** The scope (`event` + `division`) plus a folded name: what must be unique. */
export function rowScopeKey(
  event: string,
  division: string,
  name: string
): string {
  return `${event}\u0000${division}\u0000${foldRowName(name)}`;
}

/**
 * Drops rows that cannot both be stored, and says where the dropped ones went.
 *
 * `event_rows` has a primary key on `id` and a unique index on
 * `(event, division, name)`, so a client that repeats an id — or sends two boxes
 * whose names differ only in case — would abort the whole write with a
 * constraint error. That surfaces to the guild master as a 502 and a screen that
 * "just fails". Dropping the later duplicate keeps the save working instead: the
 * first row wins (so rows should be sorted into board order first), and `remap`
 * sends any team parked in a dropped box to the surviving one rather than to
 * "ว่าง".
 *
 * Runs in `normalizeEventRows`, the last gate before the INSERTs. Not in
 * `parseEventRows`: the remap has to survive to where the placements are
 * resolved, and the request guard would drop it.
 *
 * Pure, so the rule can be read (and tested) without a database.
 */
export function dedupeEventRows(rows: EventRow[]): {
  rows: EventRow[];
  remap: Map<string, string>;
} {
  const byId = new Map<string, EventRow>();
  const byScope = new Map<string, EventRow>();
  const remap = new Map<string, string>();
  const out: EventRow[] = [];

  for (const row of rows) {
    // A repeated id is the same box sent twice; the survivor is itself.
    const sameId = byId.get(row.id);
    if (sameId) {
      remap.set(row.id, sameId.id);
      continue;
    }

    const sameName = byScope.get(rowScopeKey(row.event, row.division, row.name));
    if (sameName) {
      remap.set(row.id, sameName.id);
      continue;
    }

    byId.set(row.id, row);
    byScope.set(rowScopeKey(row.event, row.division, row.name), row);
    out.push(row);
  }

  return { rows: out, remap };
}

/**
 * Follows a dropped row id to the row that replaced it.
 *
 * `remap` only ever points a dropped id at a surviving one, so a single hop
 * suffices; the loop and the `seen` guard exist so a malformed map can never
 * spin forever.
 */
function resolveRowId(id: string, remap: Map<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  while (remap.has(current) && !seen.has(current)) {
    seen.add(current);
    current = remap.get(current) as string;
  }
  return current;
}

/**
 * Drops placements that do not match a row of the same event and division.
 *
 * A deleted box therefore sends its teams to "ว่าง" without the caller having to
 * remember to null every placement first. A box the dedupe dropped is followed
 * through `remap`, so its teams move to the surviving box rather than to "ว่าง".
 *
 * Pure, and the last gate before the INSERTs (`normalizeEventRows` produces the
 * rows and remap): a stale or cross-event `rowId` can never reach the database.
 */
export function normalizePlacements(
  party: Party,
  rows: EventRow[],
  remap: Map<string, string>
): PartyPlacement[] {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const byEvent = new Map<string, PartyPlacement>();

  for (const placement of party.placements) {
    if (!getEventCategory(placement.event)) continue;

    const division =
      placement.event === "guild-league" ? placement.division || "" : "";
    if (
      placement.event === "guild-league" &&
      division &&
      !getDivision(placement.event, division as LeagueDivisionId)
    ) {
      continue;
    }

    const row = placement.rowId
      ? rowById.get(resolveRowId(placement.rowId, remap))
      : undefined;
    const rowId =
      row && row.event === placement.event && row.division === division
        ? row.id
        : null;

    // One placement per event: if a request repeats an event, the last one
    // wins, matching `parseParties`.
    byEvent.set(placement.event, {
      event: placement.event,
      division,
      rowId,
      position: placement.position,
    });
  }

  return [...byEvent.values()];
}

/** Untrusted rows from the same request; ids are the stable box identity. */
export function parseEventRows(raw: string): EventRow[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(toEventRow);
  } catch {
    return [];
  }
}

function toEventRow(value: unknown): EventRow[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<EventRow>;
  if (typeof row.id !== "string" || !row.id || typeof row.name !== "string") return [];
  const name = row.name.trim();
  if (!name) return [];
  if (typeof row.event !== "string" || !EVENT_IDS.has(row.event)) return [];

  const event = row.event as EventCategoryId;
  const division = typeof row.division === "string" ? row.division : "";
  if (event === "guild-league") {
    if (!DIVISION_IDS.has(division)) return [];
  } else if (division !== "") {
    return [];
  }

  return [
    {
      id: row.id,
      event,
      division,
      name,
      position:
        typeof row.position === "number" && Number.isFinite(row.position)
          ? row.position
          : 0,
    },
  ];
}
