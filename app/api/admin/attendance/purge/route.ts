import { requireAdmin } from "@/lib/auth";
import { deleteAttendanceHistory } from "@/lib/db";

/**
 * POST /api/admin/attendance/purge → delete one member's check-in history.
 *
 * The "ลบประวัติ" button in the absences tab uses this to reset the evidence
 * behind a warning. It removes only `attendance` rows: the member stays on the
 * roster, in their teams, and in the carry queues. Removing the person is still
 * `POST /api/admin/members/purge`, which is a separate decision and a separate
 * button on purpose.
 */

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { name } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const deleted = await deleteAttendanceHistory(name.trim());
    return Response.json({ ok: true, deleted });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
