import { requireAdmin } from "@/lib/auth";
import { readAll } from "@/lib/db";
import { guildDateKey, rosterWithStatus } from "@/lib/rngw/attendance";
import { guildTimeZone } from "@/lib/db";

/**
 * GET /api/admin/view[?date=YYYY-MM-DD]
 *
 * Everything the admin panel needs in a single query batch: the roster, the
 * attendance ledger and the parties. One round trip keeps the panel from
 * rendering three separate loading states.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(request.url);
  const timeZone = guildTimeZone();
  const date = url.searchParams.get("date") ?? guildDateKey(new Date(), timeZone);

  try {
    const { members, attendance, parties, eventRows, partyVersion } =
      await readAll();
    return Response.json({
      date,
      timeZone,
      roster: { date, timeZone, roster: rosterWithStatus(members, attendance, date) },
      allMembers: members,
      attendance,
      parties,
      eventRows,
      // Optimistic-lock token for the parties tab; a write sends it back.
      partyVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
