/**
 * POST /api/leads/crexi-report
 *
 * Parse a Crexi daily Lead Report XLSX attachment from Gmail and upsert
 * every lead into crexi_leads_state, attached to the matching property.
 *
 * Body:
 *   { gmail_message_id: string, dryRun?: boolean }
 *
 * Flow:
 *   1. Fetch message via Gmail OAuth token
 *   2. Find the .xlsx attachment
 *   3. Decode + parse with parseCrexiReport()
 *   4. Match property by (a) Detail-sheet address, then (b) name
 *   5. Upsert leads (dedupe by email + property_id; fall back to name + phone)
 *   6. Write an import_jobs audit row
 *
 * Called by:
 *   • Manual trigger via this endpoint (for backfilling old emails)
 *   • Automatic detection in poll-gmail (filename matches "Lead Report - *.xlsx")
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { parseCrexiReport, type CrexiLead } from "@/lib/cre-os/parse-crexi-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAttachmentBuffer(accessToken: string, messageId: string): Promise<{ filename: string; buf: Buffer } | null> {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error(`Gmail message fetch failed: ${msgRes.status}`);
  const msg = await msgRes.json();

  // Walk parts to find first .xlsx attachment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function find(part: any): { filename: string; attachmentId: string } | null {
    if (part?.filename?.endsWith(".xlsx") && part.body?.attachmentId) {
      return { filename: part.filename, attachmentId: part.body.attachmentId };
    }
    if (part?.parts) {
      for (const p of part.parts) {
        const hit = find(p);
        if (hit) return hit;
      }
    }
    return null;
  }
  const hit = find(msg.payload);
  if (!hit) return null;

  const attRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${hit.attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!attRes.ok) throw new Error(`Attachment fetch failed: ${attRes.status}`);
  const att = await attRes.json();
  const data: string = att.data || "";
  const buf = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return { filename: hit.filename, buf };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchProperty(supabase: any, parsed: { propertyName: string | null; propertyAddress: string | null }, filename: string): Promise<{ id: string; name: string } | null> {
  // Strategy 1: address from Detail sheet (most reliable)
  // The address comes through as "7880-7896 Broadway, Merrillville, Lake, IN 46410"
  // Try to match against properties.address with prefix matching.
  if (parsed.propertyAddress) {
    const streetPart = parsed.propertyAddress.split(",")[0]?.trim();
    if (streetPart) {
      // Try exact-ish street match first
      const { data } = await supabase
        .from("properties")
        .select("id, name, address")
        .eq("organization_id", ORG_ID)
        .ilike("address", `${streetPart}%`)
        .limit(5);
      if (data && data.length > 0) {
        // Prefer the warm one (not status='prospect')
        const warm = data.find((p: { id: string; name: string; address: string }) => true);
        return { id: warm.id as string, name: warm.name as string };
      }
    }
  }

  // Strategy 2: name match from Detail sheet or filename
  const candidates = [
    parsed.propertyName,
    filename.replace(/^Lead Report - /, "").replace(/\.xlsx$/, ""),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    // Strip common suffix words ("Retail Center", "Hotel") for fuzzier match
    const variants = new Set<string>([
      candidate,
      candidate.replace(/\s+(Retail Center|Office Building|Industrial Park|Shopping Center)$/i, ""),
      candidate.replace(/\s+Hotel$/i, ""),
      candidate.replace(/\s+by Wyndham.*$/i, ""),
    ]);

    for (const v of Array.from(variants)) {
      const { data } = await supabase
        .from("properties")
        .select("id, name")
        .eq("organization_id", ORG_ID)
        .ilike("name", `${v}%`)
        .limit(5);
      if (data && data.length > 0) {
        return { id: data[0].id as string, name: data[0].name as string };
      }
    }
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertLead(supabase: any, propertyId: string, lead: CrexiLead): Promise<"inserted" | "updated" | "skipped"> {
  // Match by (property_id, email) primarily; fall back to (property_id, name)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (lead.email) {
    const { data } = await supabase
      .from("crexi_leads_state")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .eq("email", lead.email)
      .maybeSingle();
    existing = data;
  }
  if (!existing && lead.fullName) {
    const { data } = await supabase
      .from("crexi_leads_state")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .eq("name", lead.fullName)
      .maybeSingle();
    existing = data;
  }

  const payload = {
    organization_id: ORG_ID,
    property_id: propertyId,
    name: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    role: lead.industryRole,
    level_of_interest: lead.levelOfInterest,
    number_of_visits: lead.numberOfVisits,
    last_activity_date: lead.activityDate,
    last_seen_at: new Date().toISOString(),
    raw_panel: lead.raw,
  };

  if (existing) {
    const { error } = await supabase
      .from("crexi_leads_state")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return "skipped";
    return "updated";
  } else {
    const { error } = await supabase.from("crexi_leads_state").insert({
      ...payload,
      first_seen_at: new Date().toISOString(),
    });
    if (error) return "skipped";
    return "inserted";
  }
}

export async function POST(req: NextRequest) {
  let body: { gmail_message_id?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.gmail_message_id) {
    return NextResponse.json({ error: "gmail_message_id required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const token = await getActiveGmailToken(supabase);
  if (!token) return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });

  // Open audit job
  let jobId: string | null = null;
  if (!body.dryRun) {
    const { data: job } = await supabase
      .from("import_jobs")
      .insert({
        organization_id: ORG_ID,
        source: "crexi_lead_report",
        source_detail: `gmail:${body.gmail_message_id}`,
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    jobId = job?.id ?? null;
  }

  try {
    const attachment = await fetchAttachmentBuffer(token.accessToken, body.gmail_message_id);
    if (!attachment) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no xlsx attachment" }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({ error: "No .xlsx attachment found on this message" }, { status: 404 });
    }

    const parsed = parseCrexiReport(attachment.buf);
    if (parsed.leads.length === 0) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no leads parsed", warnings: parsed.warnings }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({
        ok: false,
        error: "Parser ran but produced 0 leads",
        parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress, warnings: parsed.warnings },
      });
    }

    const propMatch = await matchProperty(supabase, parsed, attachment.filename);
    if (!propMatch) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no property match", parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress } }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({
        ok: false,
        error: "Could not match a property",
        parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress, leadCount: parsed.leads.length },
      });
    }

    let inserted = 0, updated = 0, skipped = 0;
    if (!body.dryRun) {
      for (const lead of parsed.leads) {
        const r = await upsertLead(supabase, propMatch.id, lead);
        if (r === "inserted") inserted++;
        else if (r === "updated") updated++;
        else skipped++;
      }
    } else {
      inserted = parsed.leads.length;
    }

    if (jobId) {
      await supabase.from("import_jobs").update({
        status: "completed",
        total_records: parsed.leads.length,
        processed_records: inserted + updated,
        failed_records: skipped,
        completed_at: new Date().toISOString(),
        error_log: {
          property: propMatch,
          activity: parsed.activity,
          warnings: parsed.warnings,
        },
      }).eq("id", jobId);
    }

    return NextResponse.json({
      ok: true,
      dryRun: !!body.dryRun,
      property: propMatch,
      activity: parsed.activity,
      lead_count: parsed.leads.length,
      inserted,
      updated,
      skipped,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: msg }, completed_at: new Date().toISOString() }).eq("id", jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
