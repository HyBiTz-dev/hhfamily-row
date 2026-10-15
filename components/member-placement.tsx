"use client"

import * as React from "react"
import { placementByMember } from "@/lib/party"
import type { Party } from "@/lib/rngw/types"

/**
 * "Which parties is this person already on?", shared with the add-member
 * dropdowns without threading a prop through the whole board.
 *
 * Both boards that offer the dropdown — the party builder and the event lane
 * board — know the whole parties tab and wrap their tree in the provider, so
 * the dropdowns below pick the map up from context rather than each level
 * passing it down. Outside a provider it is undefined, which the dropdown
 * treats as "no one is placed yet".
 */
const PlacementContext = React.createContext<Map<string, string> | undefined>(
  undefined
)

export function useMemberPlacement(): Map<string, string> | undefined {
  return React.useContext(PlacementContext)
}

export function MemberPlacementProvider({
  parties,
  children,
}: {
  parties: Party[]
  children: React.ReactNode
}) {
  const placement = React.useMemo(() => placementByMember(parties), [parties])

  return (
    <PlacementContext.Provider value={placement}>
      {children}
    </PlacementContext.Provider>
  )
}
