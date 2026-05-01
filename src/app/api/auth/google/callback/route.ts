/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Google OAuth redirect target. Verifies state, exchanges the code for
 * tokens, persists the refresh_token + initial Gmail history cursor, and
 * redirects the user to /settings/integrations with a status query.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exchangeCodeForTokens, GMAIL_SCOPES } from "@/lib/google-oauth";
import { getProfile } from "@/lib/gmail";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function redirectToSettings(req: NextRequest, status: string, message?: string) {
  const url = new URL("/settings/integrations", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("msg", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return redirectToSettings(req, "error", `Google: ${error}`);
  }
  if (!code) {
    return redirectToSettings(req, "error", "Missing authorization code");
  }

  // ── CSRF check ──
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return redirectToSettings(req, "error", "State mismatch (possible CSRF)");
  }

  // ── Exchange code → tokens ──
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err: any) {
    return redirectToSettings(req, "error", `Token exchange failed: ${err.message}`);
  }
  if (!tokens.refresh_token) {
    return redirectToSettings(
      req,
      "error",
      "No refresh_token returned. Try revoking access at myaccount.google.com and reconnecting."
    );
  }

  // ── Identify the mailbox + grab initial history cursor ──
  let profile;
  try {
    profile = await getProfile(tokens.access_token);
  } catch (err: any) {
    return redirectToSettings(req, "error", `Could not read Gmail profile: ${err.message}`);
  }

  // ── Persist ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error: dbErr } = await supabase
    .from("gmail_oauth_tokens")
    .upsert(
      {
        organization_id: ORG_ID,
        email: profile.emailAddress,
        refresh_token: tokens.refresh_token,
        scopes: GMAIL_SCOPES,
        last_history_id: profile.historyId,
        granted_at: new Date().toISOString(),
        revoked_at: null,
        poll_error: null,
      },
      { onConflict: "organization_id,email" }
    );

  if (dbErr) {
    return redirectToSettings(req, "error", `Could not save token: ${dbErr.message}`);
  }

  const response = redirectToSettings(req, "connected", profile.emailAddress);
  // Clear the CSRF cookie
  response.cookies.set("google_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
}
