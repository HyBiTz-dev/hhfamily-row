"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react"

import { usePortalContainer } from "@/components/portal-container"

/**
 * Combobox popup that can live inside a Radix dialog.
 *
 * shadcn's `ComboboxContent` portals to `<body>` and has no `container` prop.
 * A Radix dialog locks scrolling by treating only its content node as a shard;
 * a popup outside that shard cannot be scrolled or clicked reliably. This
 * wrapper reads the dialog content node from `PortalContainerProvider` and
 * hands it to Base UI. Outside a dialog the context is null, so the popup falls
 * back to `<body>` exactly like the CLI component.
 */
export function DialogComboboxPopup({
  children,
}: {
  children: React.ReactNode
}) {
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
