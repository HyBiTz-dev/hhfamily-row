"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
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
import { PartyLabelChips } from "@/components/party-label-chips"
import type { PartyPlacement } from "@/lib/rngw/types"

/**
 * Name + label, from the pencil on a team card.
 *
 * The party builder has this dialog too, and for a while the board's pencil only
 * offered the name — so fixing a mislabelled team meant leaving the board,
 * opening the admin tab and finding it in a list of 14 teams. Same fields, same
 * chips, one component for both (`PartyLabelChips`), because a label written in
 * one place has to mean the same thing in the other.
 *
 * Not `NameDialog`: that one owns a single string and refuses to submit an
 * unchanged value, which is exactly right for a rename and wrong here — the
 * label alone is a complete edit while the name stays as it is.
 *
 * The placements are the source of truth: the chips add or remove one event
 * each, and a removed event takes the team off that board without touching its
 * roster.
 */
function placementSignature(placements: PartyPlacement[]): string {
  return placements
    .map((placement) => `${placement.event}:${placement.division}`)
    .sort()
    .join("|")
}

export function TeamEditDialog({
  trigger,
  teamName,
  initialPlacements,
  onSubmit,
}: {
  trigger: React.ReactNode
  teamName: string
  /** The events this team plays, with the division it names. */
  initialPlacements: PartyPlacement[]
  onSubmit: (values: { name: string; placements: PartyPlacement[] }) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(teamName)
  const [placements, setPlacements] = React.useState(initialPlacements)
  const nameId = React.useId()

  const trimmed = name.trim()
  // Submitting the values already stored would rewrite the row for nothing.
  const unchanged =
    trimmed === teamName &&
    placementSignature(placements) === placementSignature(initialPlacements)
  const disabled = !trimmed || unchanged

  function submit() {
    if (disabled) return
    onSubmit({ name: trimmed, placements })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed every time it opens: after an edit, the previous values must
        // not come back as the starting point.
        if (next) {
          setName(teamName)
          setPlacements(initialPlacements)
        }
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แก้ไขทีม “{teamName}”</DialogTitle>
          <DialogDescription>
            ชื่อทีมกับป้ายกำกับ — ป้ายบอกว่าทีมนี้โผล่หน้าไหน ถอดป้ายของหน้าที่เลื่อนอยู่
            ทีมก็จะหายจากหน้านั้น (สมาชิกในทีมไม่หาย) แตะชิปเพื่อเพิ่มหน้าอื่นได้
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>ชื่อทีม</Label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              enterKeyHint="next"
              placeholder="เช่น ทีมสเกา"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submit()
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>ป้ายกำกับ</Label>
            <PartyLabelChips placements={placements} onChange={setPlacements} />
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
          <Button className="touch-manipulation" disabled={disabled} onClick={submit}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}