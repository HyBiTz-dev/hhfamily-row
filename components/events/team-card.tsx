"use client"

import { GameIcon } from "@/components/game-icon"
import { StatusBadge } from "@/components/leave/roster-list"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { splitHighlight } from "@/lib/rngw/team-search"
import type { MemberStatus, Party } from "@/lib/rngw/types"
import { cn } from "cn"

/**
 * One team, read-only, with who on it is playing today.
 *
 * Lives apart from the event board because the lane board drags this same card
 * between rows — anything the board needs to hand a drag along has to be
 * prop-shaped rather than closed over.
 */
export function TeamCard({
  team,
  byName,
  /** Shown in the header corner — the drag handle on a lane board. */
  grip,
  /** A control for the header corner, e.g. the rename button on a lane board. */
  action,
  /** Picks the card up for a button-driven move to another row. */
  move,
  /** Rendered under the members — the "add to team" control on a lane board. */
  addMember,
  /** A control on each member row, e.g. the remove button on a lane board. */
  renderMemberAction,
  dragging,
  query,
  className,
}: {
  team: Party
  byName: Map<string, MemberStatus>
  grip?: React.ReactNode
  action?: React.ReactNode
  /**
   * The move button, shown in the same corner as `action`. It is its own prop
   * rather than part of `action` so the board can decide: the button-driven move
   * is the only way to move a team without dragging, and a read-only card has
   * neither.
   */
  move?: React.ReactNode
  addMember?: React.ReactNode
  renderMemberAction?: (name: string) => React.ReactNode
  dragging?: boolean
  /** The member's own name, highlighted inside the card. */
  query?: string
  /**
   * Sizing lives with the caller: the lane board's card is a drag handle and the
   * overlay copy has to be the same width or the card resizes under the finger.
   */
  className?: string
}) {
  const members = team.memberNames
    .map((name) => ({ name, member: byName.get(name) }))
    .sort((a, b) => {
      // Present first, then leave, then unknown, then anyone the sheet lost.
      const rank = (status?: MemberStatus["status"]) =>
        status === "present" ? 0 : status === "leave" ? 1 : status ? 2 : 3;
      return rank(a.member?.status) - rank(b.member?.status)
    })

  const present = members.filter((entry) => entry.member?.status === "present").length

  return (
    <Card size="sm" className={cn(dragging && "shadow-lg", className)}>
      <CardHeader>
        {/*
          Two lines rather than one. A team name is how the guild master finds
          "the one with the tank in it", and a clipped name is a card they have
          to open or hover to read — the card has five rows to give anyway.
        */}
        <CardTitle className="line-clamp-2 break-words">{team.name}</CardTitle>
        <CardDescription className="tabular-nums">
          {members.length} คน · มาวันนี้ {present} คน
        </CardDescription>
        {(move || action || grip) && (
          <CardAction className="flex items-center gap-0.5">
            {move}
            {action}
            {grip && (
              <span className="text-muted-foreground" aria-hidden>
                {grip}
              </span>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">ยังไม่มีสมาชิกในทีมนี้</p>
        ) : (
          <ul className="divide-border divide-y">
            {members.map(({ name, member }) => (
              <li key={name} className="flex items-center gap-3 py-1.5">
                {member ? (
                  <GameIcon job={member.job} className="size-7" />
                ) : (
                  <span
                    aria-hidden
                    className="bg-muted size-7 shrink-0 rounded-md"
                    title="ไม่พบชื่อนี้ในรายชื่อสมาชิก"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <NameHighlight name={name} query={query} />
                  {member && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {member.job}
                    </span>
                  )}
                </span>
                {member ? (
                  <StatusBadge status={member.status} />
                ) : (
                  <span className="text-muted-foreground shrink-0 text-xs">นอกรายชื่อ</span>
                )}
                {renderMemberAction?.(name)}
              </li>
            ))}
          </ul>
        )}
        {addMember && <div className="pt-2">{addMember}</div>}
      </CardContent>
    </Card>
  )
}

/**
 * The name, with the searched part picked out. A member who types three letters
 * of their name should not then have to hunt through a card to see which of
 * five similar names matched.
 *
 * Wraps to two lines instead of `truncate`: this row already spends its width on
 * an icon, the status badge and the remove button, so at 320px a single-line name
 * was being cut mid-word — and a member who cannot read their own name cannot
 * tell whether they are on the team. `break-words` covers the unspaced Latin
 * names; `min-w-0` on the wrapper keeps it from pushing the badge off the row.
 */
function NameHighlight({ name, query }: { name: string; query?: string }) {
  const parts = query ? splitHighlight(name, query) : null

  if (!parts) {
    return <span className="line-clamp-2 break-words text-sm font-medium">{name}</span>
  }

  return (
    <span className="line-clamp-2 break-words text-sm font-medium">
      {parts.before}
      <mark className="bg-primary/25 text-foreground rounded-sm px-0.5 font-semibold">
        {parts.match}
      </mark>
      {parts.after}
    </span>
  )
}