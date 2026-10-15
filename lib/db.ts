import "server-only";

/**
 * Turso (libSQL) backend — remote SQLite over HTTP.
 *
 * This file is the only place in the app that talks to the database. Every API
 * route goes through the functions exported below, and no component ever sees
 * a row: they all receive `Member` / `AttendanceRow` / `Party` objects. That
 * boundary is what made it possible to swap Google Sheets out from under the
 * app without touching a single page.
 *
 *   members     the roster. The guild master can also edit it from the app,
 *               which is why writes here carry an admin session.
 *
 *   attendance  append-only ledger, one row per submission. Never updated in
 *               place — see lib/rngw/attendance.ts. Open: members submit
 *               without a PIN, since the worst they can do is add a status row.
 *
 *   parties     party drafts, written only by the admin.
 *
 * Why a hosted database and not a SQLite file: Vercel runs each request as a
 * serverless function on a throwaway instance with a read-only filesystem, so a
 * `.db` file would be invisible to the next request and lost when the instance
 * is recycled. Turso is a real SQLite server, so the same SQL works locally and
 * in production.
 *
 * Ordering is stored, not incidental. `position` on members and parties carries
 * what row order used to carry in the spreadsheet — parties are reordered by the
 * guild master (`applyRowOrder` rewrites the whole list to change it), and
 * `seq` on attendance makes "the later submission wins" deterministic instead
 * of depending on how the server returned the rows.
 */

import { createClient, type Client, type InStatement, type Row } from "@libsql/client";
import type { AttendanceRow, AttendanceStatus, Member, Party } from "@/lib/rngw/types";
import { isAttendanceStatus } from "@/lib/rngw/types";

export class DbConfigError extends Error {}

/* ------------------------------------------------------------------- client */

/**
 * A `file:` URL makes the app run against a local SQLite file, so `npm run dev`
 * works before a Turso database exists. Production uses `libsql://…`.
 */
function databaseUrl(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new DbConfigError(
      "Missing TURSO_DATABASE_URL — ยังไม่ได้ตั้งค่าฐานข้อมูล " +
        "(ดู docs/turso-setup.md)"
    );
  }
  return url;
}

let client: Client | null = null;

/**
 * One client per instance. Serverless instances are reused for many requests, so
 * this keeps the HTTP agent around instead of reconnecting every call.
 */
function db(): Client {
  if (client) return client;

  const url = databaseUrl();
  // A file: URL has no auth token and libSQL rejects an empty string as one.
  const authToken = url.startsWith("file:")
    ? undefined
    : process.env.TURSO_AUTH_TOKEN || undefined;

  if (!authToken && !url.startsWith("file:")) {
    throw new DbConfigError(
      "Missing TURSO_AUTH_TOKEN — ไม่มีโทเคนหมายของฐานข้อมูล " +
        "(ดู docs/turso-setup.md)"
    );
  }

  client = createClient({ url, authToken });
  return client;
}

/* ------------------------------------------------------------------- schema */

/**
 * Idempotent DDL, applied on demand rather than by a migration step.
 *
 * This used to be a spreadsheet where the header row was the schema and
 * `ensurePartiesColumns` bolted on a new column when the sheet predated it. A
 * real database can just create what is missing, so the columns below are the
 * whole contract. Adding one later is still an `ALTER TABLE … ADD COLUMN` here.
 *
 * `members.active` is gone: archiving a member (`active = 0`) only ever existed
 * to keep someone off the roster without touching the ledger, and leaving the
 * guild is now the delete button in the member tab — same "no data kept"
 * decision, one action instead of two. Databases created before that still
 * carry the column; `dropBenchedMembers` empties it once and nothing reads it
 * again.
 */
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS members (
     name     TEXT PRIMARY KEY,
     -- The class NAME ("Paladin"), not an id: this table is read and hand-edited
     -- by people, and a number says nothing to them. See jobs.ts for what a
     -- rename there costs.
     job      TEXT NOT NULL,
     level    INTEGER NOT NULL DEFAULT 0,
     note     TEXT,
     position INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS members_by_position ON members(position)`,

  // Append-only. `seq` is the submission order — the sheet used row order for
  // the same thing, and `latestByMember` breaks same-millisecond ties by "the
  // later row in the list wins", so the read has to hand rows back in seq order.
  `CREATE TABLE IF NOT EXISTS attendance (
     seq          INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL,
     date         TEXT NOT NULL,
     status       TEXT NOT NULL CHECK (status IN ('present', 'leave', 'unknown')),
     note         TEXT,
     submitted_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS attendance_by_date ON attendance(date)`,
  `CREATE INDEX IF NOT EXISTS attendance_by_member ON attendance(name, date, submitted_at)`,

  `CREATE TABLE IF NOT EXISTS parties (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     content    TEXT,
     -- memberNames as a JSON array: the sheet joined them with newlines, which
     -- meant a name containing a newline could not survive a round trip.
     members    TEXT NOT NULL DEFAULT '[]',
     updated_at TEXT NOT NULL,
     locked     INTEGER NOT NULL DEFAULT 0,
     position   INTEGER NOT NULL DEFAULT 0
   )`,
];

const MISSING_TABLE = /no such table/i;

let schemaReady: Promise<void> | null = null;
let cleanupReady: Promise<void> | null = null;

/**
 * Runs `statements`, creating the tables first if this is the first call.
 *
 * Lazy rather than a migration step because there is no build step to hang it
 * off on Vercel: every cold start is a fresh process with no memory of what ran
 * before. `CREATE TABLE IF NOT EXISTS` is a no-op once the tables exist, and the
 * cost of the extra round trip is paid once per instance rather than per query.
 *
 * `dropBenchedMembers` runs first, and unconditionally, because the
 * missing-table path never fires for a database that already has its tables —
 * which is exactly the database holding the rows that cleanup is for.
 */
async function run(statements: InStatement[]): Promise<Row[][]> {
  await dropBenchedMembers();

  try {
    const results = await db().batch(statements, "write");
    return results.map((result) => result.rows);
  } catch (error) {
    if (!MISSING_TABLE.test(String(error))) throw error;

    await createSchema();
    const results = await db().batch(statements, "write");
    return results.map((result) => result.rows);
  }
}

function createSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = db()
    .batch(SCHEMA.map((sql) => ({ sql })), "write")
    .then(() => undefined)
    .catch((error: unknown) => {
      // A failed attempt is not a schema: let the next call try again rather
      // than replaying this error forever.
      schemaReady = null;
      throw error;
    });

  return schemaReady;
}

/**
 * Deletes every archived member and their attendance rows, once per instance.
 *
 * Archiving used to be `active = 0` with a "คืนสถานะ" button to undo it. The
 * guild master asked for that whole path to go away, so the archived rows are
 * treated exactly like the delete button treats a member: gone, history and all.
 *
 * Two reads before the write, so a database with nothing to clean costs one
 * round trip and no transaction. The column check matters because a database
 * created after the column was dropped never had it, and `no such column` would
 * fail every query from then on.
 */
function dropBenchedMembers(): Promise<void> {
  if (cleanupReady) return cleanupReady;

  cleanupReady = (async () => {
    const columns = await db().execute("PRAGMA table_info(members)");
    if (!columns.rows.some((row) => row.name === "active")) return;

    const benched = await db().execute("SELECT name FROM members WHERE active = 0");
    if (benched.rows.length === 0) return;

    await db().batch(
      [
        // Both in one batch: one transaction, so a failure cannot delete the
        // history and keep the roster row — a member with rows but no name.
        {
          sql: "DELETE FROM attendance WHERE name IN (SELECT name FROM members WHERE active = 0)",
        },
        { sql: "DELETE FROM members WHERE active = 0" },
      ],
      "write"
    );
  })().catch((error: unknown) => {
    // A failed cleanup is not a reason to refuse every query: the app works
    // with the archived rows still in there, they are simply invisible. Let the
    // next call try again rather than replaying this error forever.
    cleanupReady = null;
    throw error;
  });

  return cleanupReady;
}

/* -------------------------------------------------------------------- reads */

type MemberRow = {
  name: string;
  job: string;
  level: number;
  note: string | null;
};

type AttendanceRowShape = {
  name: string;
  date: string;
  status: string;
  note: string | null;
  submitted_at: number;
};

type PartyRow = {
  id: string;
  name: string;
  content: string | null;
  members: string;
  updated_at: string;
  locked: number;
};

function toMember(row: MemberRow): Member {
  return {
    name: row.name,
    // Kept verbatim, even when it is not a class jobs.ts knows. A member whose
    // class is unrecognised must still show up in the roster with the name that
    // was stored — blanking the row would hide a person to explain a typo.
    job: row.job,
    level: Number(row.level) || 0,
    note: row.note || undefined,
  };
}

function toAttendanceRow(row: AttendanceRowShape): AttendanceRow | null {
  if (!isAttendanceStatus(row.status)) return null;
  return {
    name: row.name,
    // Stored as the same YYYY-MM-DD key `guildDateKey` produces, so unlike the
    // spreadsheet there is no Date cell to re-normalise on the way out.
    date: row.date,
    status: row.status as AttendanceStatus,
    note: row.note || undefined,
    submittedAt: Number(row.submitted_at) || 0,
  };
}

function toParty(row: PartyRow): Party | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    content: row.content || undefined,
    memberNames: parseMemberNames(row.members),
    locked: row.locked === 1,
    updatedAt: row.updated_at,
  };
}

function parseMemberNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

/**
 * Everything the admin panel needs, in one round trip.
 *
 * The three reads used to be three rows of one spreadsheet fetched together,
 * because Apps Script runs one execution at a time. `batch` keeps that shape:
 * one request, and either all three answers or none of them.
 */
export async function readAll(): Promise<{
  members: Member[];
  attendance: AttendanceRow[];
  parties: Party[];
}> {
  const [members, attendance, parties] = await run([
    { sql: "SELECT name, job, level, note FROM members ORDER BY position, name" },
    {
      sql: "SELECT name, date, status, note, submitted_at FROM attendance ORDER BY seq",
    },
    {
      sql: "SELECT id, name, content, members, updated_at, locked FROM parties ORDER BY position, id",
    },
  ]);

  return {
    members: members.flat().map((row) => toMember(row as unknown as MemberRow)),
    attendance: attendance
      .flat()
      .map((row) => toAttendanceRow(row as unknown as AttendanceRowShape))
      .filter((row): row is AttendanceRow => row !== null),
    parties: parties
      .flat()
      .map((row) => toParty(row as unknown as PartyRow))
      .filter((party): party is Party => party !== null),
  };
}

export async function readMembers(): Promise<Member[]> {
  const [rows] = await run([
    { sql: "SELECT name, job, level, note FROM members ORDER BY position, name" },
  ]);
  return rows.flat().map((row) => toMember(row as unknown as MemberRow));
}

export async function readAttendance(): Promise<AttendanceRow[]> {
  const [rows] = await run([
    {
      sql: "SELECT name, date, status, note, submitted_at FROM attendance ORDER BY seq",
    },
  ]);
  return rows
    .flat()
    .map((row) => toAttendanceRow(row as unknown as AttendanceRowShape))
    .filter((row): row is AttendanceRow => row !== null);
}

/** Parties saved by the admin. Public — members need to see them. */
export async function readParties(): Promise<Party[]> {
  const [rows] = await run([
    {
      sql: "SELECT id, name, content, members, updated_at, locked FROM parties ORDER BY position, id",
    },
  ]);
  return rows
    .flat()
    .map((row) => toParty(row as unknown as PartyRow))
    .filter((party): party is Party => party !== null);
}

/* ------------------------------------------------------------------- writes */

/**
 * Appends one row.
 *
 * A plain INSERT: two members submitting at the same instant produce two rows
 * rather than overwriting each other, because nothing here reads a row and
 * writes it back.
 *
 * No admin session: members report their own status without authenticating, and
 * the newest row per member is the one that counts, so a bad-faith submission
 * is overcorrectable.
 */
export async function appendAttendance(row: AttendanceRow): Promise<void> {
  await run([
    {
      sql: `INSERT INTO attendance (name, date, status, note, submitted_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [row.name, row.date, row.status, row.note ?? null, row.submittedAt],
    },
  ]);
}

/**
 * Roster writes. Callers run `requireAdmin` first — the database is only
 * reachable with the server's own token, so unlike the spreadsheet there is no
 * second process out there holding a public URL that would need its own check.
 */
export async function saveMember(member: Member): Promise<void> {
  await run([
    {
      // Upsert keyed by character name. `position` is deliberately absent from
      // the update: re-saving a member edits them in place, exactly like
      // rewriting their sheet row, so the roster order does not shuffle.
      sql: `INSERT INTO members (name, job, level, note, position)
            VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM members))
            ON CONFLICT(name) DO UPDATE SET
              job    = excluded.job,
              level  = excluded.level,
              note   = excluded.note`,
      args: [member.name, member.job, member.level, member.note ?? null],
    },
  ]);
}

/**
 * Deletes a member for good — the roster row and every attendance row for that
 * name. The only way a member leaves the guild now: there is no archiving, and
 * no undo.
 *
 * Returns how many attendance rows were removed, for the report.
 */
export async function deleteMember(name: string): Promise<{ deleted: number }> {
  const [found] = await run([
    { sql: "SELECT name FROM members WHERE name = ?", args: [name] },
  ]);
  if (!found.flat().length) {
    throw new Error("no such member");
  }

  const [counted] = await run([
    { sql: "SELECT COUNT(*) AS n FROM attendance WHERE name = ?", args: [name] },
    { sql: "DELETE FROM attendance WHERE name = ?", args: [name] },
    { sql: "DELETE FROM members WHERE name = ?", args: [name] },
  ]);

  return { deleted: Number(counted.flat()[0]?.n ?? 0) };
}

/**
 * Replaces the whole parties list. The admin is the only writer, so a
 * last-write-wins replace is simpler and safe.
 *
 * The DELETE and the INSERTs go out as one batch, which libSQL runs as a single
 * transaction: a failure part way through cannot leave the guild with half the
 * teams. That was the race the sheet could not offer — `deleteRows` followed by
 * a second `setValues` were two separate calls with a network round trip between
 * them.
 */
export async function saveParties(parties: Party[]): Promise<void> {
  const statements: InStatement[] = [
    { sql: "DELETE FROM parties" },
    ...parties.map((party, index) => ({
      sql: `INSERT INTO parties (id, name, content, members, updated_at, locked, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        party.id,
        party.name,
        // No length cap: the sheet truncated labels at 120 characters because
        // a cell has a hard limit, which silently cut party labels in half.
        party.content ?? null,
        JSON.stringify(party.memberNames ?? []),
        party.updatedAt,
        // Only a real `true` locks. Anything else writes 0, so a stringified
        // "false" in the payload cannot quietly protect a party from deletion.
        party.locked === true ? 1 : 0,
        index,
      ],
    })),
  ];

  await run(statements);
}

/**
 * Runs raw statements as one transaction.
 *
 * The escape hatch for callers that build their own statements — currently
 * only `lib/seed.ts`, which writes a whole dataset at once. Everything else
 * goes through a named function above, so that the mapping between the domain
 * and the columns stays in one file.
 *
 * Everything is one transaction on purpose: a dataset that lands halfway is
 * worse than one that fails outright, because the guild would be looking at
 * half a roster and no way to tell which half is real.
 */
export async function writeBatch(statements: InStatement[]): Promise<void> {
  await run(statements);
}

export function guildTimeZone(): string {
  return process.env.GUILD_TIMEZONE || "Asia/Bangkok";
}