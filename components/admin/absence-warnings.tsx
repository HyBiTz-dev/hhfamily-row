"use client"

import * as React from "react"
import { Trash2, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollBar } from "@/components/ui/scroll-area"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useConfirm } from "@/components/confirm-dialog"
import { GameIcon } from "@/components/game-icon"
import { ABSENCE_ALERT_AFTER, guildDayLabel, pastAlertLine, type Absences } from "@/lib/rngw/attendance"
import type { AttendanceRow, Member } from "@/lib/rngw/types"
import { cn } from "cn"
import { toast } from "sonner"

/**
 * "คนไม่มา และไม่ลา" — the members going quiet, and the way out.
 *
 * Admin only, on purpose: the count is a judgement about a person, and the
 * person cannot argue with it if they never see it. The guild master gets the
 * evidence (which days), the roster of members gets nothing.
 *
 * This is a list first and an action second. It used to bench everyone over
 * the line the moment the tab opened, then offer a "คืนสถานะ" button to undo
 * it — dropping someone off the roster over a counter, without anyone pressing
 * anything. Nothing happens on its own now: the row grows a delete button, and
 * pressing it asks once more and names what goes.
 *
 * The button appears only past the line the guild drew for itself
 * (`pastAlertLine`). Below that the tab is evidence; at or above it, the guild
 * master has usually already decided, and making them hunt for the member tab
 * only adds a chance to forget.
 */
export function AbsenceWarnings({
  members,
  absences,
  attendance,
  onSaved,
}: {
  members: Member[]
  /** Name → absences, from `absencesFor`. */
  absences: Map<string, Absences>
  /** The raw ledger, only to report how many rows a delete will remove. */
  attendance?: AttendanceRow[]
  /** Called after a delete so the panel refetches the database. */
  onSaved: () => void
}) {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [busy, setBusy] = React.useState(false)
  const byName = React.useMemo(
    () => new Map(members.map((member) => [member.name, member])),
    [members]
  )
  const warned = React.useMemo(
    () =>
      [...absences.entries()]
        .filter(([, info]) => info.count > 0)
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "th")),
    [absences]
  )

  const overLine = React.useMemo(
    () => warned.filter(([, info]) => pastAlertLine(info)),
    [warned]
  )

  /**
   * Members the rule cannot judge at all.
   *
   * Counting needs a first day — the database has no join date — so someone who
   * has never pressed the button is not counted as absent. In a guild where a
   * handful of people use the tool, that is most of the roster, and reporting
   * "ไม่มีใครเงียบผิดปกติ" without it would be a lie.
   */
  const neverAnswered = React.useMemo(
    () =>
      members
        .filter((member) => absences.has(member.name))
        .filter((member) => absences.get(member.name)?.firstSeen === undefined)
        .map((member) => member.name)
        .sort((a, b) => a.localeCompare(b, "th")),
    [members, absences]
  )

  /**
   * Rows per member, so the confirm can name the damage before anything is
   * deleted — the guild master deletes people, not databases.
   */
  const historyCount = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of attendance ?? []) {
      counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
    }
    return counts
  }, [attendance])

  /**
   * Removes a member for good: the roster row and every attendance row in their
   * name. The same call the member tab makes — one route, one behaviour, and no
   * way to make someone disappear by pressing a different button.
   */
  async function remove(name: string) {
    if (busy) return

    const history = historyCount.get(name) ?? 0
    const yes = await confirm({
      title: `ลบ ${name} ออกจากกิลด์?`,
      description:
        history > 0
          ? `ลบแถวสมาชิกและประวัติเช็คชื่อ ${history} แถวถาวร — คืนไม่ได้ ไม่มีปุ่มย้อนกลับ`
          : "ลบแถวสมาชิกถาวร — คืนไม่ได้ ไม่มีปุ่มย้อนกลับ (คนนี้ไม่มีประวัติเช็คชื่อ)",
      confirmLabel: "ลบถาวร",
      tone: "danger",
    })
    if (!yes) return

    setBusy(true)
    try {
      const res = await fetch("/api/admin/members/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "ลบสมาชิกไม่สำเร็จ")

      toast.success(`ลบ ${name} ออกจากกิลด์แล้ว`, {
        description: body.deleted > 0 ? `ลบประวัติเช็คชื่อ ${body.deleted} แถวด้วย` : undefined,
      })
      onSaved()
    } catch (cause) {
      toast.error((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The same delete button for both layouts below — the mobile list and the
   * table — so there is one button and one `remove` call, not two that could
   * drift apart.
   */
  function removeButton(name: string) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-9 shrink-0 touch-manipulation text-destructive hover:text-destructive sm:size-7"
        aria-label={`ลบ ${name} ออกจากกิลด์`}
        disabled={busy}
        onClick={() => remove(name)}
      >
        <Trash2 />
      </Button>
    )
  }

  /** Same rule as the badge in the table: over the line or not. */
  function countBadge(count: number, over: boolean) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "ml-2 align-middle",
          over
            ? "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300"
            : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
        )}
      >
        <TriangleAlert /> {count} ครั้ง
      </Badge>
    )
  }

  const countingRule = (
    <p className="leading-relaxed">
      นับเฉพาะวันเล่นกิลด์ ({guildDayLabel()}) ที่ผ่านมาแล้วและมีคนตอบจริง
      และเริ่มนับตั้งแต่วันที่สมาชิกตอบครั้งแรก · ระบบไม่ทำอะไรกับชื่อใดเอง —
      ขาดครบ {ABSENCE_ALERT_AFTER} ครั้งจะมีปุ่มถังขยะให้กดลบออกจากกิลด์
      (ลบถาวรพร้อมประวัติ กดแล้วถามยืนยันอีกครั้ง)
    </p>
  )

  if (warned.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ไม่มีใครเงียบผิดปกติ</CardTitle>
          <CardDescription>{countingRule}</CardDescription>
        </CardHeader>
        {neverAnswered.length > 0 && <NeverAnswered names={neverAnswered} />}
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ไม่มา และไม่ลา ({warned.length})</CardTitle>
        <CardDescription>{countingRule}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {overLine.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <p className="min-w-0 flex-1 text-sm">
              ขาดครบ {ABSENCE_ALERT_AFTER} ครั้ง {overLine.length} คน:{" "}
              <span className="font-medium">{overLine.map(([name]) => name).join(", ")}</span>{" "}
              — กดถังขยะที่แถวถ้าจะเอาออกจากกิลด์
            </p>
          </div>
        )}

        {/*
          Two layouts, one list of people.

          A four-column table cannot fit a 320px screen once the miss-dates
          string and the delete button are in it — and the button sits in the
          last column, so the thing this tab exists for ends up off-screen
          behind a horizontal scroll nobody thinks to try. On phones it is
          therefore a plain list: name and dates stacked, button always at the
          right edge where the thumb already is. The table keeps the screen
          from `sm` up, where the columns have room and the sticky header
          earns its keep.

          Vertical scrolling is shadcn's ScrollArea; the header sticks to the
          top of it. `TableScrollArea` is the same component with a horizontal
          bar added — `orientation` lives on ScrollBar, not on ScrollArea, so
          shadcn's own ScrollArea only ever renders the vertical one and the
          desktop table still needs both.

          A definite height, not `max-h-*`: the viewport is the element that
          scrolls and shadcn sizes it h-full, so a `max-h-*` root leaves the
          viewport sized to its own content — nothing overflows inside it and
          the root just clips the list with no way to scroll. Short lists keep
          their natural height instead of a tall empty box.
        */}
        <TableScrollArea className={cn("h-96", warned.length <= 4 && "h-auto")}>
          {/*
            Phone layout. `divide-y` on the list itself, matching the roster
            tab, so rows read as one column instead of four.
          */}
          <ul className="divide-border divide-y sm:hidden">
            {warned.map(([name, info]) => {
              const member = byName.get(name)
              const over = pastAlertLine(info)
              return (
                <li key={name} className="flex items-center gap-2 py-2.5">
                  {member && <GameIcon job={member.job} className="size-6 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {name}
                      {countBadge(info.count, over)}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {member ? `${member.job} · ` : ""}
                      {info.dates.join(", ")}
                    </p>
                  </div>
                  {over && removeButton(name)}
                </li>
              )
            })}
          </ul>

          {/*
            shadcn's Table wraps itself in `data-slot="table-container"`, a
            horizontal scroller. Left alone that div is the table's nearest
            scrollport, so a `sticky` header sticks to its top edge — which
            never moves — and scrolls away with the list. Switching the
            overflow off leaves the viewport as the only scroller, which is
            what makes the header stick and what the custom bars drag.
            The Viewport scrolls on both axes regardless.
          */}
          <div className="hidden sm:block [&_[data-slot=table-container]]:overflow-x-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 bg-card">สมาชิก</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card text-right">ขาด</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card">วันที่ขาด</TableHead>
                  {/*
                    The delete column exists only when there is somebody it
                    applies to. An empty header cell on every quiet member would
                    read as "you may delete this one too".
                  */}
                  {overLine.length > 0 && (
                    <TableHead className="sticky top-0 z-10 w-12 bg-card">
                      <span className="sr-only">ลบออกจากกิลด์</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {warned.map(([name, info]) => {
                  const member = byName.get(name)
                  const over = pastAlertLine(info)
                  return (
                    <TableRow key={name}>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2">
                          {member && (
                            <GameIcon
                              job={member.job}
                              className="size-6 shrink-0"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{name}</span>
                            {member && (
                              <span className="text-muted-foreground block truncate text-xs">
                                {member.job}
                              </span>
                            )}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{countBadge(info.count, over)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs tabular-nums">
                        {info.dates.join(", ")}
                      </TableCell>
                      {overLine.length > 0 && (
                        <TableCell className="text-right">{over && removeButton(name)}</TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </TableScrollArea>

        <NeverAnswered names={neverAnswered} />
      </CardContent>

      {/*
        Rendered here, not in the member tab: `useConfirm` opens a dialog with
        the caller that asked for it, and an unrendered one never appears.
      */}
      {confirmDialog}
    </Card>
  )
}

/**
 * shadcn's ScrollArea with a horizontal bar as well.
 *
 * `orientation` is a prop of ScrollBar, not of ScrollArea, so the component
 * from the CLI renders a vertical bar and nothing else — correct for the lists
 * that never get wide, useless for a table whose date column is one long
 * unbreakable line. The Viewport already scrolls on both axes, so the missing
 * piece was only the thing a desktop mouse can grab.
 *
 * Written here rather than by editing `components/ui/scroll-area.tsx`: that file
 * belongs to the shadcn CLI and is overwritten on update. If a second table
 * ever needs this, promote it to its own component.
 */
function TableScrollArea({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

/**
 * The people the counting rule cannot see, listed rather than acted on.
 *
 * Kept visible on purpose: "ไม่มีใครเงียบผิดปกติ" would read as good news while
 * most of the guild has never used the site at all.
 */
function NeverAnswered({ names }: { names: string[] }) {
  if (names.length === 0) return null

  return (
    <div className="space-y-1.5 rounded-lg border border-dashed px-3 py-2">
      <p className="text-sm font-medium">ยังไม่เคยตอบเลย ({names.length} คน)</p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        ระบบนับคนเหล่านี้ไม่ได้ เพราะยังไม่มีวันที่ไหนที่เป็น “ครั้งแรกที่ตอบ” ให้เริ่มนับ —
        ใครที่เพิ่งเข้ากิลด์จะไม่โดนนับย้อนหลัง ถ้าอยากให้นับคนกลุ่มนี้ด้วย
        ต้องมีวันที่เข้ากิลด์ของแต่ละคนก่อน
      </p>
      <p className="text-muted-foreground truncate text-xs">{names.join(" · ")}</p>
    </div>
  )
}