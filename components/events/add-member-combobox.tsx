"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { usePortalContainer } from "@/components/portal-container"
import { useMemberPlacement } from "@/components/member-placement"
import { GameIcon } from "@/components/game-icon"
import { StatusBadge } from "@/components/leave/roster-list"
import { matchesMemberQuery } from "@/lib/rngw/roster"
import type { MemberStatus } from "@/lib/rngw/types"

/** Who a fresh team should look for first: playing today, not on a team yet. */
const STATUS_RANK: Record<MemberStatus["status"], number> = {
  present: 0,
  unknown: 1,
  leave: 2,
}

/**
 * Picks one member to drop into a team, straight from the team card.
 *
 * The name always comes from a row someone tapped, never from the text in the
 * box, so a typo cannot invent a player. Members already on this team are left
 * out of the list — offering them again would either do nothing or write a
 * duplicate, and neither is what the tap looks like it does.
 *
 * The order is the one the guild master builds a team in: people playing today
 * who are on no team yet, then people playing today who are already somewhere,
 * then "รอเช็ค", then "ลา". Whether a move needs a confirmation is still the
 * board's business, not this component's.
 */
export function AddMemberCombobox({
  members,
  exclude,
  onPick,
}: {
  /** Everyone the admin may add. */
  members: MemberStatus[]
  /** Names already on this team, hidden from the list. */
  exclude: string[]
  onPick: (name: string) => void
}) {
  const [selected, setSelected] = React.useState<MemberStatus | null>(null)
  const placement = useMemberPlacement()

  const taken = React.useMemo(() => new Set(exclude), [exclude])
  const pool = React.useMemo(
    () =>
      members
        .filter((member) => !taken.has(member.name))
        .sort((a, b) => {
          const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status]
          if (byStatus) return byStatus

          // Same status: whoever is on no team yet comes first.
          const placed =
            (placement?.has(a.name) ? 1 : 0) - (placement?.has(b.name) ? 1 : 0)
          return placed || a.name.localeCompare(b.name, "th")
        }),
    [members, taken, placement]
  )

  return (
    <Combobox
      items={pool}
      itemToStringLabel={(member) => member.name}
      itemToStringValue={(member) => member.name}
      // The roster is refetched after every write, so these are new objects;
      // comparing by reference would make Base UI think the value fell out of
      // the list.
      isItemEqualToValue={(itemValue, value) => itemValue.name === value.name}
      value={selected}
      onValueChange={(member) => {
        if (!member) return
        onPick(member.name)
        // Clear at once: the next add starts from an empty box, and the member
        // just added is excluded by the board on the re-render anyway.
        setSelected(null)
      }}
      filter={(member, query) => matchesMemberQuery(member, query)}
      // Pressing the keyboard's done key on a phone should take the first
      // suggestion instead of leaving the box half-typed.
      autoHighlight
    >
      <ComboboxInput
        placeholder="เพิ่มคนเข้าทีม…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        showClear
        className="[&_[data-slot=combobox-clear]]:size-8 sm:[&_[data-slot=combobox-clear]]:size-6"
      />
      <MemberComboboxPopup>
        <ComboboxEmpty>ไม่พบชื่อนี้ในรายชื่อสมาชิก</ComboboxEmpty>
        <ComboboxList>
          {(member) => {
            const party = placement?.get(member.name)
            return (
              <ComboboxItem key={member.name} value={member}>
                <GameIcon job={member.job} className="size-6" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{member.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {member.job}
                    {party && ` · อยู่ปาร์ตี้ ${party}`}
                  </span>
                </span>
                <StatusBadge status={member.status} />
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      </MemberComboboxPopup>
    </Combobox>
  )
}

/**
 * The combobox popup, portaled where a scroll lock will not reach it.
 *
 * This mirrors shadcn's `ComboboxContent` (see `components/ui/combobox.tsx`),
 * with one difference: the portal target comes from `usePortalContainer()` so
 * the popup can mount *inside* a Radix dialog. Handing `container` to Base UI's
 * `ComboboxPortal` is the documented fix for the Base UI × Radix interop gap;
 * shadcn's own `ComboboxContent` has no such prop, which is why this wrapper
 * exists at all. Outside a dialog the context is null and the popup falls back
 * to `<body>`, exactly like the CLI component.
 */
function MemberComboboxPopup({ children }: { children: React.ReactNode }) {
  const container = usePortalContainer()

  return (
    <ComboboxPrimitive.Portal container={container ?? undefined}>
      <ComboboxPrimitive.Positioner
        side="bottom"
        sideOffset={6}
        align="start"
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className="group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}
