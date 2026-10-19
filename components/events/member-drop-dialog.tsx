"use client"

import { MoveHorizontal, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TEAM_MAX_MEMBERS } from "@/lib/party"
import type { Party } from "@/lib/rngw/types"

/**
 * A player was dropped onto another player.
 *
 * The gesture is ambiguous: it can mean "swap these two seats" or "put this
 * player on that team and leave the person under the finger alone". The dialog
 * asks instead of guessing, because a wrong guess moves two people at once.
 * When the target team is full only the swap is offered — there is no seat to
 * add to.
 */
export type MemberDropRequest = {
  name: string
  fromTeamId: string
  targetTeamId: string
  targetName: string
}

export function MemberDropDialog({
  request,
  parties,
  onCancel,
  onSwap,
  onAdd,
  addLabel = "เพิ่มเข้าทีม",
}: {
  request: MemberDropRequest
  parties: Party[]
  onCancel: () => void
  onSwap: () => void
  onAdd: () => void
  /** The party builder calls a team a "ปาร์ตี้", an event board calls it a "ทีม". */
  addLabel?: string
}) {
  const target = parties.find((party) => party.id === request.targetTeamId)
  const source = parties.find((party) => party.id === request.fromTeamId)
  if (!target || !source) return null

  const hasRoom = target.memberNames.length < TEAM_MAX_MEMBERS

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            วาง {request.name} ทับ {request.targetName}
          </DialogTitle>
          <DialogDescription>
            {request.name} มาจาก “{source.name}” · ปลายทาง “{target.name}” มี{" "}
            {target.memberNames.length}/{TEAM_MAX_MEMBERS} คน —{" "}
            {hasRoom
              ? "เลือกได้ว่าจะสลับที่นั่งกับคนที่วางทับ หรือเพิ่มเข้าทีมโดยไม่แตะคนเดิม"
              : "ทีมเต็มแล้ว จึงสลับที่กับคนที่วางทับได้อย่างเดียว"}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" className="touch-manipulation" onClick={onCancel}>
            ยกเลิก
          </Button>
          {hasRoom && (
            <Button variant="outline" className="touch-manipulation" onClick={onAdd}>
              <Plus />
              {addLabel}
            </Button>
          )}
          <Button className="touch-manipulation" onClick={onSwap}>
            <MoveHorizontal />
            สลับที่นั่ง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
