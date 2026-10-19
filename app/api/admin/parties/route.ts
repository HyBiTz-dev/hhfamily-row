import { requireAdmin } from "@/lib/auth";
import {
  PartyConflictError,
  PartyInvariantError,
  saveParties,
} from "@/lib/db";
import { parseEventRows, parseParties } from "@/lib/party";

/**
 * PUT /api/admin/parties  → replace the saved parties (and, optionally, rows)
 *
 * Admin session cookie required. `eventRows` is present only for a box edit:
 * add/rename/delete/reorder. Member and team edits omit it, so they leave the
 * boxes of every event alone.
 *
 * `version` is the snapshot token the client read with the list it edited. When
 * it is present and no longer current, the write is refused with 409 rather than
 * clobbering a second tab's newer work; the success body carries the new token
 * so the client can keep editing without a re-read.
 *
 * The delete and the inserts share one transaction, so a failed save leaves the
 * previous list untouched instead of half of it. Placements pointing at a row
 * that is not in the new list become "ว่าง" in the same transaction.
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

  const { parties, eventRows, version } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(parties)) {
    return Response.json({ error: "parties must be an array" }, { status: 400 });
  }
  if (eventRows !== undefined && !Array.isArray(eventRows)) {
    return Response.json({ error: "eventRows must be an array" }, { status: 400 });
  }
  if (version !== undefined && (typeof version !== "number" || !Number.isFinite(version))) {
    return Response.json({ error: "version must be a number" }, { status: 400 });
  }

  const parsed = parseParties(JSON.stringify(parties));
  const rows =
    eventRows === undefined
      ? undefined
      : parseEventRows(JSON.stringify(eventRows));

  try {
    const nextVersion = await saveParties(parsed, rows, version);
    return Response.json({
      ok: true,
      count: parsed.length,
      version: nextVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (error instanceof PartyConflictError) {
      return Response.json({ error: message }, { status: 409 });
    }
    if (error instanceof PartyInvariantError) {
      // A rule the client is supposed to enforce; a valid board cannot trip it.
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 502 });
  }
}
