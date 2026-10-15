"use client"

import * as React from "react"

/**
 * Admin session state, shared by the header and the admin panel so the two
 * don't issue two different answers to "is this person an admin?".
 *
 * The cookies are httpOnly, so this only reports what the server said — it can
 * neither read nor forge them. The PIN rides the same cookie pair (see
 * lib/auth.ts), so nothing here holds it: a write just carries the cookie, and
 * the guild master types the PIN once per login instead of once per page.
 */

type SessionState = {
  authed: boolean;
  configured: boolean;
  ready: boolean;
};

const listeners = new Set<() => void>();
let state: SessionState = { authed: false, configured: true, ready: false };

function emit(next: Partial<SessionState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function useAdminSession(): SessionState {
  React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => state,
    () => state
  );

  React.useEffect(() => {
    if (state.ready) return
    void (async () => {
      try {
        const res = await fetch("/api/admin/login", { cache: "no-store" })
        const body = await res.json()
        emit({
          authed: Boolean(body.authenticated),
          configured: body.configured !== false,
          ready: true,
        })
      } catch {
        emit({ authed: false, ready: true })
      }
    })()
  }, [])

  return state
}

export function setAdminSession(authed: boolean) {
  emit({ authed, ready: true })
}

/** Clears the cookies, then tells every subscriber — the header included. */
export async function signOutAdmin(): Promise<void> {
  try {
    await fetch("/api/admin/login", { method: "DELETE" })
  } finally {
    emit({ authed: false, ready: true })
  }
}
