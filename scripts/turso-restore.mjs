#!/usr/bin/env node
/**
 * Puts a `scripts/turso-backup.mjs` dump back.
 *
 *   node scripts/turso-restore.mjs backups/turso-parties-backup-….json [--all]
 *
 * By default only the party tables and `app_meta` are restored, because those
 * are what a party-editing round can touch. `--all` also rewrites `members` and
 * `attendance`, which no party write does — pass it only when you know nothing
 * else has written to them since the dump.
 *
 * Each table is replaced inside one batch, so a failure cannot leave a table
 * half-old and half-new.
 */

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import process from "node:process";

process.loadEnvFile(".env.local");

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("Missing TURSO_DATABASE_URL");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/turso-restore.mjs <backup.json> [--all]");
  process.exit(1);
}
const all = process.argv.includes("--all");

const dump = JSON.parse(await readFile(file, "utf8"));
const TABLES = all
  ? Object.keys(dump.tables)
  : ["parties", "event_rows", "party_members", "party_placements", "app_meta"];

const client = createClient({
  url,
  authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
});

for (const table of TABLES) {
  const rows = dump.tables[table];
  if (!Array.isArray(rows)) throw new Error(`${table} missing from ${file}`);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const statements = [{ sql: `DELETE FROM ${table}` }];
  for (const row of rows) {
    statements.push({
      sql: `INSERT INTO ${table} (${columns.join(", ")})
            VALUES (${columns.map(() => "?").join(", ")})`,
      args: columns.map((column) => row[column]),
    });
  }

  await client.batch(statements, "write");
  console.log(`${table.padEnd(18)} restored ${rows.length}`);
}
