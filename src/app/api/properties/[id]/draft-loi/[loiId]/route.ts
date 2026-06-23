/**
 * GET   /api/properties/[id]/draft-loi/[loiId]  — full row for prefill
 * PATCH /api/properties/[id]/draft-loi/[loiId]  — update + re-render PDF
 *
 * Same body shape + defaults logic as POST /api/properties/[id]/draft-loi,
 * but writes to an existing tenant_lois row instead of inserting a new
 * one. The PDF is regenerated with the new terms and the pdf_url is
 * replaced (the old PDF stays in storage until the storage GC runs —
 * not worth deleting eagerly since each LOI has its own timestamped
 * storage path).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateLOI, type LOIInput, type RampPeriod } from "@/lib/marketing/generate-loi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "marketing-pdfs";

const BROKER_NAME = "John Mathewson";
const BROKERAGE = "eXp Commercial";
const BROKER_EMAIL = "john@johnmathewson.co";
const BROKER_PHONE = "(219) 781-9547";

const VALID_LEASE_TYPES = new Set([
  "NNN", "Modified Gross", "Gross", "Industrial Gross", "Full Service", "Absolute Net",
]);

function normalizeLeaseType(input: string | null | undefined): LOIInput["leaseType"] {
  if (!input) return "NNN";
  const mapped = input
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Nnn/i, "NNN");
  if (VALID_LEASE_TYPES.has(mapped)) return mapped as LOIInput["leaseType"];
  return "NNN";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTIDescription(property: any, override?: string): string {
  if (override && override.trim()) return override.trim();
  const tiPerSf = property.ti_allowance_per_sf;
  if (tiPerSf && Number(tiPerSf) > 0) {
    return `Landlord shall provide a Tenant Improvement Allowance of $${Number(tiPerSf).toFixed(2)} per RSF, applied against the cost of Tenant's buildout. Any costs above this allowance shall be borne by Tenant.`;
  }
  return "To be negotiated.";
}

// ── GET — full row, used by the dialog for edit-mode prefill ──────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; loiId: string } }
) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await sb
    .from("tenant_lois")
    .select("*")
    .eq("id", params.loiId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "LOI not found" }, { status: 404 });

  return NextResponse.json({ loi: data });
}

// ── PATCH — update + regenerate PDF ────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; loiId: string } }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const required = ["tenant_entity", "tenant_signing_name", "tenant_signing_title", "permitted_use"];
  for (const k of required) {
    if (!body[k] || typeof body[k] !== "string" || !body[k].trim()) {
      return NextResponse.json({ error: `Missing required field: ${k}` }, { status: 400 });
    }
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Ensure the LOI exists + belongs to this property + this org.
  // Cheap safety check before doing the expensive PDF render.
  const { data: existing, error: existErr } = await sb
    .from("tenant_lois")
    .select("id, status")
    .eq("id", params.loiId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "LOI not found" }, { status: 404 });

  // Only drafts can be edited freely. Once an LOI is sent/executed,
  // editing should be deliberate (e.g. recording a counter-proposal),
  // not silent. For now, block edits on non-draft status; the UI can
  // grow a "duplicate as new draft" affordance later.
  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot edit an LOI in status '${existing.status}'. Duplicate it as a new draft instead.` },
      { status: 409 }
    );
  }

  // Load the property — same defaults logic as POST. Pull all columns
  // so the NNN fallback (operating_expenses_per_sf) and TI default
  // (ti_allowance_per_sf) both have access.
  const { data: property, error: loadErr } = await sb
    .from("properties")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = property as any;
  if (p.transaction_type !== "lease") {
    return NextResponse.json(
      { error: "Tenant LOI is only valid on a for-lease property." },
      { status: 400 }
    );
  }

  const landlordEntity =
    body.landlord_entity?.trim() ||
    p.true_owner_name ||
    p.owner_name_raw ||
    "[Landlord Entity]";

  const premisesRSF = Number(body.premises_rsf || p.available_sf || p.sqft || 0);
  if (!premisesRSF || premisesRSF <= 0) {
    return NextResponse.json(
      { error: "Premises RSF is required." },
      { status: 400 }
    );
  }

  const baseRentPerSf = Number(body.base_rent_per_sf || p.lease_rate || 0);
  if (!baseRentPerSf || baseRentPerSf <= 0) {
    return NextResponse.json(
      { error: "Base rent ($/SF/yr) is required." },
      { status: 400 }
    );
  }

  const premisesAddress = [p.address, p.city, p.state, p.zip]
    .filter(Boolean)
    .join(", ")
    .replace(", " + p.zip, ` ${p.zip}`);
  const premisesUnitLabel = body.premises_unit_label?.trim() || p.address || "the Premises";

  const commencementDate = body.commencement_date
    ? new Date(body.commencement_date)
    : (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1, 1);
        return d;
      })();

  const loiInput: LOIInput = {
    propertyName: p.name || "the Property",
    premisesUnitLabel,
    premisesAddress,
    premisesRSF,
    landlordEntity,
    tenantEntity: body.tenant_entity.trim(),
    tenantSigningName: body.tenant_signing_name.trim(),
    tenantSigningTitle: body.tenant_signing_title.trim(),
    tenantAddress: (body.tenant_address ?? "").trim(),
    tenantCity: (body.tenant_city ?? "").trim(),
    tenantState: (body.tenant_state ?? "").trim(),
    tenantZip: (body.tenant_zip ?? "").trim(),
    brokerName: BROKER_NAME,
    brokerage: BROKERAGE,
    brokerEmail: BROKER_EMAIL,
    brokerPhone: BROKER_PHONE,
    tenantBrokerName: body.tenant_broker_name?.trim() || null,
    tenantBrokerage: body.tenant_brokerage?.trim() || null,
    documentDate: new Date(),
    permittedUse: body.permitted_use.trim(),
    termYears: Number(body.term_years || 5),
    commencementDate,
    renewalOptionsCount: Number(body.renewal_options_count ?? 2),
    renewalTermYears: Number(body.renewal_term_years ?? 3),
    renewalNoticeDays: Number(body.renewal_notice_days ?? 90),
    baseRentPerSf,
    annualEscalationPct: Number(body.annual_escalation_pct ?? 3.5),
    rampPeriods: Array.isArray(body.ramp_periods)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (body.ramp_periods as any[])
          .map((r): RampPeriod | null => {
            const monthsStart = Number(r?.monthsStart ?? r?.months_start);
            const monthsEnd = Number(r?.monthsEnd ?? r?.months_end);
            const baseRent = Number(r?.baseRentPerSf ?? r?.base_rent_per_sf);
            if (
              !Number.isFinite(monthsStart) ||
              !Number.isFinite(monthsEnd) ||
              !Number.isFinite(baseRent) ||
              monthsStart < 1 ||
              monthsEnd < monthsStart ||
              monthsEnd > 12 ||
              baseRent <= 0
            ) return null;
            return {
              label: String(r?.label ?? `Months ${monthsStart}-${monthsEnd}`),
              monthsStart,
              monthsEnd,
              baseRentPerSf: baseRent,
            };
          })
          .filter((r): r is RampPeriod => r !== null)
      : [],
    nnnPerSf:
      body.nnn_per_sf !== undefined && body.nnn_per_sf !== null && body.nnn_per_sf !== ""
        ? Number(body.nnn_per_sf)
        : p.operating_expenses_per_sf
          ? Number(p.operating_expenses_per_sf)
          : null,
    leaseType: normalizeLeaseType(body.lease_type || p.lease_type),
    freeRentMonths: Number(body.free_rent_months ?? p.free_rent_months ?? 0),
    tiDescription: buildTIDescription(p, body.ti_description),
    securityDepositMonths: Number(body.security_deposit_months ?? 1),
    personalGuarantee: body.personal_guarantee !== false,
    contingencies: (body.contingencies ?? "None").trim() || "None",
  };

  // Render new PDF
  let pdfBytes: Uint8Array;
  try {
    const doc = generateLOI(loiInput);
    const buf = doc.output("arraybuffer");
    pdfBytes = new Uint8Array(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `LOI render failed: ${msg}` }, { status: 500 });
  }

  // Storage path uses the existing LOI id + a new timestamp so each
  // edit produces a distinct artifact (handy for audit / change history)
  const safeTenant = loiInput.tenantEntity.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const safeProperty = loiInput.propertyName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const filename = `LOI_${safeProperty}_${safeTenant}_${stamp}.pdf`;
  const storagePath = `${params.id}/lois/${params.loiId}_${stamp}_${filename}`;

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json(
      { ok: false, error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = pub.publicUrl;

  // Persist updates. Same column set as POST INSERT minus organization_id
  // and property_id (immutable on edit).
  const { error: updateErr } = await sb
    .from("tenant_lois")
    .update({
      lead_id: body.lead_id ?? null,
      tenant_entity: loiInput.tenantEntity,
      tenant_signing_name: loiInput.tenantSigningName,
      tenant_signing_title: loiInput.tenantSigningTitle,
      tenant_address: loiInput.tenantAddress || null,
      tenant_city: loiInput.tenantCity || null,
      tenant_state: loiInput.tenantState || null,
      tenant_zip: loiInput.tenantZip || null,
      tenant_email: body.tenant_email?.trim() || null,
      tenant_phone: body.tenant_phone?.trim() || null,
      tenant_broker_name: loiInput.tenantBrokerName || null,
      tenant_brokerage: loiInput.tenantBrokerage || null,
      landlord_entity: loiInput.landlordEntity,
      premises_rsf: loiInput.premisesRSF,
      premises_unit_label: loiInput.premisesUnitLabel,
      base_rent_per_sf: loiInput.baseRentPerSf,
      term_years: loiInput.termYears,
      commencement_date: loiInput.commencementDate.toISOString().slice(0, 10),
      annual_escalation_pct: loiInput.annualEscalationPct,
      renewal_options_count: loiInput.renewalOptionsCount,
      renewal_term_years: loiInput.renewalTermYears,
      renewal_notice_days: loiInput.renewalNoticeDays,
      lease_type: loiInput.leaseType,
      free_rent_months: loiInput.freeRentMonths,
      ramp_periods: loiInput.rampPeriods ?? [],
      nnn_per_sf: loiInput.nnnPerSf ?? null,
      ti_description: loiInput.tiDescription,
      security_deposit_months: loiInput.securityDepositMonths,
      personal_guarantee: loiInput.personalGuarantee,
      permitted_use: loiInput.permittedUse,
      contingencies: loiInput.contingencies,
      pdf_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.loiId)
    .eq("organization_id", ORG_ID);

  if (updateErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Update failed: ${updateErr.message}`,
        pdf_url: publicUrl,
        warning: "PDF was rendered to storage but the LOI row update failed.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, loi_id: params.loiId, pdf_url: publicUrl, filename });
}
