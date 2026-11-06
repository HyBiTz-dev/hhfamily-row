#!/usr/bin/env node
/**
 * Deterministic throwaway data for the phase 2/3 checks (and for looking at a
 * board before the guild's real roster exists).
 *
 *   PHASE2_BASE_URL=http://localhost:3311 \
 *   node scripts/fixture.mjs file:/tmp/phase2.db
 *
 * Only a `file:` database is accepted: this deletes every party, event row and
 * member before inserting the fixture, so pointing it at Turso would wipe the
 * guild.
 *
 * The app owns the schema (`lib/db.ts`), so this asks the running dev server for
 * `/api/parties` first. That request creates the tables on a cold database; the
 * fixture itself is plain INSERTs through the same libSQL client the checks use.
 *
 * Shape of the fixture, because the checks rely on it:
 *
 *   - siege has two boxes, "ทีม1" with two teams (drag/reorder needs a pair)
 *     and "ทีม2" with one.
 *   - "ทีม1" also plays ลีคหลัก, so "the other event keeps its
 *     position" has a team to check.
 *   - every team has 2 members, all in valid jobs, so cards render without the
 *     "นอกรายชื่อ" fallback.
 */

import { createClient } from "@libsql/client";
import process from "node:process";
import { pathToFileURL } from "node:url";

const NOW = "2026-01-01T00:00:00.000Z";

const MEMBERS = [
  ["Test Healer", "High Priest"],
  ["Test Tank", "Lord Knight"],
  ["Test Mage", "High Wizard"],
  ["Test Archer", "Sniper"],
  ["Test Bard", "Clown"],
  ["Test Dancer", "Gypsy"],
];

const ROWS = [
  ["fx-war-a", "siege", "", "ทีม1", 0],
  ["fx-war-b", "siege", "", "ทีม2", 1],
  ["fx-upper-mid", "guild-league", "upper", "เลนกลาง", 0],
  ["fx-lower-b", "guild-league", "lower", "กลุ่ม B", 0],
];

const PARTIES = [
  {
    id: "fx-party-1",
    name: "ทีม1",
    members: ["Test Healer", "Test Tank"],
    placements: [
      ["siege", "", "fx-war-a", 0],
      ["guild-league", "upper", "fx-upper-mid", 0],
    ],
  },
  {
    id: "fx-party-2",
    name: "ทีม2",
    members: ["Test Mage", "Test Archer"],
    placements: [
      ["siege", "", "fx-war-a", 1],
      ["guild-league", "upper", "fx-upper-mid", 1],
    ],
  },
  {
    id: "fx-party-3",
    name: "ทีม3",
    members: ["Test Bard", "Test Dancer"],
    placements: [
      ["siege", "", "fx-war-b", 2],
      ["guild-league", "lower", "fx-lower-b", 0],
    ],
  },
];

/**
 * Replaces the party/member tables with the fixture.
 *
 * `client` must already point at a `file:` database. The caller is responsible
 * for having created the schema (see `resetFixture`).
 */
export async function seedFixture(client) {
  const statements = [
    { sql: "DELETE FROM party_placements" },
    { sql: "DELETE FROM party_members" },
    { sql: "DELETE FROM parties" },
    { sql: "DELETE FROM event_rows" },
    { sql: "DELETE FROM attendance" },
    { sql: "DELETE FROM members" },
    // The version guard starts at 0 again, exactly like a new database.
    { sql: "DELETE FROM app_meta WHERE key = 'parties_version'" },
  ];

  MEMBERS.forEach(([name, job], position) => {
    statements.push({
      sql: "INSERT INTO members (name, job, level, note, position) VALUES (?, ?, 99, NULL, ?)",
      args: [name, job, position],
    });
  });

  ROWS.forEach(([id, event, division, name, position]) => {
    statements.push({
      sql: "INSERT INTO event_rows (id, event, division, name, position) VALUES (?, ?, ?, ?, ?)",
      args: [id, event, division, name, position],
    });
  });

  PARTIES.forEach((party, position) => {
    statements.push({
      sql: `INSERT INTO parties (id, name, content, members, updated_at, locked, position)
            VALUES (?, ?, NULL, '[]', ?, 0, ?)`,
      args: [party.id, party.name, NOW, position],
    });

    party.members.forEach((member, slot) => {
      statements.push({
        sql: "INSERT INTO party_members (party_id, member_name, slot) VALUES (?, ?, ?)",
        args: [party.id, member, slot],
      });
    });

    party.placements.forEach(([event, division, rowId, placementPosition]) => {
      statements.push({
        sql: `INSERT INTO party_placements (party_id, event, division, row_id, position)
              VALUES (?, ?, ?, ?, ?)`,
        args: [party.id, event, division, rowId, placementPosition],
      });
    });
  });

  // One batch = one transaction, so a fixture that fails halfway cannot leave a
  // half-deleted board for the next check to read.
  await client.batch(statements, "write");
}

/** Creates the schema (through the app) and then replaces its data. */
export async function resetFixture(baseUrl, client) {
  const res = await fetch(`${baseUrl}/api/parties`);
  if (!res.ok) {
    throw new Error(`GET /api/parties failed while creating the schema: ${res.status}`);
  }
  await seedFixture(client);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {
    // No .env.local is fine: the URL comes from the argument or the environment.
  }

  const url =
    process.argv[2] ??
    process.env.PHASE2_DATABASE_URL ??
    process.env.PHASE3_DATABASE_URL;
  const base = process.env.PHASE2_BASE_URL ?? "http://localhost:3311";

  if (!url || !url.startsWith("file:")) {
    console.error(
      "usage: node scripts/fixture.mjs file:/tmp/phase2.db  (PHASE2_BASE_URL points at the dev server)"
    );
    process.exit(2);
  }

  const client = createClient({ url });
  await resetFixture(base, client);
  console.log(`fixture written to ${url}`);
}
