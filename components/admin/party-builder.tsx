"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  ChevronDown,
  ChevronUp,
  Lock,
  LockOpen,
  MoveHorizontal,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AddMemberCombobox } from "@/components/events/add-member-combobox"
import {
  MemberDropDialog,
  type MemberDropRequest,
} from "@/components/events/member-drop-dialog"
import { DragSafe } from "@/components/drag-safe"
import { MemberPlacementProvider } from "@/components/member-placement"
import { GameIcon } from "@/components/game-icon"
import { StatusBadge } from "@/components/leave/roster-list"
import { useConfirm } from "@/components/confirm-dialog"
import {
  CORE_PARTY_JOBS,
  lockedParties,
  MIN_RANDOM_TEAM_SIZE,
  planRandomParties,
  RANDOM_FILL_COUNT,
  swapMemberSeats,
  TEAM_MAX_MEMBERS,
  unlockedParties,
} from "@/lib/party"
import { PartyLabelChips } from "@/components/party-label-chips"
import { derivePartyContent, partyEvents } from "@/lib/rngw/categories"
import type {
  EventRow,
  MemberStatus,
  Party,
  PartyPlacement,
} from "@/lib/rngw/types"
import { cn } from "cn"
import { toast } from "sonner"

/**
 * The party builder, admin-only.
 *
 * The list on screen *is* the `parties` tab: there is no draft copy in this
 * browser any more (that was two lists to keep in sync, and the second one was
 * easy to edit and forget to publish). Every action — dragging a name from one
 * card to another, tapping ✕, renaming — writes the whole tab straight away, so
 * members see the change on their next read.
 *
 * Each action is optimistic: the parent's list is updated first so the board
 * moves under the finger, and put back the way it was if the write fails. The
 * parent owns that list (`onChange`) rather than this component keeping a copy,
 * which is what stops the on-screen list from drifting from the database.
 *
 * There is no member list on this page: the roster already lives in the
 * attendance tab and the "add a member" combobox on every card, so a second copy
 * here only cost a scroll. "สุ่มปาร์ตี้" covers the other job a list would have
 * done — bulk-filling teams from whoever is not on one yet.
 *
 * Mobile is the main device, so dragging waits for a long press and every card
 * also offers a plain "add a member" combobox — the keyboard, no-drag path the
 * accessibility rules require.
 */
export function PartyBuilder({
  members,
  parties,
  eventRows,
  versionRef,
  onChange,
}: {
  members: MemberStatus[]
  /** The parties tab as it is on the database — and what every write replaces. */
  parties: Party[]
  /** Box names, so a card can show the label derived from its placements. */
  eventRows: EventRow[]
  /**
   * The page's optimistic-lock token, shared with every other writer on the
   * page (the board's writer in the event dialog). Read before a write and kept
   * current from the response so the next edit does not 409 on its own save;
   * omit-and-replace only when it is still unknown.
   */
  versionRef: React.RefObject<number | null>
  /** Called with the new full tab for the optimistic update (and revert). */
  onChange: (next: Party[]) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState<MemberStatus | null>(null)
  /**
   * A name was dropped on a party that already has five people. The prompt
   * picks who makes way — there is no "add" while it is full, so refusing
   * outright (what used to happen) left the guild master to remove someone by
   * hand and then repeat the drag.
   */
  const [swapRequest, setSwapRequest] = React.useState<SwapRequest | null>(null)
  /**
   * A name was dropped onto another name. Unlike a card drop, the target row
   * can mean either "swap these two" or "put me on this team" — so the dialog
   * offers both whenever the target party still has a free slot.
   */
  const [seatRequest, setSeatRequest] = React.useState<MemberDropRequest | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  /** Serialises `put`, so writes reach the database in the order they were made. */
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())
  /** Counts queued writes; only the newest one may revert or clear `busy`. */
  const seq = React.useRef(0)

  const byName = React.useMemo(
    () => new Map(members.map((member) => [member.name, member])),
    [members]
  )
  const placed = React.useMemo(
    () => new Set(parties.flatMap((party) => party.memberNames)),
    [parties]
  )
  const unplaced = members.filter((member) => !placed.has(member.name))
  const presentCount = members.filter((member) => member.status === "present").length
  const lockedCount = React.useMemo(() => lockedParties(parties).length, [parties])

  const sensors = useSensors(
    // A mouse only starts dragging after a few pixels, so a click still clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // A finger holds still for a moment first; otherwise every scroll over the
    // cards would pick a name up on the way past. No `touch-action: none`
    // anywhere, or the page could not be scrolled by touching a name.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  /**
   * Writes the whole tab, optimistically.
   *
   * PUT replaces the tab rather than diffing, so every party — the ones this
   * action did not touch included — has to travel in `next`, or it disappears
   * from the database. `onChange` shows the move at once; a failed write puts the
   * previous list back and keeps the error from the API.
   *
   * Calls queue instead of refusing: a second edit made while the first is still
   * in flight used to return early and vanish, leaving the card where it was
   * with nothing said. See the comment on `queue` below.
   *
   * `details` is for the runs long enough to need reading twice (a dozen teams,
   * a list of names): sonner's message line is small, so the names go in the
   * description and the toast stays up until they have been read.
   */
  async function put(next: Party[], success: string, details?: string): Promise<boolean> {
    setBusy(true)
    const previous = parties
    onChange(next)

    // Only the most recent edit may roll the screen back: reverting for an
    // older failed write would put a list on screen that the newer queued write
    // is about to contradict.
    const ticket = (seq.current += 1)
    const mine = () => seq.current === ticket

    // One write at a time, in order. PUT replaces the whole list, so two writes
    // in flight could land in either order and the slower one would win with a
    // stale snapshot — the card would jump back to where it was. Queueing keeps
    // the screen honest; it costs nothing but wall time.
    const result = queue.current.then(async () => {
      try {
        const payload: Record<string, unknown> = { parties: next }
        // The token this page read with the list. Left out while unknown, which
        // falls back to a plain replace.
        if (versionRef.current !== null) payload.version = versionRef.current

        const res = await fetch("/api/admin/parties", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ")
        // Keep the token current for the next queued write and for a remount
        // after switching tabs, which would otherwise re-seed from a stale prop.
        if (typeof body.version === "number") versionRef.current = body.version
        toast.success(success, { description: details, duration: details ? 8000 : undefined })
        return true
      } catch (cause) {
        if (mine()) onChange(previous)
        toast.error((cause as Error).message)
        return false
      }
    })

    // Keep the chain alive whatever this write did, or one failure would stall
    // every write queued behind it. `result` is what the caller awaits, and it
    // never rejects — the catch above turns a failure into `false`.
    queue.current = result.catch(() => undefined)

    const ok = await result
    if (mine()) setBusy(false)
    return ok
  }

  function createParty(values: PartyFormValues) {
    const name = values.name.trim() || `ปาร์ตี้ ${parties.length + 1}`
    const party: Party = {
      id: crypto.randomUUID(),
      name,
      placements: values.placements,
      memberNames: [],
      updatedAt: new Date().toISOString(),
    }
    void put([party, ...parties], `เพิ่ม ${name} แล้ว — ลากชื่อเข้าปาร์ตี้ได้เลย`)
  }

  function renameParty(party: Party, values: PartyFormValues) {
    const now = new Date().toISOString()
    const next = parties.map((current) =>
      current.id === party.id
        ? {
            ...current,
            name: values.name.trim() || current.name,
            placements: values.placements,
            updatedAt: now,
          }
        : current
    )
    void put(next, `แก้ไข ${values.name.trim() || party.name} แล้ว`)
  }

  async function deleteParty(party: Party) {
    // The lock means "don't delete me", and the trash button is a delete. The
    // button is disabled for a locked party too; this is the guard for the
    // keyboard path and for a click that landed before the lock was written.
    if (party.locked) {
      toast.info(`${party.name} ถูกล็อคไว้ — ปลดล็อคก่อนถึงลบได้`)
      return
    }
    const yes = await confirm({
      title: `ลบ “${party.name}” ออกจริงไหม?`,
      description:
        party.memberNames.length > 0
          ? `ปาร์ตี้นี้มี ${party.memberNames.length} คน — ลบแล้วรายชื่อจะหลุดจากปาร์ตี้นี้ (ตัวสมาชิกในกิลด์ยังอยู่ครบ) และไม่เห็นในหน้าเว็บ`
          : "เป็นปาร์ตี้เปล่า — กดแล้วบันทึกทันที",
      confirmLabel: "ลบปาร์ตี้",
      tone: "danger",
    })
    if (!yes) return
    void put(
      parties.filter((current) => current.id !== party.id),
      `ลบ ${party.name} แล้ว`
    )
  }

  /**
   * Locks or unlocks one party.
   *
   * Only deletion is blocked — editing a locked party still works, because the
   * flag says "keep this row" rather than "hands off". Written straight away and
   * never confirmed: it is one tap to undo and nothing is destroyed by it.
   */
  function toggleLock(party: Party) {
    const locked = party.locked !== true
    const now = new Date().toISOString()
    void put(
      parties.map((current) =>
        current.id === party.id ? { ...current, locked, updatedAt: now } : current
      ),
      locked ? `ล็อค ${party.name} ไว้แล้ว` : `ปลดล็อค ${party.name} แล้ว`
    )
  }

  /**
   * Moves one card up or down in the tab.
   *
   * `parties.position` is written as the array index (`partyStatements`), so
   * reordering the array here *is* saving the order — there is no separate
   * position field on the client copy. The buttons are the no-drag path; a
   * keyboard user can arrange the whole tab without picking a card up.
   */
  function moveParty(partyId: string, delta: -1 | 1) {
    const from = parties.findIndex((party) => party.id === partyId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= parties.length) return

    const next = [...parties]
    ;[next[from], next[to]] = [next[to], next[from]]
    void put(
      next,
      `เลื่อน ${parties[from].name} ${delta < 0 ? "ขึ้น" : "ลง"} แล้ว`
    )
  }

  /**
   * Deletes every unlocked party at once — the "start tonight over" button.
   *
   * Locked parties are the ones kept, and they are named in the dialog: a bulk
   * delete that silently skipped some teams would leave the database in a state
   * nobody can describe afterwards. Member names are not deleted, only their
   * seats in the parties tab, so the roster is untouched and the guild master
   * can shuffle them into new teams straight after.
   */
  async function deleteAllParties() {
    const doomed = unlockedParties(parties)
    const kept = lockedParties(parties)
    if (doomed.length === 0) {
      toast.info(
        kept.length > 0
          ? `ทุกปาร์ตี้ถูกล็อคไว้ (${kept.length} ปาร์ตี้) — ปลดล็อคก่อนถึงลบได้`
          : "ยังไม่มีปาร์ตี้ให้ลบ"
      )
      return
    }

    const freed = new Set(doomed.flatMap((party) => party.memberNames)).size
    const yes = await confirm({
      title: `ลบปาร์ตี้ ${doomed.length} ปาร์ตี้ออกจริงไหม?`,
      description:
        `ปาร์ตี้ที่ล็อคไว้ ${kept.length} ปาร์ตี้จะไม่ถูกลบ` +
        (kept.length > 0 ? ` (${kept.map((party) => party.name).join(", ")})` : "") +
        ` · ${freed} คนจะหลุดจากปาร์ตี้และกลับไปอยู่ในกลุ่ม “ยังไม่ถูกจัด”` +
        " ตัวสมาชิกในกิลด์ไม่หาย กดกลับคืนไม่ได้",
      confirmLabel: `ลบ ${doomed.length} ปาร์ตี้`,
      tone: "danger",
    })
    if (!yes) return
    void put(
      kept,
      kept.length > 0
        ? `ลบ ${doomed.length} ปาร์ตี้แล้ว — เหลือที่ล็อคไว้ ${kept.length} ปาร์ตี้`
        : `ลบปาร์ตี้ทั้งหมด ${doomed.length} ปาร์ตี้แล้ว`
    )
  }

  /**
   * Puts one member on a party.
   *
   * `fromPartyId` is the card a drag started on. A drag is always a *move*, so
   * the name is taken off that card whatever event it labels — the world can
   * hold a player on a Siege team and a league team at once, but yanking
   * their card onto another and leaving them behind in both is not what the
   * gesture says. With no source (the add box) the
   * event board's rule applies instead: only a party labelling the *same* event
   * counts as "already on a team". Either way a move is confirmed, because the
   * party they come from loses them, and both parties travel in the same PUT.
   */
  async function addMember(partyId: string, name: string, fromPartyId: string | null = null) {
    const target = parties.find((party) => party.id === partyId)
    if (!target || target.memberNames.includes(name)) return
    if (target.memberNames.length >= TEAM_MAX_MEMBERS) {
      toast.info(
        `${target.name} มีครบ ${TEAM_MAX_MEMBERS} คนแล้ว — ลากชื่อมาวางเพื่อสลับ หรือเอาออกก่อน`
      )
      return
    }

    const targetEvents = partyEvents(target)
    const source = fromPartyId
      ? parties.find((party) => party.id === fromPartyId && party.memberNames.includes(name))
      : undefined
    const others = source
      ? [source]
      : parties.filter(
          (party) =>
            party.id !== partyId &&
            party.memberNames.includes(name) &&
            targetEvents.length > 0 &&
            partyEvents(party).some((event) => targetEvents.includes(event))
        )
    if (others.length > 0) {
      const from = others.map((party) => party.name).join(", ")
      const yes = await confirm({
        title: `${name} อยู่ปาร์ตี้ “${from}” อยู่แล้ว`,
        description: `ยืนยันย้าย ${name} มา ${target.name}? ระบบจะเอาออกจาก ${from} ให้`,
        confirmLabel: "ย้ายมาปาร์ตี้นี้",
        // Taking them off another party is the same "removing something" the
        // danger tone is for.
        tone: "danger",
      })
      if (!yes) return
    }

    const now = new Date().toISOString()
    const next = parties.map((party) => {
      if (party.id === partyId) {
        return { ...party, memberNames: [...party.memberNames, name], updatedAt: now }
      }
      if (others.includes(party)) {
        return {
          ...party,
          memberNames: party.memberNames.filter((member) => member !== name),
          updatedAt: now,
        }
      }
      return party
    })
    void put(
      next,
      others.length > 0
        ? `ย้าย ${name} มา ${target.name} แล้ว`
        : `เพิ่ม ${name} เข้า ${target.name} แล้ว`
    )
  }

  /**
   * The drag-and-drop path, which is always a move and always confirmed.
   *
   * The confirm is the "add to party" button the drop needs: a drag can land on
   * the wrong card, and a full card would silently refuse the drop. When the
   * target is full the dialog becomes a swap prompt instead — `applyDrop` puts
   * the outgoing member in the dragged name's old seat, so both cards keep
   * their five slots.
   */
  async function requestDrop(partyId: string, name: string, fromPartyId: string | null) {
    const target = parties.find((party) => party.id === partyId)
    if (!target || target.memberNames.includes(name)) return

    const source = fromPartyId
      ? parties.find(
          (party) => party.id === fromPartyId && party.memberNames.includes(name)
        )
      : undefined

    if (target.memberNames.length >= TEAM_MAX_MEMBERS) {
      setSwapRequest({ name, fromPartyId: source?.id ?? null, targetId: partyId })
      return
    }

    const yes = await confirm({
      title: source
        ? `ย้าย ${name} มา “${target.name}”?`
        : `เพิ่ม ${name} เข้า “${target.name}”?`,
      description: source
        ? `${name} จะออกจาก “${source.name}” แล้วไปอยู่ ${target.name} ` +
          `(${target.memberNames.length + 1}/${TEAM_MAX_MEMBERS} คน)`
        : `${target.name} จะมีสมาชิก ${target.memberNames.length + 1}/${TEAM_MAX_MEMBERS} คน`,
      confirmLabel: source ? "ย้ายเข้าปาร์ตี้" : "เพิ่มเข้าปาร์ตี้",
      // Taking the name off another party removes them from that team, which is
      // the same "removing something" the red button is for.
      tone: source ? "danger" : "default",
    })
    if (!yes) return

    applyDrop(target.id, name, source?.id ?? null)
  }

  /**
   * Writes a move between two cards, optionally exchanging one of the target's
   * members back into the source card.
   *
   * `swapOut` is what keeps a full target full: the outgoing member takes the
   * dragged name's seat on the source card. With no source (a name that came
   * from nowhere — the combobox, in practice) the outgoing member simply
   * becomes unassigned.
   */
  function applyDrop(
    targetId: string,
    name: string,
    fromPartyId: string | null,
    swapOut?: string
  ) {
    const target = parties.find((party) => party.id === targetId)
    if (!target) return
    const source =
      fromPartyId && fromPartyId !== targetId
        ? parties.find((party) => party.id === fromPartyId)
        : undefined

    const now = new Date().toISOString()
    const next = parties.map((party) => {
      if (party.id === targetId) {
        return {
          ...party,
          memberNames: [
            ...party.memberNames.filter((member) => member !== swapOut),
            name,
          ],
          updatedAt: now,
        }
      }
      if (party.id === source?.id) {
        const kept = party.memberNames.filter((member) => member !== name)
        return {
          ...party,
          memberNames: swapOut ? [...kept, swapOut] : kept,
          updatedAt: now,
        }
      }
      return party
    })

    const where = swapOut
      ? `สลับ ${name} เข้า ${target.name} แทน ${swapOut} แล้ว`
      : source
        ? `ย้าย ${name} จาก ${source.name} มา ${target.name} แล้ว`
        : `เพิ่ม ${name} เข้า ${target.name} แล้ว`
    void put(
      next,
      where,
      swapOut && source
        ? `${swapOut} ไปอยู่ ${source.name} แทน`
        : undefined
    )
  }

  /**
   * Dropping one name directly onto another opens the seat dialog.
   *
   * A seat drop has two sensible meanings and the difference is invisible while
   * dragging: swap the two players, or (when the target team has room) just add
   * the dragged player and leave the person under the finger alone. The dialog
   * asks rather than guessing, because a wrong guess moves two people at once.
   */
  function requestSeatDrop(
    fromPartyId: string,
    name: string,
    targetPartyId: string,
    targetName: string
  ) {
    const source = parties.find((party) => party.id === fromPartyId)
    const target = parties.find((party) => party.id === targetPartyId)
    if (!source || !target || source.id === target.id) return
    if (!source.memberNames.includes(name) || !target.memberNames.includes(targetName)) return
    setSeatRequest({ name, fromTeamId: source.id, targetTeamId: target.id, targetName })
  }

  /** Exchanges the two names' seats; both teams keep their size. */
  function applySeatSwap(
    fromPartyId: string,
    name: string,
    targetPartyId: string,
    targetName: string
  ) {
    const source = parties.find((party) => party.id === fromPartyId)
    const target = parties.find((party) => party.id === targetPartyId)
    if (!source || !target) return

    const now = new Date().toISOString()
    const next = parties.map((party) => {
      if (party.id === source.id) {
        return {
          ...party,
          memberNames: party.memberNames.map((member) =>
            member === name ? targetName : member
          ),
          updatedAt: now,
        }
      }
      if (party.id === target.id) {
        return {
          ...party,
          memberNames: party.memberNames.map((member) =>
            member === targetName ? name : member
          ),
          updatedAt: now,
        }
      }
      return party
    })
    void put(next, `สลับ ${name} กับ ${targetName} แล้ว`)
  }

  /**
   * Exchanges two players' seats inside one party — the only way to change the
   * order the five are listed in.
   *
   * The list order is the stored slot order (`party_members.slot`), which is
   * what an event board shows when the guild master picks “ตามลำดับที่จัดไว้”.
   * Adding always appends, so without this a name could never move up. Dropping
   * a name on another name in the same card is the drag path; on phones, where
   * the long-press drag is fiddly, every row also carries ↑/↓ buttons.
   * (The buttons are hidden from `sm` up, where a mouse makes the drag easy.)
   *
   * No confirmation: it moves nothing between teams and one tap puts it back.
   */
  function swapSeats(partyId: string, name: string, otherName: string) {
    const party = parties.find((current) => current.id === partyId)
    if (!party) return

    const memberNames = swapMemberSeats(party.memberNames, name, otherName)
    // Identity means the helper refused: unknown name, or a drop on itself.
    if (memberNames === party.memberNames) return

    const now = new Date().toISOString()
    void put(
      parties.map((current) =>
        current.id === partyId
          ? { ...current, memberNames, updatedAt: now }
          : current
      ),
      `สลับลำดับ ${name} กับ ${otherName} ใน ${party.name} แล้ว`
    )
  }

  /** The ↑/↓ buttons: swap a seat with its neighbour, which is one step. */
  function moveSeat(partyId: string, name: string, delta: -1 | 1) {
    const party = parties.find((current) => current.id === partyId)
    if (!party) return
    const from = party.memberNames.indexOf(name)
    const to = from + delta
    if (from < 0 || to < 0 || to >= party.memberNames.length) return
    swapSeats(partyId, name, party.memberNames[to])
  }

  /**
   * Takes one member off a party. No confirmation: it is one tap to undo (add
   * them back), and the guild master removes people far more often than they
   * add a whole team, so a dialog on every tap would be noise.
   */
  function removeMember(party: Party, name: string) {
    const now = new Date().toISOString()
    const next = parties.map((current) =>
      current.id === party.id
        ? {
            ...current,
            memberNames: current.memberNames.filter((member) => member !== name),
            updatedAt: now,
          }
        : current
    )
    void put(next, `เอา ${name} ออกจาก ${party.name} แล้ว`)
  }

  /**
   * Rolls the party-less members into fresh teams and writes them in one PUT.
   *
   * Every member on no team at all is a candidate, but the ones who came today
   * lead the pool — see `planRandomParties`, which owns the rule and is pure so
   * it can be read (and tested) without a browser. The plan is made *before* the
   * dialog so the numbers in it are the numbers that get written; nothing here
   * re-rolls afterwards, or the confirmation would describe a different set of
   * teams than the database receives.
   *
   * Confirmed even though it only adds: a dozen teams appear at once and the
   * names inside them are a lottery, so the guild master gets to look before it
   * lands. They can undo it by removing people again, one tap each.
   */
  async function randomizeParties() {
    const plan = planRandomParties(members, parties)
    if (plan.parties.length === 0) {
      toast.info(
        unplaced.length === 0
          ? "ทุกคนมีปาร์ตี้อยู่แล้ว — ไม่มีใครให้สุ่ม"
          : `เหลือคนที่ยังไม่มีปาร์ตี้ ${unplaced.length} คน น้อยเกินกว่าจะตั้งเป็นทีม`
      )
      return
    }

    const [healerJobs, tankJobs] = CORE_PARTY_JOBS
    const core = `${healerJobs.join("/")} 1 · ${tankJobs.join("/")} 1`
    const yes = await confirm({
      title: `สุ่มจัดปาร์ตี้ ${plan.parties.length} ทีม?`,
      description:
        `คนที่ยังไม่มีปาร์ตี้ ${unplaced.length} คน → ${plan.placed.length} คน` +
        ` แต่ละทีมมี ${core} (ถ้ามี) แล้วเติมสุ่มอีก ${RANDOM_FILL_COUNT} คน จนครบ ${TEAM_MAX_MEMBERS}` +
        ` ปาร์ตี้ใหม่ติดป้ายทุกอีเวนต์ (กิลด์ลีก = ลีครอง)` +
        (plan.leftOver.length > 0
          ? ` · เหลือ ${plan.leftOver.join(", ")} ไม่ได้จัดเพราะเหลือคนเดียว`
          : ""),
      confirmLabel: "สุ่มและบันทึก",
    })
    if (!yes) return

    void put(
      [...plan.parties, ...parties],
      `สุ่มจัดปาร์ตี้ ${plan.parties.length} ทีม · ${plan.placed.length} คน`,
      plan.leftOver.length > 0
        ? `ไม่ได้จัด ${plan.leftOver.join(", ")} (เหลือคนเดียว)`
        : undefined
    )
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { type?: string; name?: string } | undefined
    if (data?.type !== "member" || !data.name) return
    setDragging(byName.get(data.name) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as
      | { type?: string; name?: string; from?: string }
      | undefined
    setDragging(null)

    if (data?.type !== "member" || !data.name || !data.from) return

    // Dropped onto another player's row: exchange the two seats.
    const overData = event.over?.data.current as
      | { type?: string; partyId?: string; name?: string }
      | undefined
    if (overData?.type === "member-seat" && overData.partyId && overData.name) {
      // Same card: the two names trade seats, which changes the order they are
      // listed in — no dialog, because nothing leaves the team. Across cards it
      // is a transfer, whose two meanings (swap players / add to the team) need
      // the dialog.
      if (overData.partyId === data.from) {
        swapSeats(data.from, data.name, overData.name)
      } else {
        requestSeatDrop(data.from, data.name, overData.partyId, overData.name)
      }
      return
    }

    const overId = event.over?.id
    if (typeof overId !== "string" || !overId.startsWith(PARTY_DROP_PREFIX)) return

    const partyId = overId.slice(PARTY_DROP_PREFIX.length)
    // Dropped back where it came from: nothing to write.
    if (data.from === partyId) return
    void requestDrop(partyId, data.name, data.from)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">จัดปาร์ตี้</h2>
          <p className="text-muted-foreground text-sm">
            {parties.length} ปาร์ตี้ · คนที่มาวันนี้ {presentCount} คน
            {lockedCount > 0 && (
              <> · ล็อคไว้ {lockedCount} ปาร์ตี้</>
            )}
          </p>
          {/*
            Kept from the footer this replaced: without the "ดึงของล่าสุด"
            button there is nowhere else that says the list on screen *is* the
            database. The footer is gone because it put a destructive button at
            the end of a long scroll, not because this was ever optional.
          */}
          <p className="text-muted-foreground text-xs">
            ทุกอย่างบันทึกทันทีที่กด ไม่มีฉบับร่างในเครื่อง และไม่มีปุ่มกดซ้ำ — การบันทึกแทนที่ทั้ง
            ตารางปาร์ตี้ ถ้าเปิดหน้านี้จากเครื่องอื่นที่เพิ่งแก้ไป ให้รีเฟรชหน้าเว็บก่อนจัดต่อ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="touch-manipulation"
            disabled={busy || unplaced.length < MIN_RANDOM_TEAM_SIZE}
            title="สุ่มทีมจากคนที่ยังไม่มีปาร์ตี้ — ทีมละ 5 คน บัฟ 1 แทงก์ 1 (เทคหรือครูส) แล้วเติมสุ่ม 3 คน"
            onClick={randomizeParties}
          >
            <Shuffle /> สุ่มปาร์ตี้
          </Button>
          <PartyFormDialog
            trigger={
              <Button className="touch-manipulation">
                <Plus /> เพิ่มปาร์ตี้
              </Button>
            }
            title="เพิ่มปาร์ตี้"
            submitLabel="เพิ่มปาร์ตี้"
            initial={{ name: "", placements: [] }}
            onSubmit={createParty}
          />
          {/*
            Up here, next to the other page-level actions, and not tucked at the
            bottom: it is the only thing here that throws work away, and the
            bottom of a long card grid is exactly where a thumb lands without
            looking. It stays an outline button in the destructive colour with
            its own confirm rather than the solid default of "เพิ่มปาร์ตี้" —
            sitting next to it should not make it look like the same kind of tap.
          */}
          <Button
            variant="outline"
            onClick={deleteAllParties}
            disabled={busy || parties.length === 0}
            className="text-destructive hover:text-destructive touch-manipulation"
          >
            <Trash2 /> ลบปาร์ตี้ทั้งหมด
            {lockedCount > 0 && (
              <span className="text-muted-foreground">(เหลือที่ล็อค {lockedCount})</span>
            )}
          </Button>
        </div>
      </div>

      {/*
        The one thing on this page that is a problem rather than a job. It sits
        directly under the header, above the grid, for three reasons: it is
        about every card at once so it belongs to no card; it is next to the
        button that fixes it; and the stats line scrolls away on a phone while
        this is the thing the guild master opened the page to check.

        A count, not a list of names: `unplaced` is everyone on the roster with
        no party at all, which in a guild this size is over a hundred people —
        most of them simply did not come tonight, and a wall of their names
        would read as an emergency and bury the people who did come. The number
        says how much is unassigned; the cards below are where you act on it.

        Admin-only by construction, like the whole tab — `requireAdmin()` guards
        the write route and the tab lives behind the PIN, so there is nothing to
        hide here from members.
      */}
      {unplaced.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <TriangleAlert className="text-amber-600 dark:text-amber-300" />
          <AlertTitle>
            ยังมี {unplaced.length} คนที่ไม่ได้อยู่ในปาร์ตี้ใดเลย
          </AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-200/90">
            {unplaced.length >= MIN_RANDOM_TEAM_SIZE ? (
              <>
                นับจากรายชื่อทั้งกิลด์ รวมคนที่ไม่มาวันนี้ — กด “สุ่มปาร์ตี้”
                เพื่อจัดคนกลุ่มนี้เป็นทีมใหม่ (ปาร์ตี้ที่มีอยู่แล้วไม่ถูกแตะ)
              </>
            ) : (
              <>
                เหลือคนเดียว สุ่มเป็นทีมไม่ได้ (ทีมต้องมีอย่างน้อย{" "}
                {MIN_RANDOM_TEAM_SIZE} คน) — เพิ่มเข้าทีมเองด้วยช่อง “เพิ่มคน”
                ท้ายการ์ด
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={preferMemberSeat}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
        // The stock instructions promise "press space to pick up", which needs
        // a KeyboardSensor this board does not have — say what actually works.
        accessibility={{
          screenReaderInstructions: { draggable: DRAG_HINT },
        }}
      >
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Shuffle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          “สุ่มปาร์ตี้” จัดคนที่ยังไม่มีปาร์ตี้เป็นทีมละ {TEAM_MAX_MEMBERS} คน (บัฟ 1
          แทงก์ 1 — เทคหรือครูส แล้วเติมสุ่มอีก {RANDOM_FILL_COUNT} คน) ใหม่ทุกทีม
          พร้อมป้ายทุกอีเวนต์ (กิลด์ลีก = ลีครอง)
        </p>
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <MoveHorizontal className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {DRAG_HINT}
        </p>
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs sm:hidden">
          <ChevronUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          สลับลำดับการ์ดด้วยปุ่ม ↑↓ ที่หัวการ์ด — ลำดับนี้คือลำดับเริ่มต้นของทีมในทุกบอร์ด
        </p>
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs sm:hidden">
          <ChevronUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          สลับลำดับคนในปาร์ตี้ด้วยปุ่ม ↑↓ ข้างชื่อ หรือลากชื่อไปวางบนชื่อในปาร์ตี้เดียวกัน
          — ลำดับนี้คือ “ตามลำดับที่จัดไว้” บนบอร์ด
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MemberPlacementProvider parties={parties}>
            {parties.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm sm:col-span-2 lg:col-span-3">
                ยังไม่มีปาร์ตี้ — กด “เพิ่มปาร์ตี้” แล้วเพิ่มคนในช่องด้านล่าง หรือกด
                “สุ่มปาร์ตี้” ถ้าจะจัดคนที่ยังไม่มีทีมทั้งหมดเลย
              </p>
            ) : (
              parties.map((party, index) => (
                <PartyCard
                  key={party.id}
                  party={party}
                  members={members}
                  eventRows={eventRows}
                  byName={byName}
                  busy={busy}
                  canMoveUp={index > 0}
                  canMoveDown={index < parties.length - 1}
                  onMove={moveParty}
                  onAdd={addMember}
                  onRemove={removeMember}
                  onMoveSeat={moveSeat}
                  onRename={renameParty}
                  onToggleLock={toggleLock}
                  onDelete={deleteParty}
                />
              ))
            )}
          </MemberPlacementProvider>
        </div>

        {/*
          The overlay travels above the page. Without it dnd-kit re-parents the
          dragged row mid-drag, which on touch browsers cancels the gesture.
        */}
        <DragOverlay dropAnimation={null}>
          {dragging ? <MemberOverlay member={dragging} /> : null}
        </DragOverlay>
      </DndContext>

      {/*
        Mounted only while a drop is waiting for an answer, so the selected
        replacement starts empty for every drop instead of remembering the
        previous one.
      */}
      {swapRequest && (
        <SwapMemberDialog
          request={swapRequest}
          parties={parties}
          byName={byName}
          onCancel={() => setSwapRequest(null)}
          onConfirm={(outgoing) => {
            const request = swapRequest
            setSwapRequest(null)
            applyDrop(request.targetId, request.name, request.fromPartyId, outgoing)
          }}
        />
      )}

      {seatRequest && (
        <MemberDropDialog
          request={seatRequest}
          parties={parties}
          addLabel="เพิ่มเข้าปาร์ตี้"
          onCancel={() => setSeatRequest(null)}
          onSwap={() => {
            const request = seatRequest
            setSeatRequest(null)
            applySeatSwap(
              request.fromTeamId,
              request.name,
              request.targetTeamId,
              request.targetName
            )
          }}
          onAdd={() => {
            const request = seatRequest
            setSeatRequest(null)
            // `applyDrop` moves the name out of its old card and adds it to the
            // target; the person it was dropped on stays put.
            applyDrop(request.targetTeamId, request.name, request.fromTeamId)
          }}
        />
      )}

      {confirmDialog}
    </div>
  )
}

/* ------------------------------------------------------------------- cards */

const PARTY_DROP_PREFIX = "party:"
const MEMBER_DRAG_PREFIX = "member:"
const MEMBER_SEAT_DROP_PREFIX = "member-seat:"

/**
 * Prefer a person's row over the card that contains it.
 *
 * Both are drop targets and both intersect the dragged chip, but a row is
 * strictly smaller than its card, so a plain `rectIntersection` can report the
 * card first and turn "swap these two players" into "move into this team".
 * When any row is under the pointer, it wins.
 */
const preferMemberSeat: CollisionDetection = (args) => {
  const collisions = rectIntersection(args)
  const seat = collisions.find(
    (collision) =>
      collision.data?.droppableContainer.data.current?.type === "member-seat"
  )
  if (!seat) return collisions
  return [seat, ...collisions.filter((collision) => collision.id !== seat.id)]
}

/** A name dropped on a full party: `targetId` is where it wants to go. */
type SwapRequest = {
  name: string
  fromPartyId: string | null
  targetId: string
}

/**
 * "This party is full — who makes way?"
 *
 * Selecting a row and pressing the footer button *is* the confirmation; there
 * is no second dialog. The outgoing member takes the dragged name's old seat on
 * the source card, so the swap keeps both teams at the same size instead of
 * leaving one person unassigned.
 */
function SwapMemberDialog({
  request,
  parties,
  byName,
  onCancel,
  onConfirm,
}: {
  request: SwapRequest
  parties: Party[]
  byName: Map<string, MemberStatus>
  onCancel: () => void
  onConfirm: (outgoing: string) => void
}) {
  const [outgoing, setOutgoing] = React.useState<string | null>(null)
  const target = parties.find((party) => party.id === request.targetId)
  const source = request.fromPartyId
    ? parties.find((party) => party.id === request.fromPartyId)
    : undefined

  if (!target) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ปาร์ตี้เต็ม — สลับคนออก</DialogTitle>
          <DialogDescription>
            “{target.name}” มี {TEAM_MAX_MEMBERS} คนแล้ว เลือกคนที่จะสลับออกเพื่อให้{" "}
            {request.name} เข้าทีม
            {source
              ? ` · ${request.name} จะออกจาก “${source.name}” และคนที่ถูกสลับออกจะไปอยู่แทน`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            เลือกคนที่จะออกจาก {target.name}
          </p>
          <div className="grid gap-1.5">
            {target.memberNames.map((name) => {
              const member = byName.get(name)
              const selected = outgoing === name
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setOutgoing(name)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-2 text-left transition-colors touch-manipulation",
                    selected
                      ? "border-primary bg-secondary"
                      : "hover:bg-muted"
                  )}
                >
                  {member ? (
                    <GameIcon job={member.job} className="size-7" />
                  ) : (
                    <span aria-hidden className="bg-muted size-7 shrink-0 rounded-md" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    {member && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {member.job}
                      </span>
                    )}
                  </span>
                  {selected && (
                    <span className="text-primary shrink-0 text-xs font-medium">
                      จะถูกสลับออก
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" className="touch-manipulation" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            className="touch-manipulation"
            disabled={!outgoing}
            onClick={() => outgoing && onConfirm(outgoing)}
          >
            {outgoing ? "สลับและบันทึก" : "เลือกคนที่จะสลับ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const DRAG_HINT =
  "ลากชื่อไปวางบนชื่ออีกคนในปาร์ตี้เดียวกันเพื่อสลับลำดับ" +
  " · วางบนชื่อในปาร์ตี้อื่นเพื่อเลือกสลับที่หรือเพิ่มเข้าทีม" +
  " · ลากไปวางบนการ์ดเพื่อย้ายเข้าปาร์ตี้" +
  " · เพิ่มคนใหม่ใช้ช่อง “เพิ่มคน” ท้ายการ์ด" +
  " (บนมือถือ: กดค้างชื่อประมาณครึ่งวินาทีก่อนลาก)"

/**
 * One party, and a drop target for dragged names.
 *
 * The card itself is not draggable; a member row is. Dropping a name on another
 * name in the same card swaps their seats (changes the list order), and dropping
 * it on a different card moves it between teams. On phones every row also has
 * ↑/↓ buttons for the same reorder — hidden from `sm` up to keep desktop cards
 * compact, where the pointer makes the drag easy.
 *
 * The order is meaningful: `saveParties` writes each name's index into
 * `party_members.slot`, and the event boards show that slot order when the guild
 * master picks “ตามลำดับที่จัดไว้”.
 */
function PartyCard({
  party,
  members,
  eventRows,
  byName,
  busy,
  canMoveUp,
  canMoveDown,
  onMove,
  onAdd,
  onRemove,
  onMoveSeat,
  onRename,
  onToggleLock,
  onDelete,
}: {
  party: Party
  members: MemberStatus[]
  eventRows: EventRow[]
  byName: Map<string, MemberStatus>
  busy: boolean
  /** Whether this card has a neighbour above/below in the tab. */
  canMoveUp: boolean
  canMoveDown: boolean
  /** Swaps this card with its neighbour; writes the whole tab order. */
  onMove: (partyId: string, delta: -1 | 1) => void
  onAdd: (partyId: string, name: string) => void | Promise<void>
  onRemove: (party: Party, name: string) => void
  /** Moves one player up/down inside this card; writes the slot order. */
  onMoveSeat: (partyId: string, name: string, delta: -1 | 1) => void
  onRename: (party: Party, values: PartyFormValues) => void
  onToggleLock: (party: Party) => void
  onDelete: (party: Party) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${PARTY_DROP_PREFIX}${party.id}` })

  const rows = party.memberNames.map((name) => ({ name, member: byName.get(name) }))
  const label = derivePartyContent(party, eventRows)
  const present = rows.filter((entry) => entry.member?.status === "present").length
  const full = party.memberNames.length >= TEAM_MAX_MEMBERS

  return (
    <div ref={setNodeRef} className="h-full">
      <Card
        size="sm"
        className={cn(
          "h-full transition-colors",
          isOver && "border-primary ring-2 ring-primary/40"
        )}
      >
        <CardHeader>
          <CardTitle className="truncate">{party.name}</CardTitle>
          <CardDescription className="tabular-nums">
            {rows.length} คน · มาวันนี้ {present} คน
          </CardDescription>
          <CardAction className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground size-9 touch-manipulation sm:hidden"
              aria-label={`เลื่อน ${party.name} ขึ้น`}
              title={`เลื่อน ${party.name} ขึ้น`}
              disabled={busy || !canMoveUp}
              onClick={() => onMove(party.id, -1)}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground size-9 touch-manipulation sm:hidden"
              aria-label={`เลื่อน ${party.name} ลง`}
              title={`เลื่อน ${party.name} ลง`}
              disabled={busy || !canMoveDown}
              onClick={() => onMove(party.id, 1)}
            >
              <ChevronDown />
            </Button>
            <PartyFormDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground size-8 touch-manipulation sm:size-6"
                  aria-label={`แก้ไข ${party.name}`}
                  title="แก้ชื่อ / ป้ายกำกับ"
                >
                  <Pencil />
                </Button>
              }
              title={`แก้ไข “${party.name}”`}
              submitLabel="บันทึก"
              initial={{ name: party.name, placements: party.placements }}
              onSubmit={(values) => onRename(party, values)}
            />
            <DragSafe>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "size-8 touch-manipulation sm:size-6",
                  party.locked
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
                aria-label={party.locked ? `ปลดล็อค ${party.name}` : `ล็อค ${party.name}`}
                aria-pressed={party.locked === true}
                title={
                  party.locked
                    ? "ปลดล็อค — จะกลับไปถูก “ลบปาร์ตี้ทั้งหมด” ด้วย"
                    : "ล็อคไว้ — “ลบปาร์ตี้ทั้งหมด” จะข้ามปาร์ตี้นี้"
                }
                disabled={busy}
                onClick={() => onToggleLock(party)}
              >
                {party.locked ? <Lock /> : <LockOpen />}
              </Button>
            </DragSafe>
            <DragSafe>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive size-8 touch-manipulation sm:size-6"
                aria-label={`ลบ ${party.name}`}
                title={party.locked ? "ปาร์ตี้ที่ล็อคไว้ลบไม่ได้" : "ลบปาร์ตี้"}
                disabled={busy || party.locked}
                onClick={() => onDelete(party)}
              >
                <Trash2 />
              </Button>
            </DragSafe>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          {party.locked && (
            <Badge className="max-w-full">
              <Lock />
              <span className="truncate">ล็อคไว้ — ลบทั้งหมดจะข้ามทีมนี้</span>
            </Badge>
          )}
          {label && (
            <Badge variant="outline" className="max-w-full">
              <span className="truncate">{label}</span>
            </Badge>
          )}

          {rows.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-2 py-6 text-center text-xs">
              {isOver ? "วางตรงนี้เพื่อย้ายเข้าทีมนี้" : "ยังไม่มีใคร — เพิ่มได้ด้านล่าง"}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {rows.map(({ name, member }, index) => (
                <MemberRow
                  key={name}
                  name={name}
                  member={member}
                  partyName={party.name}
                  partyId={party.id}
                  busy={busy}
                  canMoveUp={index > 0}
                  canMoveDown={index < rows.length - 1}
                  onMove={(delta) => onMoveSeat(party.id, name, delta)}
                  onRemove={() => onRemove(party, name)}
                />
              ))}
            </ul>
          )}

          {full ? (
            <p className="text-muted-foreground pt-1 text-xs">
              ครบ {TEAM_MAX_MEMBERS} คนแล้ว — ต้องเอาออกก่อนจึงจะเพิ่มได้
            </p>
          ) : (
            // The keyboard, no-drag way to add — required wherever dragging is
            // the quick path. Wrapped so a press cannot be read as a drag.
            <div className="pt-1">
              <DragSafe>
                <AddMemberCombobox
                  members={members}
                  exclude={party.memberNames}
                  onPick={(name) => onAdd(party.id, name)}
                />
              </DragSafe>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * A member inside a party card.
 *
 * Draggable onto another row (same card: swap order, other card: transfer), with
 * ↑/↓ buttons on phones for the same reorder, plus the remove ✕.
 */
function MemberRow({
  name,
  member,
  partyName,
  partyId,
  busy,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
}: {
  name: string
  member: MemberStatus | undefined
  partyName: string
  partyId: string
  busy: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } = useDraggable({
    id: `${MEMBER_DRAG_PREFIX}${name}`,
    data: { type: "member", name, from: partyId },
    disabled: busy,
  })
  // The row is also a drop target: dropping a name here swaps the two seats.
  // Both refs go on the same element, or the swoppable area would be a child
  // that the drag listeners never reach.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${MEMBER_SEAT_DROP_PREFIX}${partyId}:${name}`,
    data: { type: "member-seat", partyId, name },
    disabled: busy,
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
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className={cn(
        "flex cursor-grab items-center gap-3 rounded-md py-1.5 touch-manipulation active:cursor-grabbing",
        isOver && "bg-secondary ring-primary/40 ring-2"
      )}
    >
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
        <span className="block truncate text-sm font-medium">{name}</span>
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
      {/*
        The no-drag way to change the slot order, shown only where the drag is
        hardest (phones). Kept in a column so it costs width, not the name: on a
        320px screen the row has no width to spare and a truncated player name is
        how someone loses their own seat.
      */}
      <DragSafe className="sm:hidden">
        <span className="flex shrink-0 flex-col">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground size-7 touch-manipulation sm:size-6"
            aria-label={`เลื่อน ${name} ขึ้นใน ${partyName}`}
            title={`เลื่อน ${name} ขึ้น`}
            disabled={busy || !canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground size-7 touch-manipulation sm:size-6"
            aria-label={`เลื่อน ${name} ลงใน ${partyName}`}
            title={`เลื่อน ${name} ลง`}
            disabled={busy || !canMoveDown}
            onClick={() => onMove(1)}
          >
            <ChevronDown />
          </Button>
        </span>
      </DragSafe>
      <DragSafe>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive size-8 shrink-0 touch-manipulation sm:size-6"
          aria-label={`เอา ${name} ออกจาก ${partyName}`}
          title={`เอา ${name} ออก`}
          disabled={busy}
          onClick={onRemove}
        >
          <X />
        </Button>
      </DragSafe>
    </li>
  )
}

/** The chip that follows the pointer while a name is being dragged. */
function MemberOverlay({ member }: { member: MemberStatus }) {
  return (
    <div className="bg-popover text-popover-foreground flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-md">
      <GameIcon job={member.job} className="size-6" />
      <span className="text-sm font-medium">{member.name}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

interface PartyFormValues {
  name: string
  placements: PartyPlacement[]
}

/**
 * Name + label, for both making a party and editing one.
 *
 * The chips are the whole interface for event participation: each chip writes
 * one placement, and the event pages read those placements directly. There is
 * no hand-typed label to match, so a team can only appear on a board the chips
 * offer.
 *
 * A fixed team that plays several events taps several chips. The chips are
 * grouped by page so the two league chips read as one event with two divisions
 * rather than as two more events.
 */
function PartyFormDialog({
  trigger,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  trigger: React.ReactNode
  title: string
  submitLabel: string
  initial: PartyFormValues
  onSubmit: (values: PartyFormValues) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(initial.name)
  const [placements, setPlacements] = React.useState(initial.placements)
  const nameId = React.useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed every time it opens: after an edit, the previous values must
        // not come back as the starting point.
        if (next) {
          setName(initial.name)
          setPlacements(initial.placements)
        }
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            ป้ายกำกับบอกว่าปาร์ตี้นี้โผล่หน้าไหนของสมาชิก — ปาร์ตี้เดียวลงได้หลายอีเวนต์
            แตะปุ่มเพื่อติ๊ก/ถอดทีละอีเวนต์ ไม่ติ๊กไว้เลย = ทีมนี้ไม่ลงสนามไหนเลย
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>ชื่อปาร์ตี้</Label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              enterKeyHint="next"
              placeholder="เช่น ปาร์ตี้ 1 (เว้นว่างได้)"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>ป้ายกำกับ</Label>
            <PartyLabelChips
              placements={placements}
              onChange={(next) => setPlacements(next)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="touch-manipulation"
            onClick={() => setOpen(false)}
          >
            ยกเลิก
          </Button>
          <Button
            className="touch-manipulation"
            onClick={() => {
              onSubmit({ name, placements })
              setOpen(false)
            }}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
