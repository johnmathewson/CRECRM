/**
 * DELETE /api/admin/documents/[id]
 *
 * Soft-deletes a document (sets deleted_at). Underlying blob in
 * vault-documents bucket stays — the storage cleanup happens out-of-band
 * if/when needed. Soft delete preserves audit history (vault_access_logs
 * still references the doc_id).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", ORG_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
