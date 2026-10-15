import { requireAdmin } from "@/lib/auth";
import { seedDatabase, seededRandom } from "@/lib/seed";

/**
 * POST /api/admin/seed[?reset=1][?weeks=8]
 *
 * Fills the database with the sample guild in `lib/seed.ts`.
 *
 * Admin session required, like every other write here — it rewrites all three
 * tables. `?reset=1` is what actually allows an overwrite; without it a
 * database that already has members is refused outright, so a stray call can
 * never replace the real roster with names off a list. A failed seed writes
 * nothing: the whole dataset goes in as one transaction.
 *
 * Development tool. It has no place once the guild's own roster is in there —
 * the names are obviously fake, and the only way to tell them apart from real
 * members is to remember this route exists.
 */

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(request.url);
  const reset = url.searchParams.get("reset") === "1";
  const weeks = Number(url.searchParams.get("weeks"));
  const seed = Number(url.searchParams.get("seed"));

  try {
    const summary = await seedDatabase({
      reset,
      weeks: Number.isFinite(weeks) && weeks > 0 ? weeks : undefined,
      random: Number.isFinite(seed) && seed > 0 ? seededRandom(seed) : undefined,
    });
    return Response.json(summary, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // The only refusal the seed itself raises is a populated database, which is
    // the caller's mistake to fix rather than a server fault.
    const refused = message.startsWith("มีสมาชิกอยู่แล้ว");
    return Response.json({ error: message }, { status: refused ? 409 : 500 });
  }
}