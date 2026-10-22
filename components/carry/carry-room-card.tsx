"use client"

import * as React from "react"
import {
  ArrowRightLeft,
  KeyRound,
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
import type { CarryRoom, CarrySignup, Member } from "@/lib/rngw/types"

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
  members,
  authorized,
  otherOpenRooms,
  onChanged,
  onSignupHere,
}: {
  room: CarryRoom
  signups: CarrySignup[]
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
  const { confirm, dialog: confirmDialog } = useConfirm()

  const memberByName = React.useMemo(
    () => new Map(members.map((member) => [member.name, member])),
    [members]
  )

  const queue = signups.filter((signup) => signup.roomId === room.id)
  const lastSignupAt = queue.reduce(
    (latest, signup) => Math.max(latest, signup.signedAt),
    0
  )

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
                variant="ghost"
                onClick={() => void clearQueue()}
                className="text-destructive hover:text-destructive touch-manipulation"
              >
                <Trash2 /> ล้างคิว
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void deleteRoom()}
                disabled={pendingDelete}
                className="text-destructive hover:text-destructive touch-manipulation"
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
          <ScrollArea
            className={cn("w-full", queue.length > 6 ? "h-80" : "h-auto")}
          >
            <ul className="divide-border divide-y">
              {queue.map((signup, index) => {
                const member = memberByName.get(signup.name)
                return (
                  <li
                    key={signup.name}
                    className="flex items-start gap-3 py-2.5"
                  >
                    <span className="text-muted-foreground w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums">
                      {index + 1}
                    </span>
                    <GameIcon job={member?.job ?? ""} />
                    <div className="min-w-0 flex-1">
                      {/* The three action buttons eat the row width on a
                          320px phone; wrapping keeps a long character name
                          readable instead of cutting off which half it is. */}
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
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`แก้หมายเหตุของ ${signup.name}`}
                          title="แก้หมายเหตุ"
                          className="text-muted-foreground size-8 touch-manipulation sm:size-7"
                          onClick={() => setNoteSignup(signup)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`ย้าย ${signup.name} ไปห้องอื่น`}
                          title={
                            otherOpenRooms.length
                              ? "ย้ายไปห้องอื่น"
                              : "ยังไม่มีห้องอื่นที่เปิดรับคิว"
                          }
                          disabled={otherOpenRooms.length === 0}
                          className="text-muted-foreground size-8 touch-manipulation sm:size-7"
                          onClick={() => setTransferSignup(signup)}
                        >
                          <ArrowRightLeft />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`ลบ ${signup.name} ออกจากคิว`}
                          title="ลบออกจากคิว"
                          className="text-muted-foreground hover:text-destructive size-8 touch-manipulation sm:size-7"
                          onClick={() => void removeSignup(signup)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
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
