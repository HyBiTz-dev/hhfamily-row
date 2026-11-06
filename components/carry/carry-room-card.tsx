"use client"

import * as React from "react"
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Check,
  KeyRound,
  ListChecks,
  Lock,
  Pencil,
  Trash2,
  Unlock,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GameIcon } from "@/components/game-icon"
import { useConfirm } from "@/components/confirm-dialog"
import {
  CarryNoteDialog,
  RoomLoginDialog,
  RoomSettingsDialog,
  TransferAllSignupsDialog,
  TransferSignupDialog,
} from "@/components/carry/carry-dialogs"
import { cn } from "cn"
import type { CarryDone, CarryRoom, CarrySignup, Member } from "@/lib/rngw/types"

/**
 * How many queue rows a room card shows before it scrolls.
 *
 * Five fits on a phone without a long queue pushing every other room off the
 * page. The height is measured from the first five rows instead of fixed with
 * `h-80`, because a row grows when a long name or note wraps — a fixed height
 * would show four people in one room and six in the next, and `ScrollArea`
 * cannot take `max-h-*` (its viewport is sized `h-full`).
 */
const QUEUE_VISIBLE_ROWS = 5

/**
 * One room's public queue plus the controls its carrier (or an admin) sees.
 *
 * A visitor can always read the queue and ask to join this room. The action
 * buttons only render when `authorized` is true, and every one of them is
 * checked again by the API — `authorized` comes from the server's signed room
 * cookies, not from anything the browser can forge.
 */
export function CarryRoomCard({
  room,
  signups,
  done,
  members,
  authorized,
  otherOpenRooms,
  onChanged,
  onSignupHere,
}: {
  room: CarryRoom
  signups: CarrySignup[]
  done: CarryDone[]
  members: Member[]
  authorized: boolean
  otherOpenRooms: CarryRoom[]
  onChanged: () => void
  onSignupHere: (roomId: number) => void
}) {
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [noteSignup, setNoteSignup] = React.useState<CarrySignup | null>(null)
  const [transferSignup, setTransferSignup] =
    React.useState<CarrySignup | null>(null)
  const [transferAllOpen, setTransferAllOpen] = React.useState(false)
  const [pendingOpen, setPendingOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState(false)
  // "แก้ไขคิว" mode. The everyday buttons are the ones a carrier presses for
  // every person (done, skip); notes/transfer/delete are rarer and easy to hit
  // by accident on a phone, so they live behind this switch.
  const [editing, setEditing] = React.useState(false)
  const [pendingName, setPendingName] = React.useState<string | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const memberByName = React.useMemo(
    () => new Map(members.map((member) => [member.name, member])),
    [members]
  )

  const queue = signups.filter((signup) => signup.roomId === room.id)
  const doneLog = done.filter((entry) => entry.roomId === room.id)
  const lastSignupAt = queue.reduce(
    (latest, signup) => Math.max(latest, signup.signedAt),
    0
  )

  /**
   * Caps the queue at `QUEUE_VISIBLE_ROWS` rows without losing a name.
   *
   * The measured box is the wrapper, not `ScrollArea` itself: writing an
   * explicit pixel height on the wrapper gives the viewport the definite height
   * it needs, and clearing the height when the queue is short lets the card
   * shrink back instead of reserving five empty rows. `ResizeObserver` re-runs
   * the measurement when a width change re-wraps a name or note.
   */
  const queueBoxRef = React.useRef<HTMLDivElement | null>(null)
  const queueListRef = React.useRef<HTMLUListElement | null>(null)
  const hasQueue = queue.length > 0

  React.useLayoutEffect(() => {
    const box = queueBoxRef.current
    const list = queueListRef.current
    if (!box || !list) return

    const measure = () => {
      const rows = Array.from(list.children) as HTMLElement[]
      if (rows.length <= QUEUE_VISIBLE_ROWS) {
        box.style.height = ""
        return
      }

      const height = rows
        .slice(0, QUEUE_VISIBLE_ROWS)
        .reduce((total, row) => total + row.getBoundingClientRect().height, 0)
      box.style.height = `${Math.ceil(height)}px`
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [hasQueue])

  async function toggleOpen() {
    setPendingOpen(true)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: !room.open }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "เปลี่ยนสถานะห้องไม่สำเร็จ")
        return
      }
      toast.success(!room.open ? "เปิดรับคิวแล้ว" : "ปิดรับคิวแล้ว")
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPendingOpen(false)
    }
  }

  /**
   * Takes one name out of the queue and into the room's log.
   *
   * No confirm on purpose: this is the button a carrier presses for every
   * person, sometimes ten times in one sitting, and an extra dialog each time
   * slows the queue down where people are waiting. The log is exactly what
   * makes that safe — the row is not gone from the carrier's view, so a mis-tap
   * can be seen and fixed by hand.
   */
  async function markDone(signup: CarrySignup) {
    if (pendingName) return

    setPendingName(signup.name)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/signups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: signup.name, action: "done" }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ทำเครื่องหมายไม่สำเร็จ")
        return
      }
      toast.success(`${signup.name} ลงแล้ว`, {
        description: "ออกจากคิวแล้ว · เก็บไว้ใน log ของห้อง",
      })
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPendingName(null)
    }
  }

  /** Sends one name to the back of this room's queue. */
  async function skip(signup: CarrySignup) {
    if (pendingName) return

    setPendingName(signup.name)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/signups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: signup.name, action: "skip" }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ข้ามคิวไม่สำเร็จ")
        return
      }
      toast.info(`ย้าย ${signup.name} ไปท้ายคิว`)
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPendingName(null)
    }
  }

  async function deleteRoom() {
    const yes = await confirm({
      title: `ลบห้อง “${room.title}”?`,
      description:
        "ห้องนี้ว่างและยังไม่มีใครอยู่ในคิว — ลบแล้วย้อนกลับไม่ได้ แต่สร้างใหม่ได้",
      confirmLabel: "ลบห้อง",
      tone: "danger",
    })
    if (!yes) return

    setPendingDelete(true)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}`, {
        method: "DELETE",
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ลบห้องไม่สำเร็จ")
        return
      }
      toast.success(`ลบห้อง “${room.title}” แล้ว`)
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPendingDelete(false)
    }
  }

  async function clearQueue() {
    const yes = await confirm({
      title: `ล้างคิวของ “${room.title}”?`,
      description: `จะลบทั้ง ${queue.length} ชื่อออกจากคิวนี้และย้อนกลับไม่ได้ — ถ้าต้องการให้แบกอีกต้องลงชื่อใหม่`,
      confirmLabel: "ล้างคิว",
      tone: "danger",
    })
    if (!yes) return

    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/signups`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ล้างคิวไม่สำเร็จ")
        return
      }
      toast.success(`ล้างคิวของ “${room.title}” แล้ว`)
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    }
  }

  async function removeSignup(signup: CarrySignup) {
    const yes = await confirm({
      title: `ลบ “${signup.name}” ออกจากคิว?`,
      description:
        "ชื่อจะหายจากคิวนี้และย้อนกลับไม่ได้ — ถ้าต้องการให้แบกอีกต้องลงชื่อใหม่",
      confirmLabel: "ลบชื่อ",
      tone: "danger",
    })
    if (!yes) return

    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/signups`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: signup.name }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ลบชื่อไม่สำเร็จ")
        return
      }
      toast.success(`ลบ ${signup.name} ออกจากคิวแล้ว`)
      onChanged()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="line-clamp-2 text-lg">{room.title}</CardTitle>
            <CardDescription className="mt-1 text-sm">
              คนแบก:{" "}
              <span className="text-foreground text-base font-semibold break-words">
                {room.carrierName}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {queue.length} คนในคิว
                {queue.length > QUEUE_VISIBLE_ROWS &&
                  ` · เลื่อนดูอีก ${queue.length - QUEUE_VISIBLE_ROWS} คน`}
              </span>
            </CardDescription>
            <p className="text-muted-foreground mt-1 text-xs">
              สร้างเมื่อ {formatRoomDate(room.createdAt)}
              {lastSignupAt > 0 &&
                ` · ลงคิวล่าสุด ${formatRoomDate(lastSignupAt)}`}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 border",
              room.open
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            {room.open ? <Unlock /> : <Lock />}
            {room.open ? "เปิดรับคิว" : "ปิดรับคิว"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {authorized ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={room.open ? "outline" : "default"}
              onClick={() => void toggleOpen()}
              disabled={pendingOpen}
              className="touch-manipulation"
            >
              {room.open ? <Lock /> : <Unlock />}
              {room.open ? "ปิดรับคิว" : "เปิดรับคิว"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              className="touch-manipulation"
            >
              <Pencil /> ตั้งค่าห้อง
            </Button>
            {queue.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant={editing ? "default" : "outline"}
                onClick={() => setEditing((current) => !current)}
                aria-pressed={editing}
                className="touch-manipulation"
              >
                <ListChecks /> {editing ? "เสร็จสิ้น" : "แก้ไขคิว"}
              </Button>
            )}
            {queue.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTransferAllOpen(true)}
                disabled={otherOpenRooms.length === 0}
                title={
                  otherOpenRooms.length
                    ? "ย้ายทุกคนในคิวไปห้องอื่น"
                    : "ยังไม่มีห้องอื่นที่เปิดรับคิว"
                }
                className="touch-manipulation"
              >
                <ArrowRightLeft /> ย้ายคิวทั้งหมด
              </Button>
            )}
            {queue.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void clearQueue()}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive touch-manipulation dark:border-destructive/50"
              >
                <Trash2 /> ล้างคิว
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void deleteRoom()}
                disabled={pendingDelete}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive touch-manipulation dark:border-destructive/50"
              >
                <Trash2 /> ลบห้อง
              </Button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLoginOpen(true)}
            className="touch-manipulation"
          >
            <KeyRound /> เข้าจัดการห้อง
          </Button>
        )}

        {queue.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            ยังไม่มีคนลงคิว
          </p>
        ) : (
          <div ref={queueBoxRef}>
            <ScrollArea className="h-full w-full">
              <ul ref={queueListRef} className="divide-border divide-y">
                {queue.map((signup, index) => {
                  const member = memberByName.get(signup.name)
                  return (
                    <li
                      key={signup.name}
                      className="flex flex-wrap items-start gap-3 py-2.5"
                    >
                      <span className="text-muted-foreground w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <GameIcon job={member?.job ?? ""} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-medium break-words">
                          {signup.name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {member?.job ?? "นอกรายชื่อ"}
                        </p>
                        {signup.note && (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs break-words">
                            {signup.note}
                          </p>
                        )}
                      </div>

                      {authorized && (
                        /*
                          Labelled buttons, not icon-only: a carrier working down
                          a queue should not have to remember what a tick or an
                          arrow means. On a phone the group moves to its own line
                          (`basis-full`) so the Thai labels never squeeze the
                          character name — the name is what identifies the person.
                        */
                        <div className="flex shrink-0 basis-full items-center justify-end gap-1 pt-1 sm:basis-auto sm:pt-0">
                          {editing ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`แก้หมายเหตุของ ${signup.name}`}
                                title="แก้หมายเหตุ"
                                className="touch-manipulation"
                                onClick={() => setNoteSignup(signup)}
                              >
                                <Pencil /> หมายเหตุ
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`ย้าย ${signup.name} ไปห้องอื่น`}
                                title={
                                  otherOpenRooms.length
                                    ? "ย้ายไปห้องอื่น"
                                    : "ยังไม่มีห้องอื่นที่เปิดรับคิว"
                                }
                                disabled={otherOpenRooms.length === 0}
                                className="touch-manipulation"
                                onClick={() => setTransferSignup(signup)}
                              >
                                <ArrowRightLeft /> ย้าย
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`ลบ ${signup.name} ออกจากคิว`}
                                title="ลบออกจากคิว"
                                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive touch-manipulation dark:border-destructive/50"
                                onClick={() => void removeSignup(signup)}
                              >
                                <Trash2 /> ลบ
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`ทำเครื่องหมายว่า ${signup.name} ลงแล้ว`}
                                title="ลงแล้ว — ออกจากคิว เก็บไว้ใน log"
                                disabled={pendingName === signup.name}
                                className="touch-manipulation border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 dark:hover:text-emerald-300"
                                onClick={() => void markDone(signup)}
                              >
                                <Check /> ลงแล้ว
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`ย้าย ${signup.name} ไปท้ายคิว`}
                                title="ข้ามคิว — ย้ายไปท้ายคิว"
                                disabled={pendingName === signup.name}
                                className="touch-manipulation"
                                onClick={() => void skip(signup)}
                              >
                                <ArrowDownToLine /> ข้ามคิว
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          </div>
        )}

        {doneLog.length > 0 && (
          /*
            The log of finished names. `<details>` keeps it collapsed by default
            so the queue stays the thing a visitor reads first; the carrier can
            open it to check who they already ran. It is not a queue: those
            names are free to sign up again.
          */
          <details className="rounded-lg border border-dashed px-3 py-2">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm select-none">
              ลงแล้ว {doneLog.length} คนล่าสุด · ดูรายการ
            </summary>
            <ul className="divide-border mt-2 divide-y">
              {doneLog.map((entry, index) => (
                <li
                  key={`${entry.name}-${entry.doneAt}-${index}`}
                  className="flex items-center justify-between gap-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatDoneAt(entry.doneAt)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {room.open && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full touch-manipulation"
            onClick={() => onSignupHere(room.id)}
          >
            <UserPlus /> ลงคิวห้องนี้
          </Button>
        )}
      </CardContent>

      {loginOpen && (
        <RoomLoginDialog
          room={room}
          onClose={() => setLoginOpen(false)}
          onLoggedIn={() => {
            setLoginOpen(false)
            onChanged()
          }}
        />
      )}
      {settingsOpen && (
        <RoomSettingsDialog
          room={room}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false)
            onChanged()
          }}
        />
      )}
      {noteSignup && (
        <CarryNoteDialog
          room={room}
          signup={noteSignup}
          onClose={() => setNoteSignup(null)}
          onSaved={() => {
            setNoteSignup(null)
            onChanged()
          }}
        />
      )}
      {transferSignup && (
        <TransferSignupDialog
          room={room}
          signup={transferSignup}
          targets={otherOpenRooms}
          onClose={() => setTransferSignup(null)}
          onMoved={() => {
            setTransferSignup(null)
            onChanged()
          }}
        />
      )}
      {transferAllOpen && (
        <TransferAllSignupsDialog
          room={room}
          count={queue.length}
          targets={otherOpenRooms}
          onClose={() => setTransferAllOpen(false)}
          onMoved={() => {
            setTransferAllOpen(false)
            onChanged()
          }}
        />
      )}

      {confirmDialog}
    </Card>
  )
}

const roomDateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function formatRoomDate(timestamp: number): string {
  if (!timestamp) return "ไม่ทราบ"
  return roomDateFormatter.format(new Date(timestamp))
}

/** Short date + time for the "ลงแล้ว" log, where the order matters by the minute. */
const doneAtFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDoneAt(timestamp: number): string {
  if (!timestamp) return ""
  return doneAtFormatter.format(new Date(timestamp))
}
