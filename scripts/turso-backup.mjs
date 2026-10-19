#!/usr/bin/env node
/**
 * Dumps every party-related table to one JSON file before a risky write.
 *
 *   node scripts/turso-backup.mjs [label]
 *
 * Reads the same `.env.local` the app reads, so it cannot back up a different
 * database by accident. The file lands in `backups/` (git-ignored) and holds
 * the raw rows, not the domain objects — it is meant to be restorable by hand
 * with SQL, not by this app.
 */

import { createClient } from "@libsql/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

process.loadEnvFile(".env.local");

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("Missing TURSO_DATABASE_URL");

const client = createClient({
  url,
  authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
});

const TABLES = [
  "parties",
  "event_rows",
  "party_members",
  "party_placements",
  "app_meta",
  "members",
  "attendance",
];

const dump = { takenAt: new Date().toISOString(), tables: {} };

for (const table of TABLES) {
  const result = await client.execute(`SELECT * FROM ${table}`);
  dump.tables[table] = result.rows.map((row) => ({ ...row }));
}

const label = process.argv[2] ? `-${process.argv[2]}` : "";
const stamp = dump.takenAt.replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "backups");
await mkdir(dir, { recursive: true });
const file = path.join(dir, `turso-parties-backup-${stamp}${label}.json`);
await writeFile(file, JSON.stringify(dump, null, 2));

for (const [table, rows] of Object.entries(dump.tables)) {
  console.log(`${table.padEnd(18)} ${rows.length}`);
}
console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
