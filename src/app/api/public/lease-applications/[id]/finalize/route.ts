/**
 * POST /api/public/lease-applications/[id]/finalize
 *
 * Step 2: the browser has uploaded its files to the signed URLs. Record the
 * documents that actually landed, resolve the applicant to a contact, and
 * put a hot lease lead in the Stream (new lead, or the person's open lead on
 * the same property). Idempotent — a retry after success returns the same
 * lead.
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveParty, recordTouch, alarm, synthExternalId } from "@/lib/cre-os/record-touch";
import { DOC_TYPE_LABELS, LEASE_APP_BUCKET, hashToken, fmtMoney, type DocType } from "@/lib/lease-applications";
import { toE164 } from "@/lib/twilio";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const CLOSED_LEAD_STATUSES = '("archived","spam","converted","promoted","dead")';

interface PendingFile {
  doc_type: DocType;
  file_name: string;
  size: number;
  mime_type: string;
  path: string;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const headers = corsHeaders(req.headers.get("origin"));
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Online applications are temporarily unavailable." }, { status: 503, headers });
  }

  let token = "";
  try {
    const body = await req.json();
    token = typeof body?.finalize_token === "string" ? body.finalize_token : "";
  } catch { /* handled below */ }
  if (!token) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });

  const { data: app } = await admin
    .from("lease_applications")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!app || app.finalize_token_hash !== hashToken(token)) {
    return NextResponse.json({ error: "Application not found." }, { status: 404, headers });
  }
  if (app.status !== "pending_upload") {
    return NextResponse.json({ ok: true, application_id: app.id, lead_id: app.lead_id }, { headers });
  }

  // ── Documents: keep the ones that actually reached the bucket ──────────
  const pending = (Array.isArray(app.pending_files) ? app.pending_files : []) as PendingFile[];
  const { data: objects } = await admin.storage.from(LEASE_APP_BUCKET).list(app.id, { limit: 100 });
  const present = new Set((objects ?? []).map((o) => `${app.id}/${o.name}`));
  const landed = pending.filter((f) => present.has(f.path));
  const missing = pending.filter((f) => !present.has(f.path));

  if (landed.length > 0) {
    const { error: docErr } = await admin.from("lease_application_documents").upsert(
      landed.map((f) => ({
        organization_id: ORG_ID,
        application_id: app.id,
        doc_type: f.doc_type,
        file_name: f.file_name,
        storage_path: f.path,
        file_size: f.size,
        mime_type: f.mime_type,
      })),
      { onConflict: "storage_path", ignoreDuplicates: true },
    );
    if (docErr) await alarm(admin, "lease_app_docs_insert", docErr.message, { application_id: app.id });
  }

  // ── Who is applying ────────────────────────────────────────────────────
  const owners = (Array.isArray(app.owners) ? app.owners : []) as Array<{
    name: string; title: string | null; ownership_pct: number | null; guarantor: boolean;
    phone: string | null; email: string | null;
  }>;
  const primary = owners[0];
  const applicantEmail = primary?.email || app.business_email || null;
  const applicantPhone = primary?.phone || app.business_phone || null;
  const applicantName = primary?.name || app.business_legal_name;

  let contactId: string;
  try {
    contactId = (await resolveParty(admin, {
      email: applicantEmail,
      phone: applicantPhone,
      name: applicantName,
      company: app.business_legal_name,
      source: "lease_application",
      contactType: "tenant",
      warmth: "hot",
    })).contactId;
  } catch (err) {
    await alarm(admin, "lease_app_no_party", err instanceof Error ? err.message : String(err), { application_id: app.id });
    return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500, headers });
  }

  // ── The lead ───────────────────────────────────────────────────────────
  const where = app.property_label ? `${app.property_label}${app.suite ? `, ${app.suite}` : ""}` : "unspecified space";
  const docSummary = landed.length
    ? `${landed.length} doc${landed.length === 1 ? "" : "s"}`
    : "no docs";
  const guarantors = owners.filter((o) => o.guarantor).map((o) => o.name);
  const qualifierSummary = [
    `Lease application: ${app.business_legal_name}`,
    app.intended_use,
    app.monthly_revenue !== null ? `${fmtMoney(app.monthly_revenue)}/mo revenue` : null,
    app.years_in_business !== null ? `${app.years_in_business} yrs in business` : null,
    guarantors.length ? `guarantor: ${guarantors.join(", ")}` : "no guarantor",
    docSummary,
  ].filter(Boolean).join(" · ");

  const docLines = landed.map((f) => `  • ${DOC_TYPE_LABELS[f.doc_type] ?? f.doc_type}: ${f.file_name}`);
  const rawBody = [
    `Commercial lease application for ${where}.`,
    `Full application: /cre-os/applications/${app.id}`,
    "",
    `Business: ${app.business_legal_name}${app.dba ? ` (dba ${app.dba})` : ""}`,
    `Use: ${app.intended_use ?? "—"}`,
    `Entity: ${app.entity_type ?? "—"}${app.state_of_formation ? `, ${app.state_of_formation}` : ""} · ${app.years_in_business ?? "—"} yrs in business`,
    `Space: ${app.desired_sf ?? "—"} SF · move-in ${app.desired_move_in ?? "—"}`,
    "",
    "Owners:",
    ...owners.map((o) => `  • ${o.name}${o.title ? `, ${o.title}` : ""}${o.ownership_pct !== null ? ` (${o.ownership_pct}%)` : ""}${o.guarantor ? " — guarantor" : ""}${o.email ? ` · ${o.email}` : ""}${o.phone ? ` · ${o.phone}` : ""}`),
    "",
    `Monthly revenue ${fmtMoney(app.monthly_revenue)} · expenses ${fmtMoney(app.monthly_expenses)} · cash ${fmtMoney(app.cash_savings)}`,
    `Assets ${fmtMoney(app.total_assets)} · liabilities ${fmtMoney(app.total_liabilities)} · start-up ${fmtMoney(app.startup_cost)}`,
    `Current: ${app.current_address ?? "—"} (${app.current_tenure ?? "—"}${app.current_monthly_rent !== null ? `, ${fmtMoney(app.current_monthly_rent)}/mo` : ""})`,
    "",
    `Documents (${landed.length}):`,
    ...(docLines.length ? docLines : ["  (none received)"]),
    ...(missing.length ? ["", `Did not upload: ${missing.map((f) => f.file_name).join(", ")}`] : []),
    ...(app.notes ? ["", `Applicant notes: ${app.notes}`] : []),
  ].join("\n");
  const subject = `Lease application — ${app.business_legal_name}`;

  const findOpenLead = async () => {
    let q = admin
      .from("leads")
      .select("id, raw_body")
      .eq("organization_id", ORG_ID)
      .eq("contact_id", contactId)
      .not("status", "in", CLOSED_LEAD_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);
    q = app.property_id ? q.eq("property_id", app.property_id) : q.is("property_id", null);
    const { data } = await q;
    return ((data ?? [])[0] ?? null) as { id: string; raw_body: string | null } | null;
  };

  const leadFields = {
    status: "new",
    intent: "lease",
    urgency: "hot",
    qualifier_summary: qualifierSummary,
    property_label: app.property_label,
  };

  let leadId: string | null = null;
  let isNewLead = false;
  const open = await findOpenLead();
  if (open) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
    await admin.from("leads").update({
      ...leadFields,
      raw_body: open.raw_body ? `${open.raw_body}\n\n[lease application ${stamp}]\n${rawBody}` : rawBody,
      updated_at: new Date().toISOString(),
    }).eq("id", open.id);
    leadId = open.id;
  } else {
    const { data: lead, error: leadErr } = await admin.from("leads").insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: app.property_id,
      source: "website",
      sender_name: applicantName,
      sender_email: applicantEmail ? applicantEmail.toLowerCase() : null,
      sender_phone: toE164(applicantPhone),
      raw_subject: subject,
      raw_body: rawBody,
      claude_extraction: { method: "lease_application", application_id: app.id },
      ...leadFields,
    }).select("id").single();
    if (lead) {
      leadId = lead.id;
      isNewLead = true;
    } else if (leadErr?.code === "23505") {
      leadId = (await findOpenLead())?.id ?? null;
    }
    if (!leadId) {
      await alarm(admin, "lease_app_lead_insert", leadErr?.message ?? "no row returned", { application_id: app.id, contact_id: contactId });
      return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500, headers });
    }
  }

  try {
    await recordTouch(admin, {
      channel: "website",
      direction: "inbound",
      contactId,
      leadId,
      propertyId: app.property_id,
      externalId: synthExternalId(["lease_application", app.id]),
      subject,
      body: qualifierSummary,
      fromAddress: applicantEmail,
      source: "lease_application",
      rawPayload: { application_id: app.id, documents: landed.length },
    });
  } catch (err) {
    await alarm(admin, "lease_app_comm_insert", err instanceof Error ? err.message : String(err), { lead_id: leadId });
  }

  await admin.from("lead_events").insert({
    organization_id: ORG_ID,
    lead_id: leadId,
    event_type: "received",
    actor: "system",
    summary: `Lease application from ${app.business_legal_name} — ${docSummary}${missing.length ? `, ${missing.length} failed to upload` : ""}`,
    metadata: { application_id: app.id, documents: landed.length, missing: missing.map((f) => f.file_name) },
  });

  // Same 2–5 minute receipt every website lead gets (drained by poll-gmail).
  if (isNewLead && applicantEmail) {
    const { error: schedErr } = await admin.from("scheduled_acks").insert({
      organization_id: ORG_ID,
      lead_id: leadId,
      send_after: new Date(Date.now() + (2 + Math.random() * 3) * 60_000).toISOString(),
    });
    if (schedErr) await alarm(admin, "ack_not_scheduled", `Lease application lead ${leadId}: ${schedErr.message}`, { lead_id: leadId });
  }

  await admin.from("lease_applications").update({
    status: "submitted",
    submitted_at: new Date().toISOString(),
    lead_id: leadId,
    contact_id: contactId,
  }).eq("id", app.id);

  return NextResponse.json(
    { ok: true, application_id: app.id, lead_id: leadId, documents: landed.length, missing: missing.map((f) => f.file_name) },
    { headers },
  );
}
