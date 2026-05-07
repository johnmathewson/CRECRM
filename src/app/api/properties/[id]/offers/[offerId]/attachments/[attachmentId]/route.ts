/**
 * DELETE /api/properties/[id]/offers/[offerId]/attachments/[attachmentId]
 *
 * Removes both the metadata row AND the underlying storage object. If the
 * storage delete fails (rare), the metadata row stays in place so we don't
 * lose the audit trail — caller can retry.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "offer-attachments";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; offerId: string; attachmentId: string } }
) {
  const sb = svc();
  const { data: row } = await sb
    .from("offer_attachments")
    .select("id, storage_path")
    .eq("id", params.attachmentId)
    .eq("offer_id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  // Storage object first; if it fails, abort so we don't orphan the file.
  const { error: storeErr } = await sb.storage.from(BUCKET).remove([row.storage_path]);
  if (storeErr) {
    return NextResponse.json({ error: `Storage delete failed: ${storeErr.message}` }, { status: 500 });
  }
  const { error } = await sb.from("offer_attachments").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
