import "server-only";

/**
 * Turso (libSQL) backend — remote SQLite over HTTP.
 *
 * This file is the only place in the app that talks to the database. Every API
 * route goes through the functions exported below, and no component ever sees
 * a row: they all receive `Member` / `AttendanceRow` / `Party` objects. That
 * boundary is what keeps the pages independent of the storage engine.
 *
 *   members     the roster. The guild master can also edit it from the app,
 *               which is why writes here carry an admin session.
 *
 *   attendance  append-only ledger, one row per submission. Never updated in
 *               place — see lib/rngw/attendance.ts. Open: members submit
 *               without a PIN, since the worst they can do is add a status row.
 *
 *   carry_rooms / carry_signups
 *               the "ลงชื่อแบกดัน" queues. A room belongs to one carrier and
 *               carries a scrypt hash of its management PIN. Members sign up
 *               openly, but a name may sit in only one room at a time.
 *
 *   parties     party identity: name, locked flag, global order, and two retired
 *               display-cache columns (`content`, `members`) kept so older
 *               databases still open. Every writer stores NULL / '[]' in them;
 *               the label is derived from placements on read.
 *
 *   event_rows / party_members / party_placements
 *               the source of truth for boxes, rosters and event placements.
 *               `saveParties` replaces them on every write.
 *
 * Why a hosted database and not a SQLite file: Vercel runs each request as a
 * serverless function on a throwaway instance with a read-only filesystem, so a
 * `.db` file would be invisible to the next request and lost when the instance
 * is recycled. Turso is a real SQLite server, so the same SQL works locally and
 * in production.
 *
 * Ordering is stored, not incidental. `position` on members and parties carries
 * the order the guild master arranged (`applyRowOrder` rewrites the whole list
 * to change a box order), and `seq` on attendance makes "the later submission
 * wins" deterministic instead of depending on how the server returned the rows.
 */

import { createClient, type Client, type InStatement, type Row } from "@libsql/client";
import type {
  AttendanceRow,
  AttendanceStatus,
  CarryQueueLocation,
  CarryRoom,
  CarrySignup,
  EventRow,
  Member,
  Party,
  PartyPlacement,
} from "@/lib/rngw/types";
import { CARRY_ROOM_LIMIT, isAttendanceStatus } from "@/lib/rngw/types";
import { isJobName } from "@/lib/rngw/jobs";
import { dedupeEventRows, normalizePlacements } from "@/lib/party";
import {
  APPEND_POSITION,
  derivePartyContent,
  getEventCategory,
} from "@/lib/rngw/categories";

export class DbConfigError extends Error {}

/**
 * A party write refused because the tab was working from an older snapshot.
 *
 * The route turns this into 409, which the client reads as "someone else saved
 * first — refresh and try again", the one failure a plain retry must not
 * "fix" by overwriting the newer work.
 */
export class PartyConflictError extends Error {}

/**
 * A party write refused because the snapshot breaks a rule about people rather
 * than about layout — currently only "one member, one team per event". The route
 * turns this into 400, because a valid client cannot produce it.
 */
export class PartyInvariantError extends Error {}

/**
 * A room delete refused because people are still queued in it.
 *
 * The carrier must move or remove them first; deleting the room would otherwise
 * silently erase the queue of everyone waiting on that activity. The route turns
 * this into 409 with the count.
 */
export class CarryRoomNotEmptyError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`ห้องนี้ยังมี ${count} คนในคิว`);
    this.count = count;
  }
}

/**
 * `app_meta` key holding the version of the whole parties snapshot.
 *
 * One number for the list, not one per party: every write replaces the tab, so
 * "the list I was editing" is the only thing that can go stale. A database
 * written before this existed has no such row, which reads as 0.
 */
const PARTY_VERSION_KEY = "parties_version";

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
 * The normalized party tables.
 *
 * `parties` stores the team identity; these three tables store what the team
 * plays and who is in it. `saveParties` replaces all four atomically on every
 * admin write.
 *
 * No foreign keys on purpose: libSQL leaves `PRAGMA foreign_keys` off by
 * default, and everything else in this file already does explicit deletes in
 * the same batch. An unenforced FK would only suggest a guarantee this code
 * does not have.
 */
const PARTY_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  // One row per box/team-large. A box exists even when no team is in it, which
  // is exactly what the old label-derived rows could not express.
  `CREATE TABLE IF NOT EXISTS event_rows (
     id       TEXT PRIMARY KEY,
     event    TEXT NOT NULL,
     division TEXT NOT NULL DEFAULT '',
     name     TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0
   )`,
  // `event_rows_by_name` is the uniqueness gate (two boxes cannot share a name
  // inside one scope). `event_rows_by_scope` is the board's ordering path; the
  // read selects every row, but the index hands them back already sorted by
  // event → division → position, so only ties on `id` need a sort.
  `CREATE UNIQUE INDEX IF NOT EXISTS event_rows_by_name
     ON event_rows(event, division, name)`,
  `CREATE INDEX IF NOT EXISTS event_rows_by_scope
     ON event_rows(event, division, position)`,

  // The roster belongs to the party, not to an event. Editing a member on the
  // Guild War board therefore changes the same party on every board it plays,
  // which is the current behaviour.
  `CREATE TABLE IF NOT EXISTS party_members (
     party_id    TEXT NOT NULL,
     member_name TEXT NOT NULL,
     slot        INTEGER NOT NULL,
     PRIMARY KEY (party_id, member_name)
   )`,
  // Used by `deleteMember` / `syncMembers`: the only queries that look up a
  // seat by member instead of reading the whole snapshot. The full read is
  // `ORDER BY party_id, slot`, which the (party_id, member_name) primary key
  // gets close enough for a table this size (a handful of rows per party).
  `CREATE INDEX IF NOT EXISTS party_members_by_name
     ON party_members(member_name)`,

  // One row per party per event. `division` is the league tab, empty for the
  // other events. `row_id` NULL is the virtual "ว่าง" row. `position` is the
  // per-scope card order (`sortTeamsForScope` reads it, the board's reorder
  // writes it), not a leftover from the old model.
  `CREATE TABLE IF NOT EXISTS party_placements (
     party_id TEXT NOT NULL,
     event    TEXT NOT NULL,
     division TEXT NOT NULL DEFAULT '',
     row_id   TEXT,
     position INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (party_id, event)
   )`,
  // Not on the board's read path (that one loads the snapshot), but it is what
  // makes "where did this box's teams go?" a lookup: the drag/order checks query
  // by `row_id`, and a future per-box read will too.
  `CREATE INDEX IF NOT EXISTS party_placements_by_row
     ON party_placements(event, division, row_id)`,
];

/**
 * Idempotent DDL, applied on demand rather than by a migration step.
 *
 * This is an idempotent schema, not a migration step: every cold start is a new
 * process, so the tables are created on demand and a missing column is added
 * with `ALTER TABLE … ADD COLUMN` here. The columns below are the whole
 * contract.
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

  // Append-only. `seq` is the submission order, and `latestByMember` breaks
  // same-millisecond ties by "the later row in the list wins", so the read has
  // to hand rows back in seq order.
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

  // A "ห้องแบก": one carrier's queue for one activity. The PIN is stored as a
  // scrypt hash; `auth_version` is bumped when the PIN changes so old carrier
  // cookies stop working. `carry_signups` is created by `ensureCarrySchema`
  // because its first shape (one global queue) had to be replaced, not altered.
  `CREATE TABLE IF NOT EXISTS carry_rooms (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     carrier_name TEXT NOT NULL,
     title        TEXT NOT NULL,
     pin_hash     TEXT NOT NULL,
     auth_version INTEGER NOT NULL DEFAULT 1,
     open         INTEGER NOT NULL DEFAULT 1,
     created_at   INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS carry_rooms_by_carrier ON carry_rooms(carrier_name, created_at)`,

  `CREATE TABLE IF NOT EXISTS parties (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     content    TEXT,
     -- Retired display cache: saveParties writes '[]'. The roster lives in
     -- party_members, one row per seat.
     members    TEXT NOT NULL DEFAULT '[]',
     updated_at TEXT NOT NULL,
     locked     INTEGER NOT NULL DEFAULT 0,
     position   INTEGER NOT NULL DEFAULT 0
   )`,

  // The phase-1 snapshot. Created with the rest so the first query of a cold
  // start can migrate without a second schema round trip.
  ...PARTY_SCHEMA,
];

let schemaReady: Promise<void> | null = null;
let cleanupReady: Promise<void> | null = null;
let carrySchemaReady: Promise<void> | null = null;

/**
 * Runs `statements` after the schema, the one-time carry-table migration, and
 * the archived-member cleanup are ready.
 *
 * Lazy rather than a migration step because there is no build step to hang it
 * off on Vercel: every cold start is a fresh process with no memory of what ran
 * before. `CREATE TABLE IF NOT EXISTS` is a no-op once the tables exist, and the
 * cost of the extra round trip is paid once per instance rather than per query.
 *
 * Creating the schema up front (instead of waiting for a missing-table error)
 * means the first read never has to race table creation. `app_meta` stays in
 * the schema as the place for one-off markers; the party migration keys from
 * v1 are no longer read by the app.
 */
async function run(statements: InStatement[]): Promise<Row[][]> {
  await createSchema();
  // Must run before `dropBenchedMembers`, which deletes carry rows for archived
  // members and therefore needs the new table to exist.
  await ensureCarrySchema();
  await dropBenchedMembers();

  const results = await db().batch(statements, "write");
  return results.map((result) => result.rows);
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
        // One batch: one transaction, so a failure cannot delete the history or
        // the sign-up and keep the roster row — a member with rows but no name.
        {
          sql: "DELETE FROM carry_signups WHERE name IN (SELECT name FROM members WHERE active = 0)",
        },
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

/**
 * Creates the room-scoped queue, replacing the old single global queue once.
 *
 * The first version of "ลงชื่อแบกดัน" had `carry_signups(name UNIQUE, note,
 * signed_at)` and no rooms. `CREATE TABLE IF NOT EXISTS` cannot add `room_id`,
 * so a database that still has the old shape is dropped and recreated. This is
 * intentionally destructive: the guild master chose to clear the old list when
 * the multi-carrier system replaced it. The old `app_meta` round keys are
 * removed for the same reason and are never read again.
 *
 * Runs once per instance, before any query that touches the table. A failed
 * attempt clears the cached promise so the next call retries.
 */
function ensureCarrySchema(): Promise<void> {
  if (carrySchemaReady) return carrySchemaReady;

  carrySchemaReady = (async () => {
    const columns = await db().execute("PRAGMA table_info(carry_signups)");
    const hasRoomId = columns.rows.some((row) => row.name === "room_id");
    const isOldShape = columns.rows.length > 0 && !hasRoomId;

    await db().batch(
      [
        ...(isOldShape ? [{ sql: "DROP TABLE carry_signups" }] : []),
        {
          sql: `CREATE TABLE IF NOT EXISTS carry_signups (
                  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
                  room_id   INTEGER NOT NULL,
                  name      TEXT NOT NULL UNIQUE,
                  note      TEXT,
                  signed_at INTEGER NOT NULL
                )`,
        },
        {
          sql: "CREATE INDEX IF NOT EXISTS carry_signups_by_room ON carry_signups(room_id, signed_at, seq)",
        },
        {
          sql: "DELETE FROM app_meta WHERE key IN ('carry_signups_open', 'carry_signups_target')",
        },
      ],
      "write"
    );
  })().catch((error: unknown) => {
    carrySchemaReady = null;
    throw error;
  });

  return carrySchemaReady;
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

type CarryRoomShape = {
  id: number;
  carrier_name: string;
  title: string;
  pin_hash: string;
  auth_version: number;
  open: number;
  created_at: number;
};

/** Server-side room row. The PIN hash and auth version never reach the client. */
export interface CarryRoomRecord extends CarryRoom {
  pinHash: string;
  authVersion: number;
}

type CarrySignupShape = {
  room_id: number;
  name: string;
  note: string | null;
  signed_at: number;
};

type CarrySignupLocationShape = CarrySignupShape & {
  room_title: string;
  carrier_name: string;
};

type PartyRow = {
  id: string;
  name: string;
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
    // Stored as the same YYYY-MM-DD key `guildDateKey` produces, and as TEXT,
    // so there is no Date cell to re-normalise on the way out.
    date: row.date,
    status: row.status as AttendanceStatus,
    note: row.note || undefined,
    submittedAt: Number(row.submitted_at) || 0,
  };
}

function toCarryRoom(row: CarryRoomShape | undefined): CarryRoomRecord | null {
  if (!row) return null;
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    carrierName: row.carrier_name,
    title: row.title,
    open: Number(row.open) === 1,
    createdAt: Number(row.created_at) || 0,
    pinHash: row.pin_hash,
    authVersion: Number(row.auth_version) || 1,
  };
}

/** Strips the server-only fields before a room is put in a response. */
export function toPublicCarryRoom(room: CarryRoomRecord): CarryRoom {
  return {
    id: room.id,
    carrierName: room.carrierName,
    title: room.title,
    open: room.open,
    createdAt: room.createdAt,
  };
}

function toCarrySignup(row: CarrySignupShape): CarrySignup | null {
  if (!row.name) return null;
  return {
    roomId: Number(row.room_id) || 0,
    name: row.name,
    note: row.note || undefined,
    signedAt: Number(row.signed_at) || 0,
  };
}

type PartyMemberRow = {
  party_id: string;
  member_name: string;
  slot: number;
};

type PartyPlacementShape = {
  party_id: string;
  event: string;
  division: string;
  row_id: string | null;
  position: number;
};

type EventRowShape = {
  id: string;
  event: string;
  division: string;
  name: string;
  position: number;
};

/**
 * A `parties` row without its children.
 *
 * The roster and placements are filled in by `composeParties`; `content` is
 * derived there too. The retired `content`/`members` columns are not read.
 */
function toParty(row: PartyRow): Party | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    placements: [],
    memberNames: [],
    locked: row.locked === 1,
    updatedAt: row.updated_at,
  };
}

function toEventRow(row: EventRowShape): EventRow | null {
  if (!row.id || !row.name || !getEventCategory(row.event)) return null;
  return {
    id: row.id,
    event: row.event as EventRow["event"],
    division: row.division || "",
    name: row.name,
    position: Number(row.position) || 0,
  };
}

function toPlacement(row: PartyPlacementShape): PartyPlacement | null {
  if (!getEventCategory(row.event)) return null;
  return {
    event: row.event as PartyPlacement["event"],
    division: row.division || "",
    rowId: row.row_id || null,
    position: Number(row.position) || 0,
  };
}

/** An `app_meta` version cell as a number; anything unreadable is version 0. */
function toPartyVersion(rows: Row[]): number {
  const value = rows.flat()[0]?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** Joins the normalized rows into the `Party` shape every caller expects. */
function composeParties(
  partyRows: Row[],
  memberRows: Row[],
  placementRows: Row[],
  eventRows: EventRow[]
): Party[] {
  const membersByParty = new Map<string, string[]>();
  for (const row of memberRows) {
    const member = row as unknown as PartyMemberRow;
    const names = membersByParty.get(member.party_id) ?? [];
    names.push(member.member_name);
    membersByParty.set(member.party_id, names);
  }

  const placementsByParty = new Map<string, PartyPlacement[]>();
  for (const row of placementRows) {
    const placement = toPlacement(row as unknown as PartyPlacementShape);
    if (!placement) continue;
    const list = placementsByParty.get(
      (row as unknown as PartyPlacementShape).party_id
    ) ?? [];
    list.push(placement);
    placementsByParty.set(
      (row as unknown as PartyPlacementShape).party_id,
      list
    );
  }

  return partyRows.flatMap((row) => {
    const party = toParty(row as unknown as PartyRow);
    if (!party) return [];
    const withRefs: Party = {
      ...party,
      // The normalized roster is the whole answer, including "empty": falling
      // back to the JSON cache after the last member was removed would
      // resurrect a name that is no longer in the guild.
      memberNames: membersByParty.get(party.id) ?? [],
      placements: placementsByParty.get(party.id) ?? [],
    };
    return [
      {
        ...withRefs,
        content: derivePartyContent(withRefs, eventRows) || undefined,
      },
    ];
  });
}

/**
 * Everything the admin panel needs, in one round trip.
 *
 * Everything the admin panel needs, in one round trip: `batch` returns all
 * answers or none of them.
 */
export async function readAll(): Promise<{
  members: Member[];
  attendance: AttendanceRow[];
  parties: Party[];
  eventRows: EventRow[];
  /** Optimistic-lock token for the parties snapshot; see `saveParties`. */
  partyVersion: number;
}> {
  const [
    members,
    attendance,
    partyRows,
    memberRows,
    placementRows,
    eventRowRows,
    versionRows,
  ] = await run([
    { sql: "SELECT name, job, level, note FROM members ORDER BY position, name" },
    {
      sql: "SELECT name, date, status, note, submitted_at FROM attendance ORDER BY seq",
    },
    {
      sql: "SELECT id, name, updated_at, locked FROM parties ORDER BY position, id",
    },
    {
      sql: "SELECT party_id, member_name, slot FROM party_members ORDER BY party_id, slot",
    },
    {
      sql: "SELECT party_id, event, division, row_id, position FROM party_placements ORDER BY party_id, event, position",
    },
    {
      sql: "SELECT id, event, division, name, position FROM event_rows ORDER BY event, division, position, id",
    },
    { sql: "SELECT value FROM app_meta WHERE key = ?", args: [PARTY_VERSION_KEY] },
  ]);

  const eventRows = eventRowRows
    .flat()
    .map((row) => toEventRow(row as unknown as EventRowShape))
    .filter((row): row is EventRow => row !== null);

  return {
    members: members.flat().map((row) => toMember(row as unknown as MemberRow)),
    attendance: attendance
      .flat()
      .map((row) => toAttendanceRow(row as unknown as AttendanceRowShape))
      .filter((row): row is AttendanceRow => row !== null),
    parties: composeParties(partyRows, memberRows, placementRows, eventRows),
    eventRows,
    partyVersion: toPartyVersion(versionRows),
  };
}

export async function readMembers(): Promise<Member[]> {
  const [rows] = await run([
    { sql: "SELECT name, job, level, note FROM members ORDER BY position, name" },
  ]);
  return rows.flat().map((row) => toMember(row as unknown as MemberRow));
}

/**
 * Every room, every queue entry, and the roster to pick from, in one batch.
 *
 * The sign-up join drops a name that has left the roster. `deleteMember` and
 * `syncMembers` clean those rows up in the same transaction as the member, but
 * a database edited by hand may still hold one; hiding it beats showing a name
 * nobody can look up or remove from this page.
 *
 * Queues are ordered by `signedAt` then `seq`; a transfer refreshes `signedAt`
 * so the member lands at the back of the destination queue.
 */
export async function readCarryBoard(): Promise<{
  rooms: CarryRoomRecord[];
  signups: CarrySignup[];
  members: Member[];
}> {
  const [roomRows, signupRows, memberRows] = await run([
    {
      sql: `SELECT id, carrier_name, title, pin_hash, auth_version, open, created_at
              FROM carry_rooms
             ORDER BY created_at, id`,
    },
    {
      sql: `SELECT s.room_id, s.name, s.note, s.signed_at
              FROM carry_signups s
              JOIN members m ON m.name = s.name
             ORDER BY s.signed_at, s.seq`,
    },
    { sql: "SELECT name, job, level, note FROM members ORDER BY position, name" },
  ]);

  return {
    rooms: roomRows
      .flat()
      .map((row) => toCarryRoom(row as unknown as CarryRoomShape))
      .filter((row): row is CarryRoomRecord => row !== null),
    signups: signupRows
      .flat()
      .map((row) => toCarrySignup(row as unknown as CarrySignupShape))
      .filter((row): row is CarrySignup => row !== null),
    members: memberRows.flat().map((row) => toMember(row as unknown as MemberRow)),
  };
}

/** One room, including its server-only PIN hash and auth version. */
export async function readCarryRoom(
  id: number
): Promise<CarryRoomRecord | null> {
  const [rows] = await run([
    {
      sql: `SELECT id, carrier_name, title, pin_hash, auth_version, open, created_at
              FROM carry_rooms WHERE id = ?`,
      args: [id],
    },
  ]);
  return toCarryRoom(rows.flat()[0] as unknown as CarryRoomShape);
}

/**
 * Creates a room and returns its stored row, or `null` when the board is full.
 *
 * The cap is part of the INSERT rather than a separate COUNT + INSERT: two
 * people tapping "สร้างห้องแบก" at the same time must not both squeeze past the
 * limit. The outer `WHERE` sees the count at the moment SQLite writes the row.
 * The caller sets the session for the returned room.
 */
export async function createCarryRoom(input: {
  carrierName: string;
  title: string;
  pinHash: string;
}): Promise<CarryRoomRecord | null> {
  const [rows] = await run([
    {
      sql: `INSERT INTO carry_rooms
              (carrier_name, title, pin_hash, auth_version, open, created_at)
            SELECT ?, ?, ?, 1, 1, ?
             WHERE (SELECT COUNT(*) FROM carry_rooms) < ?
            RETURNING id`,
      args: [
        input.carrierName,
        input.title,
        input.pinHash,
        Date.now(),
        CARRY_ROOM_LIMIT,
      ],
    },
  ]);

  const id = Number((rows.flat()[0] as unknown as { id: number } | undefined)?.id);
  if (!Number.isFinite(id)) return null;

  const room = await readCarryRoom(id);
  if (!room) throw new Error("carry_rooms row disappeared after insert");
  return room;
}

/**
 * Updates the mutable parts of a room in one statement.
 *
 * `pinHash` is the only field that also bumps `auth_version`; changing a title
 * or the open flag must not log the carrier out. The caller re-reads the room
 * so it can hand the new auth version to `setRoomSession` after a PIN change.
 */
export async function updateCarryRoom(
  id: number,
  patch: { title?: string; open?: boolean; pinHash?: string }
): Promise<void> {
  const sets: string[] = [];
  const args: Array<string | number> = [];

  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.open !== undefined) {
    sets.push("open = ?");
    args.push(patch.open ? 1 : 0);
  }
  if (patch.pinHash !== undefined) {
    sets.push("pin_hash = ?", "auth_version = auth_version + 1");
    args.push(patch.pinHash);
  }

  if (sets.length === 0) return;

  await run([
    {
      sql: `UPDATE carry_rooms SET ${sets.join(", ")} WHERE id = ?`,
      args: [...args, id],
    },
  ]);
}

/**
 * Deletes an empty room. A non-empty room throws with the queue size so the
 * route can tell the carrier how many people are still there.
 */
export async function deleteCarryRoom(id: number): Promise<void> {
  const [deleted] = await run([
    {
      sql: `DELETE FROM carry_rooms
             WHERE id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM carry_signups WHERE room_id = ?
               )
            RETURNING id`,
      args: [id, id],
    },
  ]);
  if (deleted.flat().length) return;

  const [countRows] = await run([
    {
      sql: "SELECT COUNT(*) AS count FROM carry_signups WHERE room_id = ?",
      args: [id],
    },
  ]);
  const count = Number(
    (countRows.flat()[0] as unknown as { count: number } | undefined)?.count
  );
  throw new CarryRoomNotEmptyError(Number.isFinite(count) ? count : 0);
}

/** Where a name is already queued, or null when the name is free. */
export async function readCarryQueueLocation(
  name: string
): Promise<CarryQueueLocation | null> {
  const [rows] = await run([
    {
      sql: `SELECT s.room_id, s.name, s.note, s.signed_at,
                   r.title AS room_title, r.carrier_name
              FROM carry_signups s
              JOIN carry_rooms r ON r.id = s.room_id
             WHERE s.name = ?`,
      args: [name],
    },
  ]);

  const row = rows.flat()[0] as unknown as CarrySignupLocationShape | undefined;
  if (!row) return null;

  return {
    roomId: Number(row.room_id) || 0,
    roomTitle: row.room_title,
    carrierName: row.carrier_name,
  };
}

/** Every box/row of every event, in board order. */
async function readEventRows(): Promise<EventRow[]> {
  const [rows] = await run([
    {
      sql: "SELECT id, event, division, name, position FROM event_rows ORDER BY event, division, position, id",
    },
  ]);
  return rows
    .flat()
    .map((row) => toEventRow(row as unknown as EventRowShape))
    .filter((row): row is EventRow => row !== null);
}

/**
 * The version the parties were last written at.
 *
 * Read (not stored on the client copy) so a writer can compare before it
 * replaces the tab. See `saveParties`.
 */
async function readPartyVersion(): Promise<number> {
  const [rows] = await run([
    { sql: "SELECT value FROM app_meta WHERE key = ?", args: [PARTY_VERSION_KEY] },
  ]);
  return toPartyVersion(rows);
}

/**
 * Parties and the rows they point at, in one batch. The public board needs both:
 * a placement only stores `rowId`, and the name is the row's.
 */
export async function readPartiesAndRows(): Promise<{
  parties: Party[];
  eventRows: EventRow[];
  /** Optimistic-lock token for the parties snapshot; see `saveParties`. */
  version: number;
}> {
  const [partyRows, memberRows, placementRows, eventRowRows, versionRows] =
    await run([
      {
        sql: "SELECT id, name, updated_at, locked FROM parties ORDER BY position, id",
      },
      {
        sql: "SELECT party_id, member_name, slot FROM party_members ORDER BY party_id, slot",
      },
      {
        sql: "SELECT party_id, event, division, row_id, position FROM party_placements ORDER BY party_id, event, position",
      },
      {
        sql: "SELECT id, event, division, name, position FROM event_rows ORDER BY event, division, position, id",
      },
      { sql: "SELECT value FROM app_meta WHERE key = ?", args: [PARTY_VERSION_KEY] },
    ]);

  const eventRows = eventRowRows
    .flat()
    .map((row) => toEventRow(row as unknown as EventRowShape))
    .filter((row): row is EventRow => row !== null);

  return {
    parties: composeParties(partyRows, memberRows, placementRows, eventRows),
    eventRows,
    version: toPartyVersion(versionRows),
  };
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

/** Why a sign-up did not add a row. */
export type CarrySignupResult =
  | { kind: "added" }
  | { kind: "not-member" }
  | { kind: "room-missing" }
  | { kind: "room-closed" }
  | { kind: "existing"; location: CarryQueueLocation };

/**
 * Adds one name to one room's queue.
 *
 * Open like attendance, but the name still has to be on the roster and may sit
 * in only one queue at a time. The checks and the insert are separate round
 * trips: a racing second tap is caught by the UNIQUE `name` constraint and
 * `INSERT OR IGNORE`, then reported as "already" with the room it landed in.
 * The first sign-up keeps its note; a second tap cannot rewrite it.
 *
 * The room's open/closed switch is checked before the insert. Like the
 * membership check this is a read before the write, so a member can slip in
 * between a carrier closing the room and this call reading it — the window is
 * one round trip and the cost is a queue entry the carrier can remove.
 */
export async function signUpForCarry(
  roomId: number,
  name: string,
  note?: string
): Promise<CarrySignupResult> {
  const [memberRows, roomRows] = await run([
    { sql: "SELECT 1 AS found FROM members WHERE name = ?", args: [name] },
    { sql: "SELECT id, open FROM carry_rooms WHERE id = ?", args: [roomId] },
  ]);

  if (!memberRows.flat().length) return { kind: "not-member" };

  const room = roomRows.flat()[0] as unknown as
    | { id: number; open: number }
    | undefined;
  if (!room) return { kind: "room-missing" };

  const existing = await readCarryQueueLocation(name);
  if (existing) return { kind: "existing", location: existing };

  if (Number(room.open) !== 1) return { kind: "room-closed" };

  // The insert re-checks the room in the same statement. Deleting a room runs
  // a `NOT EXISTS` check in its own statement, so this closes the window where
  // a room is deleted between the read above and the write below: one of the
  // two writes commits first, and the other sees it.
  const [inserted] = await run([
    {
      sql: `INSERT OR IGNORE INTO carry_signups (room_id, name, note, signed_at)
            SELECT id, ?, ?, ? FROM carry_rooms
             WHERE id = ? AND open = 1
            RETURNING seq`,
      args: [name, note ?? null, Date.now(), roomId],
    },
  ]);

  if (inserted.flat().length > 0) return { kind: "added" };

  // A concurrent tap won the UNIQUE race between the read and this insert.
  const raced = await readCarryQueueLocation(name);
  if (raced) return { kind: "existing", location: raced };

  // The room was deleted or closed after the read above. Re-read it so the
  // caller gets the reason that actually applies now.
  const current = await readCarryRoom(roomId);
  if (!current) return { kind: "room-missing" };
  if (!current.open) return { kind: "room-closed" };

  // An INSERT ... SELECT that matched a room and did not conflict must insert.
  // Reaching here means an orphan row with this UNIQUE name exists, which no
  // write path in this file can create; fail loudly instead of claiming success.
  throw new Error("carry sign-up was ignored without a conflict");
}

/** Replaces one row's note inside a room. Returns false when the row is gone. */
export async function updateCarrySignupNote(
  roomId: number,
  name: string,
  note?: string
): Promise<boolean> {
  const [rows] = await run([
    {
      sql: `UPDATE carry_signups SET note = ?
             WHERE room_id = ? AND name = ?
            RETURNING name`,
      args: [note ?? null, roomId, name],
    },
  ]);
  return rows.flat().length > 0;
}

/** Removes one row from a room. Returns false when it was not there. */
export async function deleteCarrySignup(
  roomId: number,
  name: string
): Promise<boolean> {
  const [rows] = await run([
    {
      sql: "DELETE FROM carry_signups WHERE room_id = ? AND name = ? RETURNING name",
      args: [roomId, name],
    },
  ]);
  return rows.flat().length > 0;
}

/** Empties one room's queue and returns how many rows were removed. */
export async function clearCarryRoomSignups(roomId: number): Promise<number> {
  const [rows] = await run([
    {
      sql: "DELETE FROM carry_signups WHERE room_id = ? RETURNING name",
      args: [roomId],
    },
  ]);
  return rows.flat().length;
}

/**
 * Moves one member between rooms.
 *
 * Updates `room_id` and refreshes `signed_at` in one statement, so the member
 * appears at the end of the destination queue and the move is atomic. The
 * statement also re-checks that the destination is still open; deleting a room
 * and closing it are separate writes, and the two must not overwrite each other.
 * A missing result means the source row is gone, or the destination changed
 * between the route's read and this write.
 */
export async function transferCarrySignup(
  fromRoomId: number,
  toRoomId: number,
  name: string
): Promise<"moved" | "missing"> {
  const [rows] = await run([
    {
      sql: `UPDATE carry_signups SET room_id = ?, signed_at = ?
             WHERE room_id = ? AND name = ?
               AND EXISTS (
                 SELECT 1 FROM carry_rooms WHERE id = ? AND open = 1
               )
            RETURNING name`,
      args: [toRoomId, Date.now(), fromRoomId, name, toRoomId],
    },
  ]);
  return rows.flat().length > 0 ? "moved" : "missing";
}

/**
 * Moves an entire queue to another room and returns how many names moved.
 *
 * `ROW_NUMBER()` follows the source queue order (`signed_at, seq`) and gives
 * each moved row a distinct timestamp, so the destination keeps the same
 * order instead of falling back to insertion order. The `EXISTS` check is the
 * same guard as the single-name move: a target that closed or disappeared
 * between the route's read and this write leaves every row untouched.
 */
export async function transferAllCarrySignups(
  fromRoomId: number,
  toRoomId: number
): Promise<number> {
  const [rows] = await run([
    {
      sql: `WITH ordered AS (
              SELECT seq, ROW_NUMBER() OVER (ORDER BY signed_at, seq) - 1 AS rn
                FROM carry_signups
               WHERE room_id = ?
            )
            UPDATE carry_signups
               SET room_id = ?,
                   signed_at = ? + (
                     SELECT rn FROM ordered WHERE ordered.seq = carry_signups.seq
                   )
             WHERE room_id = ?
               AND EXISTS (
                 SELECT 1 FROM carry_rooms WHERE id = ? AND open = 1
               )
            RETURNING name`,
      args: [fromRoomId, toRoomId, Date.now(), fromRoomId, toRoomId],
    },
  ]);
  return rows.flat().length;
}

/**
 * Roster writes. Callers run `requireAdmin` first — the database is only
 * reachable with the server's own token, so `requireAdmin` on each route is the
 * whole gate.
 */
export async function saveMember(member: Member): Promise<void> {
  await run([
    {
      // Upsert keyed by character name. `position` is deliberately absent from
      // the update: re-saving a member edits them in place, so the roster order
      // does not shuffle.
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

/** What `syncMembers` did, for the report the guild master reads afterwards. */
export interface MemberImportSummary {
  added: number;
  updated: number;
  /** Already matching the file, so nothing was written for them. */
  unchanged: number;
  /** Taken off the roster, because the file no longer lists them. */
  removed: string[];
  /** Attendance rows deleted along with them — gone for good, like the bin. */
  removedAttendance: number;
  /** Teams the removed names were taken out of. The teams themselves stay. */
  cleanedParties: number;
}

/** What `deleteMember` took with it, for the same report. */
export interface MemberDeleteSummary {
  /** Attendance rows deleted — gone for good, like the bin says. */
  deleted: number;
  /** Teams the name was taken out of. The teams themselves stay. */
  cleanedParties: number;
}

/**
 * Rows in board order, with one dense position per scope.
 *
 * The client sends the array order after a drag/reorder; positions are derived
 * here so two boxes can never share a position because of a stale client copy.
 *
 * Duplicates (a repeated id, or two names that fold together) are dropped here
 * as the last gate before the INSERTs — `dedupeEventRows` explains the rule, and
 * `remap` carries any team that was parked in a dropped box to the survivor.
 */
function normalizeEventRows(rows: EventRow[]): {
  rows: EventRow[];
  remap: Map<string, string>;
} {
  const sorted = [...rows].sort(
    (a, b) =>
      a.event.localeCompare(b.event) ||
      a.division.localeCompare(b.division) ||
      a.position - b.position ||
      a.id.localeCompare(b.id)
  );

  const { rows: deduped, remap } = dedupeEventRows(sorted);

  const counters = new Map<string, number>();
  const normalized = deduped.map((row) => {
    const scope = `${row.event}:${row.division}`;
    const position = counters.get(scope) ?? 0;
    counters.set(scope, position + 1);
    return { ...row, position };
  });

  return { rows: normalized, remap };
}

/**
 * Refuses a snapshot that puts one member on two teams of the same event.
 *
 * The board and the builder both read "already on a team of this event" as a
 * move, so a valid client never sends this. It is a rule about people, though,
 * not about layout: if it is ever broken the guild sees one player listed in two
 * teams of one night with no way to tell which is real. Checked before the
 * batch, so the caller gets a readable 400 instead of a half-written board.
 *
 * The check is per event, ignoring division: a player cannot be on a ลีคหลัก
 * team and a ลีครอง team at once, which is the same set `partiesForEvent` gives
 * the board.
 */
function assertOneTeamPerEvent(
  parties: Party[],
  placementsByParty: Map<string, PartyPlacement[]>
): void {
  /** event → member name → the party name already holding them. */
  const owner = new Map<string, Map<string, string>>();

  for (const party of parties) {
    const events = new Set(
      (placementsByParty.get(party.id) ?? []).map((placement) => placement.event)
    );
    if (events.size === 0) continue;

    const seen = new Set<string>();
    for (const name of party.memberNames) {
      if (seen.has(name)) continue;
      seen.add(name);

      for (const event of events) {
        const byEvent = owner.get(event) ?? new Map<string, string>();
        const held = byEvent.get(name);
        if (held) {
          const title = getEventCategory(event)?.title ?? event;
          throw new PartyInvariantError(
            `"${name}" อยู่สองทีมในอีเวนต์ ${title} ("${held}" และ "${party.name}") — ` +
              "หนึ่งคนอยู่ได้ทีมเดียวต่ออีเวนต์"
          );
        }
        byEvent.set(name, party.name);
        owner.set(event, byEvent);
      }
    }
  }
}

/**
 * The statements that replace the parties/rows snapshot.
 *
 * `includeRows` is true only when the caller sent a rows list (a box was added,
 * renamed, deleted or reordered). Member and team edits leave the rows table
 * alone, so they stay a parties-only write.
 */
function partyStatements(
  parties: Party[],
  rows: EventRow[],
  includeRows: boolean
): InStatement[] {
  const resolved = includeRows
    ? normalizeEventRows(rows)
    : { rows, remap: new Map<string, string>() };
  const normalizedRows = resolved.rows;
  const placementsByParty = new Map<string, PartyPlacement[]>();
  /**
   * Every placement, grouped by its scope, so the positions written are dense
   * per scope no matter what order the client sent. `partyIndex` is the tie
   * breaker: two placements with the same position keep the parties list order.
   */
  const byScope = new Map<
    string,
    { key: string; placement: PartyPlacement; partyIndex: number }[]
  >();

  parties.forEach((party, partyIndex) => {
    const placements = normalizePlacements(party, normalizedRows, resolved.remap);
    placementsByParty.set(party.id, placements);

    for (const placement of placements) {
      const scope = `${placement.event}:${placement.division}`;
      const entries = byScope.get(scope) ?? [];
      entries.push({
        key: placementKey(party.id, placement.event),
        placement,
        partyIndex,
      });
      byScope.set(scope, entries);
    }
  });

  // Before any statement is built: a snapshot that breaks a rule about people
  // is refused outright, not written and then explained.
  assertOneTeamPerEvent(parties, placementsByParty);

  const positionByKey = new Map<string, number>();
  for (const entries of byScope.values()) {
    entries
      .sort(
        (a, b) =>
          safePosition(a.placement.position) - safePosition(b.placement.position) ||
          a.partyIndex - b.partyIndex
      )
      .forEach((entry, position) => {
        positionByKey.set(entry.key, position);
      });
  }

  const statements: InStatement[] = [];

  statements.push(
    { sql: "DELETE FROM party_members" },
    { sql: "DELETE FROM party_placements" },
    { sql: "DELETE FROM parties" }
  );

  if (includeRows) {
    // Rows are deleted only after the placements that point at them. There are
    // no foreign keys today, but keeping children first makes that guarantee
    // true if they are ever enabled.
    statements.push({ sql: "DELETE FROM event_rows" });
    for (const row of normalizedRows) {
      statements.push({
        sql: `INSERT INTO event_rows (id, event, division, name, position)
              VALUES (?, ?, ?, ?, ?)`,
        args: [row.id, row.event, row.division, row.name, row.position],
      });
    }
  }

  parties.forEach((party, index) => {
    const placements = placementsByParty.get(party.id) ?? [];

    const seen = new Set<string>();
    const memberNames = party.memberNames.filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });

    statements.push({
      // `content` and `members` are retired display caches. Store NULL / '[]'
      // so a database written from now on cannot look like the label string is
      // still the source of truth; readers derive the label from placements and
      // take the roster from `party_members`.
      sql: `INSERT INTO parties (id, name, content, members, updated_at, locked, position)
            VALUES (?, ?, NULL, '[]', ?, ?, ?)`,
      args: [
        party.id,
        party.name,
        party.updatedAt || new Date().toISOString(),
        // Only a real `true` locks, so a stringified "false" cannot quietly
        // protect a party from deletion.
        party.locked === true ? 1 : 0,
        index,
      ],
    });

    memberNames.forEach((name, slot) => {
      statements.push({
        sql: `INSERT INTO party_members (party_id, member_name, slot)
              VALUES (?, ?, ?)`,
        args: [party.id, name, slot],
      });
    });

    for (const placement of placements) {
      statements.push({
        sql: `INSERT INTO party_placements (party_id, event, division, row_id, position)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          party.id,
          placement.event,
          placement.division,
          placement.rowId,
          positionByKey.get(placementKey(party.id, placement.event)) ??
            safePosition(placement.position),
        ],
      });
    }
  });

  return statements;
}

/** One placement per (party, event), which is the table's primary key. */
function placementKey(partyId: string, event: string): string {
  return `${partyId}\u0000${event}`;
}

/** A position from the client may be missing or `NaN`; such a row goes last. */
function safePosition(position: number): number {
  return Number.isFinite(position) ? position : APPEND_POSITION;
}

/**
 * Writes a whole roster export over the current one.
 *
 * The file is the authority: a name in `members` is written, and a name that is
 * on the roster but missing from the file is removed along with its attendance
 * — the same thing the bin in the roster tab does, to the same people, on the
 * same terms. That is the whole point of the import, and it is why the caller
 * previews it and asks before calling this.
 *
 * Two columns are never written:
 *
 *   - `note`, because the export has no such column. Writing an empty one would
 *     erase what the guild master typed next to a member on every import.
 *   - `position` on update, because the roster order may have been set by hand
 *     and importing must not shuffle it. A member new to the roster takes the
 *     next free slot, as in `saveMember`.
 *
 * Everything goes out as one batch, which libSQL runs as a single transaction:
 * an import that landed halfway would leave the guild with half a roster and
 * no way to tell which half is real.
 */
export async function syncMembers(members: Member[]): Promise<MemberImportSummary> {
  // Checked before anything is read or written, and here rather than only at
  // the route: this call removes every member the list does not mention, so a
  // class the app does not have would take the whole guild down with it on the
  // way to writing one bad row. The API rejects it too — this is the second
  // door, and it is the one that cannot be forgotten.
  for (const member of members) {
    if (!isJobName(member.job)) {
      throw new Error(
        `คลาส "${member.job}" ของ ${member.name} ไม่ใช่คลาสที่ระบบรู้จัก — ยกเลิกทั้งหมด ไม่มีอะไรถูกเขียน`,
      );
    }
  }

  const existing = await readMembers();
  const was = new Map(existing.map((member) => [member.name, member]));
  const listed = new Set(members.map((member) => member.name));
  const removed = existing.filter((member) => !listed.has(member.name)).map((m) => m.name);

  let removedAttendance = 0;
  let cleanedParties = 0;
  const statements: InStatement[] = [];

  if (removed.length > 0) {
    const [counted] = await run([
      { sql: `SELECT COUNT(*) AS n FROM attendance WHERE ${inList(removed)}`, args: removed },
    ]);
    removedAttendance = Number(counted.flat()[0]?.n ?? 0);

    // Ledger first, then the roster row: a name with attendance behind it and
    // no roster row is exactly the row nobody can explain or count later.
    statements.push(
      { sql: `DELETE FROM carry_signups WHERE ${inList(removed)}`, args: removed },
      { sql: `DELETE FROM attendance WHERE ${inList(removed)}`, args: removed },
      { sql: `DELETE FROM members WHERE ${inList(removed)}`, args: removed },
    );

    const [cleaned] = await run([
      {
        sql: `SELECT COUNT(DISTINCT party_id) AS n FROM party_members WHERE ${inListOf("member_name", removed)}`,
        args: removed,
      },
    ]);
    cleanedParties = Number(cleaned.flat()[0]?.n ?? 0);

    // The roster row and its seats go in the same batch: a member removed from
    // the guild cannot be left standing in a team because a second call failed.
    statements.push({
      sql: `DELETE FROM party_members WHERE ${inListOf("member_name", removed)}`,
      args: removed,
    });
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const member of members) {
    const before = was.get(member.name);
    if (!before) {
      added++;
    } else if (before.job === member.job && before.level === member.level) {
      // Identical to what is already stored. Leaving it out keeps the batch to
      // what actually changes, and makes a second import of the same file a
      // genuine no-op.
      unchanged++;
      continue;
    } else {
      updated++;
    }

    statements.push({
      sql: `INSERT INTO members (name, job, level, position)
            VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM members))
            ON CONFLICT(name) DO UPDATE SET
              job   = excluded.job,
              level = excluded.level`,
      args: [member.name, member.job, member.level],
    });
  }

  if (statements.length > 0) {
    await run(statements);
  }

  return {
    added,
    updated,
    unchanged,
    removed,
    removedAttendance,
    cleanedParties,
  };
}

/** `name IN (?, ?, …)` with as many placeholders as there are names. */
function inList(values: string[]): string {
  return `name IN (${values.map(() => "?").join(", ")})`;
}

/** The same list predicate for a column other than `name`. */
function inListOf(column: string, values: string[]): string {
  return `${column} IN (${values.map(() => "?").join(", ")})`;
}

/**
 * Deletes a member for good — the roster row, every attendance row for that
 * name, every carry sign-up, and every team they were standing in. The only way
 * a member leaves the guild now: there is no archiving, and no undo.
 *
 * The teams are part of the same batch rather than a follow-up call. A name off
 * the roster but still in a team shows on the board as a blank icon reading
 * "นอกรายชื่อ", and a cleanup that failed halfway would leave exactly that
 * behind on the day someone left. `syncMembers` removes names the same way, for
 * the same reason — leaving the guild by bin and by import must end in the same
 * place, or the import becomes the way to remove someone quietly.
 *
 * Returns how many attendance rows were removed and how many teams were cleaned,
 * for the report.
 */
export async function deleteMember(name: string): Promise<MemberDeleteSummary> {
  const [found] = await run([
    { sql: "SELECT name FROM members WHERE name = ?", args: [name] },
  ]);
  if (!found.flat().length) {
    throw new Error("no such member");
  }

  const [counted, cleaned] = await run([
    { sql: "SELECT COUNT(*) AS n FROM attendance WHERE name = ?", args: [name] },
    {
      sql: "SELECT COUNT(DISTINCT party_id) AS n FROM party_members WHERE member_name = ?",
      args: [name],
    },
    { sql: "DELETE FROM carry_signups WHERE name = ?", args: [name] },
    { sql: "DELETE FROM attendance WHERE name = ?", args: [name] },
    { sql: "DELETE FROM members WHERE name = ?", args: [name] },
    { sql: "DELETE FROM party_members WHERE member_name = ?", args: [name] },
  ]);

  return {
    deleted: Number(counted.flat()[0]?.n ?? 0),
    cleanedParties: Number(cleaned.flat()[0]?.n ?? 0),
  };
}

/**
 * Replaces the party snapshot and returns the new snapshot version.
 *
 * `eventRows` is passed only by a box edit. Without it the existing rows are
 * kept, which is what a member/team edit wants: changing a roster must not
 * rewrite the boxes of every event.
 *
 * Placements are validated against the rows in this same call, so deleting a
 * box is one write: the row disappears and its teams land in "ว่าง", with no
 * window in which a card points at a missing row.
 *
 * `expectedVersion` is the number the caller read with the list it edited. When
 * it does not match the stored version, the write is refused with
 * `PartyConflictError` instead of replacing work a second tab saved in the
 * meantime. The comparison and the bump are not one atomic step (the version is
 * read before the batch), so two writers that submit within the same round trip
 * can still race — that is no worse than the last-write-wins replace this
 * replaces, and it closes the case that actually happens: one tab, then another
 * a moment later.
 *
 * The DELETE and the INSERTs — and the version bump — go out as one batch, which
 * libSQL runs as a single transaction: a failure part way through cannot leave
 * the guild with half the teams, or a version that disagrees with the data.
 */
export async function saveParties(
  parties: Party[],
  eventRows?: EventRow[],
  expectedVersion?: number
): Promise<number> {
  const rows = eventRows ?? (await readEventRows());
  const current = await readPartyVersion();

  if (expectedVersion !== undefined && expectedVersion !== current) {
    throw new PartyConflictError(
      `ปาร์ตี้อัปเดตไปแล้วจากแท็บ/เครื่องอื่น (หน้าที่เปิดอยู่เห็นเวอร์ชัน ${expectedVersion} · ` +
        `ล่าสุด ${current}) — รีเฟรชหน้าเว็บก่อนจัดต่อ เพื่อไม่ให้ทับงานที่เพิ่งบันทึกไป`
    );
  }

  const next = current + 1;
  const statements = partyStatements(parties, rows, eventRows !== undefined);
  statements.push({
    sql: `INSERT INTO app_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [PARTY_VERSION_KEY, String(next)],
  });

  await run(statements);
  return next;
}

export function guildTimeZone(): string {
  return process.env.GUILD_TIMEZONE || "Asia/Bangkok";
}