/**
 * GET  /api/admin/documents?property_id=...   — list docs for a property
 * POST /api/admin/documents                    — create metadata row
 *
 * Upload itself happens browser-side via the supabase-js client (uploads
 * to the vault-documents bucket). This endpoint then writes the metadata
 * row that lets the public vault API surface the file.
 *
 * Auth: server-side calls use the anon key. Middleware gates everything
 * outside /api/* — the admin pages live behind it. The public /api/public/*
 * routes are the only intentionally unauthenticated surface; this route
 * is server-internal and not CORS-exposed.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

interface CreateBody {
  property_id: string;
  name: string;
  file_path: string;     // key in vault-documents bucket (set by browser uploader)
  file_type?: string;
  file_size_bytes?: number;
  doc_category: "public" | "tenant" | "buyer";
  description?: string;
  sort_order?: number;
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("property_id");
  if (!propertyId) {
    return NextResponse.json({ error: "property_id required" }, { status: 400 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase
    .from("documents")
    .select("id, name, file_path, file_type, file_size_bytes, doc_category, description, sort_order, created_at")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .is("deleted_at", null)
    .order("doc_category")
    .order("sort_order")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data || [] });
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.property_id || !body.name || !body.file_path || !body.doc_category) {
    return NextResponse.json(
      { error: "property_id, name, file_path, doc_category are required" },
      { status: 400 }
    );
  }
  if (!["public", "tenant", "buyer"].includes(body.doc_category)) {
    return NextResponse.json({ error: "Invalid doc_category" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from("documents")
    .insert({
      organization_id: ORG_ID,
      property_id: body.property_id,
      name: body.name.trim(),
      file_path: body.file_path,
      file_type: body.file_type || null,
      file_size_bytes: body.file_size_bytes || null,
      doc_category: body.doc_category,
      description: body.description || null,
      sort_order: body.sort_order ?? 0,
      uploaded_by: USER_ID,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data }, { status: 201 });
}
