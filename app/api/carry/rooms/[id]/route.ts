import {
  clearRoomSession,
  hashRoomPin,
  normalizeRoomPin,
  requireCarryRoomAccess,
  setRoomSession,
} from "@/lib/carry-auth";
import {
  CarryRoomNotEmptyError,
  deleteCarryRoom,
  readCarryRoom,
  toPublicCarryRoom,
  updateCarryRoom,
} from "@/lib/db";
import {
  CARRY_PIN_MAX_LENGTH,
  CARRY_PIN_MIN_LENGTH,
  CARRY_ROOM_TITLE_MAX_LENGTH,
} from "@/lib/rngw/types";

/**
 * PATCH  /api/carry/rooms/[id] → rename, open/close, or change the PIN
 * DELETE /api/carry/rooms/[id] → remove an empty room
 *
 * The room's PIN (or an admin session) is required. Deleting is not allowed
 * while anyone is queued: deleting the room would silently discard their place,
 * so the route answers 409 with the count and the carrier moves or removes them
 * first.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const roomId = Number((await params).id);
  if (!Number.isInteger(roomId) || roomId < 1) {
    return Response.json({ error: "invalid room id" }, { status: 400 });
  }

  const room = await readCarryRoom(roomId);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }

  const denied = await requireCarryRoomAccess(room);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { title, open, pin } = (body ?? {}) as Record<string, unknown>;
  if (title === undefined && open === undefined && pin === undefined) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  let trimmedTitle: string | undefined;
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return Response.json({ error: "title must not be empty" }, { status: 400 });
    }
    trimmedTitle = title.trim();
    if (trimmedTitle.length > CARRY_ROOM_TITLE_MAX_LENGTH) {
      return Response.json(
        {
          error: `ชื่อห้องยาวเกิน ${CARRY_ROOM_TITLE_MAX_LENGTH} ตัวอักษร — ย่อให้สั้นลงก่อน`,
        },
        { status: 400 }
      );
    }
  }

  if (open !== undefined && typeof open !== "boolean") {
    return Response.json({ error: "open must be true or false" }, { status: 400 });
  }

  let pinHash: string | undefined;
  if (pin !== undefined) {
    const normalizedPin = normalizeRoomPin(pin);
    if (!normalizedPin) {
      return Response.json(
        {
          error: `รหัสจัดการห้องต้องยาว ${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`,
        },
        { status: 400 }
      );
    }
    pinHash = hashRoomPin(normalizedPin);
  }

  try {
    await updateCarryRoom(room.id, {
      title: trimmedTitle,
      open: open as boolean | undefined,
      pinHash,
    });

    const updated = await readCarryRoom(room.id);
    if (!updated) {
      return Response.json({ error: "ห้องถูกลบไปแล้ว" }, { status: 404 });
    }

    // Keep the current operator inside the room after changing its PIN. The
    // new token carries the bumped auth version; every other device is out.
    if (pinHash) await setRoomSession(updated.id, updated.authVersion);

    return Response.json({ ok: true, room: toPublicCarryRoom(updated) });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const roomId = Number((await params).id);
  if (!Number.isInteger(roomId) || roomId < 1) {
    return Response.json({ error: "invalid room id" }, { status: 400 });
  }

  const room = await readCarryRoom(roomId);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }

  const denied = await requireCarryRoomAccess(room);
  if (denied) return denied;

  try {
    await deleteCarryRoom(room.id);
    await clearRoomSession(room.id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CarryRoomNotEmptyError) {
      return Response.json(
        {
          error: `ห้องนี้ยังมี ${error.count} คนในคิว — ย้ายหรือลบสมาชิกก่อนลบห้อง`,
          count: error.count,
        },
        { status: 409 }
      );
    }
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
