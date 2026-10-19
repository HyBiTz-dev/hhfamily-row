"use client"

import * as React from "react"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { GameIcon } from "@/components/game-icon"
import { DragSafe } from "@/components/drag-safe"
import { StatusBadge, STATUS_LABEL } from "@/components/leave/roster-list"
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
  /** Card-order controls (↑/↓) on a lane board. */
  order,
  /** Rendered under the members — the "add to team" control on a lane board. */
  addMember,
  /** A control on each member row, e.g. the remove button on a lane board. */
  renderMemberAction,
  /**
   * Makes each member's name row tappable so that person can check in on the
   * spot. Only the read-only board and the guild master's board pass this; the
   * drag overlay copy does not, because nothing on it is meant to be tapped
   * mid-drag.
   */
  onCheckIn,
  /**
   * Makes each member row draggable (onto another member) and a drop target.
   * Admin boards only — a read-only card sits outside any `DndContext`, where
   * the dnd hooks would throw.
   */
  draggableMembers,
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
  order?: React.ReactNode
  addMember?: React.ReactNode
  renderMemberAction?: (name: string) => React.ReactNode
  /** Called with the member's name when their row is tapped. */
  onCheckIn?: (name: string) => void
  /** Admin board: rows can be picked up and dropped onto another row. */
  draggableMembers?: boolean
  dragging?: boolean
  /** The member's own name, highlighted inside the card. */
  query?: string
  /**
   * Sizing lives with the caller: the lane board's card is a drag handle and the
   * overlay copy has to be the same width or the card resizes under the finger.
   */
  className?: string
}) {
  // `party_members.slot` order is the guild master's arrangement, and the board
  // shows it as written. There is no "today first" sort any more: a card that
  // reorders itself overnight is a card whose order cannot be arranged.
  const members = team.memberNames.map((name) => ({
    name,
    member: byName.get(name),
  }))

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
        {(order || move || action || grip) && (
          <CardAction className="flex items-center gap-0.5">
            {order}
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
            {members.map(({ name, member }) => {
              /*
                A member's own status is the one thing they open this page to
                change, so the row itself is the button — not a checkbox or a
                form somewhere else. The card is a drag handle on the admin
                board, hence `DragSafe`: a press on the name must not be claimed
                by the sensor as a long-press drag.
              */
              const canCheckIn = Boolean(onCheckIn) && Boolean(member)

              if (draggableMembers) {
                return (
                  <BoardMemberRow
                    key={name}
                    teamId={team.id}
                    name={name}
                    member={member}
                    query={query}
                    canCheckIn={canCheckIn}
                    onCheckIn={onCheckIn}
                    action={renderMemberAction?.(name)}
                  />
                )
              }

              return (
                <li key={name} className="flex items-center gap-3 py-1.5">
                  {canCheckIn && member ? (
                    <DragSafe>
                      <button
                        type="button"
                        onClick={() => onCheckIn?.(name)}
                        title="แตะเพื่อเช็คชื่อ มา / ลา"
                        aria-label={`เช็คชื่อ ${name} — ตอนนี้${STATUS_LABEL[member.status]}`}
                        className="hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 -mx-1 flex min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-md px-1 py-1 text-left transition-colors focus-visible:ring-3 focus-visible:outline-none"
                      >
                        <MemberRowBody name={name} member={member} query={query} />
                      </button>
                    </DragSafe>
                  ) : (
                    <MemberRowBody name={name} member={member} query={query} />
                  )}
                  {renderMemberAction?.(name)}
                </li>
              )
            })}
          </ul>
        )}
        {addMember && <div className="pt-2">{addMember}</div>}
      </CardContent>
    </Card>
  )
}

const MEMBER_DRAG_PREFIX = "member:"
const MEMBER_SEAT_DROP_PREFIX = "member-seat:"

/** The icon + name + job + status, shared by the plain and draggable rows. */
function MemberRowBody({
  name,
  member,
  query,
}: {
  name: string
  member: MemberStatus | undefined
  query?: string
}) {
  return (
    <>
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
    </>
  )
}

/**
 * A member row on an admin board: draggable onto another row, and itself a
 * drop target.
 *
 * The drag listeners sit on the check-in button inside `DragSafe`, not on the
 * card, so a long press on a name picks up *that player* rather than the team.
 * `DragSafe` keeps the card's own sensor from hearing the same press. dnd-kit
 * swallows the click after activation, so a real drag never opens the check-in
 * dialog by accident.
 */
function BoardMemberRow({
  teamId,
  name,
  member,
  query,
  canCheckIn,
  onCheckIn,
  action,
}: {
  teamId: string
  name: string
  member: MemberStatus | undefined
  query?: string
  canCheckIn: boolean
  onCheckIn?: (name: string) => void
  action?: React.ReactNode
}) {
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: `${MEMBER_DRAG_PREFIX}${teamId}:${name}`,
    data: { type: "member", name, from: teamId },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${MEMBER_SEAT_DROP_PREFIX}${teamId}:${name}`,
    data: { type: "member-seat", teamId, name },
  })
  const setNodeRef = React.useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  return (
    <li
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className={cn(
        "flex items-center gap-3 rounded-md py-1.5",
        isOver && "bg-secondary ring-primary/40 ring-2"
      )}
    >
      {canCheckIn && member ? (
        <DragSafe>
          <button
            type="button"
            {...listeners}
            {...attributes}
            onClick={() => onCheckIn?.(name)}
            title="แตะเพื่อเช็คชื่อ มา / ลา · ลากไปวางบนชื่ออื่นเพื่อสลับ"
            aria-label={`เช็คชื่อ ${name} — ตอนนี้${STATUS_LABEL[member.status]}`}
            className="hover:bg-muted/60 active:bg-muted focus-visible:ring-ring/50 -mx-1 flex min-w-0 flex-1 cursor-grab touch-manipulation items-center gap-3 rounded-md px-1 py-1 text-left transition-colors focus-visible:ring-3 focus-visible:outline-none active:cursor-grabbing"
          >
            <MemberRowBody name={name} member={member} query={query} />
          </button>
        </DragSafe>
      ) : (
        <DragSafe>
          <div
            {...listeners}
            {...attributes}
            className="-mx-1 flex min-w-0 flex-1 cursor-grab touch-manipulation items-center gap-3 rounded-md px-1 py-1 active:cursor-grabbing"
          >
            <MemberRowBody name={name} member={member} query={query} />
          </div>
        </DragSafe>
      )}
      {action}
    </li>
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