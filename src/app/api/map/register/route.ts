/**
 * POST /api/map/register
 *
 * The parcel map's registration gate. A visitor trades name / email / phone
 * (+ company, role, SMS consent) for the owner / value / sales tier. The
 * person lands in the CRM as a contact through resolveParty (one way in),
 * the registration is written to the contact's activity timeline, and a
 * signed cookie unlocks the tier on this device.
 *
 * Public — middleware does not run on /api/*. Same-origin only (the map
 * lives in this app), so no CORS.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveParty, normalizeEmail, normalizePhone, ORG_ID } from "@/lib/cre-os/record-touch";
import { setSessionCookie } from "@/lib/parcel-map/session";

export const dynamic = "force-dynamic";

const ROLES = new Set(["developer", "investor", "contractor", "broker", "owner", "lender", "other"]);

interface Body {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  sms_consent?: boolean;
  /** Parcel that prompted the registration — kept on the activity. */
  pid?: string | null;
  address?: string | null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const role = ROLES.has(body.role ?? "") ? body.role! : "other";
  const company = (body.company ?? "").trim() || null;

  if (name.length < 2) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Please enter a valid mobile number." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  let contactId: string;
  let created = false;
  try {
    const party = await resolveParty(sb, {
      email, phone, name, company, role,
      source: "parcel_map",
      warmth: "warm",
    });
    contactId = party.contactId;
    created = party.created;
  } catch (err: any) {
    console.error("[map/register] resolveParty failed", err);
    return NextResponse.json({ error: "Could not save your registration. Please try again." }, { status: 500 });
  }

  // Engagement signal → activity timeline (not a communication).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const { error: actErr } = await sb.from("activities").insert({
    organization_id: ORG_ID,
    activity_type: "note",
    subject: "Registered on the Hobart parcel map",
    body: [
      `Role: ${role}${company ? ` · Company: ${company}` : ""}`,
      body.address || body.pid ? `Unlocked from parcel: ${body.address ?? ""} ${body.pid ? `(${body.pid})` : ""}`.trim() : null,
      `SMS consent: ${body.sms_consent ? "yes" : "no"}`,
      ip ? `IP: ${ip}` : null,
    ].filter(Boolean).join("\n"),
    occurred_at: new Date().toISOString(),
    contact_id: contactId,
  });
  if (actErr) console.error("[map/register] activity insert failed", actErr);

  const res = NextResponse.json({ ok: true, registered: true, name, created });
  setSessionCookie(res, { contactId, name });
  return res;
}
