import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "./server";

/**
 * Storage clients for server routes.
 *
 * The private buckets (vault-documents, nda-pdfs, offer-attachments) are
 * RLS-protected. The anon key can't write to them — which is why the CRM's
 * document upload failed with "new row violates row-level security policy"
 * — and it should not be able to READ them either (an anon-read policy on
 * vault-documents meant anyone with the public key could list every OM and
 * rent roll; that policy is dropped once the service key is in place).
 *
 *   createAdminClient()   — service role (SUPABASE_SERVICE_ROLE_KEY).
 *                           Bypasses RLS. Server-only. Null when unset.
 *   createStorageClient() — the right client for a storage call from a
 *                           route: service role when configured, else the
 *                           caller's own session (role `authenticated`,
 *                           which the bucket policies allow), else anon.
 *
 * Never import this from a client component.
 */
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function createStorageClient(): Promise<{ client: SupabaseClient; role: "service" | "session" | "anon" }> {
  const admin = createAdminClient();
  if (admin) return { client: admin, role: "service" };
  const session = createServerSupabase();
  const { data: { user } } = await session.auth.getUser();
  if (user) return { client: session, role: "session" };
  return {
    client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!),
    role: "anon",
  };
}
