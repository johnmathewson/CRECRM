/**
 * GET /api/lane-touches/[id] — full detail of a single touch (used by the
 * inbox detail panel to fetch the full body lazily).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadTouchDetail } from "@/lib/cre-os/prospector-inbox-queries";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const touch = await loadTouchDetail(params.id);
  if (!touch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ touch });
}
