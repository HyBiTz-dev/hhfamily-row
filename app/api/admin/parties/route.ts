import { requireAdmin } from "@/lib/auth";
import { saveParties } from "@/lib/db";
import { parseParties } from "@/lib/party";
import type { Party } from "@/lib/rngw/types";

/**
 * PUT /api/admin/parties  → replace the saved parties with this list
 *
 * Admin session cookie required. The whole table is rewritten rather than
 * diffed: only the guild master edits parties, so a last-write-wins replace
 * is simpler and safe. The delete and the inserts share one transaction, so a
 * failed save leaves the previous list untouched instead of half of it.
 */

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { parties } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseParties(JSON.stringify(Array.isArray(parties) ? parties : []));

  try {
    await saveParties(parsed as Party[]);
    return Response.json({ ok: true, count: parsed.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
