import {
  normalizeRoomPin,
  setRoomSession,
  verifyRoomPin,
} from "@/lib/carry-auth";
import { readCarryRoom, toPublicCarryRoom } from "@/lib/db";
import { CARRY_PIN_MAX_LENGTH, CARRY_PIN_MIN_LENGTH } from "@/lib/rngw/types";

/**
 * POST /api/carry/rooms/[id]/login → enter one room's carrier mode.
 *
 * The PIN is compared against the scrypt hash in `carry_rooms`; a match sets
 * the signed room cookie for seven days. A room PIN is separate from the guild
 * admin PIN, so this route never calls `requireAdmin`.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.SESSION_SECRET) {
    return Response.json(
      { error: "ยังไม่ได้ตั้งค่า SESSION_SECRET — โหมดคนแบกใช้งานไม่ได้" },
      { status: 503 }
    );
  }

  const roomId = Number((await params).id);
  if (!Number.isInteger(roomId) || roomId < 1) {
    return Response.json({ error: "invalid room id" }, { status: 400 });
  }

  const room = await readCarryRoom(roomId);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { pin } = (body ?? {}) as Record<string, unknown>;
  const normalizedPin = normalizeRoomPin(pin);
  if (!normalizedPin) {
    return Response.json(
      {
        error: `รหัสจัดการห้องต้องยาว ${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`,
      },
      { status: 400 }
    );
  }

  if (!verifyRoomPin(normalizedPin, room.pinHash)) {
    return Response.json({ error: "รหัสจัดการห้องไม่ถูกต้อง" }, { status: 401 });
  }

  await setRoomSession(room.id, room.authVersion);
  return Response.json({ ok: true, room: toPublicCarryRoom(room) });
}
