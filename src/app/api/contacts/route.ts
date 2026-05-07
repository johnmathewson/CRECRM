/**
 * GET  /api/contacts                    — list (with optional ?q= search)
 * POST /api/contacts                    — create a contact
 *
 * Body for POST: { full_name (required), email?, phone?, company?, role?,
 *                  contact_type?, relationship_type?, warmth?, city?, state?,
 *                  notes?, next_follow_up? (ISO date) }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(req: NextRequest) {
  const sb = svc();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  let query = sb
    .from("contacts")
    .select("id, full_name, email, phone, company_id, role, contact_type, warmth, city, state, last_conversation, next_follow_up")
    .eq("organization_id", ORG_ID)
    .order("full_name", { ascending: true })
    .limit(500);
  if (q) {
    // Simple OR over name + email
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data || [] });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.full_name?.trim()) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 });
  }
  const sb = svc();

  // Resolve or create company by name (optional convenience).
  let companyId: string | null = body.company_id || null;
  if (!companyId && body.company?.trim()) {
    const companyName = body.company.trim();
    const { data: existing } = await sb
      .from("companies")
      .select("id")
      .eq("organization_id", ORG_ID)
      .ilike("name", companyName)
      .maybeSingle();
    if (existing?.id) {
      companyId = existing.id;
    } else {
      const { data: newCo } = await sb
        .from("companies")
        .insert({ organization_id: ORG_ID, name: companyName })
        .select("id")
        .single();
      companyId = newCo?.id ?? null;
    }
  }

  const insertPayload: Record<string, any> = {
    organization_id: ORG_ID,
    full_name: body.full_name.trim(),
  };
  for (const f of ["email", "phone", "role", "contact_type", "relationship_type",
                   "warmth", "city", "state", "notes", "next_follow_up"]) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      insertPayload[f] = body[f];
    }
  }
  if (companyId) insertPayload.company_id = companyId;

  const { data, error } = await sb
    .from("contacts")
    .insert(insertPayload)
    .select("id, full_name, email, phone, contact_type")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data }, { status: 201 });
}
