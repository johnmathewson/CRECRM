/**
 * GET  /api/owner-tokens               — list active tokens
 * POST /api/owner-tokens                — create a new magic link
 *
 * In-app only (middleware gates everything outside /api/*; admin pages live
 * behind it).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, generateToken } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRY_DAYS = 90;

interface CreateBody {
  property_ids: string[];
  owner_contact_id?: string | null;
  label?: string;
  expires_in_days?: number;
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase
    .from("owner_access_tokens")
    .select(`
      id, token, label, property_ids, expires_at, last_viewed_at, created_at, revoked_at,
      owner:contacts(id, full_name, email)
    `)
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data || [] });
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.property_ids) || body.property_ids.length === 0) {
    return NextResponse.json({ error: "property_ids required (non-empty array)" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const days = Math.max(1, Math.min(365, body.expires_in_days || DEFAULT_EXPIRY_DAYS));
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Verify all property_ids belong to org (defense in depth — RLS would catch but explicit is friendlier)
  const { data: foundProps } = await supabase
    .from("properties")
    .select("id, name, headline")
    .eq("organization_id", ORG_ID)
    .in("id", body.property_ids);

  if (!foundProps || foundProps.length === 0) {
    return NextResponse.json({ error: "No matching properties found" }, { status: 404 });
  }

  const validIds = foundProps.map((p: any) => p.id);
  const labelGuess =
    body.label?.trim() ||
    (foundProps.length === 1
      ? `Owner — ${foundProps[0].headline || foundProps[0].name}`
      : `Owner — ${foundProps.length} listings`);

  const token = generateToken();
  const { data, error } = await supabase
    .from("owner_access_tokens")
    .insert({
      organization_id: ORG_ID,
      token,
      owner_contact_id: body.owner_contact_id || null,
      property_ids: validIds,
      label: labelGuess,
      expires_at: expiresAt,
    })
    .select("id, token, label, property_ids, expires_at, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const marketingBase = process.env.NEXT_PUBLIC_MARKETING_URL || "https://stewardshipcre.com";
  return NextResponse.json({
    token: data,
    url: `${marketingBase}/owner/${token}`,
  });
}
