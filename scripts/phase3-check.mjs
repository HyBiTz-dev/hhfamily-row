#!/usr/bin/env node
/**
 * Phase 3 — write-path robustness.
 *
 *   PHASE3_DATABASE_URL=file:/tmp/phase3.db \
 *   PHASE3_BASE_URL=http://localhost:3313 \
 *   node scripts/phase3-check.mjs
 *
 * Refuses anything but a `file:` database: it sends duplicate rows and a stale
 * version on purpose, which must never reach Turso.
 *
 * Writes go through the real route (PUT /api/admin/parties), so it covers
 * parseParties / parseEventRows → saveParties → dedupe + version batch, not just
 * the pure helpers.
 *
 *   A. a member on two teams of one event is refused (400) and changes nothing
 *   B. a repeated event_rows id is dropped instead of failing the write
 *   C. two box names that fold together leave one box (case-insensitive)
 *   D. teams parked in a dropped duplicate follow it to the surviving box
 *   E. a stale snapshot version is refused (409); the current one succeeds
 */

import { createClient } from "@libsql/client";
import process from "node:process";
import { resetFixture } from "./fixture.mjs";

process.loadEnvFile(".env.local");

const BASE = process.env.PHASE3_BASE_URL ?? "http://localhost:3313";
const url = process.env.PHASE3_DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("PHASE3_DATABASE_URL must be a file: URL (throwaway database)");
  process.exit(2);
}

const client = createClient({ url });
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/* ------------------------------------------------------------------ login */

let cookie = "";
{
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: process.env.GUILD_PIN }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  cookie = res.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie,
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
};

const getState = async () => (await api("/api/parties")).body;
const put = (payload) =>
  api("/api/admin/parties", { method: "PUT", body: JSON.stringify(payload) });

/* --------------------------------------------------------------- fixture */

{
  // The phase-4 cleanup removed `POST /api/admin/seed`; the checks write their
  // own deterministic fixture instead.
  await resetFixture(BASE, client);
  const [count] = await q("SELECT COUNT(*) AS n FROM parties");
  check("throwaway database has the fixture", Number(count.n) === 3, `${count.n} parties`);
}

/* ------------------------------------------------- A. one team per event */

{
  const before = await getState();
  const counts = await q("SELECT COUNT(*) n FROM party_members");
  const donor = before.parties.find(
    (party) => party.memberNames.length > 0 && party.placements.length > 0
  );
  const target = before.parties.find((party) => party.id !== donor?.id);

  if (!donor || !target) {
    check("a donor and a target party exist", false);
  } else {
    const name = donor.memberNames[0];
    const { event, division } = donor.placements[0];
    const next = before.parties.map((party) => {
      if (party.id !== target.id) return party;
      const playsEvent = party.placements.some((placement) => placement.event === event);
      return {
        ...party,
        memberNames: [...party.memberNames.filter((entry) => entry !== name), name],
        placements: playsEvent
          ? party.placements
          : [
              ...party.placements,
              {
                event,
                division,
                rowId: null,
                position: Number.MAX_SAFE_INTEGER,
              },
            ],
      };
    });

    const res = await put({ parties: next });
    check(
      "a member on two teams of one event is refused",
      res.status === 400,
      `${res.status} ${JSON.stringify(res.body)}`
    );
    check(
      "the refusal names the rule",
      /ทีมเดียวต่ออีเวนต์/.test(res.body.error ?? ""),
      res.body.error
    );
    const after = await q("SELECT COUNT(*) n FROM party_members");
    check(
      "the refused write changed nothing",
      Number(after[0].n) === Number(counts[0].n),
      `${counts[0].n} -> ${after[0].n}`
    );
  }
}

/* ------------------------------------------------ B. duplicate row id */

{
  const before = await getState();
  const row = before.eventRows[0];
  if (!row) {
    check("the fixture has event rows", false);
  } else {
    const res = await put({
      parties: before.parties,
      eventRows: [...before.eventRows, { ...row }],
    });
    check(
      "a repeated row id does not fail the write",
      res.status === 200,
      `${res.status} ${JSON.stringify(res.body)}`
    );
    const dup = await q(
      "SELECT id, COUNT(*) c FROM event_rows GROUP BY id HAVING c > 1"
    );
    check("no duplicate id reached the table", dup.length === 0);
    const total = await q("SELECT COUNT(*) n FROM event_rows");
    check(
      "the row count is unchanged",
      Number(total[0].n) === before.eventRows.length,
      `${total[0].n} vs ${before.eventRows.length}`
    );
  }
}

/* ------------------------------------- C. box names that fold together */

{
  const before = await getState();
  const row = before.eventRows[0];
  const scope = row
    ? { event: row.event, division: row.division }
    : { event: "guild-war", division: "" };
  const first = {
    id: crypto.randomUUID(),
    event: scope.event,
    division: scope.division,
    name: "Check Box",
    position: -2,
  };
  const second = { ...first, id: crypto.randomUUID(), name: "Check box", position: -1 };

  const res = await put({
    parties: before.parties,
    eventRows: [...before.eventRows, first, second],
  });
  check(
    "two boxes that fold together do not fail the write",
    res.status === 200,
    `${res.status} ${JSON.stringify(res.body)}`
  );

  const rows = await q(
    "SELECT id FROM event_rows WHERE event = ? AND division = ? AND lower(name) = lower(?)",
    [scope.event, scope.division, "check box"]
  );
  check("only one folded name survives", rows.length === 1, `${rows.length}`);
  check("the first (lowest position) row is the survivor", rows[0]?.id === first.id);
}

/* ------------------------------------------- D. teams follow the remap */

{
  const before = await getState();
  const placement = before.parties
    .flatMap((party) => party.placements)
    .find((entry) => entry.rowId);
  const row = before.eventRows.find((entry) => entry.id === placement?.rowId);

  if (!row) {
    check("a placed box exists to duplicate", false);
  } else {
    // The duplicate sorts before the original, so the shape that was already on
    // the board is the one the dedupe drops.
    const duplicate = { ...row, id: crypto.randomUUID(), position: -5 };
    const res = await put({
      parties: before.parties,
      eventRows: [duplicate, ...before.eventRows],
    });
    check(
      "a duplicated box name does not fail the write",
      res.status === 200,
      `${res.status} ${JSON.stringify(res.body)}`
    );

    const gone = await q("SELECT id FROM event_rows WHERE id = ?", [row.id]);
    check("the dropped box is gone", gone.length === 0);
    const kept = await q(
      "SELECT p.party_id FROM party_placements p WHERE p.row_id = ?",
      [duplicate.id]
    );
    check(
      "teams from the dropped box moved to the survivor",
      kept.length > 0,
      `${kept.length} placements`
    );
  }
}

/* ------------------------------------------- E. optimistic-lock version */

{
  const before = await getState();
  check(
    "GET /api/parties returns a version",
    typeof before.version === "number",
    String(before.version)
  );

  const ok = await put({ parties: before.parties, version: before.version });
  check("a write with the current version succeeds", ok.status === 200, `${ok.status}`);
  check(
    "the success body carries the next version",
    ok.body.version === before.version + 1,
    `${before.version} -> ${ok.body.version}`
  );

  const stale = await put({ parties: before.parties, version: before.version });
  check("a write with a stale version is refused 409", stale.status === 409, `${stale.status}`);
  check(
    "the 409 tells the user to refresh",
    /รีเฟรช/.test(stale.body.error ?? ""),
    stale.body.error
  );

  const noVersion = await put({ parties: before.parties });
  check("a write with no version still works", noVersion.status === 200, `${noVersion.status}`);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
