"use client"

import * as React from "react"
import { Plus, Save, Search, Trash2, TriangleAlert, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GameIcon } from "@/components/game-icon"
import { useConfirm } from "@/components/confirm-dialog"
import { toast } from "sonner"
import { JOBS, isJobName } from "@/lib/rngw/jobs"
import { filterMembers } from "@/lib/rngw/roster"
import { ABSENCE_ALERT_AFTER, type Absences } from "@/lib/rngw/attendance"
import type { AttendanceRow, Member, Party } from "@/lib/rngw/types"
import { cn } from "cn"

const BLANK = {
  name: "",
  job: JOBS[0].name,
  level: "90",
  note: "",
}

export function MemberManager({
  members,
  absences,
  attendance,
  parties,
  onSaved,
}: {
  members: Member[]
  /** Name → absences, from `absencesFor`; the badge is a summary, not the rule. */
  absences?: Map<string, Absences>
  /** The raw ledger, only to report how many rows a delete will remove. */
  attendance?: AttendanceRow[]
  /**
   * Only to count how many teams a delete would take the member out of, so the
   * confirm can name it. The teams themselves are edited in the parties tab,
   * where the drag is.
   */
  parties?: Party[]
  onSaved: () => void
}) {
  const [form, setForm] = React.useState(BLANK)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => filterMembers(members, query), [members, query])
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name, "th"))

  // Row count per member, so the confirm can name the damage before anything
  // is deleted — the guild master deletes people, not databases.
  const historyCount = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of attendance ?? []) {
      counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
    }
    return counts
  }, [attendance])

  // Teams per member, so a delete can say "and out of two teams" instead of
  // the guild master learning about it from the board afterwards.
  const partyTeams = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const party of parties ?? []) {
      for (const name of party.memberNames ?? []) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    return counts
  }, [parties])

  function reset() {    setForm(BLANK)
    setEditing(null)
  }

  function startEdit(member: Member) {
    setEditing(member.name)
    setForm({
      name: member.name,
      // A class jobs.ts doesn't know — renamed out from under the data, or
      // typed by hand in the database — has no option to select, and a Select
      // with no matching value renders blank. Fall back to the first class so
      // the form is usable, and say so below the field: saving would otherwise
      // overwrite their class with Lord Knight without anyone noticing.
      job: isJobName(member.job) ? member.job : JOBS[0].name,
      level: String(member.level),
      note: member.note ?? "",
    })
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || busy) return

    setBusy(true)
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          job: form.job,
          level: Number(form.level) || 0,
          note: form.note || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ")

      toast.success(`บันทึก ${form.name.trim()} แล้ว`)
      reset()
      onSaved()
    } catch (cause) {
      toast.error((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Removes a member from the guild for good: the roster row, every attendance
   * row in their name, and every team they were standing in. There is no undo,
   * so the confirm spells out the row count rather than asking "แน่ใจไหม".
   */
  async function remove(member: Member) {
    if (busy) return

    const history = historyCount.get(member.name) ?? 0
    const teams = partyTeams.get(member.name) ?? 0
    const yes = await confirm({
      title: `ลบ ${member.name} ออกจากกิลด์?`,
      description: [
        history > 0 ? `ลบประวัติเช็คชื่อ ${history} แถว` : "คนนี้ไม่มีประวัติเช็คชื่อ",
        teams > 0 ? `ถอดออกจากอีก ${teams} ทีม` : null,
        "ถาวร — คืนไม่ได้ ไม่มีปุ่มย้อนกลับ",
      ]
        .filter(Boolean)
        .join(" · "),
      confirmLabel: "ลบถาวร",
      tone: "danger",
    })
    if (!yes) return

    setBusy(true)
    try {
      const res = await fetch("/api/admin/members/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: member.name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "ลบสมาชิกไม่สำเร็จ")

      toast.success(`ลบ ${member.name} ออกจากกิลด์แล้ว`, {
        description: [
          body.deleted > 0 ? `ลบประวัติเช็คชื่อ ${body.deleted} แถว` : null,
          body.cleanedParties > 0 ? `ถอดออกจากอีก ${body.cleanedParties} ทีม` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })
      if (editing === member.name) reset()
      onSaved()
    } catch (cause) {
      toast.error((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle>{editing ? `แก้ไข ${editing}` : "เพิ่มสมาชิก"}</CardTitle>
          <CardDescription>
            บันทึกลงรายชื่อสมาชิกทันที — ถ้าเคยเพิ่มชื่อนี้แล้วจะถูกอัปเดตทับ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="m-name">ชื่อตัวละคร</Label>
                <Input
                  id="m-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="เช่น Bank"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-level">เลเวล</Label>
                <Input
                  id="m-level"
                  inputMode="numeric"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>คลาส</Label>
              <Select
                value={form.job}
                onValueChange={(value) => setForm({ ...form, job: value })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOBS.map((job) => (
                    <SelectItem key={job.name} value={job.name}>
                      {job.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && !isJobName(members.find((m) => m.name === editing)?.job) ? (
                <p className="text-muted-foreground text-xs">
                  คลาสที่บันทึกไว้ไม่อยู่ในรายการนี้ — ถ้าบันทึกตอนนี้จะถูกเปลี่ยนเป็น{" "}
                  {form.job} ให้เลือกคลาสที่ถูกต้องก่อน
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-note">หมายเหตุ</Label>
              <Input
                id="m-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="เช่น ไม่ค่อยออนไลน์"
                maxLength={100}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !form.name.trim()}>
                {editing ? <Save /> : <Plus />} {editing ? "บันทึกการแก้ไข" : "เพิ่มสมาชิก"}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" onClick={reset}>
                  ยกเลิก
                </Button>
              )}
            </div>
          </form>

          {confirmDialog}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            รายชื่อทั้งหมด ({filtered.length}
            {filtered.length !== members.length ? ` จาก ${members.length}` : ""})
          </CardTitle>
          <CardDescription>
            ค้นหาด้วยชื่อ คลาส หรือหมายเหตุ · ปุ่มถังขยะ = ลบออกจากกิลด์ถาวร คืนไม่ได้
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาสมาชิก…"
              className="pr-9 pl-8"
              aria-label="ค้นหาสมาชิก"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                aria-label="ล้างคำค้น"
                onClick={() => setQuery("")}
              >
                <X />
              </Button>
            )}
          </div>

          {/*
            A definite height, not max-height. Radix's viewport is the scroll
            container and shadcn sizes it h-full, so a `max-h-*` root leaves
            the viewport sized to its own content — nothing overflows inside
            it, and the root just clips the list with no way to scroll.
            Short rosters keep their natural height instead of a tall empty box.
          */}
          <ScrollArea className={cn("h-96", sorted.length <= 5 && "h-auto")}>
            {sorted.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                ไม่พบสมาชิกที่ตรงกับ “{query.trim()}”
              </p>
            ) : (
              <ul className="divide-border divide-y">
              {sorted.map((member) => (
                <li key={member.name} className="flex items-center gap-3 py-2">
                  <GameIcon job={member.job} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {member.name}
                      <span className="text-muted-foreground ml-2 text-xs">Lv.{member.level}</span>
                      {/*
                        The same count the warnings tab lists, so someone going
                        quiet is visible in the roster too. Amber is a warning,
                        red is the line the guild drew for itself.
                      */}
                      {(absences?.get(member.name)?.count ?? 0) > 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "ml-2 align-middle",
                            (absences?.get(member.name)?.count ?? 0) >= ABSENCE_ALERT_AFTER
                              ? "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300"
                              : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          )}
                        >
                          <TriangleAlert /> ขาด {absences?.get(member.name)?.count} ครั้ง
                        </Badge>
                      )}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {member.job}
                      {member.note ? ` · ${member.note}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(member)}>
                    แก้ไข
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 touch-manipulation text-destructive hover:text-destructive sm:size-7"
                    aria-label={`ลบ ${member.name} ออกจากกิลด์`}
                    disabled={busy}
                    onClick={() => remove(member)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
