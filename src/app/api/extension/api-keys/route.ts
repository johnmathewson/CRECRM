/**
 * GET  /api/extension/api-keys  — list (id + last_used_at + label only; key value never returned again)
 * POST /api/extension/api-keys  — generate a new key. Plaintext returned ONCE in the response; only the hash is stored.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, generateToken, hashSecret } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase
    .from("extension_api_keys")
    .select("id, label, created_at, last_used_at, revoked_at")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data || [] });
}

export async function POST(req: NextRequest) {
  let body: { label?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const plaintext = generateToken(32);
  const keyHash = hashSecret(plaintext);

  const { data, error } = await supabase
    .from("extension_api_keys")
    .insert({
      organization_id: ORG_ID,
      key_hash: keyHash,
      label: body.label || `Chrome extension (${new Date().toLocaleDateString()})`,
    })
    .select("id, label, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      key: data,
      // Plaintext shown ONCE — caller must save it. We never store or return it again.
      api_key: plaintext,
      message:
        "Save this key now — it will never be shown again. Paste it into the Stewardship Chrome extension's options page.",
    },
    { status: 201 }
  );
}
