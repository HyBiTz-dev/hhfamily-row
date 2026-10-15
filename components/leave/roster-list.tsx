"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { GameIcon } from "@/components/game-icon"
import type { AttendanceStatus, MemberStatus } from "@/lib/rngw/types"
import { cn } from "cn"

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "มา",
  leave: "ลา",
  unknown: "รอเช็ค",
}

const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  leave: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
}

/**
 * The same colour language, for text only.
 *
 * Tab triggers keep shadcn's own background — the white active card has to
 * stay readable as "this is the one you are reading" — so the colour goes on
 * the label. Tinting the whole trigger instead means fighting the built-in
 * `data-active:` utilities over which background wins.
 */
export const STATUS_TEXT_CLASS: Record<AttendanceStatus, string> = {
  present: "text-emerald-700 dark:text-emerald-300",
  leave: "text-amber-700 dark:text-amber-300",
  unknown: "text-muted-foreground",
}

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <Badge variant="outline" className={cn("border", STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/**
 * Roster sorted so the people a guild master cares about — the ones playing
 * today — come first, then people on leave, then the silent ones.
 */
export function sortRoster(roster: MemberStatus[]): MemberStatus[] {
  const rank: Record<AttendanceStatus, number> = { present: 0, leave: 1, unknown: 2 }
  return [...roster].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, "th")
  )
}

export function RosterList({
  roster,
  emptyText,
}: {
  roster: MemberStatus[]
  /**
   * What to say when the list is empty. "No members in the sheet" and "nobody
   * has replied yet" are different problems, and the second one is not the
   * admin's to fix.
   */
  emptyText?: string
}) {
  if (roster.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {emptyText ?? "ยังไม่มีสมาชิกในกิลด์ — ผู้ดูแลต้องเพิ่มในแท็บ “สมาชิก” ก่อน"}
      </p>
    )
  }

  return (
    <ul className="divide-border divide-y">
      {sortRoster(roster).map((member) => (
        <li
          key={member.name}
          className="flex items-center gap-3 py-2.5"
        >
          <GameIcon job={member.job} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {member.name}
              {member.level > 0 && (
                <span className="text-muted-foreground ml-2 text-xs">
                  Lv.{member.level}
                </span>
              )}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {member.job}
              {member.note ? ` · ${member.note}` : ""}
            </p>
          </div>
          <StatusBadge status={member.status} />
        </li>
      ))}
    </ul>
  )
}

/** How many members sit in each status. The tab labels read from this. */
export function countByStatus(roster: MemberStatus[]): Record<AttendanceStatus, number> {
  const counts: Record<AttendanceStatus, number> = { present: 0, leave: 0, unknown: 0 }
  for (const member of roster) counts[member.status] += 1
  return counts
}