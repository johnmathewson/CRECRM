/**
 * GET  /api/properties/[id]/documents
 *      List non-deleted documents on this property + signed URLs (30-min TTL).
 *
 * POST /api/properties/[id]/documents
 *      multipart/form-data: file (required), description (optional)
 *      Uploads to vault-documents bucket, creates documents row.
 *
 * Single-document delete lives at /[docId]/route.ts (soft delete via
 * deleted_at — preserves history).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "vault-documents";
const MAX_BYTES = 50 * 1024 * 1024; // 50MB — bigger ceiling than offer attachments since OMs can be chunky

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Storage key — namespaced by property so the bucket stays organized. */
function storageKey(propertyId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `properties/${propertyId}/${crypto.randomUUID()}-${safe}`;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = svc();
  const { data: rows, error } = await sb
    .from("documents")
    .select("id, name, description, file_path, file_type, file_size_bytes, doc_category, created_at, updated_at, uploaded_by")
    .eq("organization_id", ORG_ID)
    .eq("property_id", params.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const documents = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: signed } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(r.file_path, 60 * 30); // 30 min — fresh on each render
      return { ...r, signed_url: signed?.signedUrl ?? null };
    })
  );
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = svc();

  // Verify property belongs to org
  const { data: prop } = await sb
    .from("properties")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 }); }

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
  const description = String(formData.get("description") ?? "").trim() || null;

  const path = storageKey(params.id, fileName);

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: row, error: insErr } = await sb
    .from("documents")
    .insert({
      organization_id: ORG_ID,
      property_id: params.id,
      name: fileName,
      file_path: path,
      file_type: file.type || null,
      file_size_bytes: file.size,
      description,
      // doc_category left null — that field is for public-vault visibility
      // (public/tenant/buyer). Internal uploads don't need it set.
    })
    .select()
    .single();

  if (insErr) {
    // Best-effort cleanup of the orphaned upload
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Return with signed URL so UI can immediately link
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 30);
  return NextResponse.json(
    { document: { ...row, signed_url: signed?.signedUrl ?? null } },
    { status: 201 }
  );
}
