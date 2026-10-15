import { guildDateKey, rosterWithStatus } from "@/lib/rngw/attendance";
import { isAttendanceStatus } from "@/lib/rngw/types";
import { appendAttendance, guildTimeZone, readAll } from "@/lib/db";

/**
 * GET  /api/attendance?date=YYYY-MM-DD  → roster joined with that day's status
 * POST /api/attendance                  → submit one member's status
 *
 * The date defaults to today in the guild's timezone. It is always computed
 * server-side so a member with a wrong device clock can't write today's
 * status into yesterday's column.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const timeZone = guildTimeZone();
  const date = url.searchParams.get("date") ?? guildDateKey(new Date(), timeZone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const { members, attendance } = await readAll();
    return Response.json({ date, timeZone, roster: rosterWithStatus(members, attendance, date) });
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

  const { name, status, note } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  if (!isAttendanceStatus(status)) {
    return Response.json({ error: "status must be present, leave or unknown" }, { status: 400 });
  }

  try {
    // No PIN: members report their own status without authenticating. The
    // sheet can only gain a status row from this, and the newest row per
    // member wins, so a bad-faith submission is overcorrectable.
    await appendAttendance({
      name: name.trim(),
      date: guildDateKey(new Date(), guildTimeZone()),
      status,
      note: typeof note === "string" && note.trim() ? note.trim() : undefined,
      submittedAt: Date.now(),
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}