"use client"

import * as React from "react"
import { CircleCheck, CirclePlus, CircleX, FileUp, RefreshCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollBar } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import { useConfirm } from "@/components/confirm-dialog"
import { GameIcon } from "@/components/game-icon"
import type { MemberImportSummary } from "@/lib/db"
import { planMemberImport, type MemberCsvPlan } from "@/lib/rngw/member-csv"
import type { Member } from "@/lib/rngw/types"
import { cn } from "cn"
import { toast } from "sonner"

/** How many rows the preview lists before it becomes a wall. */
const PREVIEW_LIMIT = 40

/**
 * Import the roster from the file the game exports.
 *
 * The file is the authority: whoever is in it is on the roster, whoever is not
 * has left the guild. That is the whole feature, and the reason it is also the
 * most dangerous button in the admin area — a file read one column short would
 * quietly take people off the guild. Three things stand between the file and the
 * database for that reason:
 *
 *   1. **Nothing is written on picking a file.** The file is read in the browser
 *      and turned into a plan — added, updated, unchanged, removed — which is
 *      what this screen shows. The database is not involved until the guild
 *      master presses the button and confirms.
 *   2. **One unreadable row stops everything.** A typo'd class name in 30 rows
 *      would otherwise look like 30 members who left the guild. The rejected
 *      rows are listed with their line numbers and the button stays disabled.
 *   3. **The removal list is named out loud.** The confirm says how many people
 *      come off the roster and how many attendance rows go with them, because
 *      that part is as final as the bin in the roster tab.
 *
 * Reading happens in the browser on purpose: the file never has to make a round
 * trip to be rejected, and the server receives a plain member list it can
 * re-validate with the same `isJobName` gate every other write uses.
 */
export function MemberImport({
  members,
  onSaved,
}: {
  /** The roster as it is now, which is what "removed" is measured against. */
  members: Member[]
  /** Called after the import so the panel refetches the database. */
  onSaved: () => void
}) {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const byName = React.useMemo(() => new Map(members.map((member) => [member.name, member])), [members])
  const [plan, setPlan] = React.useState<MemberCsvPlan | null>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  async function read(file: File) {
    setError(null)
    setPlan(null)

    try {
      const parsed = planMemberImport(await file.text(), members)
      if (!parsed.ok) {
        setFileName(file.name)
        setError(parsed.error)
        return
      }

      setFileName(file.name)
      setPlan(parsed.plan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "อ่านไฟล์ไม่สำเร็จ")
    }
  }

  async function apply() {
    if (!plan || busy) return

    const yes = await confirm({
      title: `นำเข้า ${plan.rows.length} คนจากไฟล์นี้?`,
      description: describePlan(plan),
      confirmLabel: "นำเข้า",
      tone: plan.removed.length > 0 ? "danger" : "default",
      children: <PlanPreview plan={plan} current={byName} />,
    })
    if (!yes) return

    setBusy(true)
    try {
      const res = await fetch("/api/admin/members/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: plan.rows }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "นำเข้าไม่สำเร็จ")

      report(body.summary as MemberImportSummary)
      setPlan(null)
      setFileName(null)
      if (input.current) input.current.value = ""
      onSaved()
    } catch (cause) {
      toast.error((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const blocked = plan !== null && plan.rejected.length > 0

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>นำเข้ารายชื่อจากไฟล์</CardTitle>
          <CardDescription>
            เลือกไฟล์ CSV ที่ export รายชื่อจากเกม — ระบบอ่านเฉพาะชื่อ เลเวล
            และคลาส ที่เหลือข้ามไป · ใครที่อยู่ในไฟล์แต่ไม่อยู่ในรายชื่อ
            ถือว่าออกจากกิลด์แล้ว
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/*
            A hidden input behind a styled label rather than a visible file
            field: the native one brings its own button and cannot be made to
            match anything else on this page, and this is read on a phone
            between matches.
          */}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="เลือกไฟล์ CSV ที่ export รายชื่อสมาชิกจากเกม"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void read(file)
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="touch-manipulation"
              onClick={() => input.current?.click()}
            >
              <FileUp /> {plan ? "เลือกไฟล์ใหม่" : "เลือกไฟล์ CSV"}
            </Button>
            <Button
              type="button"
              className="touch-manipulation"
              disabled={!plan || blocked || busy}
              onClick={apply}
            >
              นำเข้า{plan ? ` ${plan.rows.length} คน` : ""}
            </Button>
          </div>

          {/*
            Current state, not the result of the last press — the result of an
            import is a toast, which stays put while this stays on screen.
          */}
          <p role="status" className="text-muted-foreground text-sm">
            {error
              ? error
              : plan
                ? blocked
                  ? `${fileName} — อ่านไม่ได้ ${plan.rejected.length} แถว แก้ตามรายการข้างล่างแล้วเลือกไฟล์ใหม่`
                  : `${fileName} — ${describePlan(plan)}`
                : "ยังไม่ได้เลือกไฟล์ · ประวัติเช็คชื่อเดิมไม่ถูกแตะ เฉพาะคนที่ถูกลบเท่านั้นที่ประวัติหาย"}
          </p>

          {/*
            The reason comes before what it would cause. Read the other way
            round, a file with one bad class name lists a member as "about to be
            deleted" first and the reason for it second — and the deletion is
            the part that cannot be undone.
          */}
          {blocked && <RejectedRows plan={plan} />}

          {plan && <PlanPreview plan={plan} current={byName} />}
        </CardContent>
      </Card>

      {confirmDialog}
    </>
  )
}

/** The counts, as a sentence, because that is what gets read out. */
function describePlan(plan: MemberCsvPlan): string {
  const parts = [
    `เพิ่ม ${plan.added.length} คน`,
    `อัปเดต ${plan.updated.length} คน`,
    `ไม่เปลี่ยน ${plan.unchanged.length} คน`,
    `จะลบ ${plan.removed.length} คน`,
  ]
  return parts.join(" · ")
}

/**
 * What the import would change, row by row.
 *
 * Also the confirm dialog's body, which is why it takes a plan rather than
 * reading one: the guild master sees the same list twice, once while deciding
 * and once while being asked to agree.
 */
function PlanPreview({
  plan,
  current,
}: {
  plan: MemberCsvPlan
  /** The roster as it is now, so each row can show what it is becoming. */
  current: Map<string, Member>
}) {
  const changed = [...plan.added, ...plan.updated]
  const shown = changed.slice(0, PREVIEW_LIMIT)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <CirclePlus className="size-4 text-emerald-600 dark:text-emerald-400" />
          เพิ่ม {plan.added.length}
        </span>
        <span className="flex items-center gap-1.5">
          <RefreshCw className="size-4 text-sky-600 dark:text-sky-400" />
          อัปเดต {plan.updated.length}
        </span>
        <span className="flex items-center gap-1.5">
          <CircleCheck className="size-4 text-muted-foreground" />
          ไม่เปลี่ยน {plan.unchanged.length}
        </span>
        <span className={cn("flex items-center gap-1.5", plan.removed.length > 0 && "text-destructive")}>
          <CircleX className="size-4" />
          ลบ {plan.removed.length}
        </span>
      </div>

      {changed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            รายชื่อที่จะเพิ่มหรือแก้ ({changed.length})
          </p>
          {/*
            A definite height, not `max-h-*`: shadcn's viewport is the element
            that scrolls and is sized h-full, so a max-height root leaves it
            sized to its own content and the list is clipped with no way to
            scroll. A short list keeps its natural height.
          */}
          <TableScrollArea className={cn("h-64", shown.length <= 4 && "h-auto")}>
            {/*
              Phone layout. Four columns do not fit on a 390px screen and the
              "was / now" column is the one that gets cut, which is the one the
              guild master is checking — so below `sm` the rows stack instead,
              the way the roster and the absences tab already read.
            */}
            <ul className="divide-border divide-y sm:hidden">
              {shown.map((member) => {
                const before = current.get(member.name)
                return (
                  <li key={member.name} className="flex items-center gap-2 py-2.5">
                    <GameIcon job={member.job} className="size-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {member.name}
                        <span className="text-muted-foreground ml-2 text-xs">
                          Lv.{member.level}
                        </span>
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {before ? `เดิม ${before.job} · Lv.${before.level} → ` : "ยังไม่มีในรายชื่อ · "}
                        {member.job}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/*
              shadcn's Table wraps itself in `data-slot="table-container"`, a
              horizontal scroller. Left alone that div is the table's nearest
              scrollport, so a `sticky` header sticks to its top edge — which
              never moves — and scrolls away with the list. Turning the overflow
              off leaves the viewport as the only scroller, which is what makes
              the header stick and what the custom bars drag.
            */}
            <div className="hidden sm:block [&_[data-slot=table-container]]:overflow-x-visible">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">ชื่อ</TableHead>
                    <TableHead className="sticky top-0 z-10 w-14 bg-card text-right">เลเวล</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">คลาส</TableHead>
                    <TableHead className="sticky top-0 z-10 w-48 bg-card">เปลี่ยน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((member) => {
                    const before = current.get(member.name)
                    return (
                      <TableRow key={member.name}>
                        <TableCell className="truncate font-medium">{member.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{member.level}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <GameIcon job={member.job} className="size-5 shrink-0" />
                            <span className="truncate">{member.job}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground truncate text-xs">
                          {before ? `เดิม ${before.job} · Lv.${before.level}` : "ยังไม่มีในรายชื่อ"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </TableScrollArea>
          {changed.length > shown.length && (
            <p className="text-muted-foreground text-xs">
              แสดง {shown.length} จาก {changed.length} คน — ที่เหลือจะถูกนำเข้าเหมือนกัน
            </p>
          )}
        </div>
      )}

      {plan.removed.length > 0 && (
        <div
          className={cn(
            "space-y-1.5 rounded-lg border px-3 py-2",
            plan.rejected.length > 0 ? "border-dashed" : "border-destructive/40",
          )}
        >
          <p className={cn("text-sm font-medium", plan.rejected.length === 0 && "text-destructive")}>
            จะถูกลบออกจากกิลด์ ({plan.removed.length} คน) พร้อมประวัติเช็คชื่อของเขา
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {plan.rejected.length > 0
              ? "คิดจากไฟล์ที่ยังอ่านไม่ครบ — พอแก้แถวที่อ่านไม่ได้ รายชื่อนี้จะกลับมาเอง"
              : "เพราะไม่มีในไฟล์นี้ · คืนไม่ได้ เหมือนกดปุ่มถังขยะทีละคน"}
          </p>
          <p className="text-xs break-words">{plan.removed.map((member) => member.name).join(" · ")}</p>
        </div>
      )}
    </div>
  )
}

/**
 * The rows the app will not take, with the line each is on.
 *
 * Listed rather than skipped because a skipped row is a person the import
 * would then delete: the file says they are in the guild, the roster does not.
 */
function RejectedRows({ plan }: { plan: MemberCsvPlan }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-destructive/40 px-3 py-2">
      <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
        <TriangleAlert className="size-4 shrink-0" />
        อ่านไม่ได้ {plan.rejected.length} แถว — ยังนำเข้าไม่ได้
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        ระบบไม่ข้ามแถวที่อ่านไม่ได้ เพราะแถวที่หายไปจะกลายเป็นคนที่โดนลบ
        แก้ไฟล์ตามรายการนี้แล้วเลือกใหม่
      </p>
      <ul className="space-y-0.5 text-xs">
        {plan.rejected.slice(0, PREVIEW_LIMIT).map((row) => (
          <li key={row.line} className="break-words">
            <span className="text-muted-foreground tabular-nums">แถวที่ {row.line}</span>
            {row.name ? ` ${row.name} — ` : " — "}
            {row.reason}
          </li>
        ))}
      </ul>
      {plan.rejected.length > PREVIEW_LIMIT && (
        <p className="text-muted-foreground text-xs">และอีก {plan.rejected.length - PREVIEW_LIMIT} แถว</p>
      )}
    </div>
  )
}

/**
 * shadcn's ScrollArea with a horizontal bar as well.
 *
 * `orientation` is a prop of ScrollBar, not of ScrollArea, so the component
 * from the CLI renders a vertical bar and nothing else — correct for the lists
 * that never get wide, useless for a table whose name column is one long
 * unbreakable line. The Viewport already scrolls on both axes, so the missing
 * piece was only the thing a desktop mouse can grab.
 *
 * Written here rather than by editing `components/ui/scroll-area.tsx`: that file
 * belongs to the shadcn CLI and is overwritten on update.
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

/** Kept out of the component body: the report names numbers, not markup. */
function report(summary: MemberImportSummary) {
  toast.success(`นำเข้าแล้ว — เพิ่ม ${summary.added} · อัปเดต ${summary.updated} · ไม่เปลี่ยน ${summary.unchanged}`)

  if (summary.removed.length > 0) {
    toast.warning(`ลบ ${summary.removed.length} คนออกจากกิลด์ พร้อมประวัติ ${summary.removedAttendance} แถว`, {
      description:
        summary.cleanedParties > 0
          ? `${summary.removed.join(" · ")} — ถอดออกจากอีก ${summary.cleanedParties} ทีมด้วย`
          : summary.removed.join(" · "),
      duration: 10_000,
    })
  }
}
