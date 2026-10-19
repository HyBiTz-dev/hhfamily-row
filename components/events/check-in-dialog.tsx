"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GameIcon } from "@/components/game-icon"
import { StatusBadge } from "@/components/leave/roster-list"
import { formatGuildDay } from "@/lib/rngw/day"
import type { AttendanceStatus, MemberStatus } from "@/lib/rngw/types"
import { cn } from "cn"
import { toast } from "sonner"

const CHOICES: { value: Exclude<AttendanceStatus, "unknown">; label: string }[] = [
  { value: "present", label: "มาเล่น" },
  { value: "leave", label: "ลาวันนี้" },
]

/**
 * The one-tap check-in a member gets by tapping their own name on an event board.
 *
 * No combobox and no PIN: the name came from the card the member just tapped, so
 * the identity is already settled — the only thing left to choose is today's
 * status. That is also why the confirm step lives in this same dialog instead of
 * a second one: the name card and the chosen status are on screen at the moment
 * the save button is pressed, and the button says out loud what it will write
 * ("ยืนยันว่ามาเล่น"). The home page's form keeps the two-step confirm because
 * there the name is picked out of 150 suggestions and can be the wrong row.
 *
 * Mounted only while open (the board keeps a name, not a boolean), so the
 * selected status resets to the member's current one every time it is opened.
 */
export function CheckInDialog({
  member,
  date,
  onClose,
  onSaved,
}: {
  member: MemberStatus
  /** Guild-local day the status belongs to. */
  date?: string
  onClose: () => void
  /** Called after a status was written, so the board behind can catch up. */
  onSaved: () => void
}) {
  const [status, setStatus] = React.useState<Exclude<AttendanceStatus, "unknown">>(
    member.status === "leave" ? "leave" : "present"
  )
  const [pending, setPending] = React.useState(false)

  async function submit() {
    if (pending) return
    setPending(true)
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The name came from a roster row (the card was drawn from `byName`), so
        // the database never receives a half-typed name.
        body: JSON.stringify({ name: member.name, status }),
      })
      const body = await response.json()

      if (!response.ok) {
        toast.error(body.error ?? "บันทึกไม่สำเร็จ")
        return
      }

      toast.success(
        `${member.name} — ${status === "present" ? "มาเล่น" : "ลาวันนี้"} บันทึกแล้ว`
      )
      onSaved()
      onClose()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>เช็คชื่อ</DialogTitle>
          <DialogDescription>
            {date ? formatGuildDay(date) : "วันนี้"} — เลือกสถานะของวันนี้แล้วกดยืนยัน
          </DialogDescription>
        </DialogHeader>

        {/*
          Who is about to be written. The card repeats the name, the job icon and
          the status on record, so a fat-finger tap on the wrong row is caught
          here rather than by the guild master looking at the board tomorrow.
        */}
        <div className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2.5">
          <GameIcon job={member.job} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{member.name}</p>
            <p className="text-muted-foreground truncate text-xs">{member.job}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-muted-foreground text-[10px]">สถานะตอนนี้</span>
            <StatusBadge status={member.status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {CHOICES.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant={status === choice.value ? "default" : "outline"}
              size="lg"
              aria-pressed={status === choice.value}
              onClick={() => setStatus(choice.value)}
              className={cn(
                "touch-manipulation",
                status === choice.value && "ring-ring/50 ring-3"
              )}
            >
              {choice.label}
            </Button>
          ))}
        </div>

        <Button
          type="button"
          size="lg"
          className="w-full touch-manipulation"
          disabled={pending}
          onClick={submit}
        >
          {pending
            ? "กำลังบันทึก…"
            : status === "present"
              ? "ยืนยันว่ามาเล่น"
              : "ยืนยันว่าลาวันนี้"}
        </Button>

        <p className="text-muted-foreground text-center text-xs">
          กดผิดชื่อหรือสถานะ แก้ได้ตลอด — แถวล่าสุดของวันนี้ชนะ
        </p>
      </DialogContent>
    </Dialog>
  )
}