import { isAdmin } from "@/lib/auth";
import { authorizedCarryRoomIds } from "@/lib/carry-auth";
import { readCarryBoard, signUpForCarry, toPublicCarryRoom } from "@/lib/db";
import { CARRY_NOTE_MAX_LENGTH } from "@/lib/rngw/types";

/**
 * GET  /api/carry-signups → every room, every queue, and the roster
 * POST /api/carry-signups → add one roster name to one open room
 *
 * Both are open, like attendance: members sign themselves up without a PIN, and
 * everyone can read every queue. The name still has to match a roster row
 * exactly — the page offers it from a combobox, and the database is the second
 * gate. The PIN only protects managing a room, not joining it.
 */

export async function GET() {
  try {
    const { rooms, signups, done, members } = await readCarryBoard();
    const admin = await isAdmin();
    const authorizedRoomIds = admin
      ? rooms.map((room) => room.id)
      : await authorizedCarryRoomIds(rooms);

    return Response.json({
      rooms: rooms.map(toPublicCarryRoom),
      signups,
      done,
      members,
      authorizedRoomIds,
      isAdmin: admin,
    });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { roomId, name, note } = (body ?? {}) as Record<string, unknown>;
  if (typeof roomId !== "number" || !Number.isInteger(roomId) || roomId < 1) {
    return Response.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote.length > CARRY_NOTE_MAX_LENGTH) {
    return Response.json(
      {
        error: `หมายเหตุยาวเกิน ${CARRY_NOTE_MAX_LENGTH} ตัวอักษร — ย่อให้สั้นลงก่อน`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await signUpForCarry(
      roomId,
      name.trim(),
      trimmedNote || undefined
    );

    switch (result.kind) {
      case "not-member":
        return Response.json(
          { error: "ไม่พบชื่อนี้ในรายชื่อสมาชิก — เลือกชื่อจากรายการเท่านั้น" },
          { status: 400 }
        );
      case "room-missing":
        return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
      case "room-closed":
        return Response.json(
          { error: "ห้องนี้ปิดรับคิวอยู่ — รอคนแบกเปิดรับอีกครั้ง" },
          { status: 409 }
        );
      case "existing":
        return Response.json(
          {
            error: `ชื่อนี้อยู่ในคิวของ “${result.location.roomTitle}” (${result.location.carrierName}) อยู่แล้ว`,
            existing: result.location,
          },
          { status: 409 }
        );
      case "added":
        return Response.json({ ok: true }, { status: 201 });
    }
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
