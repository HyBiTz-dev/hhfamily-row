import { requireAdmin } from "@/lib/auth";
import { deleteMember } from "@/lib/db";

/**
 * POST /api/admin/members/purge → delete one member for good.
 *
 * The only way a member leaves the guild. Removing the roster row and every
 * attendance row for that name means the member leaves no trace — what the
 * archiving feature (`active = 0`) used to do slowly, and this does in one go.
 *
 * Both deletes go out as one transaction, so a failure cannot delete the history
 * and keep the roster row.
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
    const { deleted } = await deleteMember(name.trim());
    return Response.json({ ok: true, deleted });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
