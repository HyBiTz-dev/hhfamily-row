"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ChevronDown, ChevronUp, GripVertical, MoveHorizontal, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddMemberCombobox } from "@/components/events/add-member-combobox"
import { DragSafe } from "@/components/drag-safe"
import { NameDialog } from "@/components/events/name-dialog"
import { TeamEditDialog } from "@/components/events/team-edit-dialog"
import { TeamCard } from "@/components/events/team-card"
import { TEAM_MAX_MEMBERS } from "@/lib/party"
import {
  defaultLaneId,
  type LeagueLane,
  type LeagueLaneId,
} from "@/lib/rngw/categories"
import type { MemberStatus, Party } from "@/lib/rngw/types"
import { cn } from "cn"

/** A team of a lane board, with the lane it resolves to already worked out. */
export type TeamInLane = Party & { lane: LeagueLaneId };

/**
 * The rows of one scope, with teams dragged between them.
 *
 * A row is only a label on the party (`Party.content`), so dropping a card
 * changes one string and rewrites the tab — see `replaceDivisionParties`. No
 * player moves, which is why a division's fixed headcount can't be broken by
 * dragging: a team keeps its members wherever it lands.
 *
 * The same board serves Guild League's fixed lanes and Guild War's boxes, which
 * are named by the guild master instead. That is the difference for the rows
 * themselves: `onReorderRow`, `onRenameRow` and `onDeleteRow` are passed for
 * Guild War only, because a league lane is the game's, not theirs. The controls
 * that belong to a *team* rather than a row — `onRenameTeam`, `onAddMember`,
 * `onRemoveMember` — are offered on every board, since a team and its members
 * are the guild master's wherever the team sits.
 *
 * Mobile is the main device here, so the touch sensor waits for a long press
 * before grabbing the card; a short swipe still scrolls the page. That is the
 * same trade-off shadcn's kanban example makes.
 */
export function LaneBoard({
  lanes,
  teams,
  byName,
  members,
  unparked,
  query,
  onMoveTeam,
  onReorderRow,
  onMoveRow,
  onRenameRow,
  onRenameTeam,
  onRemoveMember,
  onAddMember,
  onDeleteRow,
}: {
  lanes: readonly LeagueLane[]
  /** Every team of the scope, each tagged with the row it shows in. */
  teams: TeamInLane[]
  byName: Map<string, MemberStatus>
  /** The full roster, offered as suggestions when adding someone to a team. */
  members: MemberStatus[]
  /** How many of `teams` arrived without saying which row. */
  unparked: number
  /** The member's own name — highlighted on the cards. */
  query?: string
  onMoveTeam: (teamId: string, lane: LeagueLane) => void | Promise<void>
  /** Swaps two named rows. Guild War only — a league lane is the game's. */
  onReorderRow?: (fromId: string, toId: string) => void | Promise<void>
  /** Keyboard equivalent of the drag: nudge one row up or down by one. */
  onMoveRow?: (rowId: string, delta: -1 | 1) => void
  /** Renames a named box. Guild War only — a league lane is the game's. */
  onRenameRow?: (lane: LeagueLane, nextName: string) => void | Promise<void>
  /**
   * Renames a team and may relabel it, from the pencil on its card.
   *
   * Guild War only: a league lane is the game's, but the team inside it is the
   * guild master's, and fixing a typo or a wrong label is what that pencil is
   * for. The label can move the team to another page or another division — the
   * board writes the whole parties tab, so it lands wherever it now belongs.
   */
  onRenameTeam?: (
    teamId: string,
    nextName: string,
    nextContent: string
  ) => void | Promise<void>
  /** Takes a member off a team. Guild War only. */
  onRemoveMember?: (teamId: string, name: string) => void | Promise<void>
  /** Puts a member on a team, after the board confirms a move. Guild War only. */
  onAddMember?: (teamId: string, name: string) => void | Promise<void>
  /** Removes the whole row. Guild War only — see `onDeleteRow`. */
  onDeleteRow?: (lane: LeagueLane) => void
}) {
  const [dragging, setDragging] = React.useState<
    { kind: "team"; team: TeamInLane } | { kind: "row"; lane: LeagueLane } | null
  >(null)

  /**
   * The team picked up by the button, waiting for a destination row.
   *
   * Dragging needs a long press on touch — the card cannot be `touch-action:
   * none` or the page would not scroll under a finger — so on a phone it is both
   * undiscoverable and easy to lose to a scroll gesture. This is the same
   * `onMoveTeam` call in two taps: press the button, press the row. Dragging
   * stays as the shortcut for a mouse, where it needs no hold at all.
   */
  const [movingTeamId, setMovingTeamId] = React.useState<string | null>(null)
  const movingTeam = teams.find((entry) => entry.id === movingTeamId) ?? null

  // Escape backs out of a pending move: a cancel you can only reach with a
  // thumb that happens to be on the right pixel is not a cancel.
  React.useEffect(() => {
    if (!movingTeamId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMovingTeamId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [movingTeamId])

  const sensors = useSensors(
    // A mouse only starts dragging after a few pixels, so a click still clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // A finger has to hold still for a moment, otherwise every page scroll
    // would pick a team card up on the way past. No `touch-action: none` on the
    // card either — that would kill scrolling over it on a phone.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  const byLane = React.useMemo(() => {
    const grouped = new Map<LeagueLaneId, TeamInLane[]>(lanes.map((lane) => [lane.id, []]))
    for (const team of teams) grouped.get(team.lane)?.push(team)
    return grouped
  }, [lanes, teams])

  const fallbackLane = defaultLaneId(lanes)
  // The parking row ("ว่าง") is not a box the guild master named, so it is never
  // counted or moved — only the named boxes reorder among themselves.
  const namedLanes = lanes.filter((lane) => lane.suffix !== "")
  const canReorder = Boolean(onReorderRow) && namedLanes.length > 1

  /**
   * Finish a button move: clear the pending state first, then write.
   *
   * The write is optimistic and rolls itself back on failure, so there is
   * nothing to wait for — and leaving the banner up while it runs would let a
   * second tap queue a second move to a row that is about to be somewhere else.
   */
  const moveHere = movingTeamId
    ? (target: LeagueLane) => {
        const teamId = movingTeamId
        setMovingTeamId(null)
        void onMoveTeam(teamId, target)
      }
    : undefined

  /*
    A dragged row is a thin header, so overlap-based picking is unreliable —
    nearest-centre finds the row the pointer is over. Teams keep the default,
    where the card's own rectangle decides.
  */
  const collisionDetection: CollisionDetection = (args) =>
    args.active.data.current?.type === "row" ? closestCenter(args) : rectIntersection(args)

  function handleDragStart(event: DragStartEvent) {
    // A real drag supersedes a pending button move: the finger has already
    // decided it wants the long-press path, so the board should not also be
    // waiting for a tap on a row.
    setMovingTeamId(null)
    const data = event.active.data.current as { type?: string; rowId?: string } | undefined
    if (data?.type === "row") {
      const lane = lanes.find((entry) => entry.id === data.rowId)
      setDragging(lane ? { kind: "row", lane } : null)
      return
    }
    const team = teams.find((entry) => entry.id === event.active.id)
    setDragging(team ? { kind: "team", team } : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as { type?: string; rowId?: string } | undefined
    const overId = event.over?.id
    setDragging(null)
    if (overId === undefined || overId === null) return

    if (data?.type === "row") {
      const fromId = data.rowId
      const toId = String(overId)
      if (!fromId || fromId === toId) return
      // Only ever drop onto a row of this board (never the parking row's own id
      // resolved to a card, say) — `lanes` is the whole truth here.
      if (!lanes.some((entry) => entry.id === toId)) return
      void onReorderRow?.(fromId, toId)
      return
    }

    const team = teams.find((entry) => entry.id === event.active.id)
    const lane = lanes.find((entry) => entry.id === overId)
    if (!team || !lane || team.lane === lane.id) return
    void onMoveTeam(team.id, lane)
  }

  if (lanes.length === 0) return null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
      // The stock instructions promise "press space to pick up", which needs a
      // KeyboardSensor this board does not have — say what actually works
      // instead of naming a key that does nothing.
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "ลากการ์ดทีมขึ้นลงเพื่อเปลี่ยนแถวได้ด้วยเมาส์ หรือกดปุ่มย้ายแล้วเลือกแถวปลายทาง",
        },
      }}
    >
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <MoveHorizontal className="size-3.5 shrink-0" aria-hidden />
        กดปุ่ม “ย้าย” ที่มุมการ์ดทีม แล้วแตะกล่องปลายทางที่ต้องการ
        {canReorder && " · สลับลำดับกล่องด้วยปุ่ม ↑↓ ที่หัวแถว"}
      </p>

      {/*
        The pending move says out loud what the next tap will do, because the
        board does not otherwise change: every row is still a row, and a guild
        master who is not sure whether the tap landed has no way back except
        the cancel button right here.

        Keyed on the id, not on the team: a search box typed into while a move is
        pending filters that team out of `teams`, and a banner that vanished with
        it would leave the board waiting for a tap nobody could see the reason
        for.
      */}
      {movingTeamId && (
        <div
          role="status"
          className="border-primary bg-primary/10 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
        >
          <p className="min-w-0 flex-1 text-sm">
            กำลังย้าย{" "}
            <span className="font-medium">{movingTeam?.name ?? "ทีมที่เลือก"}</span>{" "}
            — แตะกล่องปลายทางด้านล่าง
          </p>
          <Button
            variant="outline"
            size="sm"
            className="touch-manipulation"
            onClick={() => setMovingTeamId(null)}
          >
            <X /> ยกเลิก
          </Button>
        </div>
      )}

      {/*
        One horizontal row per lane, teams flowing left to right. Rows instead
        of columns because dragging between them is a short vertical trip, and
        the lane you are aiming at stays a wide target instead of a tall
        narrow one.
      */}
      <div className="space-y-3">
        {lanes.map((lane) => {
          const namedIndex = namedLanes.findIndex((entry) => entry.id === lane.id)
          const reorderable = canReorder && lane.suffix !== ""
          return (
            <LaneRow
              key={lane.id}
              lane={lane}
              teams={byLane.get(lane.id) ?? []}
              byName={byName}
              members={members}
              unparked={lane.id === fallbackLane ? unparked : 0}
              query={query}
              onDelete={onDeleteRow}
              onRename={onRenameRow}
              onRenameTeam={onRenameTeam}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
              reorderable={reorderable}
              canMoveUp={reorderable && namedIndex > 0}
              canMoveDown={reorderable && namedIndex < namedLanes.length - 1}
              onMoveRow={onMoveRow}
              dragging={dragging?.kind === "row" && dragging.lane.id === lane.id}
              movingTeamId={movingTeamId}
              onStartMove={setMovingTeamId}
              onMoveHere={moveHere}
            />
          )
        })}
      </div>

      {/*
        The overlay travels above the page. Without it dnd-kit re-parents the
        card mid-drag, which on touch browsers cancels the gesture.
      */}
      <DragOverlay dropAnimation={null}>
        {dragging?.kind === "team" ? (
          // Same width as the card it stands in for: without it the overlay
          // shrink-wraps and the card visibly changes size when picked up.
          <TeamCard
            team={dragging.team}
            byName={byName}
            dragging
            query={query}
            className="w-full max-w-72"
          />
        ) : dragging?.kind === "row" ? (
          <RowPreview lane={dragging.lane} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** The header that follows the pointer while its row is being reordered. */
function RowPreview({ lane }: { lane: LeagueLane }) {
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-base font-semibold shadow-md">
      {lane.label}
    </div>
  )
}

function LaneRow({
  lane,
  teams,
  byName,
  members,
  unparked,
  query,
  onDelete,
  onRename,
  onRenameTeam,
  onAddMember,
  onRemoveMember,
  reorderable = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveRow,
  dragging = false,
  movingTeamId = null,
  onStartMove,
  onMoveHere,
}: {
  lane: LeagueLane
  teams: TeamInLane[]
  byName: Map<string, MemberStatus>
  members: MemberStatus[]
  unparked: number
  query?: string
  onDelete?: (lane: LeagueLane) => void
  /** Renames this box. Guild War only — a league lane is the game's. */
  onRename?: (lane: LeagueLane, nextName: string) => void | Promise<void>
  /** Renames a team inside this row and may relabel it. Guild War only. */
  onRenameTeam?: (
    teamId: string,
    nextName: string,
    nextContent: string
  ) => void | Promise<void>
  /** Adds a member to a team in this row. Guild War only. */
  onAddMember?: (teamId: string, name: string) => void | Promise<void>
  /** Removes a member from a team in this row. Guild War only. */
  onRemoveMember?: (teamId: string, name: string) => void | Promise<void>
  /** Whether this row shows a drag handle and nudge buttons. */
  reorderable?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveRow?: (rowId: string, delta: -1 | 1) => void
  /** True while this very row is the one being dragged. */
  dragging?: boolean
  /** The team picked up by its move button, if any — this row highlights then. */
  movingTeamId?: string | null
  /** Starts a button move on one of this row's teams. */
  onStartMove?: (teamId: string) => void
  /** Drops the pending team into this row. Absent when no move is pending. */
  onMoveHere?: (lane: LeagueLane) => void
}) {
  // The whole row is the drop target, so a team can be dropped into an empty
  // lane — not only onto another card.
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })
  // A separate draggable for the row itself, grabbed only by its handle. Its id
  // is namespaced so it can never collide with a team's uuid.
  const {
    setNodeRef: setHandleRef,
    listeners,
    attributes,
  } = useDraggable({
    id: `row:${lane.id}`,
    data: { type: "row", rowId: lane.id },
    disabled: !reorderable,
  })

  const players = teams.reduce((total, team) => total + team.memberNames.length, 0)
  const searching = Boolean(query?.trim())
  // A row with no suffix is the "ยังไม่ได้ระบุ" parking spot, not a box the
  // guild master named — there is nothing to delete there.
  const deletable = Boolean(onDelete) && lane.suffix !== ""
  // Same rule as deleting: the parking row has no name to change.
  const renamable = Boolean(onRename) && lane.suffix !== ""

  /**
   * While a button move is pending the row becomes the tap target.
   *
   * `role="button"` and the key handler rather than a real `<button>`: the row
   * already contains buttons (rename, delete, add member) and a button cannot
   * contain other buttons. In its normal state none of this is announced, so
   * screen readers do not announce a row as a button before it is one.
   */
  const takesMove = Boolean(onMoveHere)
  function handleMoveKey(event: React.KeyboardEvent) {
    if (!onMoveHere) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onMoveHere(lane)
  }

  /**
   * A tap anywhere in the row means "put it here" — except on a control that
   * means something else. Without this, tapping the ✕ on a member would remove
   * the member *and* move the team into another box.
   */
  function handleMoveClick(event: React.MouseEvent) {
    if (!onMoveHere) return
    const target = event.target as HTMLElement | null
    if (target?.closest("button, a, input, textarea, select, [role='listbox']")) return
    onMoveHere(lane)
  }

  return (
    <div
      ref={setNodeRef}
      role={takesMove ? "button" : undefined}
      tabIndex={takesMove ? 0 : undefined}
      aria-label={takesMove ? `ย้ายทีมเข้ากล่อง ${lane.label}` : undefined}
      onClick={handleMoveClick}
      onKeyDown={takesMove ? handleMoveKey : undefined}
      className={cn(
        "bg-muted/30 flex flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
        isOver && "border-primary bg-primary/5",
        dragging && "opacity-40",
        takesMove && "cursor-pointer border-primary/60 hover:border-primary hover:bg-primary/5"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        {reorderable && (
          <button
            ref={setHandleRef}
            {...listeners}
            {...attributes}
            type="button"
            // On a phone the handle is the only way to reorder, so it has to be
            // a comfortable target — the same 32/24 split as the other buttons.
            className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-manipulation rounded p-1 active:cursor-grabbing"
            aria-label={`ลากเพื่อสลับลำดับ ${lane.label}`}
            title="ลากเพื่อสลับลำดับ"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <p className="text-base font-semibold">{lane.label}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {searching ? `พบ ${teams.length} ทีม` : `${teams.length} ทีม · ${players} คน`}
        </p>
        {unparked > 0 && !searching && (
          <p className="text-muted-foreground text-xs">
            รวม {unparked} ทีมที่ยังไม่ได้ระบุว่าอยู่แถวไหน — ลากไปแถวไหนก็ได้
          </p>
        )}

        {(canMoveUp || canMoveDown || renamable || deletable) && (
          <div className="ml-auto flex items-center gap-0.5">
            {/*
              Dragging is the quick way, but it needs a pointer — these two do
              the same write and are the only path for a keyboard.
            */}
            {canMoveUp && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground size-9 touch-manipulation sm:size-7"
                aria-label={`เลื่อน ${lane.label} ขึ้น`}
                title={`เลื่อน ${lane.label} ขึ้น`}
                onClick={() => onMoveRow?.(lane.id, -1)}
              >
                <ChevronUp />
              </Button>
            )}
            {canMoveDown && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground size-9 touch-manipulation sm:size-7"
                aria-label={`เลื่อน ${lane.label} ลง`}
                title={`เลื่อน ${lane.label} ลง`}
                onClick={() => onMoveRow?.(lane.id, 1)}
              >
                <ChevronDown />
              </Button>
            )}
            {renamable && (
              <NameDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground size-9 touch-manipulation sm:size-7"
                    aria-label={`เปลี่ยนชื่อกล่อง ${lane.label}`}
                    title={`เปลี่ยนชื่อกล่อง ${lane.label}`}
                  >
                    <Pencil />
                  </Button>
                }
                title={`เปลี่ยนชื่อกล่อง “${lane.label}”`}
                description={
                  teams.length === 0
                    ? "กล่องนี้ยังว่างอยู่ — เปลี่ยนชื่อได้เลย"
                    : `ทีมในกล่องนี้ ${teams.length} ทีมจะย้ายมาอยู่ใต้ชื่อใหม่ — คนในทีมไม่เปลี่ยน`
                }
                fieldLabel="ชื่อทีมใหญ่"
                initialValue={lane.label}
                placeholder="เช่น ทีมใหญ่ 1"
                submitLabel="เปลี่ยนชื่อ"
                onSubmit={(name) => onRename?.(lane, name)}
              />
            )}
            {deletable && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive size-9 touch-manipulation sm:size-7"
                aria-label={`ลบกล่อง ${lane.label}`}
                title={`ลบกล่อง ${lane.label}`}
                onClick={() => onDelete?.(lane)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-xs">
          {searching ? "ไม่มีทีมที่ตรงกับชื่อที่ค้นหา" : "วางทีมตรงแถวนี้"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            <DraggableTeam
              key={team.id}
              team={team}
              byName={byName}
              members={members}
              query={query}
              onRename={onRenameTeam}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
              moving={team.id === movingTeamId}
              onStartMove={onStartMove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DraggableTeam({
  team,
  byName,
  members,
  query,
  onRename,
  onAddMember,
  onRemoveMember,
  moving = false,
  onStartMove,
}: {
  team: TeamInLane
  byName: Map<string, MemberStatus>
  members: MemberStatus[]
  query?: string
  onRename?: (
    teamId: string,
    nextName: string,
    nextContent: string
  ) => void | Promise<void>
  onAddMember?: (teamId: string, name: string) => void | Promise<void>
  onRemoveMember?: (teamId: string, name: string) => void | Promise<void>
  /** This card is the one picked up, waiting for a destination row. */
  moving?: boolean
  onStartMove?: (teamId: string) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: team.id,
    data: { type: "team", lane: team.lane },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // The card stays in place, dimmed, so the row keeps its height while the
      // overlay is the one travelling across the screen.
      style={{ opacity: isDragging ? 0.35 : 1 }}
      // max-w rather than a fixed width: cards share the row evenly but still
      // shrink to one per line on a 320px screen. The cap is wide enough for the
      // longest name in the guild to sit on one line next to its badge — it was
      // clipping names mid-word at `max-w-56`.
      className={cn(
        "w-full max-w-72 cursor-grab rounded-xl active:cursor-grabbing",
        // The card being moved stays put and lit while the rows light up, so the
        // eye can follow what is about to happen.
        moving && "ring-primary cursor-pointer ring-2"
      )}
    >
      <TeamCard
        team={team}
        byName={byName}
        grip={<GripVertical className="size-4" />}
        query={query}
        move={
          onStartMove ? (
            <DragSafe>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground size-8 touch-manipulation sm:size-6"
                aria-label={`ย้ายทีม ${team.name} ไปกล่องอื่น`}
                title="ย้ายทีมนี้ไปกล่องอื่น"
                aria-pressed={moving}
                onClick={() => onStartMove(team.id)}
              >
                <MoveHorizontal />
              </Button>
            </DragSafe>
          ) : undefined
        }
        action={
          onRename ? (
            <TeamEditDialog
              trigger={
                <DragSafe>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground size-8 touch-manipulation sm:size-6"
                    aria-label={`แก้ไขทีม ${team.name}`}
                    title="แก้ชื่อทีมและป้ายกำกับ"
                  >
                    <Pencil />
                  </Button>
                </DragSafe>
              }
              teamName={team.name}
              initialContent={team.content}
              onSubmit={({ name, content }) => onRename(team.id, name, content)}
            />
          ) : undefined
        }
        addMember={
          // A full team gets no add field at all: there is no room, so the
          // field would only invite a name the game will not take.
          onAddMember && team.memberNames.length < TEAM_MAX_MEMBERS ? (
            <DragSafe>
              <AddMemberCombobox
                members={members}
                exclude={team.memberNames}
                onPick={(name) => onAddMember(team.id, name)}
              />
            </DragSafe>
          ) : undefined
        }
        renderMemberAction={
          onRemoveMember
            ? (name) => (
                <DragSafe>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive size-8 shrink-0 touch-manipulation sm:size-6"
                    aria-label={`เอา ${name} ออกจาก ${team.name}`}
                    title={`เอา ${name} ออก`}
                    onClick={() => onRemoveMember(team.id, name)}
                  >
                    <X />
                  </Button>
                </DragSafe>
              )
            : undefined
        }
      />
    </div>
  )
}
