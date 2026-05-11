/**
 * GET /api/prospector/inbox?status=&lane=&q=
 *
 * Live-refresh endpoint for the Prospector Inbox view. Same shape as
 * the server-side loader; called by the page every 30s while open.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadProspectorInbox, type InboxFilters } from "@/lib/cre-os/prospector-inbox-queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filters: InboxFilters = {
    status: (searchParams.get("status") as InboxFilters["status"]) ?? "all",
    laneId: searchParams.get("lane") || undefined,
    q: searchParams.get("q") || undefined,
    limit: 100,
  };
  try {
    const snapshot = await loadProspectorInbox(filters);
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
