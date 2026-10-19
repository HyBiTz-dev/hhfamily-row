"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { activeLabelIds, partyLabelGroups, togglePartyLabel } from "@/lib/party"
import type { PartyPlacement } from "@/lib/rngw/types"

/**
 * The label editor: the chips, grouped by the page each group belongs to.
 *
 * This is the only way a party's label gets set. There is no text field beside
 * it: a label that names no event puts the team in the "ว่าง" row of every
 * page, so a custom tag is a team nobody can find.
 *
 * Grouping is not decoration: the two league chips are one event with two
 * divisions, and side by side they read as four events where there are three.
 * The group titles come from `EVENT_CATEGORIES`, so they cannot drift from the
 * page titles.
 *
 * Shared by the party builder's dialog and the pencil on a team card, so both
 * write the same vocabulary.
 */
export function PartyLabelChips({
  placements,
  onChange,
}: {
  /** The event placements being edited. */
  placements: PartyPlacement[]
  onChange: (next: PartyPlacement[]) => void
}) {
  const groups = React.useMemo(() => partyLabelGroups(), [])
  const activeIds = activeLabelIds(placements)

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.event} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium sm:w-24">
            {group.title}
          </span>
          {group.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={activeIds.includes(option.id) ? "default" : "outline"}
              className="touch-manipulation"
              aria-pressed={activeIds.includes(option.id)}
              // Multi-select: a fixed team can play several events, so a tap
              // toggles this event's segment and leaves the others — including
              // a Guild War box — exactly where they were.
              onClick={() => onChange(togglePartyLabel(placements, option))}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}