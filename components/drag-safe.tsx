"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Keeps a press on a control from reaching dnd-kit.
 *
 * A card that is also its own drag handle puts the sensor's listeners on the
 * whole element, so every control inside it — a remove ✕, an add field, a
 * rename pencil — would otherwise be claimed by the sensor: a long press on a
 * phone, or a few pixels of mouse movement, would start dragging the card
 * instead of doing what the control says.
 *
 * It must **forward the props it is given**. `DialogTrigger asChild` clones its
 * immediate child and hands it `onClick`, `ref` and the rest of the slot props,
 * so a wrapper that quietly dropped them leaves the trigger dead — the rename
 * pencil on a team card did exactly that. The wrapper is `display: contents`,
 * so it is invisible to layout and a click on the control inside bubbles up to
 * the handlers here.
 */
export function DragSafe({
  children,
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("contents", className)}
      onPointerDown={(event) => {
        props.onPointerDown?.(event)
        // Let the control do its thing; keep dnd-kit from hearing the press.
        event.stopPropagation()
      }}
      onTouchStart={(event) => {
        props.onTouchStart?.(event)
        event.stopPropagation()
      }}
    >
      {children}
    </span>
  )
}
