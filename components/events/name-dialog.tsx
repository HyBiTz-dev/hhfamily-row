"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * A dialog that asks for exactly one name and hands it back.
 *
 * Three jobs on the board share this shape — name a new box, rename a box,
 * rename a team — and all three share the same constraints: never
 * `window.prompt` (it blocks the page and its buttons are the browser's words,
 * not the app's), start from the current value when renaming, and refuse an
 * empty name. The caller owns the trigger, so the same dialog can sit on a
 * full-width button or on a small icon in a row header, and it owns the rules
 * too — a name that already exists is refused by the caller, not here.
 */
export function NameDialog({
  trigger,
  title,
  description,
  fieldLabel,
  initialValue = "",
  placeholder,
  submitLabel,
  onSubmit,
}: {
  trigger: React.ReactNode
  title: string
  description: React.ReactNode
  fieldLabel: string
  initialValue?: string
  placeholder?: string
  submitLabel: string
  onSubmit: (name: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(initialValue)
  const inputId = React.useId()

  const trimmed = name.trim()
  // Submitting the name it already has would rewrite the sheet for nothing, so
  // the button stays off until the text actually differs.
  const unchanged = trimmed === initialValue.trim()
  const disabled = !trimmed || unchanged

  function submit() {
    if (disabled) return
    onSubmit(trimmed)
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed from the current value every time it opens: after a rename,
        // the old name must not come back as the starting point.
        if (next) setName(initialValue)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{fieldLabel}</Label>
          <Input
            id={inputId}
            value={name}
            autoFocus
            enterKeyHint="done"
            placeholder={placeholder}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="touch-manipulation"
            onClick={() => setOpen(false)}
          >
            ยกเลิก
          </Button>
          <Button className="touch-manipulation" disabled={disabled} onClick={submit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
