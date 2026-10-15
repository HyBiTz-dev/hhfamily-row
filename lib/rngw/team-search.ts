/**
 * Finding one player on an event board.
 *
 * A guild league board is a wall of team cards; the question a member actually
 * has is "which team am I in?", and scanning names is the slow way to answer
 * it. Lives outside the components so the matching rule can be reasoned about
 * on its own — and so the board and the highlight inside a card cannot disagree
 * about what counts as a match.
 *
 * Names are compared with a plain case-insensitive `includes`, not Thai
 * collation: a character name may be Latin, Thai, or mixed, and searching for
 * the middle of someone's name should work without knowing which.
 */

import type { Party } from "./types";

/** The part of `text` that matches, trimmed and lowercased. Empty = no search. */
export function searchNeedle(query: string): string {
  return query.trim().toLowerCase();
}

/** Whether this team's roster contains the needle. */
export function teamMatchesQuery(team: Party, query: string): boolean {
  const needle = searchNeedle(query);
  if (!needle) return true;
  return team.memberNames.some((name) => name.toLowerCase().includes(needle));
}

/** Teams to show while searching: every team when idle, matches otherwise. */
export function filterTeamsByQuery(teams: Party[], query: string): Party[] {
  const needle = searchNeedle(query);
  if (!needle) return teams;
  return teams.filter((team) => teamMatchesQuery(team, query));
}

/**
 * Where the needle appears in a name, as `[before, match, after]`.
 *
 * Returns null when the name doesn't contain it, so the card can leave that row
 * untouched instead of highlighting nothing.
 */
export function splitHighlight(
  text: string,
  query: string
): { before: string; match: string; after: string } | null {
  const needle = searchNeedle(query);
  if (!needle) return null;

  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return null;

  // Thai has no upper/lower case, so slicing by the lowercased index is safe
  // for the ASCII characters it may be mixed with.
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length),
  };
}