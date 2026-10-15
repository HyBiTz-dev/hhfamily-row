import { requireAdmin } from "@/lib/auth";
import { readMembers, saveMember } from "@/lib/db";
import { isJobName } from "@/lib/rngw/jobs";
import type { Member } from "@/lib/rngw/types";

/**
 * GET  /api/admin/members  → the roster
 * POST /api/admin/members  → upsert one member
 *
 * Admin session cookie required. `requireAdmin` is the whole check: the
 * database sits behind the server's own token, so there is no second endpoint
 * out there that a leaked PIN would let someone else write to.
 *
 * There is no DELETE here. Leaving the guild is `POST /api/admin/members/purge`,
 * which takes the history with it; archiving was removed rather than kept as a
 * second way to make someone disappear.
 */

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    return Response.json({ members: await readMembers() });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rest = (body ?? {}) as Record<string, unknown>;
  const member = toMember(rest);

  if (!member) {
    return Response.json({ error: "ชื่อสมาชิกและคลาสต้องถูกต้อง" }, { status: 400 });
  }

  try {
    await saveMember(member);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

/**
 * The body comes from a request, so both fields are checked: a member saved
 * with a class name that is not in `JOBS` would lose its icon and its role hint
 * with nothing to explain why. `isJobName` is that check.
 */
function toMember(raw: Record<string, unknown>): Member | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || !isJobName(raw.job)) return null;

  return {
    name,
    job: raw.job,
    level: Number(raw.level) || 0,
    note: typeof raw.note === "string" && raw.note ? raw.note : undefined,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
