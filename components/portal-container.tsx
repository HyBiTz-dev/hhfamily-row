"use client"

import * as React from "react"

/**
 * Where a portaled popup inside a modal should mount.
 *
 * A Radix `Dialog` locks scrolling to its own content: the overlay hands
 * `react-remove-scroll` the content node as a *shard* and sets
 * `pointer-events: none` on everything else. A Base UI popup portals to
 * `<body>` by default, so it lands outside that shard — the list looks right
 * but cannot be scrolled (and is awkward to click) while the dialog is open.
 * This is the Base UI × Radix interop gap, not a bug in either component.
 *
 * Pointing the popup's portal at the dialog content fixes both, because then
 * it *is* inside the shard. `PortalContainerProvider` is handed the dialog
 * content node; `usePortalContainer` returns it — or null outside any dialog,
 * where the popup keeps its usual `<body>` portal and needs no help.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext)
}

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}
