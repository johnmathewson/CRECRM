/**
 * POST /api/properties/[id]/draft-loi
 *
 * Drafts a Tenant LOI on a for-lease property:
 *   1. Loads the property + landlord defaults
 *   2. Merges with the broker's terms from the request body
 *   3. Renders the LOI PDF via generateLOI()
 *   4. Uploads to Supabase Storage (marketing-pdfs bucket)
 *   5. Inserts a tenant_lois row tracking the draft
 *   6. Returns the public URL + row id so the UI can offer download
 *
 * Body:
 *   {
 *     // Optional — link the LOI back to the lead it emerged from.
 *     lead_id?: string | null;
 *
 *     // Tenant identity (required)
 *     tenant_entity: string;
 *     tenant_signing_name: string;
 *     tenant_signing_title: string;
 *     tenant_address: string;
 *     tenant_city: string;
 *     tenant_state: string;
 *     tenant_zip: string;
 *     tenant_email?: string;
 *     tenant_phone?: string;
 *
 *     // Landlord override (defaults to property.true_owner_name)
 *     landlord_entity?: string;
 *
 *     // Tenant broker (§13)
 *     tenant_broker_name?: string;
 *     tenant_brokerage?: string;
 *
 *     // Proposed terms — most have defaults pulled from property
 *     premises_rsf?: number;             // default property.available_sf
 *     premises_unit_label?: string;      // default "the Premises"
 *     base_rent_per_sf?: number;         // default property.lease_rate
 *     term_years?: number;               // default 5
 *     commencement_date?: string;        // ISO date
 *     annual_escalation_pct?: number;    // default 2.5
 *     renewal_options_count?: number;    // default 2
 *     renewal_term_years?: number;       // default 3
 *     renewal_notice_days?: number;      // default 90
 *     lease_type?: string;               // default property.lease_type or "NNN"
 *     free_rent_months?: number;         // default property.free_rent_months or 0
 *     ti_description?: string;           // default from property.ti_allowance_per_sf
 *     security_deposit_months?: number;  // default 1
 *     personal_guarantee?: boolean;      // default true
 *     permitted_use?: string;            // required (no sensible default)
 *     contingencies?: string;            // default "None"
 *   }
 *
 * Returns: { ok, loi_id, pdf_url, filename }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateLOI, type LOIInput, type RampPeriod } from "@/lib/marketing/generate-loi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "marketing-pdfs";

// Listing broker constants — moved to env later when we add multi-broker
// support. For now they're the John/eXp default and the landlord-facing
// face of every LOI we draft.
const BROKER_NAME = "John Mathewson";
const BROKERAGE = "eXp Commercial";
const BROKER_EMAIL = "john@johnmathewson.co";
const BROKER_PHONE = "(219) 781-9547";

const VALID_LEASE_TYPES = new Set([
  "NNN", "Modified Gross", "Gross", "Industrial Gross", "Full Service", "Absolute Net",
]);

function normalizeLeaseType(input: string | null | undefined): LOIInput["leaseType"] {
  if (!input) return "NNN";
  // Property's lease_type column uses snake_case values like "modified_gross";
  // the generator expects display strings. Map between them.
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Required fields up front — anything else has a sensible default.
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

  // Load the property — we need address, available_sf, lease_rate, lease_type,
  // free_rent_months, ti_allowance_per_sf, true_owner_name for defaults.
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
      { error: "Tenant LOI can only be drafted on a for-lease property. Use the sale-offer flow for sale properties." },
      { status: 400 }
    );
  }

  // Build defaults from the property + body overrides.
  const landlordEntity =
    body.landlord_entity?.trim() ||
    p.true_owner_name ||
    p.owner_name_raw ||
    "[Landlord Entity]";

  const premisesRSF = Number(body.premises_rsf || p.available_sf || p.sqft || 0);
  if (!premisesRSF || premisesRSF <= 0) {
    return NextResponse.json(
      { error: "Premises RSF is required — set available_sf on the property or pass premises_rsf in the body." },
      { status: 400 }
    );
  }

  const baseRentPerSf = Number(body.base_rent_per_sf || p.lease_rate || 0);
  if (!baseRentPerSf || baseRentPerSf <= 0) {
    return NextResponse.json(
      { error: "Base rent ($/SF/yr) is required — set lease_rate on the property or pass base_rent_per_sf in the body." },
      { status: 400 }
    );
  }

  // Build the full premises address string for §1
  const premisesAddress = [p.address, p.city, p.state, p.zip]
    .filter(Boolean)
    .join(", ")
    .replace(", " + p.zip, ` ${p.zip}`);

  const premisesUnitLabel = body.premises_unit_label?.trim() || p.address || "the Premises";

  const commencementDate = body.commencement_date
    ? new Date(body.commencement_date)
    : (() => {
        // Default: first of the next month
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
    annualEscalationPct: Number(body.annual_escalation_pct ?? 2.5),
    rampPeriods: Array.isArray(body.ramp_periods)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (body.ramp_periods as any[])
          .map((r): RampPeriod | null => {
            const monthsStart = Number(r?.monthsStart ?? r?.months_start);
            const monthsEnd = Number(r?.monthsEnd ?? r?.months_end);
            const baseRentPerSf = Number(r?.baseRentPerSf ?? r?.base_rent_per_sf);
            if (
              !Number.isFinite(monthsStart) ||
              !Number.isFinite(monthsEnd) ||
              !Number.isFinite(baseRentPerSf) ||
              monthsStart < 1 ||
              monthsEnd < monthsStart ||
              monthsEnd > 12 ||
              baseRentPerSf <= 0
            ) {
              return null;
            }
            return {
              label: String(r?.label ?? `Months ${monthsStart}-${monthsEnd}`),
              monthsStart,
              monthsEnd,
              baseRentPerSf,
            };
          })
          .filter((r): r is RampPeriod => r !== null)
      : [],
    nnnPerSf:
      body.nnn_per_sf !== undefined && body.nnn_per_sf !== null && body.nnn_per_sf !== ""
        ? Number(body.nnn_per_sf)
        : null,
    leaseType: normalizeLeaseType(body.lease_type || p.lease_type),
    freeRentMonths: Number(body.free_rent_months ?? p.free_rent_months ?? 0),
    tiDescription: buildTIDescription(p, body.ti_description),
    securityDepositMonths: Number(body.security_deposit_months ?? 1),
    personalGuarantee: body.personal_guarantee !== false,
    contingencies: (body.contingencies ?? "None").trim() || "None",
  };

  // Render the PDF
  let pdfBytes: Uint8Array;
  try {
    const doc = generateLOI(loiInput);
    const buf = doc.output("arraybuffer");
    pdfBytes = new Uint8Array(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `LOI render failed: ${msg}` }, { status: 500 });
  }

  // Filename: tenant-entity + property + date, sanitized
  const safeTenant = loiInput.tenantEntity.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const safeProperty = loiInput.propertyName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const filename = `LOI_${safeProperty}_${safeTenant}_${stamp}.pdf`;
  const storagePath = `${params.id}/lois/${stamp}_${filename}`;

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

  // Persist the draft. Allows the broker to revisit the terms later
  // OR generate a sibling LOI for a different tenant without re-typing
  // the property defaults.
  const { data: inserted, error: insertErr } = await sb
    .from("tenant_lois")
    .insert({
      organization_id: ORG_ID,
      property_id: params.id,
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
      status: "draft",
    })
    .select("id")
    .single();

  if (insertErr) {
    // PDF is uploaded — return the URL anyway so the broker can still
    // download it. Surface the persist failure so they know it's
    // ephemeral.
    return NextResponse.json(
      {
        ok: true,
        pdf_url: publicUrl,
        filename,
        warning: `LOI was rendered but failed to persist: ${insertErr.message}`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    loi_id: inserted.id,
    pdf_url: publicUrl,
    filename,
  });
}

// ── GET — list LOIs for a property ─────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await sb
    .from("tenant_lois")
    .select(
      "id, tenant_entity, tenant_signing_name, base_rent_per_sf, term_years, commencement_date, lease_type, status, pdf_url, created_at, sent_at, lead_id"
    )
    .eq("organization_id", ORG_ID)
    .eq("property_id", params.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lois: data ?? [] });
}
