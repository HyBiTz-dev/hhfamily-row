import "server-only";

/**
 * Admin session.
 *
 * There are no user accounts in this app. "Admin" simply means "someone who
 * knows the guild PIN", so a session is a pair of cookies rather than a token
 * row in the database:
 *
 *   - `guild_admin`     an HMAC-signed expiry token — proves the PIN was known.
 *   - `guild_admin_pin` the PIN itself, AES-256-GCM encrypted under
 *                       SESSION_SECRET.
 *
 * The PIN is the only credential: there is no user table, and the database is
 * reachable only with the server's own token (see lib/db.ts). `requireAdmin` on
 * each route is therefore the whole gate.
 *
 * The PIN cookie stays anyway, because a session cookie pair that a member's
 * browser already holds should keep working across a deploy. `isAdmin` requires
 * both, so dropping the PIN cookie logs the guild master out rather than
 * silently half-authorising them.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "guild_admin";
export const ADMIN_PIN_COOKIE = "guild_admin_pin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function adminPin(): string {
  const pin = process.env.GUILD_PIN;
  if (!pin) {
    throw new Error("Missing GUILD_PIN — admin features are unavailable.");
  }
  return pin;
}

/** False when GUILD_PIN is unset, so routes can explain instead of throwing. */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.GUILD_PIN && process.env.SESSION_SECRET);
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET.");
  }
  return secret;
}

/** Constant-time compare so a wrong PIN can't be found by timing the response. */
export function isAdminPinValid(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate === "") return false;
  const expected = Buffer.from(adminPin());
  const given = Buffer.from(candidate);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

function sign(expiresAt: number): string {
  return createHmac("sha256", sessionSecret())
    .update(String(expiresAt))
    .digest("base64url");
}

/** Token format: `<expiresAtMs>.<hmac>` */
export function createAdminToken(): string {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = Buffer.from(sign(expiry));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;

  return timingSafeEqual(expected, given);
}

/**
 * Key for the PIN cookie.
 *
 * Derived from SESSION_SECRET with a label, so the same secret can key both
 * this cipher and the HMAC above without the two ever sharing bytes.
 */
function pinKey(): Buffer {
  return createHash("sha256").update(`${sessionSecret()}:admin-pin`).digest();
}

/** `<iv>.<ciphertext>.<tag>`, each base64url. AES-256-GCM authenticates too. */
export function encryptPin(pin: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", pinKey(), iv);
  const sealed = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    sealed.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** The PIN back, or null when the cookie is missing, tampered with or stale. */
export function decryptPin(token: string | undefined): string | null {
  if (!token) return null;

  const [iv, sealed, tag] = token.split(".");
  if (!iv || !sealed || !tag) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      pinKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // Wrong key, tampered bytes or an older format — all mean "no session".
    return null;
  }
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  if (!verifyAdminToken(store.get(ADMIN_COOKIE)?.value)) return false;
  // A valid session cookie with no readable PIN cookie is either from before
  // the two were introduced together or was tampered with — writes would fail,
  // so treat it as signed out and let the login form set the pair again.
  return decryptPin(store.get(ADMIN_PIN_COOKIE)?.value) !== null;
}

export async function startAdminSession(pin: string): Promise<void> {
  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
  store.set(ADMIN_COOKIE, createAdminToken(), options);
  store.set(ADMIN_PIN_COOKIE, encryptPin(pin), options);
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.delete(ADMIN_PIN_COOKIE);
}

/**
 * For route handlers that mutate the roster or parties. Returns a 401
 * response instead of throwing, so callers can `return requireAdmin()`.
 */
export async function requireAdmin(): Promise<Response | null> {
  if (await isAdmin()) return null;
  return Response.json({ error: "ต้องเข้าสู่ระบบในสมุดผู้ดูแลก่อน" }, { status: 401 });
}
