#!/usr/bin/env node
/** Prints the migration report and the teams with no box. */
import { createClient } from "@libsql/client";
import process from "node:process";
process.loadEnvFile(".env.local");

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const rows = (
  await client.execute({
    sql: "SELECT value FROM app_meta WHERE key = ?",
    args: ["parties_normalized_v1_report"],
  })
).rows;

const report = JSON.parse(rows[0].value);
console.log("totals:", report.totals);
console.log("unknownMembers:", report.unknownMembers);
console.log("legacy:", report.legacy);
console.log("unresolved:", report.unresolved);
console.log("warnings:", report.warnings.slice(0, 20));
console.log("\nteams with a null-row league placement:");
for (const team of report.teams) {
  const league = team.placements.filter((p) => p.event === "guild-league");
  const war = team.placements.filter((p) => p.event === "siege");
  if (league.some((p) => p.rowId === null)) {
    console.log(`  ${team.name.padEnd(14)} members=${team.memberCount} league=${league.map((p) => `${p.division}:${p.rowName ?? "ว่าง"}`).join(",")} war=${war.map((p) => p.rowName ?? "ว่าง").join(",")}`);
  }
}
