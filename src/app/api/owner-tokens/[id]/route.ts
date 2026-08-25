/**
 * DELETE /api/owner-tokens/[id]   — revoke a magic link
 */

import { NextRequest, NextResponse } from "next/server";
import { ORG_ID } from "@/lib/owner-dashboard";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/require-staff";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Staff-only: middleware does not cover /api (see require-staff.ts).
  const denied = await requireStaff();
  if (denied) return denied;

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("owner_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", ORG_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
