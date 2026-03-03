import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, COOKIE_MAX_AGE, isAuthEnabled, deriveToken } from "@/lib/auth";

/** POST /api/auth — Login: validate password and set session cookie */
export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "Auth is not enabled" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.password !== "string") {
    return NextResponse.json({ error: "Missing password" }, { status: 400 });
  }

  const password = process.env.AUTH_PASSWORD ?? "";
  if (body.password !== password) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = await deriveToken(password);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

/** DELETE /api/auth — Logout: clear session cookie */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return response;
}
