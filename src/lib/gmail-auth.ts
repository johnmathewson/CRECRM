/**
 * Get an active Gmail access token for the org's connected mailbox.
 * Wraps the refresh-token dance so callers don't think about it.
 *
 * Returns null if no active connection exists. Callers should treat that
 * as "Gmail not configured yet."
 */

import { refreshAccessToken } from "./google-oauth";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface ActiveGmailToken {
  rowId: string;
  email: string;
  accessToken: string;
  expiresAt: number; // ms epoch
  refreshToken: string;
  lastHistoryId: string | null;
}

export async function getActiveGmailToken(supabase: any): Promise<ActiveGmailToken | null> {
  const { data, error } = await supabase
    .from("gmail_oauth_tokens")
    .select("id, email, refresh_token, last_history_id")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  let tokens;
  try {
    tokens = await refreshAccessToken(data.refresh_token);
  } catch (err: any) {
    // Mark the connection broken so the UI can prompt re-auth.
    await supabase
      .from("gmail_oauth_tokens")
      .update({ poll_error: `Refresh failed: ${err.message}` })
      .eq("id", data.id);
    throw err;
  }

  return {
    rowId: data.id,
    email: data.email,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in - 30) * 1000, // 30s safety
    refreshToken: data.refresh_token,
    lastHistoryId: data.last_history_id,
  };
}
