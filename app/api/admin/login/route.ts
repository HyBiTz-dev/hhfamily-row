import {
  isAdminConfigured,
  isAdminPinValid,
  startAdminSession,
  endAdminSession,
  isAdmin,
} from "@/lib/auth";

/**
 * POST   /api/admin/login   { pin }  → sets the admin cookie
 * DELETE /api/admin/login             → clears it
 * GET    /api/admin/login             → { authenticated }
 */

const UNCONFIGURED = "ยังไม่ได้ตั้ง GUILD_PIN และ SESSION_SECRET ใน .env.local";

export async function GET() {
  if (!isAdminConfigured()) {
    return Response.json({ authenticated: false, configured: false }, { status: 503 });
  }
  return Response.json({ authenticated: await isAdmin(), configured: true });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return Response.json({ error: UNCONFIGURED }, { status: 503 });
  }

  let pin: unknown;
  try {
    pin = (await request.json()).pin;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!isAdminPinValid(pin)) {
    return Response.json({ error: "รหัสไม่ถูกต้อง" }, { status: 401 });
  }

  await startAdminSession(pin as string);
  return Response.json({ authenticated: true });
}

export async function DELETE() {
  await endAdminSession();
  return Response.json({ authenticated: false });
}
