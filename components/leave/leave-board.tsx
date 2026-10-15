"use client"

import * as React from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  RosterList,
  STATUS_LABEL,
  STATUS_TEXT_CLASS,
  countByStatus,
} from "@/components/leave/roster-list"
import { SubmitForm } from "@/components/leave/submit-form"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { AttendanceStatus, RosterResponse } from "@/lib/rngw/types"
import { cn } from "cn"

/**
 * Tab order, which is not the status order.
 *
 * "ลา" leads because that is the group the guild pays for: finding a
 * substitute is work, while someone who has not replied yet is still expected
 * to. The first entry is also the tab that opens.
 */
const TAB_ORDER = [
  "leave",
  "present",
  "unknown",
] as const satisfies readonly AttendanceStatus[]

/**
 * `date` is a guild-local calendar day ("2026-10-14"), not an instant — so it
 * is parsed as UTC midnight and formatted as UTC, to avoid shifting it back a
 * day for viewers west of Greenwich.
 */
function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parsed)
}

export function LeaveBoard() {
  const [data, setData] = React.useState<RosterResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    // Attendance is realtime by definition — never cache it.
    fetch("/api/attendance", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? "โหลดข้อมูลไม่สำเร็จ")
        if (!cancelled) {
          setData(body)
          setError(null)
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const refresh = () => {
    setLoading(true)
    setNonce((n) => n + 1)
  }

  const counts = countByStatus(data?.roster ?? [])

  if (loading) {
    return <p className="text-muted-foreground py-16 text-center text-sm">กำลังโหลดรายชื่อ…</p>
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ยังต่อฐานข้อมูลไม่ได้</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>เช็คว่าตั้งค่าครบตาม docs/turso-setup.md แล้ว:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              ใส่ <code>TURSO_DATABASE_URL</code> และ{" "}
              <code>TURSO_AUTH_TOKEN</code> ใน <code>.env.local</code> แล้วรีสตาร์ท dev server
            </li>
            <li>
              token ต้องเป็นตัวที่สร้างด้วย <code>turso db tokens create -w</code>{" "}
              ตัว read-only จะบันทึกไม่ได้
            </li>
          </ul>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> ลองใหม่
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">เช็คชื่อวันนี้</h1>
          <p className="text-muted-foreground text-sm">
            {formatDate(data.date)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw /> รีเฟรช
        </Button>
      </div>

{/*
        Two columns on a desktop: the form is what a member came to fill in,
        the list is what they check afterwards. On a phone they stack, form
        first, because a full-width name field beats a scrolled list.
        `items-start` so the shorter form card does not stretch to the height
        of the roster card and leave a slab of empty white under it.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>แจ้งสถานะของคุณ</CardTitle>
            <CardDescription>
              เลือกชื่อตัวเองแล้วกดได้เลย ไม่ต้องใส่รหัส — ถ้ากดผิดชื่อ
              หัวหน้ากิลด์แก้ให้ได้จากหน้าผู้ดูแล
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubmitForm roster={data.roster} onSubmitted={refresh} />
          </CardContent>
        </Card>

        <Tabs defaultValue={TAB_ORDER[0]}>
          <Card>
            <CardHeader>
              <div className="space-y-3">
                <div className="min-w-0">
                  <CardTitle>รายชื่อทั้งกิลด์</CardTitle>
                  <CardDescription>แยกตามสถานะวันนี้ — เลือกแท็บเพื่อดูทีละกลุ่ม</CardDescription>
                </div>
                {/*
                  shadcn pins the list to `group-data-horizontal/tabs:h-8`, and a
                  variant utility outranks a plain one — so `h-auto` alone loses
                  and the taller triggers paint straight over the list below.
                  The `!` is what actually turns the height off.
                */}
                <TabsList className="grid h-auto! w-full grid-cols-3 gap-1">
                  {TAB_ORDER.map((status) => (
                    <TabsTrigger
                      key={status}
                      value={status}
                      className="h-auto flex-col gap-0.5 py-1.5 text-sm touch-manipulation"
                    >
                      <span className={cn("font-medium", STATUS_TEXT_CLASS[status])}>
                        {STATUS_LABEL[status]}
                      </span>
                      <span className="text-xs font-semibold tabular-nums opacity-80">
                        {counts[status]}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </CardHeader>
            <CardContent>
              {TAB_ORDER.map((status) => {
                const members = data.roster.filter((member) => member.status === status)
                const emptyText =
                  status === "unknown"
                    ? "ทุกคนตอบแล้ววันนี้ — ไม่มีใครค้างสถานะ"
                    : `ยังไม่มีใคร${STATUS_LABEL[status]}วันนี้`

                if (members.length === 0) {
                  return (
                    <TabsContent key={status} value={status}>
                      <RosterList roster={members} emptyText={emptyText} />
                    </TabsContent>
                  )
                }

                return (
                  <TabsContent key={status} value={status}>
                    {/*
                      The height has to be definite, never max-h — the viewport
                      is `size-full`, so a max-h root collapses to auto height,
                      the list never overflows and the names get clipped. See
                      AGENTS.md. Short lists drop back to h-auto rather than
                      leaving a mostly empty box on screen. (The matching width
                      trap — Radix's inline `display: table` — is fixed for
                      every ScrollArea in app/globals.css.)
                    */}
                    <ScrollArea className={cn("h-[65vh]", members.length <= 5 && "h-auto")}>
                      <RosterList roster={members} />
                    </ScrollArea>
                  </TabsContent>
                )
              })}
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </div>
  )
}