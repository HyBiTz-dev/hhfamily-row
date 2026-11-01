/**
 * Ragnarok: New World class catalog.
 *
 * 15 jobs, and the **name is the identifier** — `Member.job` stores the name
 * itself, so what is in the database reads as "Paladin" rather than 222. That
 * is the whole point: the roster is looked at and hand-edited by people, and a
 * number tells nobody anything.
 *
 * THE TRADE THIS BUYS AND WHAT IT COSTS:
 * the name is now a foreign key made of text, so renaming an entry in this file
 * orphans every member stored under the old name. There is no cascade to fix it
 * and no migration that can, because the old string is gone from the code.
 * `getJob` returning `undefined` is the only warning you get — which is why
 * `jobLabel` shows the stored string rather than blanking the roster, and why
 * `GameIcon` falls back to initials. Keep this catalog stable; if a name must
 * change, expect to re-save those members.
 *
 * Name and icon both point at the **high class** — the job whose id ends in 3
 * (Knight → Lord Knight = 213). Most members play the high class, so that is
 * what the roster shows. The Druid line is the exception to the naming rule:
 * its high-class entry is shown as "Druid", not its own name. The id survives
 * only inside `iconKey`, which is the asset filename that `jobIconUrl()` turns
 * into a path.
 *
 * Sage and Rogue are the other exception: the roster keeps their second-class
 * names even though their art is the high-class icon (`323` / `623`, the
 * "Scholar" / "Stalker" art). The name is what the guild calls them; the icon
 * follows the same `…3` rule as every other entry.
 *
 * There are no build branches any more. The high class does not split into
 * them, so a member is fully described by their job alone.
 *
 * Names are game facts; `iconKey` is an asset filename — keep it as data,
 * never as a path.
 */

export interface Job {
  /** The identifier: stored on `Member.job` and matched against it. */
  name: string;
  nameEn: string;
  /**
   * Asset key for the class icon, resolved by `jobIconUrl()`.
   *
   * Carries the high-class id (the `213` in `icon_jsxq_big_213`), not a separate
   * field — see the note at the top of this file.
   */
  iconKey: string;
}

export const JOBS: Job[] = [
  {
    name: "Lord Knight",
    nameEn: "Lord Knight",
    iconKey: "icon_jsxq_big_213",
  },
  {
    name: "Paladin",
    nameEn: "Paladin",
    iconKey: "icon_jsxq_big_223",
  },
  {
    name: "High Wizard",
    nameEn: "High Wizard",
    iconKey: "icon_jsxq_big_313",
  },
  {
    name: "Sage",
    nameEn: "Sage",
    iconKey: "icon_jsxq_big_323",
  },
  {
    name: "Sniper",
    nameEn: "Sniper",
    iconKey: "icon_jsxq_big_413",
  },
  {
    name: "Clown",
    nameEn: "Clown",
    iconKey: "icon_jsxq_big_423",
  },
  {
    name: "Gypsy",
    nameEn: "Gypsy",
    iconKey: "icon_jsxq_big_433",
  },
  {
    name: "High Priest",
    nameEn: "High Priest",
    iconKey: "icon_jsxq_big_513",
  },
  {
    name: "Champion",
    nameEn: "Champion",
    iconKey: "icon_jsxq_big_523",
  },
  {
    name: "Assassin Cross",
    nameEn: "Assassin Cross",
    iconKey: "icon_jsxq_big_613",
  },
  {
    name: "Rogue",
    nameEn: "Rogue",
    iconKey: "icon_jsxq_big_623",
  },
  {
    name: "Whitesmith",
    nameEn: "Whitesmith",
    iconKey: "icon_jsxq_big_713",
  },
  {
    name: "Creator",
    nameEn: "Creator",
    iconKey: "icon_jsxq_big_723",
  },
  {
    name: "Night Walker",
    nameEn: "Night Walker",
    iconKey: "icon_jsxq_big_813",
  },
  {
    name: "Druid",
    nameEn: "Druid",
    iconKey: "icon_jsxq_big_913",
  },
];

const JOB_BY_NAME = new Map(JOBS.map((job) => [job.name, job]));

export function getJob(name: string): Job | undefined {
  return JOB_BY_NAME.get(name);
}

/**
 * Whether `value` is a class this app knows.
 *
 * The one gate on the write path: a member saved with a typo'd class would
 * quietly lose its icon and its role hint, and nothing would say why. The roster
 * form can only offer real names anyway — this guards the API, which the form
 * does not.
 */
export function isJobName(value: unknown): value is string {
  return typeof value === "string" && JOB_BY_NAME.has(value);
}