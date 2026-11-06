import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPEND_POSITION,
  UNASSIGNED_ROW,
  derivePartyContent,
  eventRowsFor,
  partiesForDivision,
  rowsForScope,
  setPartyPlacement,
  sortTeamsForScope,
  withoutPartyPlacement,
  type EventCategoryId,
} from "../lib/rngw/categories";
import type { EventRow, Party, PartyPlacement } from "../lib/rngw/types";

function placed(overrides: Partial<PartyPlacement> = {}): PartyPlacement {
  return {
    event: "siege",
    division: "",
    rowId: null,
    position: 0,
    ...overrides,
  };
}

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: "p1",
    name: "ทีม 1",
    placements: [],
    memberNames: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "r1",
    event: "siege",
    division: "",
    name: "กล่อง",
    position: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------ derivePartyContent */

describe("derivePartyContent", () => {
  const rows = [
    row({ id: "war", event: "siege", division: "", name: "ทีมสเกา", position: 1 }),
    row({
      id: "upper",
      event: "guild-league",
      division: "upper",
      name: "เลนบน",
      position: 0,
    }),
  ];

  test("orders events canonically, not in placement order", () => {
    const content = derivePartyContent(
      party({
        placements: [
          placed({
            event: "guild-league",
            division: "upper",
            rowId: "upper",
            position: 0,
          }),
          placed({ event: "siege", rowId: "war", position: 0 }),
        ],
      }),
      rows
    );

    assert.equal(
      content,
      "Siege ทีมสเกา + Guild League ลีคหลัก เลนบน"
    );
  });

  test("falls back to the event label when the box was deleted", () => {
    const content = derivePartyContent(
      party({ placements: [placed({ rowId: "deleted-box" })] }),
      rows
    );

    assert.equal(content, "Siege");
  });

  test("keeps the division label when a league team has no box", () => {
    const content = derivePartyContent(
      party({
        placements: [
          placed({ event: "guild-league", division: "lower", rowId: null }),
        ],
      }),
      rows
    );

    assert.equal(content, "Guild League ลีครอง");
  });

  test("falls back to the event label for a missing or unknown division", () => {
    assert.equal(
      derivePartyContent(
        party({ placements: [placed({ event: "guild-league", division: "" })] }),
        rows
      ),
      "Guild League"
    );
    assert.equal(
      derivePartyContent(
        party({
          placements: [
            placed({ event: "guild-league", division: "middle" }),
          ],
        }),
        rows
      ),
      "Guild League"
    );
  });

  test("ignores an event this site does not know and joins nothing with a stray +", () => {
    assert.equal(
      derivePartyContent(
        party({
          placements: [
            placed({ event: "boss" as EventCategoryId }),
            placed({ event: "guild-league", division: "upper", rowId: "upper" }),
          ],
        }),
        rows
      ),
      "Guild League ลีคหลัก เลนบน"
    );
    assert.equal(derivePartyContent(party({ placements: [] }), rows), "");
  });
});

/* ------------------------------------------------------- order helpers */

describe("sortTeamsForScope", () => {
  test("sorts by the placement of that event, missing placements last", () => {
    const late = party({ id: "late", placements: [placed({ position: 2 })] });
    const early = party({ id: "early", placements: [placed({ position: 1 })] });
    const unplaced = party({ id: "unplaced", placements: [] });

    assert.deepEqual(
      sortTeamsForScope([late, unplaced, early], "siege").map(
        (entry) => entry.id
      ),
      ["early", "late", "unplaced"]
    );
  });

  test("keeps incoming order on equal positions and does not mutate the list", () => {
    const first = party({ id: "first", placements: [placed({ position: 1 })] });
    const second = party({ id: "second", placements: [placed({ position: 1 })] });
    const teams = [first, second];

    assert.deepEqual(
      sortTeamsForScope(teams, "siege").map((entry) => entry.id),
      ["first", "second"]
    );
    assert.deepEqual(teams, [first, second]);
  });
});

describe("eventRowsFor / rowsForScope", () => {
  const rows = [
    row({ id: "war-b", event: "siege", name: "B", position: 1 }),
    row({ id: "upper", event: "guild-league", division: "upper", name: "บน" }),
    row({ id: "war-a", event: "siege", name: "A", position: 0 }),
    row({ id: "lower", event: "guild-league", division: "lower", name: "ล่าง" }),
  ];

  test("filters one scope and sorts by position", () => {
    assert.deepEqual(
      eventRowsFor(rows, "siege", null).map((entry) => entry.id),
      ["war-a", "war-b"]
    );
    assert.deepEqual(
      eventRowsFor(rows, "guild-league", "lower").map((entry) => entry.id),
      ["lower"]
    );
  });

  test("ends every scope with the virtual parking row", () => {
    const lanes = rowsForScope(rows, "siege", null);

    assert.deepEqual(
      lanes.map((lane) => lane.id),
      ["war-a", "war-b", UNASSIGNED_ROW.id]
    );
    assert.equal(lanes.at(-1)?.suffix, "");
    assert.equal(lanes[0].suffix, "A");
  });
});

/* ----------------------------------------------------- placement edits */

describe("setPartyPlacement / withoutPartyPlacement", () => {
  test("replaces only that event and appends the moved team", () => {
    const current = party({
      placements: [
        placed({ rowId: "old", position: 1 }),
        placed({ event: "guild-league", division: "upper", rowId: "upper", position: 4 }),
      ],
    });
    const next = setPartyPlacement(
      current,
      "siege",
      "",
      "new-box"
    );

    assert.deepEqual(next.placements, [
      current.placements[1],
      {
        event: "siege",
        division: "",
        rowId: "new-box",
        position: APPEND_POSITION,
      },
    ]);
    assert.deepEqual(current.placements[0], placed({ rowId: "old", position: 1 }));
  });

  test("adds an event that was not there before", () => {
    const current = party({ placements: [placed({ rowId: "war" })] });
    const next = setPartyPlacement(current, "guild-league", "upper", null);

    assert.deepEqual(
      next.placements.map((placement) => placement.event),
      ["siege", "guild-league"]
    );
    assert.equal(next.placements[1].division, "upper");
  });

  test("removes one event and leaves the rest alone", () => {
    const war = placed({ rowId: "war" });
    const league = placed({ event: "guild-league", division: "upper" });
    const next = withoutPartyPlacement(party({ placements: [war, league] }), "siege");

    assert.deepEqual(next.placements, [league]);
  });
});

describe("partiesForDivision", () => {
  test("matches the division of that event only", () => {
    const upper = party({
      id: "upper",
      placements: [placed({ event: "guild-league", division: "upper" })],
    });
    const lower = party({
      id: "lower",
      placements: [placed({ event: "guild-league", division: "lower" })],
    });
    const war = party({ id: "war", placements: [placed({ rowId: "war" })] });

    assert.deepEqual(
      partiesForDivision([upper, lower, war], "guild-league", "upper").map(
        (entry) => entry.id
      ),
      ["upper"]
    );
  });
});
