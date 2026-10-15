/**
 * Roster search.
 *
 * Kept out of the components so it can be tested without rendering anything.
 * The admin party builder and the member search box both filter, and they
 * must agree.
 */

import { getJob } from "./jobs";
import type { Member } from "./types";

/** Every field someone might plausibly type into the search box. */
function searchableFields(member: Member): string[] {
  const job = getJob(member.job);

  return [
    member.name,
    // `member.job` is the class name itself, so it is searched directly — and
    // that also finds classes jobs.ts no longer knows, which `job?.name` would
    // drop. `nameEn` is still worth matching on for the ones that differ.
    member.job,
    job?.nameEn,
    member.note,
  ].filter((field): field is string => Boolean(field));
}

export function matchesMemberQuery(member: Member, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return searchableFields(member).some((field) => field.toLowerCase().includes(needle));
}

export function filterMembers(members: Member[], query: string): Member[] {
  return members.filter((member) => matchesMemberQuery(member, query));
}

/**
 * Name-only matching, for "type your own name" boxes.
 *
 * `matchesMemberQuery` also matches jobs and notes, which is what you want when
 * hunting through the roster for someone — and exactly what you do not want
 * when someone is typing their own name, because "ยง" should not silently
 * resolve to whichever Ranger happens to be listed first.
 */
export function matchesMemberName(member: Member, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return member.name.toLowerCase().includes(needle);
}
