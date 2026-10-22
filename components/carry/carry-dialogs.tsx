"use client"

import * as React from "react"
import { KeyRound, Lock, Target, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DialogComboboxPopup } from "@/components/combobox-popup"
import { GameIcon } from "@/components/game-icon"
import { PortalContainerProvider } from "@/components/portal-container"
import { matchesMemberName } from "@/lib/rngw/roster"
import {
  CARRY_NOTE_MAX_LENGTH,
  CARRY_PIN_MAX_LENGTH,
  CARRY_PIN_MIN_LENGTH,
  CARRY_ROOM_TITLE_MAX_LENGTH,
  type CarryRoom,
  type CarrySignup,
  type Member,
} from "@/lib/rngw/types"

/** Create a room: pick the carrier name, name the activity, choose a PIN. */
export function CreateRoomDialog({
  members,
  onClose,
  onCreated,
}: {
  members: Member[]
  onClose: () => void
  onCreated: () => void
}) {
  const [carrier, setCarrier] = React.useState<Member | null>(null)
  const [typed, setTyped] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [pin, setPin] = React.useState("")
  const [confirmPin, setConfirmPin] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [content, setContent] = React.useState<HTMLDivElement | null>(null)

  const carriers = React.useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name, "th")),
    [members]
  )
  // Base UI keeps the selected row when its text is edited. The room must only
  // be created for a name the carrier actually picked from the list.
  const picked = carrier && typed.trim() === carrier.name ? carrier : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return

    if (!picked) {
      toast.error("เลือกชื่อคนแบกจากรายการก่อน")
      return
    }
    if (!title.trim()) {
      toast.error("ใส่ชื่อห้องหรือกิจกรรมที่จะแบกก่อน")
      return
    }
    if (
      pin.trim().length < CARRY_PIN_MIN_LENGTH ||
      pin.trim().length > CARRY_PIN_MAX_LENGTH
    ) {
      toast.error(
        `รหัสจัดการห้องต้องยาว ${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`
      )
      return
    }
    if (pin.trim() !== confirmPin.trim()) {
      toast.error("รหัสทั้งสองช่องไม่ตรงกัน")
      return
    }

    setPending(true)
    try {
      const response = await fetch("/api/carry/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrierName: picked.name,
          title: title.trim(),
          pin: pin.trim(),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "สร้างห้องไม่สำเร็จ")
        return
      }
      toast.success(`สร้างห้อง “${body.room.title}” แล้ว`)
      onCreated()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent ref={setContent}>
        <DialogHeader>
          <DialogTitle>สร้างห้องแบก</DialogTitle>
          <DialogDescription>
            ตั้งชื่อห้องหรือกิจกรรมที่จะแบก แล้วตั้งรหัสสำหรับเข้าจัดการคิวของห้องนี้
          </DialogDescription>
        </DialogHeader>

        <PortalContainerProvider container={content}>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-carrier">ชื่อคนแบก</Label>
              <Combobox
                items={carriers}
                itemToStringLabel={(member) => member.name}
                itemToStringValue={(member) => member.name}
                isItemEqualToValue={(itemValue, value) =>
                  itemValue.name === value.name
                }
                value={carrier}
                onValueChange={(member) => {
                  setCarrier(member)
                  setTyped(member ? member.name : "")
                }}
                filter={(member, query) => matchesMemberName(member, query)}
                onInputValueChange={setTyped}
                autoHighlight
              >
                <ComboboxInput
                  id="create-carrier"
                  placeholder={
                    carriers.length === 0
                      ? "ยังไม่มีรายชื่อสมาชิก"
                      : "พิมพ์ชื่อคนแบก แล้วเลือกจากรายการ"
                  }
                  disabled={carriers.length === 0}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  showClear
                  className="[&_[data-slot=combobox-clear]]:size-8 sm:[&_[data-slot=combobox-clear]]:size-6"
                />
                <DialogComboboxPopup>
                  <ComboboxEmpty>
                    {carriers.length === 0
                      ? "ยังไม่มีสมาชิกในกิลด์ — ผู้ดูแลต้องเพิ่มรายชื่อก่อน"
                      : "ไม่พบชื่อนี้ — ชื่อต้องมาจากรายชื่อสมาชิก"}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(member) => (
                      <ComboboxItem key={member.name} value={member}>
                        <GameIcon job={member.job} className="size-6" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {member.name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {member.job}
                          </span>
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </DialogComboboxPopup>
              </Combobox>
              <p className="text-muted-foreground text-xs">
                ชื่อต้องมาจากรายชื่อสมาชิกเท่านั้น
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-room-title">ชื่อห้อง / กิจกรรม</Label>
              <Input
                id="create-room-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={CARRY_ROOM_TITLE_MAX_LENGTH}
                placeholder="เช่น แบกดัน 100 / Abyss 60"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-room-pin">รหัสจัดการห้อง</Label>
                <Input
                  id="create-room-pin"
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  maxLength={CARRY_PIN_MAX_LENGTH}
                  autoComplete="new-password"
                  placeholder={`${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-room-pin-confirm">ยืนยันรหัส</Label>
                <Input
                  id="create-room-pin-confirm"
                  type="password"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value)}
                  maxLength={CARRY_PIN_MAX_LENGTH}
                  autoComplete="new-password"
                  placeholder="พิมพ์รหัสอีกครั้ง"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              รหัสนี้ใช้เข้าจัดการคิวของห้องนี้ ไม่ใช่รหัสผู้ดูแลกิลด์
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={pending}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={pending}>
                <UserPlus />
                {pending ? "กำลังสร้าง…" : "สร้างห้อง"}
              </Button>
            </DialogFooter>
          </form>
        </PortalContainerProvider>
      </DialogContent>
    </Dialog>
  )
}

/** Enter one room's carrier mode with its PIN. */
export function RoomLoginDialog({
  room,
  onClose,
  onLoggedIn,
}: {
  room: CarryRoom
  onClose: () => void
  onLoggedIn: () => void
}) {
  const [pin, setPin] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!pin.trim()) {
      toast.error("ใส่รหัสจัดการห้องก่อน")
      return
    }

    setPending(true)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "เข้าจัดการห้องไม่สำเร็จ")
        return
      }
      toast.success(`เข้าจัดการห้อง “${room.title}” แล้ว`)
      onLoggedIn()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">เข้าจัดการห้อง “{room.title}”</DialogTitle>
          <DialogDescription>
            ใส่รหัสจัดการห้องที่ตั้งไว้ตอนสร้าง — คนแบก: {room.carrierName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="room-login-pin">รหัสจัดการห้อง</Label>
            <Input
              id="room-login-pin"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              maxLength={CARRY_PIN_MAX_LENGTH}
              autoComplete="current-password"
              placeholder="รหัสที่ตั้งไว้"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending}>
              <KeyRound />
              {pending ? "กำลังตรวจรหัส…" : "เข้าจัดการ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Rename a room, or change its PIN without logging the current device out. */
export function RoomSettingsDialog({
  room,
  onClose,
  onSaved,
}: {
  room: CarryRoom
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState(room.title)
  const [pin, setPin] = React.useState("")
  const [confirmPin, setConfirmPin] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error("ชื่อห้องห้ามว่าง")
      return
    }

    const wantsPin = pin.trim().length > 0
    if (wantsPin) {
      if (
        pin.trim().length < CARRY_PIN_MIN_LENGTH ||
        pin.trim().length > CARRY_PIN_MAX_LENGTH
      ) {
        toast.error(
          `รหัสจัดการห้องต้องยาว ${CARRY_PIN_MIN_LENGTH}–${CARRY_PIN_MAX_LENGTH} ตัวอักษร`
        )
        return
      }
      if (pin.trim() !== confirmPin.trim()) {
        toast.error("รหัสทั้งสองช่องไม่ตรงกัน")
        return
      }
    }

    const patch: { title?: string; pin?: string } = {}
    if (trimmedTitle !== room.title) patch.title = trimmedTitle
    if (wantsPin) patch.pin = pin.trim()

    if (!patch.title && !patch.pin) {
      toast.info("ไม่มีการเปลี่ยนแปลง")
      return
    }

    setPending(true)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "บันทึกการตั้งค่าห้องไม่สำเร็จ")
        return
      }
      toast.success(patch.pin ? "บันทึกการตั้งค่าและรหัสใหม่แล้ว" : "บันทึกชื่อห้องแล้ว")
      onSaved()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">ตั้งค่าห้อง “{room.title}”</DialogTitle>
          <DialogDescription>
            แก้ชื่อห้อง/กิจกรรม หรือตั้งรหัสจัดการใหม่ — เว้นช่องรหัสว่างไว้ถ้าไม่เปลี่ยน
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="room-settings-title">ชื่อห้อง / กิจกรรม</Label>
            <Input
              id="room-settings-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={CARRY_ROOM_TITLE_MAX_LENGTH}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="room-settings-pin">รหัสใหม่ (ไม่บังคับ)</Label>
              <Input
                id="room-settings-pin"
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                maxLength={CARRY_PIN_MAX_LENGTH}
                autoComplete="new-password"
                placeholder="เว้นว่าง = ใช้รหัสเดิม"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-settings-pin-confirm">ยืนยันรหัสใหม่</Label>
              <Input
                id="room-settings-pin-confirm"
                type="password"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value)}
                maxLength={CARRY_PIN_MAX_LENGTH}
                autoComplete="new-password"
                placeholder="พิมพ์รหัสอีกครั้ง"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            เปลี่ยนรหัสแล้ว อุปกรณ์อื่นที่เคยเข้าห้องนี้จะต้องใส่รหัสใหม่
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin/carrier edit of one queue row's note. Empty clears it. */
export function CarryNoteDialog({
  room,
  signup,
  onClose,
  onSaved,
}: {
  room: CarryRoom
  signup: CarrySignup
  onClose: () => void
  onSaved: () => void
}) {
  const [note, setNote] = React.useState(signup.note ?? "")
  const [pending, setPending] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return

    setPending(true)
    try {
      const response = await fetch(
        `/api/carry/rooms/${room.id}/signups`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: signup.name, note }),
        }
      )
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "บันทึกหมายเหตุไม่สำเร็จ")
        return
      }
      toast.success(
        note.trim()
          ? `บันทึกหมายเหตุของ ${signup.name} แล้ว`
          : `ลบหมายเหตุของ ${signup.name} แล้ว`
      )
      onSaved()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">
            แก้หมายเหตุของ “{signup.name}”
          </DialogTitle>
          <DialogDescription>
            ห้อง “{room.title}” — เว้นว่างเพื่อลบหมายเหตุ ลำดับในคิวไม่เปลี่ยน
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="carry-edit-note">หมายเหตุ (ไม่บังคับ)</Label>
            <Input
              id="carry-edit-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={CARRY_NOTE_MAX_LENGTH}
              placeholder="เช่น ว่างหลังสามทุ่ม / ขอรอบดึก"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก…" : "บันทึกหมายเหตุ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Move one queue row into another open room's queue. */
export function TransferSignupDialog({
  room,
  signup,
  targets,
  onClose,
  onMoved,
}: {
  room: CarryRoom
  signup: CarrySignup
  targets: CarryRoom[]
  onClose: () => void
  onMoved: () => void
}) {
  const [targetId, setTargetId] = React.useState(
    targets[0] ? String(targets[0].id) : ""
  )
  const [pending, setPending] = React.useState(false)

  const target = targets.find((candidate) => String(candidate.id) === targetId)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !target) return

    setPending(true)
    try {
      const response = await fetch(
        `/api/carry/rooms/${room.id}/signups`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: signup.name, toRoomId: target.id }),
        }
      )
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ย้ายคิวไม่สำเร็จ")
        return
      }
      toast.success(`ย้าย ${signup.name} ไปห้อง “${target.title}” แล้ว`)
      onMoved()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">
            ย้าย “{signup.name}” ไปห้องอื่น
          </DialogTitle>
          <DialogDescription>
            จากห้อง “{room.title}” — หมายเหตุเดิมจะติดไปด้วย และชื่อจะไปต่อท้ายคิวปลายทาง
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Target className="text-muted-foreground size-5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate font-medium">{signup.name}</p>
              {signup.note && (
                <p className="text-muted-foreground line-clamp-2 text-xs break-words">
                  {signup.note}
                </p>
              )}
            </div>
          </div>

          {targets.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-3 text-sm">
              <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground">
                ยังไม่มีห้องอื่นที่เปิดรับคิว — ให้คนแบกอีกห้องเปิดรับก่อน
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="carry-transfer-target">ห้องปลายทาง</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="carry-transfer-target" className="w-full">
                  <SelectValue placeholder="เลือกห้องปลายทาง" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((candidate) => (
                    <SelectItem key={candidate.id} value={String(candidate.id)}>
                      {candidate.title} — {candidate.carrierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending || !target}>
              {pending ? "กำลังย้าย…" : "ย้ายคิว"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Move every queue row into another open room's queue. */
export function TransferAllSignupsDialog({
  room,
  count,
  targets,
  onClose,
  onMoved,
}: {
  room: CarryRoom
  count: number
  targets: CarryRoom[]
  onClose: () => void
  onMoved: () => void
}) {
  const [targetId, setTargetId] = React.useState(
    targets[0] ? String(targets[0].id) : ""
  )
  const [pending, setPending] = React.useState(false)

  const target = targets.find((candidate) => String(candidate.id) === targetId)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !target) return

    setPending(true)
    try {
      const response = await fetch(`/api/carry/rooms/${room.id}/signups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, toRoomId: target.id }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? "ย้ายคิวทั้งหมดไม่สำเร็จ")
        return
      }
      const moved = typeof body.moved === "number" ? body.moved : count
      toast.success(`ย้ายทั้ง ${moved} ชื่อไปห้อง “${target.title}” แล้ว`)
      onMoved()
    } catch {
      toast.error("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">
            ย้ายคิวทั้งหมดจาก “{room.title}”
          </DialogTitle>
          <DialogDescription>
            จะย้ายทั้ง {count} ชื่อไปต่อท้ายคิวปลายทางตามลำดับเดิม —
            หมายเหตุของแต่ละคนติดไปด้วย
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Target className="text-muted-foreground size-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">{count} ชื่อในคิว</p>
              <p className="text-muted-foreground text-xs">
                จากห้อง “{room.title}”
              </p>
            </div>
          </div>

          {targets.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-3 text-sm">
              <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground">
                ยังไม่มีห้องอื่นที่เปิดรับคิว — ให้คนแบกอีกห้องเปิดรับก่อน
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="carry-transfer-all-target">ห้องปลายทาง</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger
                  id="carry-transfer-all-target"
                  className="w-full"
                >
                  <SelectValue placeholder="เลือกห้องปลายทาง" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((candidate) => (
                    <SelectItem key={candidate.id} value={String(candidate.id)}>
                      {candidate.title} — {candidate.carrierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending || !target}>
              {pending ? "กำลังย้าย…" : `ย้ายทั้ง ${count} ชื่อ`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
