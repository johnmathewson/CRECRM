/**
 * Google OAuth helpers — one-time grant for inquiries@stewardshipcre.com.
 *
 * Flow:
 *   1. /api/auth/google/connect builds an auth URL via buildAuthUrl() and
 *      redirects to Google.
 *   2. User authenticates as inquiries@stewardshipcre.com and grants the
 *      requested scopes.
 *   3. Google redirects back to /api/auth/google/callback?code=...&state=...
 *   4. Callback exchanges the code for { access_token, refresh_token } via
 *      exchangeCodeForTokens(). Refresh token is persisted; access token is
 *      regenerated on demand via refreshAccessToken() (typically 60min TTL).
 *
 * Scopes:
 *   - gmail.modify covers read + send + draft + label management. One scope
 *     beats three. Tighten later if we want least-privilege.
 */

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string; // only returned on first grant (or with prompt=consent)
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

function googleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth env vars missing — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the Google authorization URL. The state parameter prevents CSRF —
 * the caller stores it (e.g. in a cookie) before redirecting and verifies
 * it matches in the callback.
 *
 * `prompt: "consent"` forces Google to issue a refresh_token on every grant.
 * Without it, refresh_tokens only come back the first time a user grants —
 * so re-grants after a revoke would silently fail.
 *
 * `access_type: "offline"` is what makes Google return a refresh_token at all.
 */
export function buildAuthUrl(opts: { state: string; loginHint?: string }): string {
  const { clientId, redirectUri } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
    include_granted_scopes: "true",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = googleClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = googleClientConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {
    // Best-effort revoke. Even if Google is down, we'll still mark our row revoked locally.
  });
}

/** Crypto-safe random hex for OAuth state tokens. */
export function generateState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
