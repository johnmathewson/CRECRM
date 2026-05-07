/**
 * Token-gated attachment ops. Owner-portal callers can:
 *
 *   POST   — upload a file to one of their offers
 *   GET    — list attachments + fresh signed URLs
 *
 * The dashboard payload also embeds attachments; this endpoint is for
 * direct calls (and refresh after upload).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

const BUCKET = "offer-attachments";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_DOC_TYPES = ["loi", "addendum", "financing", "other"] as const;
type DocType = (typeof ALLOWED_DOC_TYPES)[number];

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function authorize(sb: any, token: string, offerId: string, origin: string | null) {
  const { data: tokenRow } = await sb
    .from("owner_access_tokens")
    .select("id, property_ids, expires_at, revoked_at")
    .eq("token", token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!tokenRow || tokenRow.revoked_at) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid or revoked link" }, { status: 401, headers: corsHeaders(origin) }),
    };
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Link expired" }, { status: 401, headers: corsHeaders(origin) }),
    };
  }
  const { data: offer } = await sb
    .from("seller_net_offers")
    .select("id, property_id, published_at")
    .eq("id", offerId)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!offer) {
    return { ok: false as const, response: NextResponse.json({ error: "Offer not found" }, { status: 404, headers: corsHeaders(origin) }) };
  }
  if (!(tokenRow.property_ids ?? []).includes(offer.property_id)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders(origin) }) };
  }
  return { ok: true as const, tokenRow, offer };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string; offerId: string } }
) {
  const origin = req.headers.get("origin");
  const sb = svc();
  const auth = await authorize(sb, params.token, params.offerId, origin);
  if (!auth.ok) return auth.response;

  const { data: rows, error } = await sb
    .from("offer_attachments")
    .select("id, file_name, storage_path, file_size, mime_type, doc_type, uploaded_at")
    .eq("organization_id", ORG_ID)
    .eq("offer_id", params.offerId)
    .order("uploaded_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });

  const attachments = await Promise.all(
    (rows ?? []).map(async (r: any) => {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(r.storage_path, 60 * 30);
      return { ...r, signed_url: signed?.signedUrl ?? null };
    })
  );
  return NextResponse.json({ attachments }, { headers: corsHeaders(origin) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; offerId: string } }
) {
  const origin = req.headers.get("origin");
  const sb = svc();
  const auth = await authorize(sb, params.token, params.offerId, origin);
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400, headers: corsHeaders(origin) }); }

  const file = formData.get("file");
  if (!(file instanceof Blob) || !file.size) {
    return NextResponse.json({ error: "file is required" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)}MB limit` }, { status: 413, headers: corsHeaders(origin) });
  }
  const fileName = (file as any).name || "upload";
  const docTypeRaw = String(formData.get("doc_type") ?? "loi");
  const docType: DocType = (ALLOWED_DOC_TYPES as readonly string[]).includes(docTypeRaw)
    ? (docTypeRaw as DocType)
    : "loi";

  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const path = `${params.offerId}/${crypto.randomUUID()}-${safe}`;

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500, headers: corsHeaders(origin) });

  const { data: row, error: insErr } = await sb
    .from("offer_attachments")
    .insert({
      organization_id: ORG_ID,
      offer_id: params.offerId,
      property_id: auth.offer.property_id,
      uploaded_via_token_id: auth.tokenRow.id,
      file_name: fileName,
      storage_path: path,
      file_size: file.size,
      mime_type: file.type || null,
      doc_type: docType,
    })
    .select()
    .single();

  if (insErr) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: insErr.message }, { status: 500, headers: corsHeaders(origin) });
  }

  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
  return NextResponse.json(
    { attachment: { ...row, signed_url: signed?.signedUrl ?? null } },
    { status: 201, headers: corsHeaders(origin) }
  );
}
