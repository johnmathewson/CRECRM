/**
 * DELETE /api/properties/[id]/documents/[docId]
 *
 * Soft-delete: stamps deleted_at. Preserves the audit trail and the
 * storage object (so we can recover later). A future "permanent delete"
 * would be a separate admin action that also removes the storage file.
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const sb = svc();
  const { error } = await sb
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.docId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
