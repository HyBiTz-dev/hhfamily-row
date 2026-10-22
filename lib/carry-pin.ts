import "server-only";

/**
 * Room PIN hashing, kept apart from the cookie/session code in `carry-auth.ts`
 * so it has no dependency on `next/headers`.
 *
 * A PIN is short and human-chosen, so it is stretched with scrypt rather than
 * stored or hashed with a plain digest. The salt is per room; the stored string
 * is `saltHex:hashHex`. `verifyRoomPin` compares in constant time.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import {
  CARRY_PIN_MAX_LENGTH,
  CARRY_PIN_MIN_LENGTH,
} from "@/lib/rngw/types";

/** Trims a candidate PIN and returns it only when it is the right length. */
export function normalizeRoomPin(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const pin = candidate.trim();
  if (pin.length < CARRY_PIN_MIN_LENGTH || pin.length > CARRY_PIN_MAX_LENGTH) {
    return null;
  }
  return pin;
}

/** `saltHex:hashHex`, the only form written to `carry_rooms.pin_hash`. */
export function hashRoomPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyRoomPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const actual = scryptSync(pin, salt, expected.length);
  return timingSafeEqual(expected, actual);
}
