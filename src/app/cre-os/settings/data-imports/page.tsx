import { DataImportsView } from "@/components/cre-os/settings/DataImportsView";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Data imports — drag/drop page for CoStar + PropStream uploads. The
 * gating dependency for the whole Prospector. CoStar gives us the cold
 * universe; PropStream stamps signal flags on top.
 */
export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export default async function DataImportsPage() {
  const sb = createServerSupabase();
  const { data: jobs } = await sb
    .from("import_jobs")
    .select("id, source, source_detail, status, total_records, processed_records, failed_records, started_at, completed_at, created_at")
    .eq("organization_id", ORG_ID)
    .in("source", ["costar", "propstream"])
    .order("created_at", { ascending: false })
    .limit(20);

  return <DataImportsView jobs={(jobs ?? []) as Array<Record<string, unknown>>} />;
}
