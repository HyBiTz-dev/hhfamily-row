"use client"

import * as React from "react"
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { DialogComboboxPopup } from "@/components/combobox-popup"
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
      <DialogComboboxPopup>
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
      </DialogComboboxPopup>
    </Combobox>
  )
}
