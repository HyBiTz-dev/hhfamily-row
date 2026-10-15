import "server-only";

/**
 * Sample data for the guild tool.
 *
 * The real roster is the guild's business; this is the set that makes every
 * screen worth looking at — a roster big enough to search and paginate, a
 * ledger with enough history for the absence rules to produce interesting
 * numbers, and parties spread across the events and boards.
 *
 * Two rules shape it, both learned the hard way:
 *
 * - **Labels are built with the same helpers the app uses** (`rowContentLabel`,
 *   `boxRow`, `laneContentLabel`, `setEventSegment`), never typed by hand. A
 *   hand-written label that misses a keyword puts a team in no box on any page,
 *   which looks like the box feature is broken rather than like a typo.
 * - **The PRNG is seeded and deterministic.** Re-running produces the same
 *   guild, so "it looked right last time" is still reproducible, and a bug
 *   found in the sample data can be found again.
 *
 * Nothing here is imported by the app itself.
 */

import { readAttendance, readMembers, readParties, writeBatch } from "@/lib/db";
import { ABSENCE_ALERT_AFTER, GUILD_DAYS, absencesFor } from "@/lib/rngw/attendance";
import { TEAM_MAX_MEMBERS, partyLabelOptions } from "@/lib/party";
import {
  LEAGUE_DIVISIONS,
  boxRow,
  laneContentLabel,
  rowContentLabel,
  setEventSegment,
  UNASSIGNED_ROW,
} from "@/lib/rngw/categories";
import type { AttendanceRow, Member, Party } from "@/lib/rngw/types";

/* ------------------------------------------------------------------ random */

/** mulberry32 — small, fast, and the same sequence on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

/** Weighted pick — a guild has far more healers than creators. */
function weighted(random: () => number, weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

function shuffled<T>(random: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------- names */

/**
 * Character names.
 *
 * Latin stems because that is what the sample roster has always used, plus Thai
 * ones because a Thai guild is not all latin — the point is to see how the UI
 * handles a name that is long, a name that is short, and a name with no spaces.
 */
const STEMS = [
  "Ka", "No", "Ri", "Ze", "Lu", "Mi", "Tha", "Ver", "Gan", "Sol",
  "Dra", "Nyx", "Kir", "Mal", "Oro", "Fen", "Hal", "Ith", "Jor", "Kel",
  "Lum", "Nir", "Pha", "Qua", "Rhu", "Sil", "Tor", "Uma", "Vor", "Wyn",
  "Xan", "Yri", "Zel", "Ash", "Bel", "Ced", "Dan", "Esk", "Gin", "Hes",
  "Ilv", "Ken", "Lam", "Mar", "Nev", "Pra", "Rem", "Sab", "Tal", "Val",
] as const;

const SUFFIXES = ["ra", "ne", "mi", "ze", "lo", "ni", "sa", "ta"] as const;

const THAI_NAMES = [
  "ส้มทอง", "ใบเดือน", "พายสีเงา", "เจ้าแม่มะม่วง", "หมอกเช้า",
  "ปลาทู", "กาแฟเย็น", "น้ำแข็งใส", "แมวขี้หลับ", "รวยไฟมัน",
] as const;

/** Class mix: healers and tanks are what a guild fields most of. */
const JOB_WEIGHTS: Record<string, number> = {
  "High Priest": 22,
  Clown: 14,
  Gypsy: 12,
  "Lord Knight": 14,
  Paladin: 12,
  Sniper: 10,
  "High Wizard": 6,
  "Assassin Cross": 5,
  Whitesmith: 4,
  Creator: 3,
  Champion: 4,
  "Night Walker": 3,
  Druid: 2,
};

const NOTES = ["", "", "", "", "", "alt", "main account", "ไม่ค่อยออนไลน์"] as const;

/* ------------------------------------------------------------------ dates */

/** Guild-local day key for `offset` days before `today`. */
function dayBefore(today: string, offset: number): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Guild days strictly before `today`, oldest first, capped at `weeks` back. */
function pastGuildDays(today: string, weeks: number): string[] {
  const days: string[] = [];
  for (let back = 1; back <= weeks * 7; back++) {
    const date = dayBefore(today, back);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (GUILD_DAYS.includes(weekday)) days.push(date);
  }
  return days.reverse();
}

/* ----------------------------------------------------------------- roster */

export interface SeedOptions {
  /** Overwrite whatever is in the database. Without it a populated one is left alone. */
  reset?: boolean;
  random?: () => number;
  /** Fixed "today", so a seeded dataset is reproducible on any machine. */
  today?: string;
  weeks?: number;
}

export interface SeedSummary {
  members: number;
  attendance: number;
  parties: number;
  neverAnswered: number;
  /** Members whose absences reached the warning line. */
  overTheLine: number;
  today: string;
}

const MEMBER_COUNT = 150;

/** The absence count is recomputed by `absencesFor`, not guessed here. */
function seedMembers(random: () => number): Member[] {
  const names: string[] = [];
  const taken = new Set<string>();

  // The Thai names are placed first, because they are the cases worth seeing:
  // long ones, ones with no Latin letters, and ones a search box has to handle.
  // Generating the Latin ones afterwards means a longer stem list can never
  // quietly push every Thai name out of the roster.
  for (const name of THAI_NAMES) {
    if (taken.has(name)) continue;
    taken.add(name);
    names.push(name);
  }

  const latinCount = MEMBER_COUNT - names.length;
  for (const stem of STEMS) {
    for (const suffix of SUFFIXES) {
      const name = `${stem}${suffix}`;
      if (taken.has(name)) continue;
      taken.add(name);
      names.push(name);
      if (names.length >= MEMBER_COUNT) break;
    }
    if (names.length >= MEMBER_COUNT) break;
  }

  if (names.length < latinCount) {
    throw new Error(
      `ชุดชื่อตัวอย่างมีแค่ ${names.length} ชื่อ ไม่พอสำหรับ ${MEMBER_COUNT} — ` +
        "เพิ่ม STEMS หรือ SUFFIXES ใน lib/seed.ts"
    );
  }

  return names.slice(0, MEMBER_COUNT).map((name) => ({
    name,
    job: weighted(random, JOB_WEIGHTS),
    level: 60 + Math.floor(random() * 40),
    note: pick(random, NOTES) || undefined,
  }));
}

/**
 * A ledger with real shape.
 *
 * The absences rules need four things and this gives all of them: days that are
 * guild days, days that are already over, days somebody actually played, and
 * members whose first answer is late — plus a few people who never answer at
 * all, which the absence panel reports separately.
 *
 * A handful of members are given a deliberate run of silence so the
 * absence warning has real names behind it.
 */
function seedAttendance(members: Member[], today: string, weeks: number, random: () => number): AttendanceRow[] {
  const playDays = pastGuildDays(today, weeks);
  if (playDays.length === 0) return [];

  const rows: AttendanceRow[] = [];

  // Picked from the roster itself rather than from a hand-written name list: a
  // name that is not in the roster would silently do nothing, and the panel
  // would come back empty with nothing to explain it. These are the last few
  // members, so this stays correct however the name generator changes.
  const silent = new Set(members.slice(-6).map((member) => member.name));

  // Every 11th member only starts answering three weeks in — the late joiners
  // the absence rules exist for.
  const lateJoiners = new Map<string, string>();
  members.forEach((member, index) => {
    if (index % 11 === 0 && playDays.length > 6) {
      lateJoiners.set(member.name, playDays[Math.floor(playDays.length / 3)]);
    }
  });

  // Two members go quiet for three straight sessions, which is exactly the
  // shape the red warning is drawn for.
  const goingQuiet = new Map<string, number>();
  members.forEach((member, index) => {
    if (index === 5 || index === 60) goingQuiet.set(member.name, playDays.length - 4);
  });

  let clock = Date.UTC(2026, 0, 1);

  for (const member of members) {
    if (silent.has(member.name)) continue;

    const from = lateJoiners.get(member.name);
    const quietFrom = goingQuiet.get(member.name);

    for (const date of playDays) {
      if (from && date < from) continue;
      clock += 60_000 + Math.floor(random() * 600_000);

      if (quietFrom !== undefined && playDays.indexOf(date) >= quietFrom) continue;

      // Roughly one answer in four is a leave, and silence is rare: most
      // players check in every session. The silence rate is the only thing
      // that decides how many names the absence panel flags, so it is kept low
      // on purpose — a sample roster where a fifth of the guild is over the
      // line would make the panel look broken.
      const roll = random();
      if (roll < 0.025) continue;

      rows.push({
        name: member.name,
        date,
        status: roll < 0.23 ? "leave" : "present",
        note: roll < 0.23 && random() < 0.3 ? "มีธุระ" : undefined,
        submittedAt: clock,
      });
    }
  }

  // Today, so the board the guild master opens has something on it. Includes a
  // few silent members — those show as "รอเช็ค", which is the normal state of
  // the page mid-day.
  const todayPresent = Math.round(members.length * 0.62);
  const roster = shuffled(random, members);
  roster.forEach((member, index) => {
    if (index >= todayPresent) return;
    clock += 60_000 + Math.floor(random() * 600_000);
    rows.push({
      name: member.name,
      date: today,
      status: random() < 0.82 ? "present" : "leave",
      submittedAt: clock,
    });
  });

  return rows;
}

/**
 * Parties across every board that has one.
 *
 * Boxes are the part that is easy to get wrong: `rowsForScope` derives them
 * from what teams are labelled, so a box only exists if a team carries its name.
 * Every box below is named here and then used on at least one team.
 */
function seedParties(members: Member[], random: () => number): Party[] {
  // Build the pool out of today's check-ins — that is the set the builder itself
  // would offer first.
  const answered = new Set(members.map((member) => member.name));
  const pool = shuffled(random, [...answered]);
  const taken = new Set<string>();

  const take = (size: number): string[] => {
    const team: string[] = [];
    while (team.length < size && pool.length > 0) {
      const name = pool.shift();
      if (!name || taken.has(name)) continue;
      taken.add(name);
      team.push(name);
    }
    return team;
  };

  const [, polarityChip, ...leagueChips] = partyLabelOptions();
  const parties: Party[] = [];

  const add = (
    content: string,
    size: number,
    options: { locked?: boolean } = {}
  ): boolean => {
    const memberNames = take(size);
    if (memberNames.length < 2) return false;
    parties.push({
      id: crypto.randomUUID(),
      name: `ทีม${parties.length + 1}`,
      content,
      memberNames,
      locked: options.locked === true,
      updatedAt: new Date().toISOString(),
    });
    return true;
  };

  // Guild War boxes — each name below appears on at least one team, so the box
  // really exists on the board.
  for (const box of ["ทีมสเกา", "ทีมบอส"]) {
    add(rowContentLabel("guild-war", boxRow(box)), 5);
  }
  // One team in no box at all — it belongs to the "ว่าง" row the board always
  // keeps at the bottom.
  add(rowContentLabel("guild-war", UNASSIGNED_ROW), 5);

  for (let i = 0; i < 2; i++) {
    add(rowContentLabel("polarity", boxRow(`ทีม${i + 1}`)), 5);
  }

  // League teams, spread over both divisions and all three lanes, because the
  // division and lane rules only show anything if every lane is occupied.
  for (const chip of leagueChips) {
    add(chip.content, 5, { locked: chip.id === "guild-league:lower" && parties.length % 2 === 0 });
  }
  for (const division of LEAGUE_DIVISIONS) {
    for (const lane of division.lanes ?? []) {
      add(laneContentLabel(division, lane), TEAM_MAX_MEMBERS);
    }
  }

  // One team on both events at once — the label carries two segments, which is
  // what `contentSegments` exists for.
  const dual = rowContentLabel("guild-war", boxRow("ทีมคาแรง"));
  if (parties.length > 0) {
    const memberNames = take(4);
    if (memberNames.length >= 2) {
      parties.push({
        id: crypto.randomUUID(),
        name: `ทีม${parties.length + 1}`,
        content: setEventSegment(dual, polarityChip.event, polarityChip.content),
        memberNames,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return parties;
}

/* ------------------------------------------------------------------- write */

export async function seedDatabase(options: SeedOptions = {}): Promise<SeedSummary> {
  const random = options.random ?? seededRandom(20261015);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const weeks = options.weeks ?? 8;

  const existing = await readMembers();
  if (existing.length > 0 && !options.reset) {
    throw new Error(
      `มีสมาชิกอยู่แล้ว ${existing.length} คน — ถ้าจะเขียนทับ ให้ยืนยันก่อน ` +
        "(POST ซ้ำอีกครั้งด้วย ?reset=1)"
    );
  }

  const members = seedMembers(random);
  const attendance = seedAttendance(members, today, weeks, random);
  const parties = seedParties(members, random);

  const statements = [
    { sql: "DELETE FROM attendance" },
    { sql: "DELETE FROM parties" },
    { sql: "DELETE FROM members" },
    ...members.map((member, index) => ({
      sql: `INSERT INTO members (name, job, level, note, position)
            VALUES (?, ?, ?, ?, ?)`,
      args: [member.name, member.job, member.level, member.note ?? null, index],
    })),
    ...attendance.map((row) => ({
      sql: `INSERT INTO attendance (name, date, status, note, submitted_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [row.name, row.date, row.status, row.note ?? null, row.submittedAt],
    })),
    ...parties.map((party, index) => ({
      sql: `INSERT INTO parties (id, name, content, members, updated_at, locked, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        party.id,
        party.name,
        party.content ?? null,
        JSON.stringify(party.memberNames),
        party.updatedAt,
        party.locked ? 1 : 0,
        index,
      ],
    })),
  ];

  await writeBatch(statements);

  // Re-read through the app's own readers rather than counting what we just
  // sent: that is the only way to know the labels survived `compact` and the
  // members came back as `Member` objects rather than columns.
  const [storedMembers, storedAttendance, storedParties] = await Promise.all([
    readMembers(),
    readAttendance(),
    readParties(),
  ]);

  // Counted with the app's own rule, not guessed while generating — if this
  // comes back 0 the sample data is not exercising the absence panel at all,
  // which is the whole reason the ledger exists here.
  const absences = absencesFor(storedMembers, storedAttendance, today);

  return {
    members: storedMembers.length,
    attendance: storedAttendance.length,
    parties: storedParties.length,
    neverAnswered: storedMembers.filter(
      (member) => !storedAttendance.some((row) => row.name === member.name)
    ).length,
    overTheLine: [...absences.values()].filter(
      (entry) => entry.count >= ABSENCE_ALERT_AFTER
    ).length,
    today,
  };
}