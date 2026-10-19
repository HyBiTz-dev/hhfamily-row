/**
 * Reads the guild's roster export into members.
 *
 * The guild master exports the roster from the game as CSV and wants the app to
 * catch up with it in one action: names and levels and classes that moved, and
 * people who left the guild gone from the roster. Nothing else. Attendance is a
 * ledger this app owns and the game knows nothing about it, so it is never part
 * of the file.
 *
 * Two rules make this safe to run against the real roster:
 *
 *   1. **A row the app cannot read stops the whole import.** The import deletes
 *      everyone missing from the file, so a file that silently lost 30 rows to a
 *      typo'd class name would take 30 people off the guild with it. The
 *      preview lists every rejected row instead of writing anything, and the
 *      file is fixed rather than the guild.
 *   2. **The header decides what each column means.** `Player`, `Lv.` and
 *      `Class` are located by name, so the eleven other columns the game
 *      exports (`Gear Score`, `Weekly Contribution`, `Online Status`, …) are
 *      ignored rather than guessed at by position — the game has added
 *      columns before and will again.
 *
 * Pure functions with no React and no database, so the rules above can be read
 * and tested on their own.
 */

import { isJobName } from "./jobs";
import type { Member } from "./types";

/** Header cells the file must have, matched after trimming. */
const COLUMNS = { name: "Player", level: "Lv.", job: "Class" } as const;

/**
 * Class names the game export writes that this app stores under another name.
 *
 * The export prints the translated branch of two classes — Alithea is the
 * Druid line, Night Watch is the Night Walker line — while the guild calls them
 * Druid and Night Walker. These are the names `jobs.ts` holds and the names the
 * roster shows, so the file is translated on the way in rather than the app
 * carrying two spellings of the same class.
 *
 * Not aliases in `JOBS`: a class that answers to two names is a class whose
 * name can drift again, and `isJobName()` is meant to be the one gate.
 */
const EXPORT_JOB_NAMES: Record<string, string> = {
  Alithea: "Druid",
  "Night Watch": "Night Walker",
};

/**
 * Longer than any character name the game allows, and the same limit the roster
 * form uses. A name past this is a file that has shifted its columns, not a
 * member.
 */
const MAX_NAME_LENGTH = 40;

/** A file this big is a sign the wrong export was picked. */
export const MAX_IMPORT_ROWS = 500;

/** A row the app will not write, and why. The line number is the file's own. */
export interface CsvRejection {
  /** 1-based line in the file, so it can be found and fixed. */
  line: number;
  /** Whatever the name cell said, even when the name itself is the problem. */
  name: string;
  reason: string;
}

/** What an import would do, computed without touching the database. */
export interface MemberCsvPlan {
  /** Every row to write, in file order. Never partial — see rule 1 above. */
  rows: Member[];
  rejected: CsvRejection[];
  /** In the file, not on the roster yet. */
  added: Member[];
  /** On the roster, and their class or level differs from the file. */
  updated: Member[];
  /** On the roster with the same class and level the file gives. */
  unchanged: Member[];
  /** On the roster and missing from the file — the import removes these. */
  removed: Member[];
}

export type MemberCsvParse =
  | { ok: true; plan: MemberCsvPlan }
  | { ok: false; error: string };

/**
 * Reads a roster export against the current roster.
 *
 * `current` is the roster as it is now, so the plan can say which rows add a
 * member, which edit one, and — the part that needs the current state — who
 * would be removed for not being in the file.
 */
export function planMemberImport(text: string, current: Member[]): MemberCsvParse {
  const table = readCsv(text.replace(/^\uFEFF/, ""));
  if (table.length === 0) {
    return { ok: false, error: "ไฟล์ว่างเปล่า" };
  }

  const header = table[0].cells;
  const at = {
    name: header.indexOf(COLUMNS.name),
    level: header.indexOf(COLUMNS.level),
    job: header.indexOf(COLUMNS.job),
  };
  const missing = (
    [
      [COLUMNS.name, at.name],
      [COLUMNS.level, at.level],
      [COLUMNS.job, at.job],
    ] as const
  )
    .filter(([, index]) => index < 0)
    .map(([label]) => label);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `ไฟล์นี้ไม่มีคอลัมน์ ${missing.join(", ")} — ต้องเป็นไฟล์ที่ export รายชื่อสมาชิกจากเกม`,
    };
  }

  const body = table.slice(1).filter((record) => record.cells.some((cell) => cell.trim() !== ""));
  if (body.length === 0) {
    return { ok: false, error: "ไฟล์นี้มีแค่หัวคอลัมน์ ไม่มีสมาชิกให้นำเข้า" };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `ไฟล์นี้มี ${body.length} แถว มากกว่าที่รับได้ (${MAX_IMPORT_ROWS}) — น่าจะเปิดผิดไฟล์`,
    };
  }

  const rows: Member[] = [];
  const rejected: CsvRejection[] = [];
  const seen = new Map<string, number>();

  body.forEach(({ cells, line }) => {
    const name = (cells[at.name] ?? "").trim();
    const rawLevel = (cells[at.level] ?? "").trim();
    const rawJob = (cells[at.job] ?? "").trim();

    if (!name) {
      rejected.push({ line, name: "", reason: "ไม่มีชื่อตัวละคร" });
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      rejected.push({
        line,
        name: `${name.slice(0, 20)}…`,
        reason: `ชื่อยาว ${name.length} ตัวอักษร เกิน ${MAX_NAME_LENGTH}`,
      });
      return;
    }
    const duplicate = seen.get(name);
    if (duplicate !== undefined) {
      rejected.push({ line, name, reason: `ชื่อซ้ำกับแถวที่ ${duplicate} ในไฟล์เดียวกัน` });
      return;
    }

    const job = readJob(rawJob);
    if (!job) {
      rejected.push({
        line,
        name,
        reason: `คลาส "${rawJob || "(ว่าง)"}" ไม่ใช่คลาสที่ระบบรู้จัก`,
      });
      return;
    }

    // `Number("")` is 0, which is also what the roster form stores for a blank
    // level, so an empty cell is the same thing here rather than a rejection.
    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 0) {
      rejected.push({
        line,
        name,
        reason: `เลเวล "${rawLevel || "(ว่าง)"}" ไม่ใช่ตัวเลข`,
      });
      return;
    }

    seen.set(name, line);
    rows.push({ name, job, level });
  });

  if (rows.length === 0) {
    return {
      ok: false,
      error: `อ่านไฟล์นี้ไม่ได้เลย — ${rejected.length} แถว ไม่มีแถวไหนถูกต้องสักแถว`,
    };
  }

  const before = new Map(current.map((member) => [member.name, member]));
  const after = new Set(rows.map((member) => member.name));

  const added: Member[] = [];
  const updated: Member[] = [];
  const unchanged: Member[] = [];
  for (const member of rows) {
    const was = before.get(member.name);
    if (!was) added.push(member);
    // The class is compared, not the note: the export carries no note, so
    // writing an empty one would wipe whatever the guild master typed here.
    else if (was.job === member.job && was.level === member.level) unchanged.push(member);
    else updated.push(member);
  }

  const removed = current.filter((member) => !after.has(member.name));

  return { ok: true, plan: { rows, rejected, added, updated, unchanged, removed } };
}

/**
 * The class as this app stores it, or null when the file names one the app does
 * not have.
 */
function readJob(raw: string): string | null {
  if (isJobName(raw)) return raw;
  const translated = EXPORT_JOB_NAMES[raw];
  return translated && isJobName(translated) ? translated : null;
}

/** One CSV record and the line it starts on, so a rejection can be found. */
type CsvRecord = { cells: string[]; line: number };

/**
 * Splits CSV text into records.
 *
 * RFC 4180, not `split(",")`: the game wraps a field in quotes whenever it
 * contains a comma or a line break, and a character name may hold either. The
 * file the guild exports has no quotes at all, which is exactly why a naive
 * split would look correct until the day it is not.
 *
 * Each record remembers the line it started on. A quoted field may span lines,
 * so counting records is not counting lines, and telling the guild master "แถวที่
 * 87 เสีย" has to mean line 87 of the file they exported.
 */
function readCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let open = false;
  let startLine = 1;
  let line = 1;

  const endRow = () => {
    cells.push(field);
    records.push({ cells, line: startLine });
    cells = [];
    field = "";
    open = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') {
        field += char;
        if (char === "\n") line++;
      } else if (text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      if (!open) startLine = line;
      quoted = true;
      open = true;
    } else if (char === ",") {
      if (!open) startLine = line;
      cells.push(field);
      field = "";
      open = true;
    } else if (char === "\n") {
      line++;
      if (open) endRow();
      else startLine = line;
    } else if (char === "\r") {
      // Excel writes CRLF. The \n of the pair ends the row; a lone \r does too.
      if (text[index + 1] === "\n") index++;
      line++;
      if (open) endRow();
      else startLine = line;
    } else {
      if (!open) startLine = line;
      field += char;
      open = true;
    }
  }

  // The last line of a file usually has no newline after it.
  if (open) endRow();

  return records;
}
