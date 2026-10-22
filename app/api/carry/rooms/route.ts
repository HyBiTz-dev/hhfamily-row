import {
  hashRoomPin,
  normalizeRoomPin,
  setRoomSession,
} from "@/lib/carry-auth";
import { createCarryRoom, readMembers, toPublicCarryRoom } from "@/lib/db";
import {
  CARRY_PIN_MAX_LENGTH,
  CARRY_PIN_MIN_LENGTH,
  CARRY_ROOM_LIMIT,
  CARRY_ROOM_TITLE_MAX_LENGTH,
} from "@/lib/rngw/types";

/**
 * POST /api/carry/rooms → create a room and enter its carrier mode.
 *
 * This is the only public write on the page. Anyone may open a room for an
 * activity; the PIN they choose is what later proves they may manage that
 * room's queue. `carrierName` must be a real roster name, but the PIN — not the
 * name — is the credential. The creator is logged into the new room immediately
 * so they can set it up without typing the PIN twice.
 */

export async function POST(request: Request) {
  if (!process.env.SESSION_SECRET) {
    return Response.json(
      { error: "ยังไม่ได้ตั้งค่า SESSION_SECRET — สร้างห้องแบกไม่ได้" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { carrierName, title, pin } = (body ?? {}) as Record<string, unknown>;
  if (typeof carrierName !== "string" || !carrierName.trim()) {
    return Response.json({ error: "carrierName is required" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length > CARRY_ROOM_TITLE_MAX_LENGTH) {
    return Response.json(
      {
        error: `ชื่อห้องยาวเกิน ${CARRY_ROOM_TITLE_MAX_LENGTH} ตัวอักษร — ย่อให้สั้นลงก่อน`,
      },
      { status: 400 }
    );
  }

  const normalizedPin = normalizeRoomPin(pin);
  if (!normalizedPin) {
    return Response.json(
      {
        error: `รหัสจัดการห้องต้องยาว ${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`,
      },
      { status: 400 }
    );
  }

  try {
    const members = await readMembers();
    if (!members.some((member) => member.name === carrierName.trim())) {
      return Response.json(
        { error: "ไม่พบชื่อคนแบกในรายชื่อสมาชิก — เลือกชื่อจากรายการเท่านั้น" },
        { status: 400 }
      );
    }

    const room = await createCarryRoom({
      carrierName: carrierName.trim(),
      title: trimmedTitle,
      pinHash: hashRoomPin(normalizedPin),
    });
    if (!room) {
      return Response.json(
        {
          error: `สร้างห้องแบกครบ ${CARRY_ROOM_LIMIT} ห้องแล้ว — ลบห้องว่างหรือย้าย/ล้างคิวก่อนสร้างใหม่`,
        },
        { status: 409 }
      );
    }

    // Carries the new auth version, so a later PIN change invalidates it.
    await setRoomSession(room.id, room.authVersion);

    return Response.json(
      { ok: true, room: toPublicCarryRoom(room) },
      { status: 201 }
    );
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
