/**
 * Domain types for the guild tool.
 *
 * Job/class data is static game facts (ids + names) and lives in `jobs.ts`.
 * Everything below is data *we* own and persist to Turso.
 */

/** The boards a party can play on. */
export type EventCategoryId = "guild-war" | "guild-league" | "polarity";

/** Whether a member is playing today. */
export type AttendanceStatus = "present" | "leave" | "unknown";

export const ATTENDANCE_STATUSES = ["present", "leave", "unknown"] as const;

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return ATTENDANCE_STATUSES.includes(value as AttendanceStatus);
}

export interface Member {
  /**
   * In-game character name. Used as the primary key — character names are
   * unique within a guild, so it doubles as the primary key.
   */
  name: string;
  /**
   * Class name, e.g. "Paladin" — a `Job.name` from jobs.ts, stored as the name
   * itself so the database is readable and hand-editable.
   *
   * An unrecognised string is kept and shown rather than rejected: the roster
   * must not go blank because someone renamed a class in jobs.ts, or typed one
   * by hand in the database. See the note at the top of jobs.ts for the trade
   * this makes.
   */
  job: string;
  level: number;
  /** Freeform note, e.g. "main account", "alt". */
  note?: string;
}

/**
 * One member's status for one calendar day, as stored in the append-only
 * `attendance` ledger. Never edit a row in place — submissions append, and
 * `latestByMember()` resolves the winner. That is what keeps two members
 * submitting at the same instant from clobbering each other.
 */
export interface AttendanceRow {
  name: string;
  /** YYYY-MM-DD in the guild's timezone, computed server-side. */
  date: string;
  status: AttendanceStatus;
  note?: string;
  /** Epoch milliseconds — used to order submissions. */
  submittedAt: number;
}

/**
 * One box/team-large on a board.
 *
 * Rows are named by the guild master, for every event. League rows used to be
 * fixed game lanes; they are now the same first-class containers as Guild War
 * boxes, which is why a row can stay empty and be renamed or reordered.
 */
export interface EventRow {
  id: string;
  event: EventCategoryId;
  /** `''` for events without league tabs. */
  division: string;
  name: string;
  position: number;
}

/**
 * Where one party sits on one event's board.
 *
 * A party has one placement per event it plays, so its event set is the set of
 * these rows. The roster is not here: it lives on the party, which is why
 * editing a member on Guild War also changes the same party on Guild League.
 */
export interface PartyPlacement {
  event: EventCategoryId;
  /** `''` for events without league tabs. */
  division: string;
  /** `EventRow.id`, or `null` for the virtual "ว่าง" row. */
  rowId: string | null;
  position: number;
}

/**
 * A party/team.
 *
 * `placements` is the source of truth for which boards the team appears on.
 * `content` is a display label derived from those placements and the row names
 * — never written by the editor, never matched against.
 */
export interface Party {
  id: string;
  name: string;
  /** Derived display label, e.g. "Guild War ทีมสเกา". Read-only. */
  content?: string;
  /** One entry per event this team plays. */
  placements: PartyPlacement[];
  /** Member names, in slot order. */
  memberNames: string[];
  /**
   * Kept out of "delete every party" and out of the trash button.
   *
   * Only deletion — editing still works on a locked party, because "don't wipe
   * the list" and "hands off this team" are different requests and locking
   * that also freezes the name would only make the flag surprising. Unlocked
   * parties fall back to `undefined` so the column stays blank.
   */
  locked?: boolean;
  updatedAt: string;
}

/** A roster entry joined with its status for a particular day. */
export type MemberStatus = Member & {
  status: AttendanceStatus;
  /** Overrides `Member.note` when the member wrote one for this day. */
  note?: string;
  updatedAt?: number;
};

/** Body of `GET /api/attendance`. */
export interface RosterResponse {
  date: string;
  timeZone: string;
  roster: MemberStatus[];
}

/** Optional note cap, shared by the routes and the sign-up form. */
export const CARRY_NOTE_MAX_LENGTH = 100;

/** Cap for a room's name/activity label. */
export const CARRY_ROOM_TITLE_MAX_LENGTH = 80;

/**
 * Hard cap on the number of rooms in the whole board.
 *
 * Rooms are public to create, so without a cap one person can fill the page
 * with empty rooms. The server enforces this inside the insert; the button
 * only mirrors it for convenience. Admins can free slots with the empty-room
 * cleanup, but a non-empty queue always has to be moved or cleared first.
 */
export const CARRY_ROOM_LIMIT = 10;

/** A room's management PIN is short enough to type on a phone, long enough to
 * not be a single tap. Both numbers are shared by the route and the dialogs. */
export const CARRY_PIN_MIN_LENGTH = 4;
export const CARRY_PIN_MAX_LENGTH = 12;

/**
 * A "ห้องแบก" — one carrier's queue for one activity.
 *
 * A member may run several rooms, and each room has its own management PIN and
 * its own open/closed switch. `id` is the route parameter; the PIN hash stays
 * on the server and is deliberately absent from this shape.
 */
export interface CarryRoom {
  id: number;
  carrierName: string;
  title: string;
  open: boolean;
  createdAt: number;
}

/**
 * One person waiting in a room's queue.
 *
 * The queue is global in the sense that a member can be in only one room at a
 * time, so `name` is unique across the whole table. `signedAt` plus the stored
 * sequence keeps the order deterministic; a transfer refreshes `signedAt` so the
 * member lands at the end of the destination queue.
 */
export interface CarrySignup {
  roomId: number;
  name: string;
  /**
   * Optional freeform note the member typed when signing up, e.g. "ว่างหลัง
   * สามทุ่ม". Kept short (the route and the input both cap it at 100 chars) and
   * shown under the name in the queue.
   */
  note?: string;
  signedAt: number;
}

/** Where a name already sits, used to explain a refused duplicate sign-up. */
export interface CarryQueueLocation {
  roomId: number;
  roomTitle: string;
  carrierName: string;
}

/** Body of `GET /api/carry-signups`: every room, every queue, and the roster.
 *
 * `authorizedRoomIds` is computed from the carrier session cookies on the
 * server. It is not a permission check by itself — every write route checks the
 * same cookie again — but it lets the page show the correct controls without
 * shipping any PIN or hash to the browser.
 */
export interface CarryBoardResponse {
  rooms: CarryRoom[];
  signups: CarrySignup[];
  members: Member[];
  authorizedRoomIds: number[];
  /**
   * True only for the guild-admin session, not for a carrier who happens to
   * hold every room's PIN. The page uses it for the bulk "remove empty rooms"
   * tool; the API checks the admin session again before every deletion.
   */
  isAdmin: boolean;
}