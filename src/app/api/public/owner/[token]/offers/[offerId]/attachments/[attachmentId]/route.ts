/**
 * DELETE /api/public/owner/[token]/offers/[offerId]/attachments/[attachmentId]
 *
 * Owner-portal delete. Same shape as the internal admin delete — verifies
 * the token has access to the property the offer belongs to before
 * removing the storage object + metadata row.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

const BUCKET = "offer-attachments";

const ALLOWED_ORIGINS = [
  "https://stewardshipcre.com",
  "https://www.stewardshipcre.com",
  "http://localhost:3000",
  "http://localhost:3001",
];
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string; offerId: string; attachmentId: string } }
) {
  const origin = req.headers.get("origin");
  const sb = svc();

  const { data: tokenRow } = await sb
    .from("owner_access_tokens")
    .select("id, property_ids, expires_at, revoked_at")
    .eq("token", params.token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!tokenRow || tokenRow.revoked_at) {
    return NextResponse.json({ error: "Invalid or revoked link" }, { status: 401, headers: corsHeaders(origin) });
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Link expired" }, { status: 401, headers: corsHeaders(origin) });
  }

  const { data: row } = await sb
    .from("offer_attachments")
    .select("id, storage_path, property_id")
    .eq("id", params.attachmentId)
    .eq("offer_id", params.offerId)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (!(tokenRow.property_ids ?? []).includes(row.property_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders(origin) });
  }

  const { error: storeErr } = await sb.storage.from(BUCKET).remove([row.storage_path]);
  if (storeErr) {
    return NextResponse.json({ error: `Storage delete failed: ${storeErr.message}` }, { status: 500, headers: corsHeaders(origin) });
  }
  const { error } = await sb.from("offer_attachments").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });
  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) });
}
