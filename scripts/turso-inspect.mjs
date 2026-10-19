#!/usr/bin/env node
/** Read-only inspection of the party tables. */
import { createClient } from "@libsql/client";
import process from "node:process";
process.loadEnvFile(".env.local");

const url = process.env.TURSO_DATABASE_URL;
const client = createClient({
  url,
  authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
});

const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const show = (title, rows) => {
  console.log(`\n== ${title}`);
  console.table(rows.map((r) => ({ ...r })));
};

show(
  "event_rows",
  await q("SELECT id, event, division, name, position FROM event_rows ORDER BY event, division, position")
);
show("app_meta", await q("SELECT key, substr(value,1,60) AS value FROM app_meta"));
show(
  "placements grouped",
  await q(`SELECT event, division, COALESCE(row_id,'(NULL)') AS row_id, COUNT(*) AS n
           FROM party_placements GROUP BY event, division, row_id ORDER BY event, division, n DESC`)
);
show(
  "placements with NULL row",
  await q(`SELECT p.party_id, pt.name, p.event, p.division FROM party_placements p
           JOIN parties pt ON pt.id = p.party_id WHERE p.row_id IS NULL
           ORDER BY p.event, p.division, pt.name`)
);
show("BabyOTteR in party_members", await q("SELECT * FROM party_members WHERE member_name LIKE '%Baby%'"));
show("BabyOTteR in members", await q("SELECT name, job FROM members WHERE name LIKE '%Baby%'"));
show("roster names not in members", await q(`SELECT DISTINCT pm.member_name FROM party_members pm
  LEFT JOIN members m ON m.name = pm.member_name WHERE m.name IS NULL`));
