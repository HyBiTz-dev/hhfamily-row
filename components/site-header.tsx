"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, LogOut, Menu, ShieldCheck } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ADMIN_HREF, NAV_ITEMS } from "@/lib/nav";
import { signOutAdmin, useAdminSession } from "@/hooks/use-admin-session";
import { cn } from "cn";

export function SiteHeader() {
  const pathname = usePathname();
  const { authed } = useAdminSession();
  const onAdmin = pathname === ADMIN_HREF;

  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-1 px-4 sm:h-16">
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className="mr-2 shrink-0 text-sm font-semibold tracking-tight transition-colors hover:text-muted-foreground sm:mr-4 sm:text-lg"
        >
          กิลด์ HHFamily
        </Link>

        {/*
          Mobile menu. Measured at 320px: brand + 3 nav links + admin button +
          theme toggle need ~520px, and only ~288px is usable after px-4, so the
          links would be squeezed into an 82px scroll strip that shows one page
          and hides two. The sheet shows all of them at full width instead.
        */}
        <MobileMenu authed={authed} />

        {/*
          Native horizontal scroll, not ScrollArea: same reason as the
          history table — shadcn's ScrollArea is vertical-only, and a nav
          strip inside a 56px-tall bar has no room for a scrollbar without
          pushing the links off-centre.
        */}
        <nav className="hidden flex-1 items-center gap-1 overflow-x-auto sm:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/*
          The admin entry point is always visible. Hiding it until you are
          already logged in would leave the guild master with no way in after
          signing out or switching devices. It is repeated in the mobile sheet
          with its label, because a bare icon does not say what it opens.

          It renders as "sign in" by default rather than waiting for the
          session check, so the server sends a usable button immediately
          instead of an empty spot that fills in a moment later.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
          {authed ? (
            <>
              <Button
                variant={onAdmin ? "secondary" : "ghost"}
                size="icon-sm"
                asChild
                className="size-9 touch-manipulation sm:h-7 sm:w-auto sm:px-2.5"
              >
                <Link href={ADMIN_HREF}>
                  <ShieldCheck />
                  <span className="sr-only sm:not-sr-only">ผู้ดูแล</span>
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9 touch-manipulation sm:size-7"
                aria-label="ออกจากระบบผู้ดูแล"
                title="ออกจากระบบ"
                onClick={() => void signOutAdmin()}
              >
                <LogOut />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              className="size-9 touch-manipulation sm:h-7 sm:w-auto sm:px-2.5"
            >
              <Link
                href={ADMIN_HREF}
                aria-current={onAdmin ? "page" : undefined}
              >
                <Lock />
                <span className="sr-only sm:not-sr-only">เข้าสู่ระบบ</span>
              </Link>
            </Button>
          )}

          <ModeToggle />
        </span>
      </div>
    </header>
  );
}

/**
 * Hamburger + sheet, below `sm` only.
 *
 * Rows are full-width rather than the inline strip, because this is opened by
 * thumb: a tappable row is easier to hit than a 30px-tall link.
 */
function MobileMenu({ authed }: { authed: boolean }) {
  const pathname = usePathname();

  /*
    Uncontrolled on purpose. The sheet is a Radix dialog, so Escape, the
    overlay and `SheetClose` already close it, and wrapping each link in
    `SheetClose` is what closes it on navigation. Holding `open` in state just
    to add a `useEffect` that resets it on `pathname` would be the
    set-state-in-effect pattern the linter rejects — and it would also fire a
    second render on every page change for no gain.
  */
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 touch-manipulation sm:hidden"
          aria-label="เปิดเมนู"
        >
          <Menu />
        </Button>
      </SheetTrigger>

      {/*
          No width/gap overrides: `w-3/4` and `gap-4` are variant + later
          utilities, so a plain `w-72`/`gap-0` in className loses exactly like
          TabsList's `h-auto` did (see AGENTS.md). The defaults are fine.
        */}
      <SheetContent side="left" className="sm:hidden">
        <SheetHeader className="pb-0">
          <SheetTitle>เมนู</SheetTitle>
          <SheetDescription className="sr-only">
            เลือกหน้าที่ต้องการ
          </SheetDescription>
        </SheetHeader>

        <nav className="flex flex-col gap-1 overflow-y-auto px-4 pb-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <SheetClose key={item.href} asChild>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-base transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground font-medium"
                      : "hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </SheetClose>
            );
          })}

          {/*
            The admin area is not in NAV_ITEMS, so the sheet would otherwise be
            an incomplete menu. Repeating it here is what makes "เปิดเมนู"
            honest — the header keeps its own button for the sign-back-in rule.
          */}
          <SheetClose asChild>
            <Link
              href={ADMIN_HREF}
              aria-current={pathname === ADMIN_HREF ? "page" : undefined}
              className={cn(
                "mt-2 flex items-center gap-2 border-t pt-3 text-base transition-colors",
                pathname === ADMIN_HREF
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "hover:bg-muted hover:text-foreground",
              )}
            >
              {authed ? <ShieldCheck /> : <Lock />}
              {authed ? "ผู้ดูแลกิลด์" : "เข้าสู่ระบบผู้ดูแล"}
            </Link>
          </SheetClose>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
