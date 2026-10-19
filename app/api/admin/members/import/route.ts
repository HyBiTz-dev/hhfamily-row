import { requireAdmin } from "@/lib/auth";
import { syncMembers } from "@/lib/db";
import { isJobName } from "@/lib/rngw/jobs";
import { MAX_IMPORT_ROWS } from "@/lib/rngw/member-csv";
import type { Member } from "@/lib/rngw/types";

/**
 * Applies a roster export the client already read.
 *
 * The file is parsed in the browser rather than posted here, so the guild master
 * sees exactly what will change before anything is written and this route is
 * only reached once they have agreed to it. What arrives is a plain list of
 * members, which means the same gate as everywhere else has to be applied here
 * anyway: `isJobName`. A class the app does not have is refused, because
 * writing it would leave that member on the roster with no icon and no hint of
 * why.
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

  const raw = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.members)) {
    return Response.json({ error: "members is required" }, { status: 400 });
  }
  if (raw.members.length > MAX_IMPORT_ROWS) {
    return Response.json(
      { error: `ไฟล์นี้ใหญ่เกินไป (${raw.members.length} คน)` },
      { status: 400 },
    );
  }

  const members = toMembers(raw.members);
  if (!members) {
    return Response.json({ error: "ข้อมูลในไฟล์ไม่ถูกต้อง" }, { status: 400 });
  }
  if (members.length === 0) {
    return Response.json(
      { error: "ไฟล์นี้ไม่มีสมาชิกให้นำเข้า — ถ้ากดตกลง รายชื่อเดิมจะหายทั้งหมด" },
      { status: 400 },
    );
  }

  try {
    return Response.json({ ok: true, summary: await syncMembers(members) });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 502 });
  }
}

function toMembers(raw: unknown[]): Member[] | null {
  const members: Member[] = [];
  for (const item of raw) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name || !isJobName(entry.job)) return null;

    members.push({ name, job: entry.job, level: Number(entry.level) || 0 });
  }
  return members;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
