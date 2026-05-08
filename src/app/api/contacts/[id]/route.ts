/**
 * GET   /api/contacts/[id]  — full row + company name (joined)
 * PATCH /api/contacts/[id]  — partial update of any whitelisted column.
 *
 * Used by the EditContactDialog on the contact workspace. Company name
 * passed as `company` (string) gets resolved to or auto-created as a
 * companies row, mirroring the create endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Whitelist mirrors what the create endpoint accepts + a few legacy
// columns the broker might already have set via the old UI.
const PATCHABLE_FIELDS = new Set([
  "full_name", "email", "phone", "role", "contact_type",
  "relationship_type", "warmth", "city", "state", "notes",
  "next_follow_up", "last_conversation", "company_id",
]);

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = svc();
  const { data, error } = await sb
    .from("contacts")
    .select(`
      id, full_name, email, phone, role, contact_type, relationship_type,
      warmth, city, state, notes, next_follow_up, last_conversation,
      company_id,
      company:companies(id, name)
    `)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Flatten the joined company so the client only has to read one shape.
  const co = Array.isArray((data as any).company) ? (data as any).company[0] : (data as any).company;
  return NextResponse.json({
    contact: { ...data, company_name: co?.name ?? null },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const sb = svc();

  // Resolve `company` (a string name) to a company_id — find or create.
  // Caller can also pass company_id directly, or null/empty to clear.
  if ("company" in body && !("company_id" in body)) {
    const raw = (body.company ?? "") as string;
    const companyName = raw.trim();
    if (companyName === "") {
      body.company_id = null;
    } else {
      const { data: existing } = await sb
        .from("companies")
        .select("id")
        .eq("organization_id", ORG_ID)
        .ilike("name", companyName)
        .maybeSingle();
      if (existing?.id) {
        body.company_id = existing.id;
      } else {
        const { data: newCo, error: coErr } = await sb
          .from("companies")
          .insert({ organization_id: ORG_ID, name: companyName })
          .select("id")
          .single();
        if (coErr || !newCo) {
          return NextResponse.json({ error: `Company create failed: ${coErr?.message}` }, { status: 500 });
        }
        body.company_id = newCo.id;
      }
    }
    delete body.company;
  }

  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) {
      // Coerce empty strings to null so cleared inputs actually clear.
      update[k] = v === "" ? null : v;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // full_name has a NOT NULL constraint — refuse to clear it.
  if ("full_name" in update && (update.full_name === null || String(update.full_name).trim() === "")) {
    return NextResponse.json({ error: "full_name cannot be empty" }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from("contacts")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
