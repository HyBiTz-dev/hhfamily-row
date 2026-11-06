#!/usr/bin/env node
/**
 * Phase 0.1 — one full write round against the database, then verify and
 * restore.
 *
 *   node scripts/phase0-write-check.mjs [backup.json]
 *
 * Runs against a dev server on http://localhost:3000 (start `npm run dev`
 * first) so the writes take the real path: route handler → `parseParties` →
 * `saveParties` → one `batch` over the Turso HTTP client. Every step is checked
 * with a direct read, and the tables are restored from the backup file at the
 * end, so the guild data ends exactly where it started.
 *
 * Exits non-zero if any check fails, and leaves the database as-is in that case
 * so you can see what happened.
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

process.loadEnvFile(".env.local");

const BASE = process.env.PHASE0_BASE_URL ?? "http://localhost:3000";
const url = process.env.TURSO_DATABASE_URL;
const client = createClient({
  url,
  authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
});

const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);

/** Order- and key-order-independent hash, so a compare cannot fail on either. */
const stableHash = (rows) =>
  hash(
    rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]))
        )
      )
      .sort()
  );

/**
 * `parties.content` is a display cache, and every write re-derives it in
 * canonical event order (Siege → Guild League). A row the
 * migration wrote in another order therefore comes back re-ordered — same
 * segments, same teams. Comparing the sorted segments keeps that from looking
 * like a lost party.
 */
const canonicalParty = (row) => ({
  ...row,
  content:
    typeof row.content === "string"
      ? row.content.split(" + ").sort().join(" + ")
      : row.content,
});
const canonicalParties = (rows) => rows.map(canonicalParty);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ login */

let cookie = "";
{
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: process.env.GUILD_PIN }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  cookie = res.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
}

const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
};

const getState = async () => {
  const { body } = await api("/api/parties");
  return body;
};

const put = async (parties, eventRows) => {
  const payload = eventRows === undefined ? { parties } : { parties, eventRows };
  const res = await api("/api/admin/parties", { method: "PUT", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`PUT failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

/* --------------------------------------------------------------- baseline */

const snap = async () => ({
  parties: await q("SELECT id, name, content, members, updated_at, locked, position FROM parties ORDER BY id"),
  rows: await q("SELECT id, event, division, name, position FROM event_rows ORDER BY id"),
  members: await q("SELECT party_id, member_name, slot FROM party_members ORDER BY party_id, slot"),
  placements: await q("SELECT party_id, event, division, row_id, position FROM party_placements ORDER BY party_id, event"),
});

const baseline = await snap();
const baseHash = {
  parties: stableHash(canonicalParties(baseline.parties)),
  rows: stableHash(baseline.rows),
  members: stableHash(baseline.members),
  placements: stableHash(baseline.placements),
};
console.log(`baseline: ${baseline.parties.length} parties, ${baseline.rows.length} rows, ` +
  `${baseline.members.length} seats, ${baseline.placements.length} placements`);
console.log(`hash parties=${baseHash.parties} rows=${baseHash.rows}`);

/* Confirm the starting point is the backup we are about to restore to. If it
   is not, another writer ran in between and "restore" would be a surprise. */
const backupFile = process.argv[2];
if (backupFile) {
  const dump = JSON.parse(await readFile(backupFile, "utf8"));
  check(
    "start state equals the backup file",
    stableHash(canonicalParties(baseline.parties)) === stableHash(canonicalParties(dump.tables.parties)),
    "content order ignored"
  );
}

/* -------------------------------------- A. add a box at Siege (rows) */

const stateA = await getState();
const boxId = crypto.randomUUID();
const boxName = "ทดสอบเฟส0";
await put(stateA.parties, [
  ...stateA.eventRows,
  { id: boxId, event: "siege", division: "", name: boxName, position: 0 },
]);

{
  const rows = await q("SELECT * FROM event_rows WHERE id = ?", [boxId]);
  const after = await snap();
  check("A box added → event_rows has the new row", rows.length === 1, `name=${rows[0]?.name}`);
  check("A box added → parties unchanged", stableHash(canonicalParties(after.parties)) === baseHash.parties);
  check("A box added → placements unchanged", stableHash(after.placements) === baseHash.placements);
}

/* ------------------------------- B. move a team into the new box (placement) */

const stateB = await getState();
const target = stateB.parties.find(
  (party) =>
    party.placements.length >= 2 &&
    party.placements.some((p) => p.event === "siege") &&
    party.placements.some((p) => p.event === "guild-league")
);
if (!target) throw new Error("no shared team found to move");
const otherPlacementsBefore = target.placements
  .filter((p) => p.event !== "siege")
  .map((p) => `${p.event}:${p.division}:${p.rowId ?? "-"}`)
  .sort();

await put(
  stateB.parties.map((party) =>
    party.id === target.id
      ? {
          ...party,
          placements: party.placements.map((p) =>
            p.event === "siege" ? { ...p, rowId: boxId } : p
          ),
          updatedAt: new Date().toISOString(),
        }
      : party
  )
);

{
  const placed = await q(
    "SELECT row_id FROM party_placements WHERE party_id = ? AND event = 'siege'",
    [target.id]
  );
  const content = await q("SELECT content FROM parties WHERE id = ?", [target.id]);
  const otherPlacementsAfter = (
    await q(
      "SELECT event, division, COALESCE(row_id,'-') AS row_id FROM party_placements WHERE party_id = ? AND event <> 'siege'",
      [target.id]
    )
  )
    .map((r) => `${r.event}:${r.division}:${r.row_id}`)
    .sort();

  check("B team moved → placement row_id is the new box", placed[0]?.row_id === boxId);
  check(
    "B team moved → parties.content derived from the box",
    typeof content[0]?.content === "string" && content[0].content.includes(boxName),
    String(content[0]?.content)
  );
  check(
    "B team moved → the team's other events are untouched",
    JSON.stringify(otherPlacementsBefore) === JSON.stringify(otherPlacementsAfter),
    otherPlacementsAfter.join(" | ")
  );
}

/* --------------------------------------- C. rename the box (no team lost) */

const stateC = await getState();
const boxName2 = "ทดสอบเฟส0-ใหม่";
await put(
  stateC.parties,
  stateC.eventRows.map((row) => (row.id === boxId ? { ...row, name: boxName2 } : row))
);

{
  const after = await snap();
  const rows = await q("SELECT name FROM event_rows WHERE id = ?", [boxId]);
  const content = await q("SELECT content FROM parties WHERE id = ?", [target.id]);
  check("C box renamed → row name changed", rows[0]?.name === boxName2);
  check("C box renamed → no party added or lost", after.parties.length === baseline.parties.length);
  check("C box renamed → no placement added or lost", after.placements.length === baseline.placements.length);
  check("C box renamed → placement still points at the box", (
    await q("SELECT row_id FROM party_placements WHERE party_id = ? AND event = 'siege'", [target.id])
  )[0]?.row_id === boxId);
  check("C box renamed → content follows the new name", content[0]?.content?.includes(boxName2));
}

/* ------------------------- D. rename the team + edit members (other events stay) */

const stateD = await getState();
const rosterBefore = await q(
  "SELECT member_name, slot FROM party_members WHERE party_id = ? ORDER BY slot",
  [target.id]
);
const droppedName = rosterBefore[rosterBefore.length - 1]?.member_name;
const teamName2 = `${target.name} (ทดสอบ)`;
await put(
  stateD.parties.map((party) =>
    party.id === target.id
      ? {
          ...party,
          name: teamName2,
          memberNames: party.memberNames.filter((name) => name !== droppedName),
          updatedAt: new Date().toISOString(),
        }
      : party
  )
);

{
  const otherPlacements = await q(
    "SELECT COUNT(*) AS n FROM party_placements WHERE party_id = ? AND event <> 'siege'",
    [target.id]
  );
  const nameNow = await q("SELECT name FROM parties WHERE id = ?", [target.id]);
  const rosterNow = await q(
    "SELECT member_name FROM party_members WHERE party_id = ? ORDER BY slot",
    [target.id]
  );
  check("D team renamed → name changed", nameNow[0]?.name === teamName2);
  check("D members edited → one seat fewer", rosterNow.length === rosterBefore.length - 1);
  check("D members edited → dropped name is gone", !rosterNow.some((r) => r.member_name === droppedName), String(droppedName));
  check("D other events still present", Number(otherPlacements[0]?.n) === otherPlacementsBefore.length);
}

/* ------------------------------ E. delete the box that holds teams (row_id NULL) */

const stateE = await getState();
await put(
  stateE.parties,
  stateE.eventRows.filter((row) => row.id !== boxId)
);

{
  const after = await snap();
  const placed = await q(
    "SELECT row_id FROM party_placements WHERE party_id = ? AND event = 'siege'",
    [target.id]
  );
  check("E box deleted → row gone from event_rows", !(await q("SELECT id FROM event_rows WHERE id = ?", [boxId])).length);
  check("E box deleted → team's row_id is NULL", placed[0]?.row_id === null);
  check("E box deleted → team not lost", after.parties.length === baseline.parties.length);
  check("E box deleted → rows count back to baseline", after.rows.length === baseline.rows.length);
  check("E box deleted → placements count unchanged", after.placements.length === baseline.placements.length);
}

/* ---------------------------- F. batch is one transaction on the HTTP client */

{
  const dupId = crypto.randomUUID();
  let threw = false;
  try {
    await client.batch(
      [
        { sql: "INSERT INTO event_rows (id, event, division, name, position) VALUES (?,?,?,?,?)", args: [dupId, "siege", "", "ชั่วคราว", 0] },
        { sql: "INSERT INTO event_rows (id, event, division, name, position) VALUES (?,?,?,?,?)", args: [dupId, "siege", "", "ซ้ำ", 0] },
      ],
      "write"
    );
  } catch {
    threw = true;
  }
  const left = await q("SELECT id FROM event_rows WHERE id = ?", [dupId]);
  check("F a failing batch rolls back completely", threw && left.length === 0, `threw=${threw} rowsLeft=${left.length}`);
}

/* --------------------------------------------------------------- restore */

if (backupFile) {
  const dump = JSON.parse(await readFile(backupFile, "utf8"));
  for (const table of ["parties", "event_rows", "party_members", "party_placements"]) {
    const rows = dump.tables[table];
    const columns = Object.keys(rows[0]);
    await client.batch(
      [
        { sql: `DELETE FROM ${table}` },
        ...rows.map((row) => ({
          sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          args: columns.map((column) => row[column]),
        })),
      ],
      "write"
    );
  }
  await sleep(50);
  const after = {};
  for (const table of ["parties", "event_rows", "party_members", "party_placements"]) {
    after[table] = await q(`SELECT * FROM ${table}`);
    check(
      `R restored ${table} matches the backup`,
      stableHash(after[table]) === stableHash(dump.tables[table]),
      `${after[table].length} rows`
    );
  }
} else {
  console.log("\nno backup file given — NOT restoring. Pass one to undo the round.");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
