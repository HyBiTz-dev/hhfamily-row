import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPEND_POSITION,
  type EventCategoryId,
} from "../lib/rngw/categories";
import type {
  EventRow,
  MemberStatus,
  Party,
  PartyPlacement,
} from "../lib/rngw/types";
import {
  dedupeEventRows,
  normalizePlacements,
  parseEventRows,
  parseParties,
  partyLabelOptions,
  planRandomParties,
  swapMemberSeats,
  togglePartyLabel,
} from "../lib/party";

function placed(overrides: Partial<PartyPlacement> = {}): PartyPlacement {
  return {
    event: "guild-war",
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
    event: "guild-war",
    division: "",
    name: "กล่อง",
    position: 0,
    ...overrides,
  };
}

function member(overrides: Partial<MemberStatus> = {}): MemberStatus {
  return {
    name: "A",
    job: "Clown",
    level: 1,
    status: "present",
    ...overrides,
  };
}

/* ------------------------------------------------------- member order */

describe("swapMemberSeats", () => {
  test("swaps two seats and leaves everyone else where they were", () => {
    assert.deepEqual(
      swapMemberSeats(["A", "B", "C", "D"], "A", "C"),
      ["C", "B", "A", "D"]
    );
  });

  test("swapping with the neighbour is the one-step move the arrows make", () => {
    assert.deepEqual(swapMemberSeats(["A", "B", "C"], "B", "A"), ["B", "A", "C"]);
  });

  test("leaves the array alone when a name is unknown or the same", () => {
    const names = ["A", "B"];
    assert.equal(swapMemberSeats(names, "A", "A"), names);
    assert.equal(swapMemberSeats(names, "A", "missing"), names);
    assert.equal(swapMemberSeats(names, "missing", "B"), names);
  });

  test("does not mutate the input", () => {
    const names = ["A", "B", "C"];
    swapMemberSeats(names, "A", "B");
    assert.deepEqual(names, ["A", "B", "C"]);
  });
});

/* ------------------------------------------------------- label chips */

describe("togglePartyLabel", () => {
  const war = partyLabelOptions().find((option) => option.id === "guild-war")!;
  const upper = partyLabelOptions().find(
    (option) => option.id === "guild-league:upper"
  )!;
  const lower = partyLabelOptions().find(
    (option) => option.id === "guild-league:lower"
  )!;

  test("adds one event without touching the boxes of the others", () => {
    const current = [placed({ rowId: "war-box", position: 4 })];
    const next = togglePartyLabel(current, upper);

    assert.equal(next.length, 2);
    assert.deepEqual(next[0], current[0]);
    assert.deepEqual(next[1], {
      event: "guild-league",
      division: "upper",
      rowId: null,
      position: APPEND_POSITION,
    });
  });

  test("removes only the matching event and division", () => {
    const current = [
      placed({ rowId: "war-box" }),
      placed({ event: "guild-league", division: "upper", rowId: "upper-box" }),
    ];

    assert.deepEqual(togglePartyLabel(current, upper), [current[0]]);
  });

  test("switching division replaces the league placement and clears its box", () => {
    const current = [
      placed({ rowId: "war-box" }),
      placed({ event: "guild-league", division: "upper", rowId: "upper-box" }),
    ];
    const next = togglePartyLabel(current, lower);

    assert.deepEqual(next, [
      current[0],
      {
        event: "guild-league",
        division: "lower",
        rowId: null,
        position: APPEND_POSITION,
      },
    ]);
  });

  test("unticking one event keeps every other event untouched", () => {
    const current = [
      placed({ event: "polarity", rowId: "polarity-box" }),
      placed({ rowId: "war-box" }),
    ];
    const next = togglePartyLabel(current, war);

    assert.deepEqual(next, [current[0]]);
  });
});

/* ------------------------------------------------------------ parseParties */

describe("parseParties", () => {
  test("rejects input that is not a party array", () => {
    assert.deepEqual(parseParties("not json"), []);
    assert.deepEqual(parseParties("{}"), []);
    assert.deepEqual(parseParties("[null, 3, {}]"), []);
    assert.deepEqual(parseParties('[{"name":"no id"}]'), []);
    assert.deepEqual(parseParties('[{"id":"p1"}]'), []);
  });

  test("keeps one placement per event, the last one winning", () => {
    const [parsed] = parseParties(
      JSON.stringify([
        {
          id: "p1",
          name: "ทีม",
          placements: [
            { event: "guild-war", rowId: "first", position: 1 },
            { event: "guild-war", rowId: "second", position: 2 },
          ],
        },
      ])
    );

    assert.deepEqual(parsed.placements, [
      {
        event: "guild-war",
        division: "",
        rowId: "second",
        position: 2,
      },
    ]);
  });

  test("drops placements with unknown events or divisions", () => {
    const [parsed] = parseParties(
      JSON.stringify([
        {
          id: "p1",
          name: "ทีม",
          placements: [
            { event: "boss", division: "" },
            { event: "guild-war", division: "upper" },
            { event: "guild-league", division: "middle" },
            { event: "guild-league", division: "" },
            { event: "guild-league", division: "upper" },
            { event: "polarity", division: "" },
          ],
        },
      ])
    );

    assert.deepEqual(
      parsed.placements.map((placement) => placement.event),
      ["guild-league", "polarity"]
    );
    assert.deepEqual(parsed.placements[0], {
      event: "guild-league",
      division: "upper",
      rowId: null,
      position: APPEND_POSITION,
    });
  });

  test("dedupes members, drops blanks, and accepts only a real true lock", () => {
    const parsed = parseParties(
      JSON.stringify([
        {
          id: "locked",
          name: "ล็อค",
          memberNames: ["A", "A", "", 7, "B"],
          locked: true,
        },
        { id: "string-lock", name: "ไม่ล็อค", locked: "true" },
        { id: "number-lock", name: "ไม่ล็อค", locked: 1 },
      ])
    );

    assert.deepEqual(parsed[0].memberNames, ["A", "B"]);
    assert.equal(parsed[0].locked, true);
    assert.equal(parsed[1].locked, false);
    assert.equal(parsed[2].locked, false);
    assert.equal(parsed[0].content, undefined);
  });

  test("defaults a missing row id and position instead of keeping junk", () => {
    const [parsed] = parseParties(
      JSON.stringify([
        {
          id: "p1",
          name: "ทีม",
          placements: [
            { event: "guild-war", rowId: "", position: Number.NaN },
            { event: "polarity", rowId: 42, position: "first" },
          ],
        },
      ])
    );

    for (const placement of parsed.placements) {
      assert.equal(placement.rowId, null);
      assert.equal(placement.position, APPEND_POSITION);
    }
  });
});

/* ---------------------------------------------------------- parseEventRows */

describe("parseEventRows", () => {
  test("rejects input that is not a row array", () => {
    assert.deepEqual(parseEventRows("nope"), []);
    assert.deepEqual(parseEventRows("{}"), []);
    assert.deepEqual(parseEventRows("[null, 2, {}]"), []);
    assert.deepEqual(parseEventRows('[{"id":"r1","event":"guild-war"}]'), []);
  });

  test("trims the name and defaults a missing position", () => {
    const [parsed] = parseEventRows(
      JSON.stringify([
        { id: "r1", event: "guild-war", division: "", name: "  ทีมสเกา  " },
      ])
    );

    assert.deepEqual(parsed, {
      id: "r1",
      event: "guild-war",
      division: "",
      name: "ทีมสเกา",
      position: 0,
    });
  });

  test("drops blank names, unknown events, and the wrong division shape", () => {
    assert.deepEqual(
      parseEventRows(
        JSON.stringify([
          { id: "blank", event: "guild-war", name: "   " },
          { id: "boss", event: "boss", name: "กล่อง" },
          { id: "war-div", event: "guild-war", division: "upper", name: "กล่อง" },
          { id: "league-empty", event: "guild-league", division: "", name: "กล่อง" },
          { id: "league-bad", event: "guild-league", division: "middle", name: "กล่อง" },
          { id: "league-ok", event: "guild-league", division: "upper", name: "กล่อง" },
        ])
      ).map((entry) => entry.id),
      ["league-ok"]
    );
  });

  test("does not dedupe: that is the write gate's job", () => {
    const rows = parseEventRows(
      JSON.stringify([
        { id: "same", event: "guild-war", name: "A", position: 1 },
        { id: "same", event: "guild-war", name: "A", position: 2 },
      ])
    );

    assert.equal(rows.length, 2);
  });
});

/* ---------------------------------------------------------- dedupeEventRows */

describe("dedupeEventRows", () => {
  test("keeps the first row of a repeated id and remaps to it", () => {
    const { rows, remap } = dedupeEventRows([
      row({ id: "same", name: "แรก" }),
      row({ id: "same", name: "หลัง" }),
    ]);

    assert.deepEqual(rows.map((entry) => entry.name), ["แรก"]);
    assert.equal(remap.get("same"), "same");
  });

  test("folds names inside one scope, but not across scopes", () => {
    const { rows, remap } = dedupeEventRows([
      row({ id: "a", name: "ทีม A" }),
      row({ id: "b", name: " ทีม a " }),
      row({ id: "c", event: "polarity", name: "ทีม A" }),
    ]);

    assert.deepEqual(rows.map((entry) => entry.id), ["a", "c"]);
    assert.equal(remap.get("b"), "a");
  });

  test("uses event and division together as the scope", () => {
    const { rows } = dedupeEventRows([
      row({ id: "upper", event: "guild-league", division: "upper", name: "A" }),
      row({ id: "lower", event: "guild-league", division: "lower", name: "A" }),
    ]);

    assert.equal(rows.length, 2);
  });
});

/* ------------------------------------------------------- normalizePlacements */

describe("normalizePlacements", () => {
  const rows = [
    row({ id: "war-box", event: "guild-war", division: "", name: "วอร์" }),
    row({ id: "upper-box", event: "guild-league", division: "upper", name: "บน" }),
    row({ id: "polarity-box", event: "polarity", division: "", name: "โพล" }),
  ];

  test("drops a row that belongs to another event and follows a remap", () => {
    const next = normalizePlacements(
      party({
        placements: [
          placed({ event: "guild-war", rowId: "upper-box" }),
          placed({
            event: "guild-league",
            division: "upper",
            rowId: "upper-box",
          }),
          placed({ event: "polarity", rowId: "dropped-box" }),
        ],
      }),
      rows,
      new Map([["dropped-box", "war-box"]])
    );
    const byEvent = new Map(next.map((entry) => [entry.event, entry]));

    assert.equal(byEvent.get("guild-war")?.rowId, null);
    assert.equal(byEvent.get("guild-league")?.rowId, "upper-box");
    // The remap points at a Guild War row, which cannot hold a Polarity team.
    assert.equal(byEvent.get("polarity")?.rowId, null);
  });

  test("can follow a chained remap without looping", () => {
    const [next] = normalizePlacements(
      party({
        placements: [placed({ rowId: "old-a" })],
      }),
      rows,
      new Map([
        ["old-a", "old-b"],
        ["old-b", "war-box"],
      ])
    );

    assert.equal(next.rowId, "war-box");
  });

  test("clears a stale row id and normalises a non-league division", () => {
    const [next] = normalizePlacements(
      party({
        placements: [
          placed({ event: "guild-war", division: "upper", rowId: "war-box" }),
        ],
      }),
      rows,
      new Map()
    );

    assert.deepEqual(next, {
      event: "guild-war",
      division: "",
      rowId: "war-box",
      position: 0,
    });
  });

  test("drops unknown events and invalid league divisions", () => {
    const next = normalizePlacements(
      party({
        placements: [
          placed({ event: "boss" as EventCategoryId }),
          placed({ event: "guild-league", division: "middle" }),
          placed({ event: "polarity", rowId: null }),
        ],
      }),
      rows,
      new Map()
    );

    assert.deepEqual(next.map((entry) => entry.event), ["polarity"]);
  });

  test("keeps one placement per event, the last one winning", () => {
    const next = normalizePlacements(
      party({
        placements: [
          placed({ event: "guild-war", rowId: "war-box" }),
          placed({ event: "guild-war", rowId: null }),
        ],
      }),
      rows,
      new Map()
    );

    assert.equal(next.length, 1);
    assert.equal(next[0].rowId, null);
  });
});

/* -------------------------------------------------------- planRandomParties */

describe("planRandomParties", () => {
  const random = () => 0.5;

  test("fills teams of at most five, never reusing someone already placed", () => {
    const members = [
      member({ name: "Taken" }),
      ...Array.from({ length: 6 }, (_, index) =>
        member({ name: `Free ${index + 1}` })
      ),
    ];
    const existing = [party({ id: "old", memberNames: ["Taken"] })];
    const plan = planRandomParties(members, existing, random);
    const names = plan.parties.flatMap((entry) => entry.memberNames);

    assert.equal(plan.parties.length, 1);
    assert.equal(names.length, 5);
    assert.ok(!names.includes("Taken"));
    assert.equal(plan.placed.length, 5);
    assert.equal(plan.leftOver.length, 1);
    assert.ok(!names.includes(plan.leftOver[0]));
  });

  test("gives a team a healer and one tank class when both are free", () => {
    const members = [
      member({ name: "Priest", job: "High Priest" }),
      member({ name: "Knight", job: "Lord Knight" }),
      ...Array.from({ length: 4 }, (_, index) =>
        member({ name: `Fill ${index + 1}`, job: "Clown" })
      ),
    ];
    const plan = planRandomParties(members, [], random);
    const [first] = plan.parties;

    assert.equal(first.memberNames.length, 5);
    assert.ok(first.memberNames.includes("Priest"));
    assert.ok(first.memberNames.includes("Knight"));
    assert.equal(plan.leftOver.length, 1);
  });

  test("fills today's players first and names teams after the existing ones", () => {
    const members = [
      ...Array.from({ length: 5 }, (_, index) =>
        member({ name: `Present ${index + 1}`, status: "present" })
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        member({ name: `Away ${index + 1}`, status: "leave" })
      ),
    ];
    const plan = planRandomParties(
      members,
      [party({ id: "old-1" }), party({ id: "old-2" })],
      random
    );
    const firstTeam = plan.parties[0].memberNames;

    assert.equal(plan.parties[0].name, "ปาร์ตี้ 3");
    assert.deepEqual(
      firstTeam.slice().sort(),
      ["Present 1", "Present 2", "Present 3", "Present 4", "Present 5"]
    );
    assert.ok(
      plan.parties.every((entry) =>
        entry.placements.some(
          (placement) =>
            placement.event === "guild-league" && placement.division === "lower"
        )
      )
    );
    assert.ok(
      plan.parties.every((entry) =>
        entry.placements.some((placement) => placement.event === "guild-war")
      )
    );
    assert.ok(
      plan.parties.every((entry) =>
        entry.placements.some((placement) => placement.event === "polarity")
      )
    );
  });

  test("leaves a lone player out instead of making a team of one", () => {
    const members = [
      ...Array.from({ length: 5 }, (_, index) =>
        member({ name: `Player ${index + 1}` })
      ),
      member({ name: "Lonely" }),
    ];
    const plan = planRandomParties(members, [], random);

    assert.equal(plan.parties.length, 1);
    assert.equal(plan.placed.length, 5);
    assert.equal(plan.leftOver.length, 1);
    assert.ok(!plan.placed.includes(plan.leftOver[0]));
  });

  test("returns an empty plan when nobody is free", () => {
    const plan = planRandomParties([], [party()], random);

    assert.deepEqual(plan, { parties: [], placed: [], leftOver: [] });
  });
});
