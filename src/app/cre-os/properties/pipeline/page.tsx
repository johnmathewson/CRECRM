import { createClient } from "@supabase/supabase-js";
import { PropertyPipelineView } from "@/components/cre-os/property/PropertyPipelineView";

/**
 * Property pipeline kanban. Different from /cre-os/pipeline (which
 * is DEAL-shaped) — this view groups PROPERTIES by their
 * pipeline_stage so John sees the lifecycle of his asset book:
 *
 *   Lead → Prospecting → Pitched → Listing → Under Contract → Closed
 *
 * Loading is a single org-scoped property pull, grouped + sorted on
 * the server so the client just renders columns.
 */

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

export interface PipelinePropertyCard {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  asset_type: string | null;
  status: string | null;
  pipeline_stage: string | null;
  your_role: string | null;
  asking_price: number | null;
  sqft: number | null;
  cap_rate: number | null;
  listed_at: string | null;
  prospecting_started_at: string | null;
  pitched_at: string | null;
  under_contract_at: string | null;
  updated_at: string | null;
  daysInStage: number | null;
}

export interface PipelineColumn {
  key: string;
  label: string;
  description: string;
  tone: "neutral" | "amber" | "coral" | "teal";
  cards: PipelinePropertyCard[];
}

const COLUMN_ORDER: Array<{ key: string; label: string; statuses: string[]; description: string; tone: PipelineColumn["tone"] }> = [
  {
    key: "lead",
    label: "Lead",
    statuses: ["prospect", "idea"],
    description: "Observed but not pursued yet — the assessor / public-record load lives here.",
    tone: "neutral",
  },
  {
    key: "prospecting",
    label: "Prospecting",
    statuses: ["prospecting"],
    description: "Actively pursuing — owner research, BOV in progress, outreach started.",
    tone: "amber",
  },
  {
    key: "pitched",
    label: "Pitched",
    statuses: ["pitched"],
    description: "BOV / proposal presented to the owner. Waiting on the listing agreement.",
    tone: "amber",
  },
  {
    key: "listing",
    label: "Listing",
    statuses: ["listed"],
    description: "Signed and active — public marketing live, buyer outreach open.",
    tone: "coral",
  },
  {
    key: "under_contract",
    label: "Under Contract",
    statuses: ["under_contract"],
    description: "Offer accepted, due-diligence + financing underway.",
    tone: "teal",
  },
  {
    key: "closed",
    label: "Closed",
    statuses: ["sold", "leased"],
    description: "Sale closed or lease executed.",
    tone: "teal",
  },
];

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

async function loadPropertyPipeline(): Promise<PipelineColumn[]> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load all properties that have made it past raw "lead" state PLUS
  // a sample of leads so the kanban first column isn't empty. The
  // raw 15k prospects would crush the page if we loaded them all,
  // so we cap leads at the 20 most recently updated.
  const { data: nonLeads } = await sb
    .from("properties")
    .select(
      "id, slug, name, address, city, state, asset_type, status, pipeline_stage, your_role, " +
        "asking_price, sqft, cap_rate, listed_at, prospecting_started_at, pitched_at, " +
        "under_contract_at, updated_at"
    )
    .eq("organization_id", ORG_ID)
    .or("is_dead.is.null,is_dead.eq.false")
    .not("status", "in", "(prospect,idea)")
    .order("updated_at", { ascending: false })
    .limit(200);

  const { data: leads } = await sb
    .from("properties")
    .select(
      "id, slug, name, address, city, state, asset_type, status, pipeline_stage, your_role, " +
        "asking_price, sqft, cap_rate, listed_at, prospecting_started_at, pitched_at, " +
        "under_contract_at, updated_at"
    )
    .eq("organization_id", ORG_ID)
    .or("is_dead.is.null,is_dead.eq.false")
    .in("status", ["prospect", "idea"])
    .not("your_role", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows = ([...(nonLeads ?? []), ...(leads ?? [])] as any[]).map((r) => {
    // Days-in-stage uses the matching *_at stamp; falls back to updated_at.
    let stampedAt: string | null = null;
    switch (r.status) {
      case "prospecting": stampedAt = r.prospecting_started_at ?? r.updated_at; break;
      case "pitched":     stampedAt = r.pitched_at ?? r.updated_at; break;
      case "listed":      stampedAt = r.listed_at ?? r.updated_at; break;
      case "under_contract": stampedAt = r.under_contract_at ?? r.updated_at; break;
      default:            stampedAt = r.updated_at;
    }
    return {
      ...(r as PipelinePropertyCard),
      daysInStage: daysSince(stampedAt),
    };
  });

  return COLUMN_ORDER.map((col) => ({
    key: col.key,
    label: col.label,
    description: col.description,
    tone: col.tone,
    cards: allRows
      .filter((r) => col.statuses.includes(r.status ?? ""))
      .sort((a, b) => {
        const ay = a.asking_price ?? 0;
        const by = b.asking_price ?? 0;
        return by - ay;
      }),
  }));
}

export default async function PropertyPipelinePage() {
  const columns = await loadPropertyPipeline();
  return <PropertyPipelineView columns={columns} />;
}
