/**
 * POST /api/leads/[id]/promote
 *
 * Convert a lead into a deal. Creates a deal row + Lead-stage transition,
 * links it back to the lead, and marks the lead as promoted.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = svc();
  const id = params.id;

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select(`
      *,
      property:properties(id, name, asking_price, lease_rate, asset_type),
      contact:contacts(id, full_name)
    `)
    .eq("id", id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (leadErr || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (lead.linked_deal_id) {
    return NextResponse.json(
      { error: "Lead is already promoted to a deal", deal_id: lead.linked_deal_id },
      { status: 409 }
    );
  }

  const property = (lead as any).property;
  const contact = (lead as any).contact;

  // Build a sensible deal name + type from the matched property + lead intent
  const dealType =
    lead.intent === "buy" || lead.intent === "sell" ? "sale" : lead.intent === "lease" ? "lease" : "sale";
  const dealName = property?.name
    ? `${property.name} — ${contact?.full_name || lead.sender_name || "Inbound prospect"}`
    : `${lead.sender_name || lead.sender_email || "Inbound lead"} (${lead.property_label || "no property"})`;

  // Pull a price from the property if present
  const price =
    dealType === "sale"
      ? property?.asking_price ?? null
      : property?.lease_rate ?? null;

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      organization_id: ORG_ID,
      property_id: property?.id || lead.property_id || null,
      lead_id: lead.id,
      client_contact_id: contact?.id || lead.contact_id || null,
      deal_type: dealType,
      deal_name: dealName,
      price,
      probability_pct: 25, // default starting probability for a fresh lead
      assigned_to: USER_ID,
    })
    .select()
    .single();

  if (dealErr || !deal) {
    return NextResponse.json(
      { error: `Deal create failed: ${dealErr?.message}` },
      { status: 500 }
    );
  }

  // First stage transition: enter at "Lead"
  await supabase.from("deal_stages").insert({
    deal_id: deal.id,
    stage: "Lead",
    entered_at: new Date().toISOString(),
    entered_by: USER_ID,
    notes: `Promoted from lead ${lead.id}`,
  });

  // Link the deal back to the lead + flip status
  await supabase
    .from("leads")
    .update({
      linked_deal_id: deal.id,
      status: "promoted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await supabase.from("lead_events").insert({
    organization_id: ORG_ID,
    lead_id: id,
    event_type: "promoted_to_deal",
    actor: "user",
    summary: `John promoted to deal — "${dealName}"`,
    metadata: { deal_id: deal.id, deal_name: dealName, deal_type: dealType, price },
  });

  return NextResponse.json({ deal });
}
