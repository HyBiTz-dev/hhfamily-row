import "server-only";

/**
 * Carrier mode: a room PIN, not the guild admin PIN.
 *
 * Each `carry_rooms` row carries a scrypt hash of the PIN its creator chose.
 * Knowing that PIN is what allows someone to manage that room's queue. The
 * admin PIN is separate and still unlocks everything through `requireAdmin` —
 * this module only adds the narrower "this room's owner" path.
 *
 * A successful login sets `guild_carry_room_<id>` to an HMAC-signed token. The
 * token includes `auth_version`, which `lib/db.ts` increments whenever the PIN
 * changes, so changing a PIN invalidates old sessions without a session table.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { isAdmin } from "@/lib/auth";

// Re-exported so routes and dialogs only need one carrier-auth import. The
// hashing itself lives in `carry-pin.ts`, which has no `next/headers` import.
export {
  hashRoomPin,
  normalizeRoomPin,
  verifyRoomPin,
} from "@/lib/carry-pin";

const ROOM_COOKIE_PREFIX = "guild_carry_room_";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET — carrier mode is unavailable.");
  }
  return secret;
}

function cookieName(roomId: number): string {
  return `${ROOM_COOKIE_PREFIX}${roomId}`;
}

function sign(roomId: number, authVersion: number, expiresAt: number): string {
  return createHmac("sha256", sessionSecret())
    .update(`carry-room:${roomId}:${authVersion}:${expiresAt}`)
    .digest("base64url");
}

/** Token format: `<roomId>.<authVersion>.<expiresAtMs>.<hmac>` */
export function createRoomToken(roomId: number, authVersion: number): string {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  return `${roomId}.${authVersion}.${expiresAt}.${sign(roomId, authVersion, expiresAt)}`;
}

export function verifyRoomToken(
  token: string | undefined,
  roomId: number,
  authVersion: number
): boolean {
  if (!token) return false;

  const [tokenRoomId, tokenVersion, expiresAt, signature] = token.split(".");
  if (!tokenRoomId || !tokenVersion || !expiresAt || !signature) return false;
  if (Number(tokenRoomId) !== roomId) return false;
  if (Number(tokenVersion) !== authVersion) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = Buffer.from(sign(roomId, authVersion, expiry));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;

  return timingSafeEqual(expected, given);
}

export async function setRoomSession(
  roomId: number,
  authVersion: number
): Promise<void> {
  const store = await cookies();
  store.set(cookieName(roomId), createRoomToken(roomId, authVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearRoomSession(roomId: number): Promise<void> {
  const store = await cookies();
  store.delete(cookieName(roomId));
}

/**
 * Which rooms this browser may manage, according to the signed room cookies.
 *
 * Returns [] rather than throwing when SESSION_SECRET is absent: the public
 * board should still render in a half-configured environment, it just cannot
 * enter carrier mode. Writes still go through `requireCarryRoomAccess`.
 */
export async function authorizedCarryRoomIds(
  rooms: Array<{ id: number; authVersion: number }>
): Promise<number[]> {
  if (!process.env.SESSION_SECRET) return [];

  const store = await cookies();
  return rooms
    .filter((room) =>
      verifyRoomToken(
        store.get(cookieName(room.id))?.value,
        room.id,
        room.authVersion
      )
    )
    .map((room) => room.id);
}

/**
 * Gate for every carrier write. The guild admin may manage any room; otherwise
 * the browser must hold that room's signed cookie. Returns a 401 response for
 * callers to return directly, matching `requireAdmin`.
 */
export async function requireCarryRoomAccess(room: {
  id: number;
  authVersion: number;
}): Promise<Response | null> {
  if (await isAdmin()) return null;
  if (!process.env.SESSION_SECRET) {
    return Response.json(
      { error: "ยังไม่ได้ตั้งค่า SESSION_SECRET — โหมดคนแบกใช้งานไม่ได้" },
      { status: 503 }
    );
  }

  const store = await cookies();
  const token = store.get(cookieName(room.id))?.value;
  if (verifyRoomToken(token, room.id, room.authVersion)) return null;

  return Response.json(
    { error: "ต้องเข้าสู่โหมดคนแบกของห้องนี้ก่อน" },
    { status: 401 }
  );
}
