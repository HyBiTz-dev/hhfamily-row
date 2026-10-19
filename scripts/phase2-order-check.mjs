#!/usr/bin/env node
/**
 * Phase 2 — per-event team order, party order and member slot order.
 *
 *   PHASE2_DATABASE_URL=file:/tmp/phase2.db \
 *   PHASE2_BASE_URL=http://localhost:3311 \
 *   node scripts/phase2-order-check.mjs
 *
 * Refuses to run against anything other than a `file:` database, because it
 * reverses the order of a box and the parties tab and then reads the result
 * back. Point it at a throwaway `file:` database, never Turso; the fixture is
 * written at the start of the run.
 *
 * The writes go through the real route (PUT /api/admin/parties), so the check
 * covers `parseParties` → `saveParties` → dense per-scope positions, not just
 * the pure helpers.
 */

import { createClient } from "@libsql/client";
import process from "node:process";
import { resetFixture } from "./fixture.mjs";

process.loadEnvFile(".env.local");

const BASE = process.env.PHASE2_BASE_URL ?? "http://localhost:3000";
const url = process.env.PHASE2_DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("PHASE2_DATABASE_URL must be a file: URL (throwaway database)");
  process.exit(2);
}

const client = createClient({ url });
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;

// The phase-4 cleanup removed the seed route; the checks now own their data.
await resetFixture(BASE, client);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const scopeKey = (placement) => `${placement.event}:${placement.division}`;
const laneKey = (placement) => placement.rowId ?? "__unassigned";

/** Teams of one scope in board order: lane order, then placement position. */
function scopeOrder(parties, event, division, rowOrder) {
  const teams = parties
    .filter((party) =>
      party.placements.some(
        (placement) =>
          placement.event === event && placement.division === division
      )
    )
    .map((party, index) => ({ party, index }));

  const laneRank = new Map(rowOrder.map((row, index) => [row, index]));
  return teams.sort((a, b) => {
    const left = a.party.placements.find(
      (placement) => placement.event === event && placement.division === division
    );
    const right = b.party.placements.find(
      (placement) => placement.event === event && placement.division === division
    );
    return (
      (laneRank.get(laneKey(left)) ?? 99) -
        (laneRank.get(laneKey(right)) ?? 99) ||
      left.position - right.position ||
      a.index - b.index
    );
  });
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

const getState = async () => {
  const { body } = await api("/api/parties");
  return body;
};

const put = async (parties) => {
  const res = await api("/api/admin/parties", {
    method: "PUT",
    body: JSON.stringify({ parties }),
  });
  if (!res.ok) {
    throw new Error(`PUT failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
};

/* -------------------------------------------------------------- per-event */

/** First named box that holds at least two teams, with the scope's lane order. */
function pickBox(parties, eventRows) {
  for (const event of ["guild-war", "polarity", "guild-league"]) {
    const divisions = event === "guild-league" ? ["upper", "lower"] : [""];
    for (const division of divisions) {
      const rows = eventRows
        .filter((row) => row.event === event && row.division === division)
        .sort((a, b) => a.position - b.position)
        .map((row) => row.id);
      const rowOrder = [...rows, "__unassigned"];
      const ordered = scopeOrder(parties, event, division, rowOrder);
      const byLane = new Map();
      for (const entry of ordered) {
        const placement = entry.party.placements.find(
          (value) => value.event === event && value.division === division
        );
        const lane = laneKey(placement);
        byLane.set(lane, [...(byLane.get(lane) ?? []), entry]);
      }
      const lane = [...byLane.entries()].find(
        ([key, entries]) => key !== "__unassigned" && entries.length >= 2
      );
      if (lane) {
        return { event, division, rowOrder, lane: lane[0], ordered, byLane };
      }
    }
  }
  return null;
}

{
  let { parties: before, eventRows } = await getState();
  check("seeded parties present", before.length > 0, `${before.length} parties`);

  // Add an empty team to a real box so the reorder path has two cards to swap,
  // exactly like the UI would. The fixture already has one such box; this is
  // the fallback for a database seeded another way.
  let picked = pickBox(before, eventRows);
  if (!picked) {
    const row = eventRows.find((entry) => entry.event === "guild-war") ?? eventRows[0];
    if (row) {
      await put([
        ...before,
        {
          id: crypto.randomUUID(),
          name: "ทดสอบลำดับ",
          placements: [
            {
              event: row.event,
              division: row.division,
              rowId: row.id,
              position: Number.MAX_SAFE_INTEGER,
            },
          ],
          memberNames: [],
          updatedAt: new Date().toISOString(),
        },
      ]);
      ({ parties: before } = await getState());
      picked = pickBox(before, eventRows);
    }
  }

  check("a box with 2+ teams exists", Boolean(picked));
  if (picked) {
    const { event, division, rowOrder, lane, ordered, byLane } = picked;
    const laneTeams = byLane.get(lane);
    const reversedLane = [...laneTeams].reverse();
    const expected = reversedLane.map((entry) => entry.party.id);
    const queue = [...reversedLane];
    const newOrder = ordered.map((entry) => {
      const placement = entry.party.placements.find(
        (value) => value.event === event && value.division === division
      );
      return laneKey(placement) === lane ? queue.shift() : entry;
    });

    const positionById = new Map(
      newOrder.map((entry, position) => [entry.party.id, position])
    );
    const next = before.map((party) => {
      const position = positionById.get(party.id);
      if (position === undefined) return party;
      return {
        ...party,
        placements: party.placements.map((placement) =>
          placement.event === event && placement.division === division
            ? { ...placement, position }
            : placement
        ),
      };
    });

    await put(next);
    const { parties: after } = await getState();
    const afterLane = scopeOrder(after, event, division, rowOrder).filter(
      (entry) => {
        const placement = entry.party.placements.find(
          (value) => value.event === event && value.division === division
        );
        return laneKey(placement) === lane;
      }
    );
    check(
      "card order reverses inside one box",
      JSON.stringify(afterLane.map((entry) => entry.party.id)) ===
        JSON.stringify(expected),
      `${event}:${division} / ${lane}`
    );

    const dbRows = await q(
      "SELECT party_id, position FROM party_placements WHERE event = ? AND division = ? ORDER BY position",
      [event, division]
    );
    check(
      "placement positions stay dense per scope",
      dbRows.every((row, index) => Number(row.position) === index),
      `${dbRows.length} placements`
    );

    // A team that also plays another event must keep the other order.
    const shared = before.find(
      (party) =>
        party.placements.length > 1 &&
        party.placements.some(
          (placement) =>
            placement.event === event && placement.division === division
        )
    );
    if (shared) {
      const other = shared.placements.find(
        (placement) => !(placement.event === event && placement.division === division)
      );
      const was = other.position;
      const now = after
        .find((party) => party.id === shared.id)
        ?.placements.find(
          (placement) =>
            placement.event === other.event && placement.division === other.division
        )?.position;
      check(
        "the same team's other event keeps its position",
        was === now,
        `${other.event}: ${was} → ${now}`
      );
    }
  }
}

/* ------------------------------------------------------------ party order */

{
  const { parties: before } = await getState();
  const reversed = [...before].reverse();
  await put(reversed);
  const { parties: after } = await getState();

  check(
    "party builder order follows the array",
    JSON.stringify(after.map((party) => party.id)) ===
      JSON.stringify(reversed.map((party) => party.id))
  );
  const positions = await q(
    "SELECT id, position FROM parties ORDER BY position"
  );
  check(
    "parties.position is dense after reorder",
    positions.every((row, index) => Number(row.position) === index)
  );

  // Put the original order back so the database is left as it was.
  await put(before);
}

/* ------------------------------------------------------------ member slot */

{
  const { parties } = await getState();
  const seats = await q(
    "SELECT party_id, member_name, slot FROM party_members ORDER BY party_id, slot"
  );
  const mismatch = parties.find((party) => {
    const stored = seats
      .filter((seat) => seat.party_id === party.id)
      .map((seat) => seat.member_name);
    return JSON.stringify(stored) !== JSON.stringify(party.memberNames);
  });
  check(
    "memberNames is read in party_members.slot order",
    !mismatch,
    mismatch ? mismatch.id : `${parties.length} parties`
  );
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
