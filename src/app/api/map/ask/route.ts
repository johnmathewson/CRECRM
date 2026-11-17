/**
 * POST /api/map/ask
 *
 * "Ask about this parcel" from the parcel map. Requires a registration
 * session (so the person is already a CRM contact), then hands the message
 * to the universal lead intake (/api/leads/intake, source=website) so it
 * gets qualified, drafted, threaded and surfaced exactly like any other
 * inbound inquiry.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readSession } from "@/lib/parcel-map/session";
import { synthExternalId } from "@/lib/cre-os/record-touch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  pid: string;
  address?: string | null;
  zoning?: string | null;
  acres?: number | null;
  owner?: string | null;
  message: string;
}

export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "Please register first." }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!body.pid || message.length < 5) return NextResponse.json({ error: "Please write a short message." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: contact } = await sb
    .from("contacts")
    .select("id, full_name, email, phone")
    .eq("id", session.contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Registration not found. Please register again." }, { status: 401 });

  const label = body.address || body.pid;
  const facts = [
    `Parcel: ${body.pid}`,
    body.address ? `Address: ${body.address}, Hobart IN` : null,
    body.zoning ? `Zoning: ${body.zoning}` : null,
    body.acres != null ? `Lot: ${body.acres} ac` : null,
    body.owner ? `Deeded owner (county record): ${body.owner}` : null,
  ].filter(Boolean).join("\n");

  const payload = {
    source: "website",
    sender_name: contact.full_name,
    sender_email: contact.email,
    sender_phone: contact.phone,
    raw_subject: `Parcel map inquiry: ${label}`,
    raw_body: `${message}\n\n— Sent from the Hobart parcel map —\n${facts}`,
    source_message_id: synthExternalId(["parcel_map_ask", contact.id, body.pid, String(Date.now())]),
    raw_payload: { via: "parcel_map", pid: body.pid, address: body.address ?? null, contact_id: contact.id },
  };

  const r = await fetch(`${req.nextUrl.origin}/api/leads/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("[map/ask] intake failed", r.status, out);
    return NextResponse.json({ error: "Could not send your message. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, lead_id: out.lead_id ?? null, status: out.status ?? null });
}
