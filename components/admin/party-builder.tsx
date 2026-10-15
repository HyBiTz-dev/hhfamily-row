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
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
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
  stripCustomLabels,
  TEAM_MAX_MEMBERS,
  unlockedParties,
} from "@/lib/party"
import { PartyLabelChips } from "@/components/party-label-chips"
import { matchEventCategories } from "@/lib/rngw/categories"
import type { MemberStatus, Party } from "@/lib/rngw/types"
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
  onChange,
}: {
  members: MemberStatus[]
  /** The parties tab as it is on the database — and what every write replaces. */
  parties: Party[]
  /** Called with the new full tab for the optimistic update (and revert). */
  onChange: (next: Party[]) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState<MemberStatus | null>(null)
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
        const res = await fetch("/api/admin/parties", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parties: next }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ")
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
      content: values.content.trim() || undefined,
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
            content: values.content.trim() || undefined,
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
   * hold a player on a Guild War team and a league team at once, but yanking
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
      toast.info(`${target.name} มีครบ ${TEAM_MAX_MEMBERS} คนแล้ว — ต้องเอาออกก่อน`)
      return
    }

    const targetEvents = matchEventCategories(target.content)
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
            matchEventCategories(party.content).some((event) => targetEvents.includes(event))
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

    const overId = event.over?.id
    if (data?.type !== "member" || !data.name) return
    if (typeof overId !== "string" || !overId.startsWith(PARTY_DROP_PREFIX)) return

    const partyId = overId.slice(PARTY_DROP_PREFIX.length)
    // Dropped back where it came from: nothing to write.
    if (data.from === partyId) return
    void addMember(partyId, data.name, data.from ?? null)
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
            initial={{ name: "", content: "" }}
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
        collisionDetection={rectIntersection}
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MemberPlacementProvider parties={parties}>
            {parties.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm sm:col-span-2 lg:col-span-3">
                ยังไม่มีปาร์ตี้ — กด “เพิ่มปาร์ตี้” แล้วเพิ่มคนในช่องด้านล่าง หรือกด
                “สุ่มปาร์ตี้” ถ้าจะจัดคนที่ยังไม่มีทีมทั้งหมดเลย
              </p>
            ) : (
              parties.map((party) => (
                <PartyCard
                  key={party.id}
                  party={party}
                  members={members}
                  byName={byName}
                  busy={busy}
                  onAdd={addMember}
                  onRemove={removeMember}
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

      {confirmDialog}
    </div>
  )
}

/* ------------------------------------------------------------------- cards */

const PARTY_DROP_PREFIX = "party:"
const MEMBER_DRAG_PREFIX = "member:"

const DRAG_HINT =
  "ลากชื่อจากปาร์ตี้หนึ่งไปอีกปาร์ตี้เพื่อย้าย · เพิ่มคนใหม่ใช้ช่อง “เพิ่มคน” ท้ายการ์ด" +
  " (บนมือถือ: กดค้างชื่อประมาณครึ่งวินาทีก่อนลาก)"

/**
 * One party, and a drop target for dragged names.
 *
 * The card is not draggable and does not sort its members: the only drag here
 * is moving a name from one card to another, which changes two `memberNames`
 * lists at once (the source loses them). Adding someone is the combobox below —
 * there is no member list to drag from any more. Slot order was dropped with the
 * old editor: neither the game nor the database cares which of the five is listed
 * first.
 * order was dropped with the old editor: neither the game nor the database cares
 * which of the five is listed first.
 */
function PartyCard({
  party,
  members,
  byName,
  busy,
  onAdd,
  onRemove,
  onRename,
  onToggleLock,
  onDelete,
}: {
  party: Party
  members: MemberStatus[]
  byName: Map<string, MemberStatus>
  busy: boolean
  onAdd: (partyId: string, name: string) => void | Promise<void>
  onRemove: (party: Party, name: string) => void
  onRename: (party: Party, values: PartyFormValues) => void
  onToggleLock: (party: Party) => void
  onDelete: (party: Party) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${PARTY_DROP_PREFIX}${party.id}` })

  const rows = party.memberNames.map((name) => ({ name, member: byName.get(name) }))
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
              initial={{ name: party.name, content: party.content ?? "" }}
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
          {party.content && (
            <Badge variant="outline" className="max-w-full">
              <span className="truncate">{party.content}</span>
            </Badge>
          )}

          {rows.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-2 py-6 text-center text-xs">
              {isOver ? "วางตรงนี้เพื่อย้ายเข้าทีมนี้" : "ยังไม่มีใคร — เพิ่มได้ด้านล่าง"}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {rows.map(({ name, member }) => (
                <MemberRow
                  key={name}
                  name={name}
                  member={member}
                  partyName={party.name}
                  partyId={party.id}
                  busy={busy}
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

/** A member inside a party card: draggable to another card, with a remove ✕. */
function MemberRow({
  name,
  member,
  partyName,
  partyId,
  busy,
  onRemove,
}: {
  name: string
  member: MemberStatus | undefined
  partyName: string
  partyId: string
  busy: boolean
  onRemove: () => void
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${MEMBER_DRAG_PREFIX}${name}`,
    data: { type: "member", name, from: partyId },
    disabled: busy,
  })

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className="flex cursor-grab items-center gap-3 py-1.5 touch-manipulation active:cursor-grabbing"
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
  content: string
}

/**
 * Name + label, for both making a party and editing one.
 *
 * The label chips are the whole interface for the label: a party's `content`
 * decides which event pages it shows on, and the site matches it against
 * `compact`ed keywords. A hand-typed label only has to *look* right to whoever
 * typed it while matching nothing at all — the team then appears in no event,
 * only in the "ว่าง" row of every page. So the field is gone rather than
 * optional, and `stripCustomLabels` cleans up the ones typed before it was.
 *
 * A fixed team that plays several events taps several chips — the label then
 * reads `"Guild War + Guild League ลีคหลัก"`, and each event page reads only its
 * own part. The chips are grouped by page so the two league chips read as one
 * event with two divisions rather than as two more events.
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
  const [content, setContent] = React.useState(() => stripCustomLabels(initial.content))
  const nameId = React.useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed every time it opens: after an edit, the previous values must
        // not come back as the starting point. The label comes in stripped —
        // a typed tag that names no event lights no chip and would look like
        // the party had none.
        if (next) {
          setName(initial.name)
          setContent(stripCustomLabels(initial.content))
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
              content={content}
              onChange={(next) => setContent(next)}
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
              // Stripped again on the way out: the chips can only ever produce
              // segments that match an event, so this only matters for a party
              // whose label predates the editor.
              onSubmit({ name, content: stripCustomLabels(content) })
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
