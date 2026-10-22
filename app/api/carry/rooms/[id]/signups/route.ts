import { requireCarryRoomAccess } from "@/lib/carry-auth";
import {
  clearCarryRoomSignups,
  deleteCarrySignup,
  readCarryRoom,
  transferAllCarrySignups,
  transferCarrySignup,
  updateCarrySignupNote,
} from "@/lib/db";
import { CARRY_NOTE_MAX_LENGTH } from "@/lib/rngw/types";

/**
 * PATCH  /api/carry/rooms/[id]/signups → edit one queue note
 * DELETE /api/carry/rooms/[id]/signups → remove one name, or clear the queue
 * POST   /api/carry/rooms/[id]/signups → transfer one name or the whole queue
 *
 * All three require the source room's carrier session (or an admin session).
 * A transfer targets an *open* room: moving someone into a queue that is not
 * accepting people would be a back door around the closed switch. The source
 * carrier may move a name to another carrier's room; the requirement is
 * explicitly that carriers can hand people over, so no target PIN is needed.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const room = await readRoomFromParams(params);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }
  if (room instanceof Response) return room;

  const denied = await requireCarryRoomAccess(room);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { name, note } = (body ?? {}) as Record<string, unknown>;
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
    const updated = await updateCarrySignupNote(
      room.id,
      name.trim(),
      trimmedNote || undefined
    );
    if (!updated) {
      return Response.json(
        { error: "ไม่พบชื่อนี้ในคิวของห้อง" },
        { status: 404 }
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const room = await readRoomFromParams(params);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }
  if (room instanceof Response) return room;

  const denied = await requireCarryRoomAccess(room);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { name, all } = (body ?? {}) as Record<string, unknown>;

  try {
    if (all === true) {
      const removed = await clearCarryRoomSignups(room.id);
      return Response.json({ ok: true, removed });
    }

    if (typeof name !== "string" || !name.trim()) {
      return Response.json(
        { error: "name is required (or all: true)" },
        { status: 400 }
      );
    }

    const removed = await deleteCarrySignup(room.id, name.trim());
    if (!removed) {
      return Response.json(
        { error: "ไม่พบชื่อนี้ในคิวของห้อง" },
        { status: 404 }
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const room = await readRoomFromParams(params);
  if (!room) {
    return Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
  }
  if (room instanceof Response) return room;

  const denied = await requireCarryRoomAccess(room);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { name, toRoomId, all } = (body ?? {}) as Record<string, unknown>;
  const movingAll = all === true;

  if (!movingAll && (typeof name !== "string" || !name.trim())) {
    return Response.json(
      { error: "name is required (or all: true)" },
      { status: 400 }
    );
  }
  if (
    typeof toRoomId !== "number" ||
    !Number.isInteger(toRoomId) ||
    toRoomId < 1
  ) {
    return Response.json({ error: "toRoomId is required" }, { status: 400 });
  }
  if (toRoomId === room.id) {
    return Response.json(
      { error: "ต้องย้ายไปห้องอื่น ไม่ใช่ห้องเดิม" },
      { status: 400 }
    );
  }

  const target = await readCarryRoom(toRoomId);
  if (!target) {
    return Response.json({ error: "ไม่พบห้องปลายทาง" }, { status: 404 });
  }
  if (!target.open) {
    return Response.json(
      { error: "ห้องปลายทางปิดรับคิวอยู่ — เปิดรับก่อนย้าย" },
      { status: 409 }
    );
  }

  try {
    if (movingAll) {
      const moved = await transferAllCarrySignups(room.id, target.id);
      if (moved === 0) {
        const currentTarget = await readCarryRoom(toRoomId);
        if (!currentTarget) {
          return Response.json({ error: "ไม่พบห้องปลายทาง" }, { status: 404 });
        }
        if (!currentTarget.open) {
          return Response.json(
            { error: "ห้องปลายทางปิดรับคิวอยู่ — เปิดรับก่อนย้าย" },
            { status: 409 }
          );
        }
        return Response.json(
          { error: "ไม่มีชื่อในคิวของห้องนี้แล้ว — รีเฟรชก่อนลองอีกครั้ง" },
          { status: 409 }
        );
      }
      return Response.json({ ok: true, moved });
    }

    const result = await transferCarrySignup(
      room.id,
      target.id,
      (name as string).trim()
    );
    if (result === "missing") {
      // The UPDATE also checks that the target is still open, so a room closed
      // or deleted between the read above and the write looks like a missing
      // source row. Re-read the target to answer with the real reason.
      const currentTarget = await readCarryRoom(toRoomId);
      if (!currentTarget) {
        return Response.json({ error: "ไม่พบห้องปลายทาง" }, { status: 404 });
      }
      if (!currentTarget.open) {
        return Response.json(
          { error: "ห้องปลายทางปิดรับคิวอยู่ — เปิดรับก่อนย้าย" },
          { status: 409 }
        );
      }
      return Response.json(
        { error: "ไม่พบชื่อนี้ในคิวของห้อง — อาจถูกลบหรือย้ายไปแล้ว" },
        { status: 404 }
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

/**
 * The params promise gives a string; this returns either the room or an error
 * Response. The sentinel keeps the three handlers from repeating the parse.
 */
async function readRoomFromParams(
  params: Promise<{ id: string }>
): Promise<
  Awaited<ReturnType<typeof readCarryRoom>> | Response
> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ error: "invalid room id" }, { status: 400 });
  }
  const room = await readCarryRoom(id);
  return room ?? Response.json({ error: "ไม่พบห้องแบกนี้" }, { status: 404 });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
