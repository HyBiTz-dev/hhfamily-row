import { readParties } from "@/lib/db";
import { parseParties } from "@/lib/party";

/**
 * GET /api/parties → the parties saved on the sheet
 *
 * Public, like the roster: members need to see which party the guild master
 * put together. Only the admin can write them (see /api/admin/parties).
 */
export async function GET() {
  try {
    return Response.json({ parties: parseParties(JSON.stringify(await readParties())) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
