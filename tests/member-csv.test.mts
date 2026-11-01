import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planMemberImport } from "../lib/rngw/member-csv";

const HEADER =
  "Id,Player,Lv.,Class,Title,Gender,Position,Gear Score,Weekly,Weekly Contribution,Total Contribution,Online Status";

function csv(...rows: string[]): string {
  return `\uFEFF${[HEADER, ...rows].join("\r\n")}\r\n`;
}

describe("planMemberImport", () => {
  test("translates the class names the game export prints", () => {
    const result = planMemberImport(
      csv(
        '1,A,92,Alithea,Pathfinder V,M,Member,1,1,1,1,[Online]',
        '2,B,92,"Night Watch",Pathfinder V,M,Member,1,1,1,1,[Online]',
        '3,C,92,Scholar,Pathfinder V,M,Member,1,1,1,1,[Online]',
        '4,D,92,Stalker,Pathfinder V,M,Member,1,1,1,1,[Online]'
      ),
      []
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.plan.rows.map((member) => member.job),
      ["Druid", "Night Walker", "Sage", "Rogue"]
    );
    assert.equal(result.plan.rejected.length, 0);
  });

  test("rejects a class the app does not know instead of guessing", () => {
    const result = planMemberImport(
      csv(
        '1,A,92,Professor,Pathfinder V,M,Member,1,1,1,1,[Online]',
        '2,B,92,Sage,Pathfinder V,M,Member,1,1,1,1,[Online]'
      ),
      []
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.rows.length, 1);
    assert.equal(result.plan.rejected.length, 1);
    assert.match(result.plan.rejected[0].reason, /Professor/);
  });

  test("adds, updates and removes against the current roster", () => {
    const result = planMemberImport(
      csv(
        '2,OldName,92,Sage,Pathfinder V,M,Member,1,1,1,1,[Online]',
        '3,NewName,92,Rogue,Pathfinder V,M,Member,1,1,1,1,[Online]'
      ),
      [
        { name: "OldName", job: "Sage", level: 91 },
        { name: "Gone", job: "Clown", level: 92 },
      ]
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.added.map((member) => member.name), ["NewName"]);
    assert.deepEqual(result.plan.updated.map((member) => member.name), ["OldName"]);
    assert.deepEqual(result.plan.removed.map((member) => member.name), ["Gone"]);
  });
});
