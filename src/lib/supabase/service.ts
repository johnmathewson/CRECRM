/**
 * Server-only Supabase client using the service-role key.
 *
 * Mirrors sag-crm's `makeSagSupabase()`. Use this in API route handlers and
 * server-side lib code that needs to read or write tables whose anon policies
 * have been dropped (`gmail_oauth_tokens`, `extension_api_keys`,
 * `owner_access_tokens`).
 *
 * SECURITY: the service-role key bypasses RLS entirely. A route using this
 * client MUST enforce its own caller check first — `requireStaff()` for
 * in-app admin routes, or the route's own capability check (cron secret,
 * extension API key, owner capability token).
 *
 * NEVER import this from a client component. It throws rather than silently
 * falling back to the anon key, so a missing env var fails loudly at runtime
 * instead of quietly degrading to a weaker identity.
 */

import { createClient } from "@supabase/supabase-js";

export function createServiceSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for credential-table access"
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
