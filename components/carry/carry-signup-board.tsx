"use client"

import * as React from "react"
import {
  Lock,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GameIcon } from "@/components/game-icon"
import { useConfirm } from "@/components/confirm-dialog"
import { matchesMemberName } from "@/lib/rngw/roster"
import { splitHighlight } from "@/lib/rngw/team-search"
import {
  CARRY_NOTE_MAX_LENGTH,
  CARRY_ROOM_LIMIT,
  type CarryBoardResponse,
  type CarryRoom,
  type CarrySignup,
  type Member,
} from "@/lib/rngw/types"
import { CreateRoomDialog } from "@/components/carry/carry-dialogs"
import { CarryRoomCard } from "@/components/carry/carry-room-card"

/**
 * "ลงชื่อแบกดัน" — many carriers, each with a room and a queue.
 *
 * Members sign themselves up without a PIN and may sit in only one queue at a
 * time. Carriers create rooms, manage their own queue with the room PIN, and may
 * hand a member to another open room. Admins can manage every room because the
 * server treats an admin session as access to all rooms. No PIN or hash ever
 * reaches this component: `authorizedRoomIds` is the server's answer to "which
 * rooms may this browser show controls for", and every write re-checks it.
 */
export function CarrySignupBoard() {
  const [data, setData] = React.useState<CarryBoardResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [nonce, setNonce] = React.useState(0)
  const [selectedRoomId, setSelectedRoomId] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [pendingCleanup, setPendingCleanup] = React.useState(false)
  const formRef = React.useRef<HTMLDivElement>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  React.useEffect(() => {
    let cancelled = false
    // Queues change while the page is open, so the board is never cached.
    fetch("/api/carry-signups", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? "โหลดคิวไม่สำเร็จ")
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

  /** After a write: refetch without replacing the page with a spinner. */
  const refreshQuietly = () => setNonce((n) => n + 1)

  const reload = () => {
    setLoading(true)
    refreshQuietly()
  }

  function pickRoom(roomId: number) {
    setSelectedRoomId(String(roomId))
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  if (!data) {
    if (loading) {
      return (
        <p className="text-muted-foreground py-16 text-center text-sm">
          กำลังโหลดคิว…
        </p>
      )
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>ยังต่อฐานข้อมูลไม่ได้</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw /> ลองใหม่
          </Button>
        </CardContent>
      </Card>
    )
  }

  const openRooms = data.rooms.filter((room) => room.open)
  const authorizedRoomIds = new Set(data.authorizedRoomIds)
  const emptyRooms = data.rooms.filter(
    (room) => !data.signups.some((signup) => signup.roomId === room.id)
  )
  const roomLimitReached = data.rooms.length >= CARRY_ROOM_LIMIT

  /**
   * Admin-only cleanup for rooms that were created as a joke or left behind.
   *
   * The server refuses to delete a room that still has anyone in its queue, so
   * this only removes genuinely empty rooms. Each deletion is its own request:
   * a room may become non-empty between this render and the tap, and the loop
   * reports which ones were kept instead of stopping halfway.
   */
  async function cleanupEmptyRooms() {
    if (emptyRooms.length === 0) return

    const preview = emptyRooms.slice(0, 6)
    const yes = await confirm({
      title: `ลบห้องว่าง ${emptyRooms.length} ห้อง?`,
      description:
        "ห้องที่ยังไม่มีใครอยู่ในคิวจะถูกลบถาวร รวมถึงห้องที่เพิ่งสร้างแต่ยังไม่ได้ใช้งาน — ห้องที่มีคนอยู่จะไม่ถูกลบ",
      confirmLabel: `ลบ ${emptyRooms.length} ห้อง`,
      tone: "danger",
      children: (
        <div className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            {preview.map((room) => (
              <li key={room.id} className="break-words">
                {room.title}{" "}
                <span className="text-muted-foreground">
                  ({room.carrierName})
                </span>
              </li>
            ))}
          </ul>
          {emptyRooms.length > preview.length && (
            <p className="text-muted-foreground">
              และอีก {emptyRooms.length - preview.length} ห้อง
            </p>
          )}
        </div>
      ),
    })
    if (!yes) return

    setPendingCleanup(true)
    let removed = 0
    const kept: string[] = []
    try {
      for (const room of emptyRooms) {
        try {
          const response = await fetch(`/api/carry/rooms/${room.id}`, {
            method: "DELETE",
          })
          if (response.ok) removed += 1
          else kept.push(room.title)
        } catch {
          kept.push(room.title)
        }
      }
    } finally {
      setPendingCleanup(false)
      refreshQuietly()
    }

    if (removed > 0) {
      toast.success(`ลบห้องว่าง ${removed} ห้องแล้ว`)
    }
    if (kept.length > 0) {
      toast.error(`ลบไม่ได้ ${kept.length} ห้อง`, {
        description: `${kept.join(", ")} — อาจมีคนลงคิวอยู่ ต้องล้างคิวก่อน`,
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">ลงชื่อแบกดัน</h1>
          <p className="text-muted-foreground text-sm">
            {data.rooms.length}/{CARRY_ROOM_LIMIT} ห้อง · เปิดรับ{" "}
            {openRooms.length} ห้อง · {emptyRooms.length} ห้องว่าง ·{" "}
            {data.signups.length} คนในคิว
          </p>
          <p className="text-muted-foreground text-xs">
            ทุกคนดูคิวของทุกห้องได้ — ลงชื่อโดยไม่ต้องใส่รหัส · สร้างห้องได้สูงสุด{" "}
            {CARRY_ROOM_LIMIT} ห้อง
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={roomLimitReached}
            title={
              roomLimitReached
                ? `สร้างห้องครบ ${CARRY_ROOM_LIMIT} ห้องแล้ว — ลบห้องว่างหรือย้าย/ล้างคิวก่อน`
                : undefined
            }
          >
            <Plus />
            {roomLimitReached
              ? `ครบ ${CARRY_ROOM_LIMIT} ห้องแล้ว`
              : "สร้างห้องแบก"}
          </Button>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw /> รีเฟรช
          </Button>
          {data.isAdmin && emptyRooms.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void cleanupEmptyRooms()}
              disabled={pendingCleanup}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 /> {pendingCleanup ? "กำลังลบ…" : `ลบห้องว่าง (${emptyRooms.length})`}
            </Button>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateRoomDialog
          members={data.members}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            refreshQuietly()
          }}
        />
      )}

      <div ref={formRef} className="scroll-mt-4">
        <Card>
          <CardHeader>
            <CardTitle>ลงชื่อของฉัน</CardTitle>
            <CardDescription>
              เลือกห้อง/คนแบก แล้วเลือกชื่อตัวเองจากรายชื่อ — ไม่ต้องใส่รหัส
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CarrySignupForm
              rooms={data.rooms}
              signups={data.signups}
              members={data.members}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
              onSigned={refreshQuietly}
            />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">คิวของทุกห้อง</h2>
          <p className="text-muted-foreground text-sm">
            คนแบกเปิด-ปิดรับคิวเองได้ · กด “เข้าจัดการห้อง” เพื่อใส่รหัสของห้อง
          </p>
        </div>

        {data.rooms.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-medium">ยังไม่มีห้องแบก</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                เริ่มโดยการสร้างห้อง เลือกชื่อคนแบกจากรายชื่อ และตั้งรหัสสำหรับจัดการคิว
              </p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> สร้างห้องแบก
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {data.rooms.map((room) => (
              <CarryRoomCard
                key={room.id}
                room={room}
                signups={data.signups}
                members={data.members}
                authorized={authorizedRoomIds.has(room.id)}
                otherOpenRooms={openRooms.filter(
                  (candidate) => candidate.id !== room.id
                )}
                onChanged={refreshQuietly}
                onSignupHere={pickRoom}
              />
            ))}
          </div>
        )}
      </section>

      {confirmDialog}
    </div>
  )
}

/**
 * Pick a room and a roster name, then join that room's queue.
 *
 * The name always comes from a row someone tapped, never from the text in the
 * box: a typo must not invent a player. Confirming shows the room, the carrier,
 * and the name being written, because a wrong row would put someone else in a
 * queue without them knowing. The server rejects a name that already sits in
 * any queue; the inline notice explains that before the button can be pressed.
 */
function CarrySignupForm({
  rooms,
  signups,
  members,
  selectedRoomId,
  onSelectRoom,
  onSigned,
}: {
  rooms: CarryRoom[]
  signups: CarrySignup[]
  members: Member[]
  selectedRoomId: string
  onSelectRoom: (value: string) => void
  onSigned: () => void
}) {
  const [selected, setSelected] = React.useState<Member | null>(null)
  // Mirrors the text in the box, only to guard "the box no longer says the
  // selected name". Base UI keeps the selection when the text is edited.
  const [typed, setTyped] = React.useState("")
  const [note, setNote] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const openRooms = React.useMemo(
    () => rooms.filter((room) => room.open),
    [rooms]
  )

  // Keep the board's selection only while that room is still open. A room that
  // closes under the form falls back to the first open room without an effect.
  const roomId = openRooms.some((room) => String(room.id) === selectedRoomId)
    ? selectedRoomId
    : openRooms[0]
      ? String(openRooms[0].id)
      : ""
  const selectedRoom = openRooms.find((room) => String(room.id) === roomId)

  const pool = React.useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name, "th")),
    [members]
  )

  const picked = selected && typed.trim() === selected.name ? selected : null
  const existing = picked
    ? signups.find((signup) => signup.name === picked.name)
    : undefined
  const existingRoom = existing
    ? rooms.find((room) => room.id === existing.roomId)
    : undefined

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!picked || !selectedRoom || existing || pending) return

    // Captured before the await: the form may change while the dialog is open,
    // and the dialog has to describe the row that will actually be written.
    const chosen = picked
    const chosenRoom = selectedRoom
    const chosenNote = note.trim()

    const yes = await confirm({
      title: `ยืนยันลงชื่อ “${chosen.name}”?`,
      description:
        "ถ้าไม่ใช่ชื่อของคุณ กดยกเลิกแล้วเลือกใหม่ — คนแบกหรือผู้ดูแลลบให้ได้ แต่จะช้ากว่า",
      confirmLabel: "ยืนยันลงชื่อ",
      children: (
        <div className="space-y-2">
          <div className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2.5">
            <GameIcon job={chosen.job} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{chosen.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {chosen.job}
              </p>
            </div>
          </div>
          <div className="bg-muted/50 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm">
            <Target className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 break-words">
              ห้อง “{chosenRoom.title}” · คนแบก {chosenRoom.carrierName}
            </p>
          </div>
          {chosenNote && (
            <p className="text-muted-foreground text-xs break-words">
              หมายเหตุ: {chosenNote}
            </p>
          )}
        </div>
      ),
    })
    if (!yes) return

    setPending(true)
    try {
      const response = await fetch("/api/carry-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: chosenRoom.id,
          name: chosen.name,
          note: chosenNote || undefined,
        }),
      })
      const body = await response.json()

      if (!response.ok) {
        if (body.existing) {
          toast.info(body.error ?? "ชื่อนี้อยู่ในคิวแล้ว")
          onSigned()
        } else {
          toast.error(body.error ?? "ลงชื่อไม่สำเร็จ")
          if (response.status === 409) onSigned()
        }
        return
      }

      toast.success(`ลงชื่อ ${chosen.name} ในห้อง “${chosenRoom.title}” แล้ว`)

      // Clear the box so the next person on a shared phone starts fresh.
      setSelected(null)
      setTyped("")
      setNote("")
      onSigned()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  if (openRooms.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-3 text-sm">
        <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">ยังไม่มีห้องที่เปิดรับคิว</p>
          <p className="text-muted-foreground">
            รอคนแบกเปิดรับ หรือกด “สร้างห้องแบก” เพื่อเปิดห้องของตัวเอง
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="carry-room">ห้อง / คนแบก</Label>
        <Select value={roomId} onValueChange={onSelectRoom}>
          <SelectTrigger id="carry-room" className="w-full">
            <SelectValue placeholder="เลือกห้องที่ต้องการลงคิว" />
          </SelectTrigger>
          <SelectContent>
            {openRooms.map((room) => (
              <SelectItem key={room.id} value={String(room.id)}>
                {room.title} — {room.carrierName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="carry-member-name">ชื่อตัวละคร</Label>
        <Combobox
          items={pool}
          // The label is what lands in the box; the value is what a form would
          // send. Only picking a row fills the form.
          itemToStringLabel={(member) => member.name}
          itemToStringValue={(member) => member.name}
          isItemEqualToValue={(itemValue, value) =>
            itemValue.name === value.name
          }
          value={selected}
          onValueChange={(member) => {
            setSelected(member)
            setTyped(member ? member.name : "")
          }}
          filter={(member, query) => matchesMemberName(member, query)}
          onInputValueChange={(value) => setTyped(value)}
          autoHighlight
        >
          <ComboboxInput
            id="carry-member-name"
            placeholder={
              pool.length === 0
                ? "ยังไม่มีรายชื่อสมาชิก"
                : "พิมพ์ชื่อของคุณ"
            }
            disabled={pool.length === 0}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            showClear
            className="[&_[data-slot=combobox-clear]]:size-8 sm:[&_[data-slot=combobox-clear]]:size-6"
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {pool.length === 0
                ? "ยังไม่มีสมาชิกในกิลด์ — ผู้ดูแลต้องเพิ่มรายชื่อก่อน"
                : "ไม่พบชื่อนี้ — ลองพิมพ์เฉพาะบางส่วน หรือถามหัวหน้ากิลด์"}
            </ComboboxEmpty>
            <ComboboxList>
              {(member) => (
                <ComboboxItem key={member.name} value={member}>
                  <GameIcon job={member.job} className="size-6" />
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

      {picked && existing && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm">
          <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">ชื่อนี้อยู่ในคิวแล้ว</p>
            <p className="text-muted-foreground break-words">
              {existingRoom
                ? `ห้อง “${existingRoom.title}” · คนแบก ${existingRoom.carrierName}`
                : "ห้องอื่น"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              ถ้าต้องการย้าย ให้คนแบกของห้องนั้นย้ายให้
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="carry-note">หมายเหตุ (ไม่บังคับ)</Label>
        <Input
          id="carry-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="เช่น ว่างหลังสามทุ่ม / ขอรอบดึก"
          maxLength={CARRY_NOTE_MAX_LENGTH}
        />
        <p className="text-muted-foreground text-xs">
          เขียนสั้น ๆ ให้คนแบกเห็น เช่น ช่วงเวลาที่ว่าง
        </p>
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!picked || !selectedRoom || Boolean(existing) || pending}
      >
        <UserPlus />
        {pending ? "กำลังลงชื่อ…" : "ลงชื่อห้องนี้"}
      </Button>

      {confirmDialog}
    </form>
  )
}

/** Picks the typed part out of a suggestion, same mark as the check-in form. */
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
