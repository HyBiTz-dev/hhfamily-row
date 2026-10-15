"use client"

import * as React from "react"
import { ArrowLeft, CalendarIcon, ChevronRight, PencilLine, Search, X } from "lucide-react"
import { th } from "react-day-picker/locale/th"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GameIcon } from "@/components/game-icon"
import {
  StatusBadge,
  STATUS_LABEL,
  STATUS_TEXT_CLASS,
} from "@/components/leave/roster-list"
import { dateFromKey, guildDateLabel, guildTimeLabel, keyFromDate } from "@/lib/rngw/attendance"
import { matchesMemberQuery } from "@/lib/rngw/roster"
import type { AttendanceRow, AttendanceStatus, Member } from "@/lib/rngw/types"
import { cn } from "cn"

/** One member's day: every round they pressed the button, plus the winner. */
type DayEntry = {
  name: string
  /** Rows in submission order, i.e. chronological — an append-only ledger. */
  rounds: AttendanceRow[]
  /** The round that counts; ties go to the row later in the database. */
  latest: AttendanceRow
}

type Day = {
  date: string
  /** Submitters whose winning status is มา / ลา. */
  present: number
  leave: number
  /** Legacy rows whose winning status is "unknown"; the form cannot make these. */
  unknown: number
  /** Everyone who pressed anything that day. */
  responded: number
  /** Active members who pressed nothing that day — the live board's "รอเช็ค". */
  silent: number
  /** Submitters, sorted present → leave → name. */
  entries: DayEntry[]
}

/**
 * What the dialog is showing. It is one dialog with two faces rather than two
 * dialogs, so "back" is a state change instead of closing one and opening
 * another — on a phone that is the difference between a tap and a flash.
 */
type View =
  | { mode: "day"; date: string }
  | { mode: "member"; name: string; back?: string }

/** A row in the day list: someone who answered, or someone who went quiet. */
type ListedRow =
  | { kind: "entry"; entry: DayEntry }
  | { kind: "silent"; member: Member }

/** The order the roster reads in: the people playing first, the silent last. */
const STATUS_RANK: Record<AttendanceStatus, number> = { present: 0, leave: 1, unknown: 2 }

/**
 * The day tabs, in the order they read best.
 *
 * Tabs, not toggle chips: the three groups are what the guild master comes for
 * ("who showed up", "who said they can't", "who never said anything"), and a
 * mixed list sorted by status made all three questions cost a scroll. One group
 * at a time also means the list never has to be read twice to find a name.
 */
const TAB_STATUSES: AttendanceStatus[] = ["present", "leave", "unknown"]

/** The last row in submission order wins, matching `latestByMember` in the lib. */
function latestOf(rounds: AttendanceRow[]): AttendanceRow {
  let best = rounds[0]
  for (const round of rounds) if (round.submittedAt >= best.submittedAt) best = round
  return best
}

/**
 * Attendance history, newest first.
 *
 * Aggregated in the browser from the ledger the app already downloaded — no
 * extra request, and the numbers always match what the database holds.
 *
 * "รอเช็ค" means the same thing here as on the live board: a member in today's
 * roster who pressed nothing that day. It is not a row in the ledger — nobody
 * writes "I did not answer" — so it has to be derived from the roster, which is
 * why the database's own `unknown` status (which the form can never produce) is
 * not what this number counts.
 *
 * Three ways into the detail, all reading the same rows:
 * - pick a day in the calendar,
 * - tap a day in the table,
 * - search a member, to see every day they ever answered.
 *
 * The dialog lists **every** submission of a day, not just the winner. The
 * database is append-only, so "claimed มา then switched to ลา" is not an argument
 * about memory — both rows and both timestamps are still there to read.
 */
export function HistoryTable({
  members,
  attendance,
  today,
  timeZone,
}: {
  members: Member[]
  attendance: AttendanceRow[]
  /** The guild-local day the view was rendered for — the picker's upper bound. */
  today: string
  /** Guild timezone, for rendering submission times the way the database means them. */
  timeZone: string
}) {
  const [limit, setLimit] = React.useState(14)
  const [picked, setPicked] = React.useState<Date | undefined>(undefined)
  const [picking, setPicking] = React.useState(false)
  const [view, setView] = React.useState<View | null>(null)
  /** The typed-in picker value; always reset to null so the box clears. */
  const [memberPick, setMemberPick] = React.useState<Member | null>(null)
  /** Day-view filters. Cleared only when a day is opened fresh. */
  const [dayQuery, setDayQuery] = React.useState("")
  /** Which of the three groups the day list is showing. */
  const [statusTab, setStatusTab] = React.useState<AttendanceStatus>("present")
  const [onlyEdited, setOnlyEdited] = React.useState(false)

  const activeNames = React.useMemo(
    () => new Set(members.map((member) => member.name)),
    [members]
  )

  const days = React.useMemo(() => {
    // Group every row by member first, then resolve the winner per member —
    // the same rule the live board uses, but keeping the losing rows around
    // instead of discarding them, because the losing rows are the log.
    const byDate = new Map<string, Map<string, AttendanceRow[]>>()
    for (const row of attendance) {
      let byName = byDate.get(row.date)
      if (!byName) {
        byName = new Map()
        byDate.set(row.date, byName)
      }
      const rounds = byName.get(row.name)
      if (rounds) rounds.push(row)
      else byName.set(row.name, [row])
    }

    const days: Day[] = []
    for (const [date, byName] of byDate) {
      const entries: DayEntry[] = []
      const day: Day = {
        date,
        present: 0,
        leave: 0,
        unknown: 0,
        responded: 0,
        silent: members.length,
        entries,
      }

      for (const [name, rounds] of byName) {
        const latest = latestOf(rounds)
        if (latest.status === "present") day.present += 1
        else if (latest.status === "leave") day.leave += 1
        else day.unknown += 1
        // Answering at all takes them off the "missing" count.
        if (activeNames.has(name)) day.silent -= 1
        entries.push({ name, rounds, latest })
      }

      day.responded = entries.length
      entries.sort(
        (a, b) =>
          STATUS_RANK[a.latest.status] - STATUS_RANK[b.latest.status] ||
          a.name.localeCompare(b.name, "th")
      )
      days.push(day)
    }

    return days.sort((a, b) => b.date.localeCompare(a.date))
  }, [attendance, members, activeNames])

  const dayByDate = React.useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days]
  )
  const membersByName = React.useMemo(
    () => new Map(members.map((member) => [member.name, member])),
    [members]
  )
  /** Everyone, alphabetically — the pool the "ดูประวัติรายคน" search draws from. */
  const memberPool = React.useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name, "th")),
    [members]
  )

  const shown = days.slice(0, limit)

  const dayDate = view?.mode === "day" ? view.date : null
  const viewingDay = dayDate ? dayByDate.get(dayDate) : undefined
  const memberName = view?.mode === "member" ? view.name : null
  const memberBack = view?.mode === "member" ? view.back : undefined
  const memberInfo = memberName ? membersByName.get(memberName) : undefined

  const edited = React.useMemo(
    () => viewingDay?.entries.filter((entry) => entry.rounds.length > 1) ?? [],
    [viewingDay]
  )

  /** Members who stayed quiet that day, sorted by name. */
  const silentMembers = React.useMemo(() => {
    if (!viewingDay) return []
    const answered = new Set(viewingDay.entries.map((entry) => entry.name))
    return members
      .filter((member) => !answered.has(member.name))
      .sort((a, b) => a.name.localeCompare(b.name, "th"))
  }, [viewingDay, members])

  /** Day rows for the open tab, after the search box and "กดซ้ำ" had their say. */
  const dayListed = React.useMemo<ListedRow[]>(() => {
    if (!viewingDay) return []
    const needle = dayQuery.trim().toLowerCase()

    const rows: ListedRow[] = []
    for (const entry of viewingDay.entries) {
      if (onlyEdited && entry.rounds.length <= 1) continue
      if (entry.latest.status !== statusTab) continue
      if (needle && !entry.name.toLowerCase().includes(needle)) continue
      rows.push({ kind: "entry", entry })
    }
    // The quiet ones are always "รอเช็ค" in the ledger's language, and the
    // "กดซ้ำ" filter is about edits, so they drop out when it is on.
    if (!onlyEdited && statusTab === "unknown") {
      for (const member of silentMembers) {
        if (needle && !member.name.toLowerCase().includes(needle)) continue
        rows.push({ kind: "silent", member })
      }
    }
    return rows
  }, [viewingDay, silentMembers, dayQuery, statusTab, onlyEdited])

  /** A member's days, newest first, for the "ดูประวัติรายคน" view. */
  const memberDays = React.useMemo(() => {
    if (!memberName) return []
    const found: { date: string; entry: DayEntry }[] = []
    for (const day of days) {
      const entry = day.entries.find((candidate) => candidate.name === memberName)
      if (entry) found.push({ date: day.date, entry })
    }
    return found
  }, [days, memberName])

  const memberSummary = React.useMemo(() => {
    const summary = { present: 0, leave: 0, unknown: 0, edited: 0 }
    for (const { entry } of memberDays) {
      summary[entry.latest.status] += 1
      if (entry.rounds.length > 1) summary.edited += 1
    }
    return summary
  }, [memberDays])

  const filtering = Boolean(dayQuery.trim()) || onlyEdited
  const dayUnknown = viewingDay ? viewingDay.unknown + viewingDay.silent : 0

  /** How many names each tab holds — the size of the day, not of the filter. */
  const tabCounts: Record<AttendanceStatus, number> = {
    present: viewingDay?.present ?? 0,
    leave: viewingDay?.leave ?? 0,
    unknown: dayUnknown,
  }

  /** What an empty tab means, which is a different sentence for each one. */
  const EMPTY_TAB: Record<AttendanceStatus, string> = {
    present: "ไม่มีใครกดมาในวันนี้",
    leave: "ไม่มีใครกดลาในวันนี้",
    unknown: "ทุกคนในรายชื่อกดสถานะครบแล้ว",
  }

  /** Fresh day: filters reset, because the last day's filters mean little here. */
  function openDay(date: string) {
    setDayQuery("")
    setStatusTab("present")
    setOnlyEdited(false)
    setView({ mode: "day", date })
  }

  function openMember(name: string, back?: string) {
    setView({ mode: "member", name, back })
  }

  /** Picking a day opens it straight away — one tap, not select-then-confirm. */
  function pick(date: Date | undefined) {
    if (!date) return
    setPicked(date)
    setPicking(false)
    openDay(keyFromDate(date))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ประวัติการมา/ลา</CardTitle>
        <CardDescription>
          นับจากสถานะล่าสุดของแต่ละคนในแต่ละวัน · สมาชิกปัจจุบัน {members.length} คน ·
          กดที่วันที่เพื่อดูรายชื่อและ log
          ทุกครั้งที่กด · หรือพิมพ์ชื่อเพื่อดูประวัติย้อนหลังรายคน
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {days.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            ยังไม่มีประวัติ — ให้สมาชิกกดสถานะสักวัน
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="touch-manipulation">
                    <CalendarIcon />
                    {picked ? guildDateLabel(keyFromDate(picked)) : "เลือกวันที่ย้อนหลัง"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    locale={th}
                    selected={picked}
                    onSelect={pick}
                    defaultMonth={picked ?? dateFromKey(today)}
                    disabled={{ after: dateFromKey(today) }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24"
                  aria-label="จำนวนวันล่าสุดที่แสดง"
                />
                <span className="text-muted-foreground text-sm">วันล่าสุด</span>
              </div>
            </div>

            {/*
              The member search lives here, on the page, and not inside the
              dialog. It is a Base UI Combobox, and Radix's Dialog marks
              everything outside itself aria-hidden while trapping focus, which
              would leave the popup alive but unreachable. Picking a name opens
              the member view; no combobox ever renders inside the dialog.
            */}
            <div className="max-w-full sm:max-w-xs">
              <Combobox
                items={memberPool}
                itemToStringLabel={(member) => member.name}
                itemToStringValue={(member) => member.name}
                isItemEqualToValue={(itemValue, value) => itemValue.name === value.name}
                value={memberPick}
                onValueChange={(member) => {
                  if (!member) return
                  // Clear at once: picking opens the member view, and the box
                  // should be empty if the dialog is dismissed and reopened.
                  setMemberPick(null)
                  openMember(member.name)
                }}
                filter={(member, query) => matchesMemberQuery(member, query)}
                autoHighlight
              >
                <ComboboxInput
                  placeholder="ดูประวัติรายคน — พิมพ์ชื่อสมาชิก…"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>ไม่พบชื่อนี้ในรายชื่อสมาชิก</ComboboxEmpty>
                  <ComboboxList>
                    {(member) => (
                      <ComboboxItem key={member.name} value={member}>
                        <GameIcon job={member.job} className="size-6" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{member.name}</span>
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

            {/*
              Native horizontal overflow, not shadcn's ScrollArea: this
              version of ScrollArea is vertical-only (orientation lives on
              ScrollBar, not the root), and a table also benefits from the
              browser's own momentum scrolling on touch devices.
            */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-3 font-medium">วันที่</th>
                    <th className="py-2 pr-3 text-right font-medium">{STATUS_LABEL.present}</th>
                    <th className="py-2 pr-3 text-right font-medium">{STATUS_LABEL.leave}</th>
                    <th className="py-2 pr-3 text-right font-medium">{STATUS_LABEL.unknown}</th>
                    <th className="py-2 text-right font-medium">ตอบแล้ว</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((day) => {
                    const waiting = day.unknown + day.silent
                    const expected = day.responded + day.silent
                    const rate = expected === 0 ? 0 : day.responded / expected
                    const editedCount = day.entries.filter((entry) => entry.rounds.length > 1).length
                    return (
                      <tr key={day.date} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          {/*
                            The date is the button, not the row: a table row
                            cannot be a button, and this keeps the keyboard and
                            screen-reader path the same as the tap path.
                          */}
                          <button
                            type="button"
                            onClick={() => openDay(day.date)}
                            aria-label={`ดูรายชื่อวันที่ ${guildDateLabel(day.date)}`}
                            className="hover:text-foreground focus-visible:ring-ring/50 flex touch-manipulation items-center gap-1 text-left font-medium tabular-nums focus-visible:ring-3 focus-visible:outline-none"
                          >
                            {guildDateLabel(day.date)}
                            <ChevronRight className="text-muted-foreground size-3.5" />
                          </button>
                          {editedCount > 0 && (
                            <span className="text-muted-foreground ml-1 inline-flex items-center gap-0.5 text-xs">
                              <PencilLine className="size-3" />
                              {editedCount}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {day.present}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {day.leave}
                        </td>
                        <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
                          {waiting}
                        </td>
                        <td className="py-2 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "h-1.5 w-16 overflow-hidden rounded-full bg-muted",
                                "relative inline-block"
                              )}
                            >
                              <span
                                className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                                style={{ width: `${Math.round(rate * 100)}%` }}
                              />
                            </span>
                            <span className="text-xs tabular-nums">
                              {day.responded}/{expected}
                            </span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={view !== null} onOpenChange={(open) => !open && setView(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            {view?.mode === "member" && memberBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit touch-manipulation"
                onClick={() => setView({ mode: "day", date: memberBack })}
              >
                <ArrowLeft /> กลับไปวันที่ {guildDateLabel(memberBack)}
              </Button>
            )}
            <DialogTitle>
              {view?.mode === "day" && guildDateLabel(view.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {view?.mode === "member" && memberName}
            </DialogTitle>
            <DialogDescription>
              {view?.mode === "day" &&
                (viewingDay
                  ? [
                      `ตอบ ${viewingDay.responded} คน`,
                      `${STATUS_LABEL.present} ${viewingDay.present}`,
                      `${STATUS_LABEL.leave} ${viewingDay.leave}`,
                      dayUnknown > 0 ? `${STATUS_LABEL.unknown} ${dayUnknown}` : null,
                      edited.length > 0 ? `กดซ้ำ/แก้สถานะ ${edited.length} คน` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "วันนี้ไม่มีใครกดสถานะ")}
              {view?.mode === "member" &&
                (memberDays.length > 0
                  ? [
                      `ตอบ ${memberDays.length} วัน`,
                      `${STATUS_LABEL.present} ${memberSummary.present}`,
                      `${STATUS_LABEL.leave} ${memberSummary.leave}`,
                      memberSummary.unknown > 0
                        ? `${STATUS_LABEL.unknown} ${memberSummary.unknown}`
                        : null,
                      memberSummary.edited > 0 ? `กดซ้ำ ${memberSummary.edited} วัน` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "ยังไม่มีประวัติของสมาชิกคนนี้")}
            </DialogDescription>
          </DialogHeader>

          {view?.mode === "day" ? (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  />
                  <Input
                    value={dayQuery}
                    onChange={(event) => setDayQuery(event.target.value)}
                    placeholder="ค้นหาชื่อในวันนี้…"
                    className="pr-9 pl-8"
                    aria-label="ค้นหาชื่อในวันนี้"
                  />
                  {dayQuery && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                      aria-label="ล้างคำค้น"
                      onClick={() => setDayQuery("")}
                    >
                      <X />
                    </Button>
                  )}
                </div>

                {/*
                  Three tabs instead of three toggle chips: the counts sit in
                  the tab itself, so the list below never has to be scanned to
                  find out how big the other groups are. The colour goes on the
                  number only — see STATUS_TEXT_CLASS, shadcn's own background
                  has to stay readable as "this is the tab you are reading".

                  "กดซ้ำ" stays a button beside the tabs rather than a fourth
                  tab: it cuts across all three groups instead of being one.
                */}
                <Tabs
                  value={statusTab}
                  onValueChange={(value) => setStatusTab(value as AttendanceStatus)}
                >
                  <TabsList>
                    {TAB_STATUSES.map((status) => (
                      <TabsTrigger key={status} value={status} className="touch-manipulation">
                        {STATUS_LABEL[status]}
                        <span
                          className={cn("text-xs tabular-nums", STATUS_TEXT_CLASS[status])}
                        >
                          {tabCounts[status]}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                {edited.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={onlyEdited ? "secondary" : "outline"}
                      aria-pressed={onlyEdited}
                      className="touch-manipulation"
                      onClick={() => setOnlyEdited((value) => !value)}
                    >
                      <PencilLine /> กดซ้ำ ({edited.length})
                    </Button>
                    {onlyEdited && (
                      <p className="text-muted-foreground text-xs">
                        เฉพาะคนที่กดสถานะมากกว่า 1 รอบในวันนี้
                      </p>
                    )}
                  </div>
                )}

                {filtering && (
                  <p role="status" className="text-muted-foreground text-xs">
                    พบ {dayListed.length} คน
                  </p>
                )}
              </div>

              {dayListed.length > 0 ? (
                <ScrollArea className="h-[56dvh] pr-3">
                  {/*
                    Definite height, not max-h: ScrollArea's viewport is h-full,
                    so a max-h root collapses it and clips the list.
                  */}
                  <ul className="divide-border divide-y">
                    {dayListed.map((row) =>
                      row.kind === "entry" ? (
                        <DayEntryRow
                          key={row.entry.name}
                          entry={row.entry}
                          member={membersByName.get(row.entry.name)}
                          dayDate={dayDate}
                          timeZone={timeZone}
                          onOpenMember={openMember}
                        />
                      ) : (
                        <li key={row.member.name} className="flex items-center gap-3 py-2.5">
                          <GameIcon job={row.member.job} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              <button
                                type="button"
                                onClick={() => openMember(row.member.name, dayDate ?? undefined)}
                                aria-label={`ดูประวัติทุกวันของ ${row.member.name}`}
                                className="focus-visible:ring-ring/50 rounded-sm underline decoration-muted-foreground/60 decoration-dotted underline-offset-2 hover:decoration-foreground focus-visible:ring-2 focus-visible:outline-none"
                              >
                                {row.member.name}
                              </button>
                              {row.member.level > 0 && (
                                <span className="text-muted-foreground ml-2 text-xs">
                                  Lv.{row.member.level}
                                </span>
                              )}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {row.member.job}
                            </p>
                          </div>
                          <StatusBadge status="unknown" />
                        </li>
                      )
                    )}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {filtering ? "ไม่พบชื่อที่ตรงกับตัวกรอง" : EMPTY_TAB[statusTab]}
                </p>
              )}

              {/*
                  The caveat belongs to the tab that means it. On "มา" there is
                  nothing to qualify, and saying it there would read as a
                  footnote about the wrong people.
                */}
              {statusTab === "unknown" && silentMembers.length > 0 && (
                /*
                  The honest caveat, kept on screen rather than in a comment:
                  the roster has no join date, so "did not answer" is judged
                  against the roster as it is now. Someone who joined after this
                  day is counted as quiet, which is wrong and worth saying.
                */
                <p className="text-muted-foreground border-dashed border-t pt-2 text-xs leading-relaxed">
                  {STATUS_LABEL.unknown} = สมาชิกในรายชื่อปัจจุบันที่ไม่ได้กดในวันนั้น ·
                  ระบบไม่มีวันที่เข้ากิลด์ คนที่เพิ่งเข้าทีหลังจึงอาจถูกนับรวมด้วย
                </p>
              )}
            </>
          ) : (
            <MemberHistory
              name={memberName ?? ""}
              member={memberInfo}
              days={memberDays}
              timeZone={timeZone}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/** One member who answered that day, with their name opening the member view. */
function DayEntryRow({
  entry,
  member,
  dayDate,
  timeZone,
  onOpenMember,
}: {
  entry: DayEntry
  member?: Member
  dayDate: string | null
  timeZone: string
  onOpenMember: (name: string, back?: string) => void
}) {
  const rounds = entry.rounds
  const changed = rounds.length > 1

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        {member && <GameIcon job={member.job} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            <button
              type="button"
              onClick={() => onOpenMember(entry.name, dayDate ?? undefined)}
              aria-label={`ดูประวัติทุกวันของ ${entry.name}`}
              className="focus-visible:ring-ring/50 rounded-sm underline decoration-muted-foreground/60 decoration-dotted underline-offset-2 hover:decoration-foreground focus-visible:ring-2 focus-visible:outline-none"
            >
              {entry.name}
            </button>
            {member && member.level > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">Lv.{member.level}</span>
            )}
            {changed && (
              <Badge
                variant="outline"
                className="ml-2 align-middle border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
              >
                <PencilLine /> กด {rounds.length} รอบ
              </Badge>
            )}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {member ? member.job : "ไม่พบในรายชื่อสมาชิก"}
            {entry.latest.note ? ` · ${entry.latest.note}` : ""}
          </p>
        </div>
        <StatusBadge status={entry.latest.status} />
      </div>

      {changed ? (
        <RoundLog rounds={rounds} timeZone={timeZone} className="ml-11" />
      ) : (
        <p className="text-muted-foreground mt-1 ml-11 text-xs tabular-nums">
          กดเมื่อ {guildTimeLabel(entry.latest.submittedAt, timeZone)}
        </p>
      )}
    </li>
  )
}

/**
 * Every round of a day, oldest first, for the people who pressed more than
 * once. A member who claimed มา and then switched to ลา reads here in the order
 * they pressed, so "I never said that" has an answer that is not an argument.
 */
function RoundLog({
  rounds,
  timeZone,
  className,
}: {
  rounds: AttendanceRow[]
  timeZone: string
  className?: string
}) {
  return (
    <ol className={cn("border-border mt-2 space-y-1 border-l pl-3", className)}>
      {rounds.map((round, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {guildTimeLabel(round.submittedAt, timeZone)}
          </span>
          <span className={cn("font-medium", STATUS_TEXT_CLASS[round.status])}>
            {STATUS_LABEL[round.status]}
          </span>
          {round.note && (
            <span className="text-muted-foreground min-w-0 break-words">{round.note}</span>
          )}
          {index === rounds.length - 1 && (
            <span className="text-muted-foreground">· ล่าสุด (ใช้ตัดสิน)</span>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * One member's ledger across every day they answered, newest first.
 *
 * This is the view for a question about a person rather than a day: "has Nong
 * been leaving a lot this month?" The day view answers "who answered today";
 * this one answers "how has this one person been answering".
 */
function MemberHistory({
  name,
  member,
  days,
  timeZone,
}: {
  name: string
  member?: Member
  days: { date: string; entry: DayEntry }[]
  timeZone: string
}) {
  if (days.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        ยังไม่มีประวัติของสมาชิกคนนี้ — ยังไม่เคยกดสถานะเลย
      </p>
    )
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border p-3">
        {member && <GameIcon job={member.job} className="size-10" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {name}
            {member && member.level > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">Lv.{member.level}</span>
            )}
            </p>
          <p className="text-muted-foreground truncate text-xs">
            {member ? member.job : "ไม่พบในรายชื่อสมาชิก"}
            {member?.note ? ` · ${member.note}` : ""}
          </p>
        </div>
      </div>

      <ScrollArea className="h-[52dvh] pr-3">
        <ul className="divide-border divide-y">
          {days.map(({ date, entry }) => (
            <li key={date} className="py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium tabular-nums">
                    {guildDateLabel(date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  {entry.latest.note && (
                    <p className="text-muted-foreground truncate text-xs">{entry.latest.note}</p>
                  )}
                </div>
                <StatusBadge status={entry.latest.status} />
              </div>
              {entry.rounds.length > 1 && <RoundLog rounds={entry.rounds} timeZone={timeZone} />}
            </li>
          ))}
        </ul>
      </ScrollArea>
    </>
  )
}
