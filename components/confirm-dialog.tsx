"use client"

import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** What a confirmation asks, and which button means yes. */
export type ConfirmRequest = {
  title: string
  description: string
  confirmLabel?: string
  /** `danger` paints the yes button red — for anything that deletes. */
  tone?: "default" | "danger"
  /**
   * Extra content between the text and the buttons.
   *
   * For a choice that is easy to get wrong, the important detail is rarely
   * something a sentence describes well — "which character am I about to
   * record?" is answered far better by the same name card the roster shows than
   * by the name in quotes.
   */
  children?: React.ReactNode
}

type PendingConfirm = ConfirmRequest & { resolve: (answer: boolean) => void }

/**
 * `window.confirm`, but ours.
 *
 * The native dialog blocks the page, cannot be styled, and renders its button
 * labels in the browser's language rather than the app's. Every call site here
 * is something destructive the guild master taps on a phone between matches,
 * so it has to look like the rest of the site.
 *
 * Usage: `const { confirm, dialog } = useConfirm()`, render `dialog` once, then
 * `if (!(await confirm({ ... }))) return`.
 */
export function useConfirm() {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  const confirm = React.useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...request, resolve })
      }),
    []
  )

  /** Resolving twice is a no-op, so Radix's own close handling is harmless. */
  function answer(value: boolean) {
    setPending((current) => {
      current?.resolve(value)
      return null
    })
  }

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {pending?.children && <div className="min-w-0">{pending.children}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            variant={pending?.tone === "danger" ? "destructive" : "default"}
            onClick={() => answer(true)}
          >
            {pending?.confirmLabel ?? "ตกลง"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, dialog }
}