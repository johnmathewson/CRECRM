/**
 * Internal-admin attachment endpoints for seller-net offers.
 *
 *   POST /api/properties/[id]/offers/[offerId]/attachments
 *        multipart/form-data with: file (required), doc_type (optional, default 'loi')
 *        Uploads to the offer-attachments bucket, records metadata.
 *
 *   GET  /api/properties/[id]/offers/[offerId]/attachments
 *        Returns the metadata rows + a fresh signed URL for each file.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "offer-attachments";
const MAX_BYTES = 25 * 1024 * 1024; // 25MB ceiling — covers normal LOIs + a margin
const ALLOWED_DOC_TYPES = ["loi", "addendum", "financing", "other"] as const;
type DocType = (typeof ALLOWED_DOC_TYPES)[number];

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Build a stable storage key — keeps the original filename readable but
 *  prefixes with org/property/offer/uuid so the bucket stays organized
 *  and a re-upload never collides with an existing object. */
function storageKey(offerId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${offerId}/${crypto.randomUUID()}-${safe}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  const sb = svc();
  const { data: rows, error } = await sb
    .from("offer_attachments")
    .select("id, file_name, storage_path, file_size, mime_type, doc_type, uploaded_at, uploaded_via_token_id")
    .eq("organization_id", ORG_ID)
    .eq("offer_id", params.offerId)
    .order("uploaded_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sign each path so the UI can link directly. Short TTL — UI re-fetches
  // when it needs to render again.
  const attachments = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: signed } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 60 * 30); // 30 min
      return { ...r, signed_url: signed?.signedUrl ?? null };
    })
  );
  return NextResponse.json({ attachments });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  const sb = svc();

  // Verify offer belongs to property
  const { data: offer } = await sb
    .from("seller_net_offers")
    .select("id, property_id")
    .eq("id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob) || !file.size) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)}MB limit` },
      { status: 413 }
    );
  }
  const fileName = (file as any).name || "upload";
  const docTypeRaw = String(formData.get("doc_type") ?? "loi");
  const docType: DocType = (ALLOWED_DOC_TYPES as readonly string[]).includes(docTypeRaw)
    ? (docTypeRaw as DocType)
    : "loi";

  const path = storageKey(params.offerId, fileName);

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: row, error: insErr } = await sb
    .from("offer_attachments")
    .insert({
      organization_id: ORG_ID,
      offer_id: params.offerId,
      property_id: params.id,
      file_name: fileName,
      storage_path: path,
      file_size: file.size,
      mime_type: file.type || null,
      doc_type: docType,
    })
    .select()
    .single();

  if (insErr) {
    // Best-effort cleanup of the orphaned upload
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Fresh signed URL so the UI can immediately link/preview
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
  return NextResponse.json({ attachment: { ...row, signed_url: signed?.signedUrl ?? null } }, { status: 201 });
}
