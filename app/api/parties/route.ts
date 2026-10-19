import { readPartiesAndRows } from "@/lib/db";

/**
 * GET /api/parties → the parties and the boxes they point at
 *
 * Public, like the roster: members need to see which party the guild master
 * put together. Only the admin can write them (see /api/admin/parties).
 *
 * The rows travel with the parties because a placement stores only `rowId`;
 * without the names the board cannot label a box.
 */
export async function GET() {
  try {
    const { parties, eventRows, version } = await readPartiesAndRows();
    return Response.json({ parties, eventRows, version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
