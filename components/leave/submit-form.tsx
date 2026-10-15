"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GameIcon } from "@/components/game-icon"
import { useConfirm } from "@/components/confirm-dialog"
import { StatusBadge } from "@/components/leave/roster-list"
import { matchesMemberName } from "@/lib/rngw/roster"
import { splitHighlight } from "@/lib/rngw/team-search"
import type { AttendanceStatus, MemberStatus } from "@/lib/rngw/types"
import { cn } from "cn"
import { toast } from "sonner"

const CHOICES: { value: Exclude<AttendanceStatus, "unknown">; label: string }[] = [
  { value: "present", label: "มาเล่น" },
  { value: "leave", label: "ลาวันนี้" },
]

/**
 * Members pick their own name, tap a status, and confirm.
 *
 * There is no PIN and no account here: attendance is open so anyone can report
 * their own status, and the only gate is picking a real roster row. The last
 * tap asks once more, showing the name that is about to be written. Recording
 * the wrong person is the one mistake this form can make that the guild master
 * cannot spot from the board: a row appears under a name, and the person who
 * actually meant to answer says nothing at all.
 */
export function SubmitForm({
  roster,
  onSubmitted,
}: {
  roster: MemberStatus[]
  onSubmitted: () => void
}) {
  const [selected, setSelected] = React.useState<MemberStatus | null>(null)
  // What is in the box right now, only used to highlight the matching part of
  // each suggestion. The submitted name still comes from the picked row.
  const [typed, setTyped] = React.useState("")
  const [status, setStatus] = React.useState<Exclude<AttendanceStatus, "unknown">>(
    "present"
  )
  const [note, setNote] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const sorted = [...roster].sort((a, b) => a.name.localeCompare(b.name, "th"))

  /**
   * The picked member, but only while the box still says their name.
   *
   * The combobox keeps `selected` when someone edits the text afterwards, so
   * submitting on that alone would send the old name while the box shows
   * something else — the kind of thing that quietly puts another person's
   * attendance in the database. Comparing the two is the whole guard.
   */
  const picked = selected && typed.trim() === selected.name ? selected : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!picked || pending) return

    // Captured now rather than read again after the await: the member may
    // change the form while the dialog is open, and the dialog has to describe
    // the write that is about to happen, not whatever the form says later.
    const chosen = picked
    const chosenStatus = status
    const chosenNote = note.trim()

    const yes = await confirm({
      title: `ยืนยันบันทึกสถานะของ “${chosen.name}”?`,
      description: "ถ้าไม่ใช่ชื่อของคุณ กดยกเลิกแล้วเลือกใหม่ — ชื่อที่บันทึกแล้วหัวหน้ากิลด์แก้ให้ได้ แต่จะช้ากว่า",
      confirmLabel: "ยืนยันบันทึก",
      children: (
        <div className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2.5">
          <GameIcon job={chosen.job} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{chosen.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {chosen.job}
            </p>
            {chosenNote && (
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                หมายเหตุ: {chosenNote}
              </p>
            )}
          </div>
          <StatusBadge status={chosenStatus} />
        </div>
      ),
    })
    if (!yes) return

    setPending(true)
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The name comes from a roster row that was picked out of the list, so
        // the database can never receive a half-typed name.
        body: JSON.stringify({
          name: chosen.name,
          status: chosenStatus,
          note: chosenNote || undefined,
        }),
      })
      const body = await response.json()

      if (!response.ok) {
        toast.error(body.error ?? "ส่งไม่สำเร็จ")
        return
      }

      toast.success(
        `${chosen.name} — ${chosenStatus === "present" ? "มาเล่น" : "ลาวันนี้"} บันทึกแล้ว`
      )
      setNote("")
      onSubmitted()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="member-name">ชื่อตัวละคร</Label>
        {/*
          Typing beats scrolling through a dropdown of 150 names on a phone,
          but the name still has to come from a row someone picked — otherwise
          a typo becomes a new person in the roster. So the list filters as you
          type, and only choosing an item fills the form.
        */}
        <Combobox
          items={sorted}
          // `itemToStringLabel` is what lands in the box; `itemToStringValue` is
          // what a form submission would send. Only the first one is obvious —
          // leaving it out makes Base UI print the whole object as JSON.
          itemToStringLabel={(member) => member.name}
          itemToStringValue={(member) => member.name}
          // After a successful submit the roster is refetched, so these are new
          // objects. Comparing by reference would make Base UI think the
          // selection is no longer in the list.
          isItemEqualToValue={(itemValue, value) => itemValue.name === value.name}
          value={selected}
          onValueChange={(member) => {
            setSelected(member)
            // Base UI fills the box on its own; keep the two in step so the
            // `picked` check above sees the same text.
            setTyped(member ? member.name : "")
          }}
          filter={(member, query) => matchesMemberName(member, query)}
          // Wrapped, not passed straight to setState: this callback gets a
          // second argument (the event details) and React would happily treat
          // that object as a state updater function.
          onInputValueChange={(value) => setTyped(value)}
          // Pressing the keyboard's search key on a phone should take the first
          // suggestion instead of submitting an empty form.
          autoHighlight
        >
          <ComboboxInput
            id="member-name"
            placeholder="พิมพ์ชื่อของคุณ"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            showClear
            // shadcn sizes the clear button for a mouse (24px); a thumb needs
            // the usual 32px. The trigger chevron is left alone — typing works
            // without it.
            className="[&_[data-slot=combobox-clear]]:size-8 sm:[&_[data-slot=combobox-clear]]:size-6"
          />
          <ComboboxContent>
            <ComboboxEmpty>
              ไม่พบชื่อนี้ — ลองพิมพ์เฉพาะบางส่วน หรือถามหัวหน้ากิลด์
            </ComboboxEmpty>
            <ComboboxList>
              {(member) => (
                <ComboboxItem key={member.name} value={member}>
                  <GameIcon
                    job={member.job}
                    className="size-6"
                  />
                  <span className="min-w-0 flex-1">
                    <MemberName name={member.name} query={typed} />
                    <span className="text-muted-foreground block truncate text-xs">
                      {member.job}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      <div className="space-y-1.5">
        <Label>วันนี้สถานะอะไร</Label>
        <div className="grid grid-cols-2 gap-2">
          {CHOICES.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant={status === choice.value ? "default" : "outline"}
              size="lg"
              aria-pressed={status === choice.value}
              onClick={() => setStatus(choice.value)}
              className={cn(status === choice.value && "ring-ring/50 ring-3")}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">หมายเหตุ (ไม่บังคับ)</Label>
        <Input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น จะออนไลน์ดึก"
          maxLength={100}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!picked || pending}
      >
        {pending ? "กำลังบันทึก…" : "บันทึกสถานะ"}
      </Button>

      {confirmDialog}
    </form>
  )
}

/** A suggestion with the typed part picked out, same mark as the event boards. */
function MemberName({ name, query }: { name: string; query: string }) {
  const parts = splitHighlight(name, query)

  if (!parts) return <span className="block truncate font-medium">{name}</span>

  return (
    <span className="block truncate font-medium">
      {parts.before}
      <mark className="bg-primary/25 text-foreground rounded-sm px-0.5 font-semibold">
        {parts.match}
      </mark>
      {parts.after}
    </span>
  )
}