"use client"

import * as React from "react"
import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PortalContainerProvider } from "@/components/portal-container"
import { PartyBuilder } from "@/components/admin/party-builder"
import type { MemberStatus, Party } from "@/lib/rngw/types"

/**
 * The party builder, opened without leaving the event page.
 *
 * It is the same component the admin tab uses, so there is nothing to
 * duplicate — the dialog only adds a frame. Saving writes the sheet directly;
 * `onChange` is what updates the board behind the dialog.
 */
export function PartyDialog({
  members,
  parties,
  onChange,
}: {
  members: MemberStatus[]
  /** The parties tab as it is on the sheet — what members see right now. */
  parties: Party[]
  /** Applied to the board behind the dialog as soon as a write succeeds. */
  onChange: (next: Party[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  // The dialog content node. The add-member popups portal into it so they stay
  // scrollable while Radix locks the rest of the page — see portal-container.tsx.
  const [content, setContent] = React.useState<HTMLDivElement | null>(null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="touch-manipulation">
          <Users /> จัดการปาร์ตี้
        </Button>
      </DialogTrigger>
      <DialogContent ref={setContent} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>จัดการปาร์ตี้</DialogTitle>
          <DialogDescription>
            จัดทีมแล้วกด “บันทึก” เพื่อเขียนลงฐานข้อมูลทันที สมาชิกจะเห็นตอนโหลดหน้าครั้งถัดไป
          </DialogDescription>
        </DialogHeader>

        {/*
          ScrollArea rather than overflow on the dialog: the builder is long and
          its viewport needs a definite height (see AGENTS.md — a max-h root
          collapses the viewport and clips the list). One height for both long
          and short content is fine here because the builder is never short.
        */}
        <PortalContainerProvider container={content}>
          <ScrollArea className="h-[68dvh] pr-2">
            <PartyBuilder
              members={members}
              parties={parties}
              onChange={onChange}
            />
          </ScrollArea>
        </PortalContainerProvider>
      </DialogContent>
    </Dialog>
  )
}
