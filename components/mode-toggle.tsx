"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

/**
 * Light/dark toggle.
 *
 * Both icons are always rendered and swapped by CSS rather than by React
 * state, because the server can't know which theme the visitor chose. That
 * avoids the hydration mismatch a `mounted` flag would otherwise cause.
 *
 * Only the click handler reads the current theme, and that always runs in the
 * browser, so there is nothing to mismatch.
 */
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      // 28px is a comfortable mouse target but too small for a thumb, so the
      // tap target grows on coarse pointers only.
      className="size-9 touch-manipulation sm:size-7"
      aria-label="สลับโหมดสว่าง/มืด"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" aria-hidden />
      <Moon className="block dark:hidden" aria-hidden />
    </Button>
  )
}