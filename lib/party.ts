/**
 * Party composition helpers.
 *
 * Parties live in the sheet only — the builder writes the tab directly, so
 * there is no browser-side copy to keep in sync. `parseParties` is the guard
 * on the way back in: request bodies and sheet cells are both untrusted.
 */

import { JOBS } from "./rngw/jobs";
import {
  clearEventSegment,
  contentSegments,
  EVENT_CATEGORIES,
  LEAGUE_DIVISIONS,
  matchDivision,
  matchEventCategory,
  rowContentLabel,
  SEGMENT_SEPARATOR,
  setEventSegment,
  UNASSIGNED_ROW,
  type EventCategoryId,
} from "./rngw/categories";
import type { MemberStatus, Party } from "./rngw/types";

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
  /** Matches `labelOptionId`, and doubles as the React key. */
  id: string;
  /** The event this chip belongs to — several chips may share one (the two
   * leagues), which is why the id, not this, is what a chip is keyed by. */
  event: EventCategoryId;
  /** Chip text. */
  label: string;
  /** What the chip writes into the label. */
  content: string;
}

export function partyLabelOptions(): PartyLabelOption[] {
  return [
    {
      id: "guild-war",
      event: "guild-war",
      label: "Guild War",
      content: rowContentLabel("guild-war", UNASSIGNED_ROW),
    },
    {
      id: "polarity",
      event: "polarity",
      label: "Polarity",
      content: rowContentLabel("polarity", UNASSIGNED_ROW),
    },
    ...LEAGUE_DIVISIONS.map((division) => ({
      id: `guild-league:${division.id}`,
      event: "guild-league" as EventCategoryId,
      label: division.label,
      content: division.contentLabel,
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

/**
 * Which chip one label segment names, or null when it names no event.
 *
 * Runs the same matching the event pages run rather than comparing strings, so
 * a party saved before this editor existed — with a hand-typed or misspelled
 * label — still lights the right chip. A Guild War box ("Guild War ทีมสเกา")
 * lights "Guild War"; the box itself is not this editor's business.
 */
export function labelOptionId(segment: string): string | null {
  const event = matchEventCategory(segment);
  if (!event) return null;
  const division = matchDivision(segment, event);
  return division ? `${event}:${division}` : event;
}

/** Every chip a label lights, in the order its segments appear. */
export function activeLabelIds(content: string | undefined): string[] {
  const ids: string[] = [];
  for (const segment of contentSegments(content)) {
    const id = labelOptionId(segment);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The label a party is allowed to carry: whatever the chips can write, nothing else.
 *
 * A label exists to say which board a team belongs on, so a hand-typed segment
 * ("ปาร์ตี้บอส") has nothing to match: the team lands in no event at all and only
 * shows up in the "ว่าง" row of every page. The editor no longer accepts typing,
 * and this is the other half of that rule — labels already in the database
 * (typed before the chips existed, or by hand in Turso) are reduced to the
 * segments that name a real event when a party is opened or saved.
 */
export function stripCustomLabels(content: string | undefined): string {
  return contentSegments(content)
    .filter((segment) => matchEventCategory(segment) !== null)
    .join(SEGMENT_SEPARATOR);
}

/**
 * Adds one event to a label, or takes it back out — the chip toggle.
 *
 * A label may name several events, so this only touches that event's segment:
 * ticking Guild League on a "Guild War" party appends it and leaves the war
 * segment (and its box) untouched, and unticking it removes only the league
 * part. Switching ลีคหลัก to ลีครอง rewrites that one segment, box or not, because
 * a team cannot be in both divisions at once.
 */
export function togglePartyLabel(
  content: string,
  option: PartyLabelOption
): string {
  return activeLabelIds(content).includes(option.id)
    ? clearEventSegment(content, option.event)
    : setEventSegment(content, option.event, option.content);
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

export function randomPartyLabel(): string {
  const options = partyLabelOptions();
  return RANDOM_PARTY_LABEL_IDS.map((id) => options.find((option) => option.id === id)?.content)
    .filter((content): content is string => Boolean(content))
    .join(SEGMENT_SEPARATOR);
}

/**
 * A team of one is not a team, so the last odd person out is reported instead
 * of being written to the sheet as a party nobody asked for.
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
      content: randomPartyLabel(),
      memberNames: names,
      updatedAt: now,
    });
  }

  return { parties, placed, leftOver: pool.map((member) => member.name) };
}

/**
 * Untrusted input (a request body or a sheet row); keep only entries that look
 * sane, and only labels the chips could have written.
 *
 * `stripCustomLabels` is here, not only in the editor: this is the gate every
 * write passes through, so a hand-crafted request cannot put a label back that
 * the UI no longer offers — and a party saved with one before the editor
 * changed is cleaned the first time anything writes the list.
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
  if (typeof party.id !== "string" || typeof party.name !== "string") return [];
  return [
    {
      id: party.id,
      name: party.name,
      content:
        typeof party.content === "string"
          ? stripCustomLabels(party.content) || undefined
          : undefined,
      memberNames: Array.isArray(party.memberNames)
        ? party.memberNames.filter((name): name is string => typeof name === "string")
        : [],
      // Only a real `true` locks. Anything else (missing, "false", 0) is an
      // unlocked party, because the alternative — a typo silently protecting a
      // team from deletion — is the worse mistake.
      locked: party.locked === true,
      updatedAt: typeof party.updatedAt === "string" ? party.updatedAt : new Date().toISOString(),
    },
  ];
}
