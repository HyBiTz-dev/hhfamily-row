#!/usr/bin/env node
/**
 * Phase 0.3 + 0.4 — the two one-time data fixes agreed with the guild master.
 *
 *   node scripts/phase0-league-placement-fix.mjs [backup.json]
 *
 * 0.3  A league team whose label names no box was migrated to the row "ว่าง".
 *      Before the migration it sat in the old default — เลนกลาง for ลีคหลัก,
 *      กลุ่ม B for ลีครอง. Put those teams back there so the guild master does
 *      not have to drag 16 teams after deploy.
 *
 * 0.4  `BabyOTteR` is on ปาร์ตี้ 32 but has no roster row, so the board draws a
 *      blank icon reading "นอกรายชื่อ". Remove the seat.
 *
 * Both go out as ONE PUT — the same route the UI uses, so the same validation
 * and the same single transaction. Nothing else in the list is changed.
 *
 * Pass the backup file to have the script refuse to run if the database has
 * drifted from it (content order ignored), so the "before" numbers below are
 * the numbers actually on screen.
 */

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import process from "node:process";

process.loadEnvFile(".env.local");

const BASE = process.env.PHASE0_BASE_URL ?? "http://localhost:3000";
const MISSING_MEMBER = "BabyOTteR";
/** The pre-migration default lanes: ลีคหลัก → เลนกลาง, ลีครอง → กลุ่ม B. */
const DEFAULT_ROW = {
  upper: "guild-league:upper:middle",
  lower: "guild-league:lower:b",
};

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const loginRes = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pin: process.env.GUILD_PIN }),
});
if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
const cookie = loginRes.headers.getSetCookie().map((e) => e.split(";")[0]).join("; ");

const readState = async () => (await (await fetch(`${BASE}/api/parties`)).json());

const state = await readState();

/* Guard: the state we are about to edit is the backup we were handed. */
const backupFile = process.argv[2];
if (backupFile) {
  const dump = JSON.parse(await readFile(backupFile, "utf8"));
  const canon = (rows) =>
    rows
      .map((row) =>
        JSON.stringify({
          id: row.id,
          name: row.name,
          content: row.content ? row.content.split(" + ").sort().join(" + ") : row.content,
          members: row.members,
          locked: Number(row.locked),
        })
      )
      .sort();
  const before = canon(dump.tables.parties);
  const now = canon(
    state.parties.map((p) => ({
      id: p.id,
      name: p.name,
      content: p.content,
      members: JSON.stringify(p.memberNames),
      locked: p.locked ? 1 : 0,
    }))
  );
  if (JSON.stringify(before) !== JSON.stringify(now)) {
    throw new Error("database does not match the backup — refusing to write");
  }
  console.log("state matches the backup (content order ignored)");
}

const rowIds = new Set(state.eventRows.map((row) => row.id));
for (const rowId of Object.values(DEFAULT_ROW)) {
  if (!rowIds.has(rowId)) throw new Error(`missing row ${rowId} — cannot map`);
}

/* Counts before the write, so the checks below are deltas and cannot be
   satisfied by numbers that were already there. */
const countBefore = async (where) =>
  Number((await client.execute(`SELECT COUNT(*) AS n FROM party_placements WHERE ${where}`)).rows[0]?.n ?? 0);
const beforeCounts = {
  nullLeague: await countBefore("event = 'guild-league' AND row_id IS NULL"),
  middle: await countBefore("row_id = 'guild-league:upper:middle'"),
  groupB: await countBefore("row_id = 'guild-league:lower:b'"),
};

const reparked = [];
const cleaned = [];
const now = new Date().toISOString();

const next = state.parties.map((party) => {
  let changed = false;
  let placements = party.placements;

  for (const placement of party.placements) {
    if (placement.event === "guild-league" && placement.rowId === null) {
      const target = DEFAULT_ROW[placement.division];
      if (!target) continue;
      placements = placements.map((entry) =>
        entry === placement ? { ...entry, rowId: target } : entry
      );
      reparked.push(`${party.name} → ${target}`);
      changed = true;
    }
  }

  let memberNames = party.memberNames;
  if (party.memberNames.includes(MISSING_MEMBER)) {
    memberNames = memberNames.filter((name) => name !== MISSING_MEMBER);
    cleaned.push(party.name);
    changed = true;
  }

  return changed ? { ...party, placements, memberNames, updatedAt: now } : party;
});

console.log(`\n0.3 repark ${reparked.length} league teams:`);
for (const line of reparked) console.log(`  ${line}`);
console.log(`0.4 remove ${MISSING_MEMBER} from: ${cleaned.join(", ") || "(none)"}`);

if (reparked.length === 0 && cleaned.length === 0) {
  console.log("\nnothing to do");
  process.exit(0);
}

const res = await fetch(`${BASE}/api/admin/parties`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ parties: next }),
});
if (!res.ok) throw new Error(`PUT failed: ${res.status} ${await res.text()}`);

/* ------------------------------------------------------------- verification */

const count = async (sql, args = []) =>
  Number((await client.execute({ sql, args })).rows[0]?.n ?? 0);

const nullLeague = await count(
  `SELECT COUNT(*) AS n FROM party_placements
   WHERE event = 'guild-league' AND row_id IS NULL`
);
const inMiddle = await count(
  `SELECT COUNT(*) AS n FROM party_placements WHERE row_id = 'guild-league:upper:middle'`
);
const inGroupB = await count(
  `SELECT COUNT(*) AS n FROM party_placements WHERE row_id = 'guild-league:lower:b'`
);
const seat = await count(
  `SELECT COUNT(*) AS n FROM party_members WHERE member_name = ?`,
  [MISSING_MEMBER]
);
const parties = await count("SELECT COUNT(*) AS n FROM parties");
const placements = await count("SELECT COUNT(*) AS n FROM party_placements");

const checks = [
  ["no league placement is left in \"ว่าง\"", nullLeague === 0, `null=${nullLeague}`],
  [
    "ลีคหลัก teams landed in เลนกลาง (+4)",
    inMiddle === beforeCounts.middle + 4,
    `${beforeCounts.middle} → ${inMiddle}`,
  ],
  [
    "ลีครอง teams landed in กลุ่ม B (+12)",
    inGroupB === beforeCounts.groupB + 12,
    `${beforeCounts.groupB} → ${inGroupB}`,
  ],
  [`${MISSING_MEMBER} has no seat`, seat === 0, `seat=${seat}`],
  ["no party added or lost", parties === state.parties.length, `parties=${parties}`],
  ["no placement added or lost", placements === state.parties.reduce((n, p) => n + p.placements.length, 0), `placements=${placements}`],
];

let failures = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
process.exit(failures === 0 ? 0 : 1);
