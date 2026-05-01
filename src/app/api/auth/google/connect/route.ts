/**
 * GET /api/auth/google/connect?email=inquiries@stewardshipcre.com
 *
 * Kicks off the Google OAuth grant flow. Generates a CSRF state token,
 * stores it in a short-lived cookie, and redirects to Google's auth URL.
 *
 * The user authenticates as the requested mailbox (login_hint is a soft
 * suggestion, not a constraint — Google still shows account chooser).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateState } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const loginHint = searchParams.get("email") || "inquiries@stewardshipcre.com";

  let authUrl: string;
  let state: string;
  try {
    state = generateState();
    authUrl = buildAuthUrl({ state, loginHint });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "OAuth not configured" },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(authUrl);
  // 10 minute window to complete the OAuth grant. HttpOnly + Secure + SameSite=Lax.
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
