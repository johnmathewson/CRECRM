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

/**
 * The PRIMARY mailbox: the one the inbound-lead pipeline polls and the one
 * all sends go out from. Pinned (not "newest grant") so that connecting a
 * second account for sent-sync — e.g. john@ — can never silently steal
 * inbound polling or flip the send identity. Override via env if the
 * primary ever changes.
 */
const PRIMARY_MAILBOX = (process.env.GMAIL_PRIMARY_MAILBOX ?? "inquiries@stewardshipcre.com").toLowerCase();

interface TokenRow {
  id: string;
  email: string;
  refresh_token: string;
  last_history_id: string | null;
}

async function activeTokenRows(supabase: any): Promise<TokenRow[]> {
  const { data, error } = await supabase
    .from("gmail_oauth_tokens")
    .select("id, email, refresh_token, last_history_id")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  if (error || !data) return [];
  return data as TokenRow[];
}

async function refreshRow(supabase: any, row: TokenRow): Promise<ActiveGmailToken> {
  let tokens;
  try {
    tokens = await refreshAccessToken(row.refresh_token);
  } catch (err: any) {
    // Mark the connection broken so the UI can prompt re-auth.
    await supabase
      .from("gmail_oauth_tokens")
      .update({ poll_error: `Refresh failed: ${err.message}` })
      .eq("id", row.id);
    throw err;
  }
  return {
    rowId: row.id,
    email: row.email,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in - 30) * 1000, // 30s safety
    refreshToken: row.refresh_token,
    lastHistoryId: row.last_history_id,
  };
}

export async function getActiveGmailToken(supabase: any): Promise<ActiveGmailToken | null> {
  const rows = await activeTokenRows(supabase);
  if (rows.length === 0) return null;
  const primary = rows.find((r) => r.email.toLowerCase() === PRIMARY_MAILBOX) ?? rows[0];
  return refreshRow(supabase, primary);
}

/**
 * Every active connection, refreshed. Accounts whose refresh fails are
 * skipped (and marked broken) rather than sinking the whole batch — used
 * by multi-mailbox jobs like SENT-sync where partial coverage beats none.
 */
export async function getActiveGmailTokens(supabase: any): Promise<ActiveGmailToken[]> {
  const rows = await activeTokenRows(supabase);
  const out: ActiveGmailToken[] = [];
  for (const row of rows) {
    try {
      out.push(await refreshRow(supabase, row));
    } catch (err) {
      console.error(`[gmail-auth] refresh failed for ${row.email}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
