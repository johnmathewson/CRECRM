"use client";

import { useState, useEffect, useMemo } from "react";

/**
 * TenantLOIDialog — two-step modal for drafting a Tenant LOI on a
 * for-lease property:
 *
 *   Step 1: SOURCE PICKER
 *     A) "From a lead" → loads active leads on this property,
 *        broker picks one; tenant entity + contact prefill from
 *        the lead's contact record.
 *     B) "Blank LOI" → tenant identity entered manually.
 *
 *   Step 2: TERMS FORM
 *     Tenant entity / signing name / signing title / contact address
 *     + proposed economic terms (term years, rent, escalation,
 *     renewal options, lease type, free rent, TI, security deposit,
 *     personal guarantee, permitted use, contingencies).
 *     Most fields prefill from the property's lease defaults.
 *
 *   Step 3: SUBMIT
 *     POSTs /api/properties/[id]/draft-loi → generates PDF →
 *     uploads to storage → persists tenant_lois row → returns URL.
 *     Dialog displays the download link and a "Draft another LOI"
 *     button so the broker can rapid-fire LOIs to multiple
 *     prospects on the same property.
 */

/** Shape matches PropertyLead from lib/cre-os/property-queries.ts —
 *  passed in from OffersTab so we don't double-fetch on dialog open. */
interface LeadOption {
  id: string;
  senderName: string | null;
  senderEmail: string | null;
  intent: string | null;
  urgency: "hot" | "warm" | "cold" | null;
  status: string | null;
}

interface PropertyDefaults {
  available_sf: number | null;
  sqft: number | null;
  lease_rate: number | null;
  lease_type: string | null;
  free_rent_months: number | null;
  ti_allowance_per_sf: number | null;
  operating_expenses_per_sf: number | null;
  true_owner_name: string | null;
  owner_name_raw: string | null;
  address: string | null;
}

const LEASE_TYPE_OPTIONS = [
  "NNN",
  "Modified Gross",
  "Gross",
  "Industrial Gross",
  "Full Service",
  "Absolute Net",
];

export function TenantLOIDialog({
  open,
  propertyId,
  propertyName,
  propertyDefaults,
  leads,
  editingLoiId = null,
  onClose,
}: {
  open: boolean;
  propertyId: string;
  propertyName: string;
  propertyDefaults: PropertyDefaults;
  /** Active leads on this property — passed from OffersTab via
   *  PropertyDetail. Filter is applied here for the picker. */
  leads: LeadOption[];
  /** When set, the dialog opens in edit mode: skips the source
   *  picker, fetches the existing LOI row, prefills every field,
   *  and submits PATCH instead of POST. Null = new-draft mode. */
  editingLoiId?: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"source" | "form" | "done">("source");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — source picker
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const activeLeads = useMemo(
    () => leads.filter((l) => !["archived", "spam"].includes(l.status ?? "")),
    [leads]
  );

  // Step 2 — terms form
  const [tenantEntity, setTenantEntity] = useState("");
  const [tenantSigningName, setTenantSigningName] = useState("");
  const [tenantSigningTitle, setTenantSigningTitle] = useState("");
  const [tenantAddress, setTenantAddress] = useState("");
  const [tenantCity, setTenantCity] = useState("");
  const [tenantState, setTenantState] = useState("IN");
  const [tenantZip, setTenantZip] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [tenantPhone, setTenantPhone] = useState("");
  const [tenantBrokerName, setTenantBrokerName] = useState("");
  const [tenantBrokerage, setTenantBrokerage] = useState("");

  const [landlordEntity, setLandlordEntity] = useState("");
  const [premisesUnitLabel, setPremisesUnitLabel] = useState("");
  const [premisesRsf, setPremisesRsf] = useState("");
  const [baseRentPerSf, setBaseRentPerSf] = useState("");
  const [termYears, setTermYears] = useState("5");
  const [commencementDate, setCommencementDate] = useState("");
  const [annualEscalationPct, setAnnualEscalationPct] = useState("3.5");
  const [renewalOptionsCount, setRenewalOptionsCount] = useState("2");
  const [renewalTermYears, setRenewalTermYears] = useState("3");
  const [leaseType, setLeaseType] = useState("NNN");
  const [freeRentMonths, setFreeRentMonths] = useState("0");
  const [nnnPerSf, setNnnPerSf] = useState("");
  // Ramp/discount periods for Year 1. Stored as strings so the inputs
  // are ergonomic; coerced on submit. Most LOIs have 0–2 ramps.
  const [rampPeriods, setRampPeriods] = useState<
    { label: string; monthsStart: string; monthsEnd: string; baseRentPerSf: string }[]
  >([]);
  const [tiDescription, setTiDescription] = useState("");
  const [securityDepositMonths, setSecurityDepositMonths] = useState("1");
  const [personalGuarantee, setPersonalGuarantee] = useState(true);
  const [permittedUse, setPermittedUse] = useState("");
  const [contingencies, setContingencies] = useState("None.");

  // Step 3 — result
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  // Hydrate property defaults whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    // Edit mode skips the source picker — broker picked the LOI to
    // edit from the list, that IS their source choice.
    setStep(editingLoiId ? "form" : "source");
    setError(null);
    setSelectedLeadId(null);
    setPdfUrl(null);
    setFilename(null);

    // Prefill landlord + premises defaults from the property
    setLandlordEntity(
      propertyDefaults.true_owner_name ?? propertyDefaults.owner_name_raw ?? ""
    );
    setPremisesUnitLabel(propertyDefaults.address ?? "");
    setPremisesRsf(
      propertyDefaults.available_sf
        ? String(propertyDefaults.available_sf)
        : propertyDefaults.sqft
          ? String(propertyDefaults.sqft)
          : ""
    );
    setBaseRentPerSf(
      propertyDefaults.lease_rate ? String(propertyDefaults.lease_rate) : ""
    );

    // Normalize lease_type from snake_case ("modified_gross") to display
    if (propertyDefaults.lease_type) {
      const norm = propertyDefaults.lease_type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/Nnn/i, "NNN");
      if (LEASE_TYPE_OPTIONS.includes(norm)) setLeaseType(norm);
    }

    setFreeRentMonths(
      propertyDefaults.free_rent_months
        ? String(propertyDefaults.free_rent_months)
        : "0"
    );

    // Prefill NNN from the property's operating-expense estimate.
    // Without this the broker has to remember to enter it on every
    // LOI, and an empty value silently strips the NNN columns from
    // §7 of the rendered PDF — the bug John just flagged.
    setNnnPerSf(
      propertyDefaults.operating_expenses_per_sf
        ? String(propertyDefaults.operating_expenses_per_sf)
        : ""
    );

    if (
      propertyDefaults.ti_allowance_per_sf &&
      Number(propertyDefaults.ti_allowance_per_sf) > 0
    ) {
      setTiDescription(
        `Landlord shall provide a Tenant Improvement Allowance of $${Number(
          propertyDefaults.ti_allowance_per_sf
        ).toFixed(2)} per RSF.`
      );
    } else {
      setTiDescription("To be negotiated.");
    }

    // Default commencement: first of next month
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    setCommencementDate(d.toISOString().slice(0, 10));
  }, [open, propertyDefaults, editingLoiId]);

  // Edit mode: load the existing LOI row and overwrite the
  // property-defaults prefill with the actual values from the draft.
  // This runs AFTER the property-defaults useEffect so the saved
  // values win.
  useEffect(() => {
    if (!open || !editingLoiId) return;
    let cancelled = false;
    fetch(`/api/properties/${propertyId}/draft-loi/${editingLoiId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.error) throw new Error(j.error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loi = j.loi as any;
        if (!loi) return;

        setSelectedLeadId(loi.lead_id ?? null);

        setTenantEntity(loi.tenant_entity ?? "");
        setTenantSigningName(loi.tenant_signing_name ?? "");
        setTenantSigningTitle(loi.tenant_signing_title ?? "");
        setTenantAddress(loi.tenant_address ?? "");
        setTenantCity(loi.tenant_city ?? "");
        setTenantState(loi.tenant_state ?? "IN");
        setTenantZip(loi.tenant_zip ?? "");
        setTenantEmail(loi.tenant_email ?? "");
        setTenantPhone(loi.tenant_phone ?? "");
        setTenantBrokerName(loi.tenant_broker_name ?? "");
        setTenantBrokerage(loi.tenant_brokerage ?? "");

        setLandlordEntity(loi.landlord_entity ?? "");
        setPremisesUnitLabel(loi.premises_unit_label ?? "");
        if (loi.premises_rsf) setPremisesRsf(String(loi.premises_rsf));
        if (loi.base_rent_per_sf) setBaseRentPerSf(String(loi.base_rent_per_sf));
        if (loi.term_years) setTermYears(String(loi.term_years));
        if (loi.commencement_date) setCommencementDate(String(loi.commencement_date).slice(0, 10));
        if (loi.annual_escalation_pct) setAnnualEscalationPct(String(loi.annual_escalation_pct));
        if (loi.renewal_options_count !== null && loi.renewal_options_count !== undefined) {
          setRenewalOptionsCount(String(loi.renewal_options_count));
        }
        if (loi.renewal_term_years) setRenewalTermYears(String(loi.renewal_term_years));

        if (loi.lease_type && LEASE_TYPE_OPTIONS.includes(loi.lease_type)) {
          setLeaseType(loi.lease_type);
        }
        setFreeRentMonths(String(loi.free_rent_months ?? 0));
        setNnnPerSf(loi.nnn_per_sf ? String(loi.nnn_per_sf) : "");

        // Ramp periods come back from PostgREST as a jsonb array.
        // Coerce numbers back to strings for the form inputs.
        if (Array.isArray(loi.ramp_periods)) {
          setRampPeriods(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (loi.ramp_periods as any[]).map((r) => ({
              label: String(r.label ?? ""),
              monthsStart: String(r.monthsStart ?? r.months_start ?? ""),
              monthsEnd: String(r.monthsEnd ?? r.months_end ?? ""),
              baseRentPerSf: String(r.baseRentPerSf ?? r.base_rent_per_sf ?? ""),
            }))
          );
        }

        if (loi.ti_description) setTiDescription(loi.ti_description);
        if (loi.security_deposit_months !== null && loi.security_deposit_months !== undefined) {
          setSecurityDepositMonths(String(loi.security_deposit_months));
        }
        setPersonalGuarantee(loi.personal_guarantee !== false);
        if (loi.permitted_use) setPermittedUse(loi.permitted_use);
        if (loi.contingencies) setContingencies(loi.contingencies);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, editingLoiId, propertyId]);

  const selectedLead = useMemo(
    () => activeLeads.find((l) => l.id === selectedLeadId) ?? null,
    [activeLeads, selectedLeadId]
  );

  function pickFromLead(leadId: string) {
    const lead = activeLeads.find((l) => l.id === leadId);
    if (!lead) return;
    setSelectedLeadId(leadId);
    // Prefill tenant signing name + email from the lead. Entity (LLC
    // name) isn't on PropertyLead — broker fills it in.
    if (lead.senderName) setTenantSigningName(lead.senderName);
    if (lead.senderEmail) setTenantEmail(lead.senderEmail);
    setStep("form");
  }

  function startBlank() {
    setSelectedLeadId(null);
    setStep("form");
  }

  async function submit() {
    setError(null);
    if (!tenantEntity.trim()) return setError("Tenant entity is required.");
    if (!tenantSigningName.trim()) return setError("Tenant signing name is required.");
    if (!tenantSigningTitle.trim()) return setError("Tenant signing title is required.");
    if (!permittedUse.trim()) return setError("Permitted use description is required.");
    if (!premisesRsf || Number(premisesRsf) <= 0) return setError("Premises RSF is required.");
    if (!baseRentPerSf || Number(baseRentPerSf) <= 0) return setError("Base rent ($/SF/yr) is required.");

    setBusy(true);
    try {
      // Route to PATCH on the per-LOI endpoint when editing, POST on
      // the list endpoint when drafting fresh. Same body shape both ways.
      const url = editingLoiId
        ? `/api/properties/${propertyId}/draft-loi/${editingLoiId}`
        : `/api/properties/${propertyId}/draft-loi`;
      const method = editingLoiId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLeadId,
          tenant_entity: tenantEntity,
          tenant_signing_name: tenantSigningName,
          tenant_signing_title: tenantSigningTitle,
          tenant_address: tenantAddress,
          tenant_city: tenantCity,
          tenant_state: tenantState,
          tenant_zip: tenantZip,
          tenant_email: tenantEmail,
          tenant_phone: tenantPhone,
          tenant_broker_name: tenantBrokerName,
          tenant_brokerage: tenantBrokerage,
          landlord_entity: landlordEntity,
          premises_unit_label: premisesUnitLabel,
          premises_rsf: Number(premisesRsf),
          base_rent_per_sf: Number(baseRentPerSf),
          term_years: Number(termYears),
          commencement_date: commencementDate,
          annual_escalation_pct: Number(annualEscalationPct),
          renewal_options_count: Number(renewalOptionsCount),
          renewal_term_years: Number(renewalTermYears),
          lease_type: leaseType,
          free_rent_months: Number(freeRentMonths),
          nnn_per_sf: nnnPerSf.trim() === "" ? null : Number(nnnPerSf),
          ramp_periods: rampPeriods
            .map((r) => ({
              label: r.label.trim() || `Months ${r.monthsStart}-${r.monthsEnd}`,
              monthsStart: Number(r.monthsStart),
              monthsEnd: Number(r.monthsEnd),
              baseRentPerSf: Number(r.baseRentPerSf),
            }))
            .filter(
              (r) =>
                Number.isFinite(r.monthsStart) &&
                Number.isFinite(r.monthsEnd) &&
                Number.isFinite(r.baseRentPerSf) &&
                r.baseRentPerSf > 0 &&
                r.monthsStart >= 1 &&
                r.monthsEnd >= r.monthsStart &&
                r.monthsEnd <= 12
            ),
          ti_description: tiDescription,
          security_deposit_months: Number(securityDepositMonths),
          personal_guarantee: personalGuarantee,
          permitted_use: permittedUse,
          contingencies,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setPdfUrl(j.pdf_url ?? null);
      setFilename(j.filename ?? null);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-3 lg:p-8"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft flex flex-col max-h-[calc(100vh-1rem)] lg:max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] shrink-0">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
            Tenant LOI · {propertyName}
          </div>
          <h2 className="mt-1 font-heading text-lg font-semibold text-cream">
            {step === "source" && "Draft Tenant LOI — Source"}
            {step === "form" && (editingLoiId ? "Edit Tenant LOI — Terms" : "Draft Tenant LOI — Terms")}
            {step === "done" && (editingLoiId ? "LOI Updated" : "LOI Drafted")}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
              {error}
            </div>
          )}

          {step === "source" && (
            <SourceStep
              leads={activeLeads}
              onPickLead={pickFromLead}
              onStartBlank={startBlank}
            />
          )}

          {step === "form" && (
            <TermsForm
              selectedLead={selectedLead}
              tenantEntity={tenantEntity}
              setTenantEntity={setTenantEntity}
              tenantSigningName={tenantSigningName}
              setTenantSigningName={setTenantSigningName}
              tenantSigningTitle={tenantSigningTitle}
              setTenantSigningTitle={setTenantSigningTitle}
              tenantAddress={tenantAddress}
              setTenantAddress={setTenantAddress}
              tenantCity={tenantCity}
              setTenantCity={setTenantCity}
              tenantState={tenantState}
              setTenantState={setTenantState}
              tenantZip={tenantZip}
              setTenantZip={setTenantZip}
              tenantEmail={tenantEmail}
              setTenantEmail={setTenantEmail}
              tenantPhone={tenantPhone}
              setTenantPhone={setTenantPhone}
              tenantBrokerName={tenantBrokerName}
              setTenantBrokerName={setTenantBrokerName}
              tenantBrokerage={tenantBrokerage}
              setTenantBrokerage={setTenantBrokerage}
              landlordEntity={landlordEntity}
              setLandlordEntity={setLandlordEntity}
              premisesUnitLabel={premisesUnitLabel}
              setPremisesUnitLabel={setPremisesUnitLabel}
              premisesRsf={premisesRsf}
              setPremisesRsf={setPremisesRsf}
              baseRentPerSf={baseRentPerSf}
              setBaseRentPerSf={setBaseRentPerSf}
              termYears={termYears}
              setTermYears={setTermYears}
              commencementDate={commencementDate}
              setCommencementDate={setCommencementDate}
              annualEscalationPct={annualEscalationPct}
              setAnnualEscalationPct={setAnnualEscalationPct}
              renewalOptionsCount={renewalOptionsCount}
              setRenewalOptionsCount={setRenewalOptionsCount}
              renewalTermYears={renewalTermYears}
              setRenewalTermYears={setRenewalTermYears}
              leaseType={leaseType}
              setLeaseType={setLeaseType}
              freeRentMonths={freeRentMonths}
              setFreeRentMonths={setFreeRentMonths}
              nnnPerSf={nnnPerSf}
              setNnnPerSf={setNnnPerSf}
              rampPeriods={rampPeriods}
              setRampPeriods={setRampPeriods}
              tiDescription={tiDescription}
              setTiDescription={setTiDescription}
              securityDepositMonths={securityDepositMonths}
              setSecurityDepositMonths={setSecurityDepositMonths}
              personalGuarantee={personalGuarantee}
              setPersonalGuarantee={setPersonalGuarantee}
              permittedUse={permittedUse}
              setPermittedUse={setPermittedUse}
              contingencies={contingencies}
              setContingencies={setContingencies}
            />
          )}

          {step === "done" && pdfUrl && (
            <div className="space-y-3">
              <div className="rounded border border-teal-400/40 bg-teal-400/[0.08] px-4 py-3 font-body text-[13px] text-teal-300">
                {editingLoiId
                  ? "LOI updated and re-rendered. Download to grab the new PDF."
                  : "LOI rendered and saved. Download, edit in Word if needed, then send to the tenant."}
              </div>
              <a
                href={pdfUrl}
                download={filename ?? "tenant-loi.pdf"}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center px-4 py-3 rounded border border-coral-400/50 bg-coral-400/[0.18] hover:bg-coral-400/[0.28] font-heading text-[12px] uppercase tracking-eyebrow font-semibold text-coral-200 transition-colors"
              >
                Download LOI PDF
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/[0.06] shrink-0 bg-steward-base flex items-center justify-between gap-2 rounded-b">
          {step === "form" && (
            <button
              onClick={() => setStep("source")}
              disabled={busy}
              className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-50"
            >
              ← Back
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => !busy && onClose()}
              disabled={busy}
              className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-50"
            >
              {step === "done" ? "Close" : "Cancel"}
            </button>
            {step === "form" && (
              <button
                onClick={submit}
                disabled={busy}
                className="px-4 py-2 rounded border border-coral-400/50 bg-coral-400/[0.18] hover:bg-coral-400/[0.28] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-200 transition-colors disabled:opacity-40"
              >
                {busy
                  ? (editingLoiId ? "Updating…" : "Drafting…")
                  : (editingLoiId ? "Save changes →" : "Generate LOI →")}
              </button>
            )}
            {step === "done" && (
              <button
                onClick={() => setStep("source")}
                className="px-4 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                + Draft another LOI
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Source picker ───────────────────────────────────────────────
function SourceStep({
  leads,
  onPickLead,
  onStartBlank,
}: {
  leads: LeadOption[];
  onPickLead: (id: string) => void;
  onStartBlank: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-2">
          From an existing lead
        </div>
        {leads.length === 0 ? (
          <div className="font-body text-[12px] text-cream-dim italic">
            No active leads on this property yet.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => onPickLead(lead.id)}
                className="w-full text-left px-3 py-2.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-coral-400/[0.06] hover:border-coral-400/30 transition-colors"
              >
                <div className="font-heading text-[13px] text-cream">
                  {lead.senderName ?? "Unnamed lead"}
                </div>
                <div className="font-mono text-[10.5px] text-cream-subtle mt-0.5 flex flex-wrap gap-x-3">
                  {lead.senderEmail && <span>{lead.senderEmail}</span>}
                  {lead.intent && <span>· {lead.intent}</span>}
                  {lead.urgency && <span>· {lead.urgency}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-2">
          Or start blank
        </div>
        <button
          onClick={onStartBlank}
          className="w-full px-3 py-2.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-coral-400/[0.06] hover:border-coral-400/30 transition-colors text-left"
        >
          <div className="font-heading text-[13px] text-cream">Blank LOI</div>
          <div className="font-mono text-[10.5px] text-cream-subtle mt-0.5">
            Enter tenant details manually — cold prospect, off-market deal, etc.
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Step 2 — Terms form ──────────────────────────────────────────────────
interface TermsFormProps {
  selectedLead: LeadOption | null;
  tenantEntity: string;
  setTenantEntity: (v: string) => void;
  tenantSigningName: string;
  setTenantSigningName: (v: string) => void;
  tenantSigningTitle: string;
  setTenantSigningTitle: (v: string) => void;
  tenantAddress: string;
  setTenantAddress: (v: string) => void;
  tenantCity: string;
  setTenantCity: (v: string) => void;
  tenantState: string;
  setTenantState: (v: string) => void;
  tenantZip: string;
  setTenantZip: (v: string) => void;
  tenantEmail: string;
  setTenantEmail: (v: string) => void;
  tenantPhone: string;
  setTenantPhone: (v: string) => void;
  tenantBrokerName: string;
  setTenantBrokerName: (v: string) => void;
  tenantBrokerage: string;
  setTenantBrokerage: (v: string) => void;
  landlordEntity: string;
  setLandlordEntity: (v: string) => void;
  premisesUnitLabel: string;
  setPremisesUnitLabel: (v: string) => void;
  premisesRsf: string;
  setPremisesRsf: (v: string) => void;
  baseRentPerSf: string;
  setBaseRentPerSf: (v: string) => void;
  termYears: string;
  setTermYears: (v: string) => void;
  commencementDate: string;
  setCommencementDate: (v: string) => void;
  annualEscalationPct: string;
  setAnnualEscalationPct: (v: string) => void;
  renewalOptionsCount: string;
  setRenewalOptionsCount: (v: string) => void;
  renewalTermYears: string;
  setRenewalTermYears: (v: string) => void;
  leaseType: string;
  setLeaseType: (v: string) => void;
  freeRentMonths: string;
  setFreeRentMonths: (v: string) => void;
  nnnPerSf: string;
  setNnnPerSf: (v: string) => void;
  rampPeriods: { label: string; monthsStart: string; monthsEnd: string; baseRentPerSf: string }[];
  setRampPeriods: (
    v: { label: string; monthsStart: string; monthsEnd: string; baseRentPerSf: string }[]
  ) => void;
  tiDescription: string;
  setTiDescription: (v: string) => void;
  securityDepositMonths: string;
  setSecurityDepositMonths: (v: string) => void;
  personalGuarantee: boolean;
  setPersonalGuarantee: (v: boolean) => void;
  permittedUse: string;
  setPermittedUse: (v: string) => void;
  contingencies: string;
  setContingencies: (v: string) => void;
}

const inputCls =
  "w-full px-2.5 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[12px] text-cream focus:outline-none focus:border-coral-400/50 focus:bg-coral-400/[0.04]";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </div>
      {children}
      {hint && <div className="font-mono text-[9.5px] text-cream-subtle mt-0.5">{hint}</div>}
    </label>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">{label}</div>
      {children}
    </div>
  );
}

function TermsForm(p: TermsFormProps) {
  return (
    <div className="space-y-5">
      {p.selectedLead && (
        <div className="rounded border border-teal-400/30 bg-teal-400/[0.06] px-3 py-2 font-body text-[12px] text-teal-200">
          Prefilled from lead: <span className="font-semibold">{p.selectedLead.senderName}</span>
          {p.selectedLead.senderEmail && ` · ${p.selectedLead.senderEmail}`}
        </div>
      )}

      <Section label="Tenant identity">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tenant entity (LLC)" hint="Goes in §3 + signature block">
            <input value={p.tenantEntity} onChange={(e) => p.setTenantEntity(e.target.value)} placeholder="M'Bodied Mvmt LLC" className={inputCls} />
          </Field>
          <Field label="Landlord entity" hint="Defaults from property owner">
            <input value={p.landlordEntity} onChange={(e) => p.setLandlordEntity(e.target.value)} placeholder="Liberty Square Holdings" className={inputCls} />
          </Field>
          <Field label="Signing name">
            <input value={p.tenantSigningName} onChange={(e) => p.setTenantSigningName(e.target.value)} placeholder="Marisa Winslow" className={inputCls} />
          </Field>
          <Field label="Signing title">
            <input value={p.tenantSigningTitle} onChange={(e) => p.setTenantSigningTitle(e.target.value)} placeholder="Founder, M'Bodied Mvmt" className={inputCls} />
          </Field>
          <Field label="Tenant street address">
            <input value={p.tenantAddress} onChange={(e) => p.setTenantAddress(e.target.value)} placeholder="1320 Brandywine Rd" className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="City">
              <input value={p.tenantCity} onChange={(e) => p.setTenantCity(e.target.value)} placeholder="Crown Point" className={inputCls} />
            </Field>
            <Field label="ST">
              <input value={p.tenantState} onChange={(e) => p.setTenantState(e.target.value)} placeholder="IN" className={inputCls} />
            </Field>
            <Field label="Zip">
              <input value={p.tenantZip} onChange={(e) => p.setTenantZip(e.target.value)} placeholder="46307" className={inputCls} />
            </Field>
          </div>
          <Field label="Tenant email">
            <input value={p.tenantEmail} onChange={(e) => p.setTenantEmail(e.target.value)} placeholder="optional" className={inputCls} />
          </Field>
          <Field label="Tenant phone">
            <input value={p.tenantPhone} onChange={(e) => p.setTenantPhone(e.target.value)} placeholder="optional" className={inputCls} />
          </Field>
          <Field label="Tenant broker (if any)">
            <input value={p.tenantBrokerName} onChange={(e) => p.setTenantBrokerName(e.target.value)} placeholder="Optional — §13" className={inputCls} />
          </Field>
          <Field label="Tenant brokerage">
            <input value={p.tenantBrokerage} onChange={(e) => p.setTenantBrokerage(e.target.value)} placeholder="Coldwell Banker, etc." className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section label="Premises & rent">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Premises unit label" hint="§1 — e.g. 'Unit 41-51 W 78th Place'">
            <input value={p.premisesUnitLabel} onChange={(e) => p.setPremisesUnitLabel(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Available SF (RSF)" hint="§1 — rentable square feet">
            <input inputMode="numeric" value={p.premisesRsf} onChange={(e) => p.setPremisesRsf(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Base rent $/SF/yr" hint="§7 Year 1 rate">
            <input inputMode="decimal" value={p.baseRentPerSf} onChange={(e) => p.setBaseRentPerSf(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Annual escalation %" hint="§7 — compounds yearly">
            <input inputMode="decimal" value={p.annualEscalationPct} onChange={(e) => p.setAnnualEscalationPct(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Term (years)" hint="§5 — initial term">
            <input inputMode="numeric" value={p.termYears} onChange={(e) => p.setTermYears(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Commencement date">
            <input type="date" value={p.commencementDate} onChange={(e) => p.setCommencementDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section label="Ramp / discount periods (Year 1)">
        <div className="font-body text-[11.5px] text-cream-dim mb-1">
          Add stepped/discount sub-periods within Year 1 — e.g. Months 1-6 at $9.50/SF, Months 7-12 at full
          rate. Leave empty if Year 1 runs at the full base rent the whole way.
        </div>
        {p.rampPeriods.length === 0 ? (
          <div className="font-body text-[12px] text-cream-subtle italic mb-2">
            No ramp periods — Year 1 will be flat at the base rate.
          </div>
        ) : (
          <div className="space-y-2 mb-2">
            {p.rampPeriods.map((ramp, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_70px_70px_90px_auto] gap-2 items-end p-2 rounded border border-white/[0.06] bg-white/[0.02]"
              >
                <Field label="Label">
                  <input
                    value={ramp.label}
                    onChange={(e) => {
                      const next = [...p.rampPeriods];
                      next[idx] = { ...next[idx], label: e.target.value };
                      p.setRampPeriods(next);
                    }}
                    placeholder={`Months ${ramp.monthsStart || "1"}-${ramp.monthsEnd || "6"}`}
                    className={inputCls}
                  />
                </Field>
                <Field label="Mo start">
                  <input
                    inputMode="numeric"
                    value={ramp.monthsStart}
                    onChange={(e) => {
                      const next = [...p.rampPeriods];
                      next[idx] = { ...next[idx], monthsStart: e.target.value };
                      p.setRampPeriods(next);
                    }}
                    className={inputCls}
                  />
                </Field>
                <Field label="Mo end">
                  <input
                    inputMode="numeric"
                    value={ramp.monthsEnd}
                    onChange={(e) => {
                      const next = [...p.rampPeriods];
                      next[idx] = { ...next[idx], monthsEnd: e.target.value };
                      p.setRampPeriods(next);
                    }}
                    className={inputCls}
                  />
                </Field>
                <Field label="Base $/SF">
                  <input
                    inputMode="decimal"
                    value={ramp.baseRentPerSf}
                    onChange={(e) => {
                      const next = [...p.rampPeriods];
                      next[idx] = { ...next[idx], baseRentPerSf: e.target.value };
                      p.setRampPeriods(next);
                    }}
                    className={inputCls}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => {
                    p.setRampPeriods(p.rampPeriods.filter((_, i) => i !== idx));
                  }}
                  className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-red-500/[0.10] hover:border-red-400/40 hover:text-red-300 font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle transition-colors self-end"
                  title="Remove this period"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            const lastEnd = p.rampPeriods.length
              ? Number(p.rampPeriods[p.rampPeriods.length - 1].monthsEnd) || 0
              : 0;
            const start = lastEnd + 1;
            const end = Math.min(start + 5, 12);
            p.setRampPeriods([
              ...p.rampPeriods,
              {
                label: `Months ${start}-${end}`,
                monthsStart: String(start),
                monthsEnd: String(end),
                baseRentPerSf: "",
              },
            ]);
          }}
          className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-coral-400/[0.10] hover:border-coral-400/40 font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-coral-300 transition-colors"
        >
          + Add ramp period
        </button>
      </Section>

      <Section label="Lease structure">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lease type" hint="§8 — NNN/Gross/etc.">
            <select value={p.leaseType} onChange={(e) => p.setLeaseType(e.target.value)} className={inputCls}>
              {LEASE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="NNN $/SF/yr (optional)" hint="§7+§8 — pass-through estimate">
            <input inputMode="decimal" value={p.nnnPerSf} onChange={(e) => p.setNnnPerSf(e.target.value)} placeholder="e.g. 4.00" className={inputCls} />
          </Field>
          <Field label="Free rent (months at $0)" hint="§9 — different from ramp discount">
            <input inputMode="numeric" value={p.freeRentMonths} onChange={(e) => p.setFreeRentMonths(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Security deposit (months)" hint="§11 — of Year 1 Base Rent">
            <input inputMode="numeric" value={p.securityDepositMonths} onChange={(e) => p.setSecurityDepositMonths(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Renewal options (count)" hint="§6">
            <input inputMode="numeric" value={p.renewalOptionsCount} onChange={(e) => p.setRenewalOptionsCount(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Renewal term (years each)" hint="§6">
            <input inputMode="numeric" value={p.renewalTermYears} onChange={(e) => p.setRenewalTermYears(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Personal guarantee" hint="§12">
            <select value={String(p.personalGuarantee)} onChange={(e) => p.setPersonalGuarantee(e.target.value === "true")} className={inputCls}>
              <option value="true">Yes — required</option>
              <option value="false">No</option>
            </select>
          </Field>
        </div>
        <Field label="TI description" hint="§10 — freeform; default pulled from property">
          <textarea value={p.tiDescription} onChange={(e) => p.setTiDescription(e.target.value)} rows={2} className={inputCls + " font-body text-[12.5px]"} />
        </Field>
      </Section>

      <Section label="Use + contingencies">
        <Field label="Permitted use" hint="§4 — describe tenant's business + ancillary uses">
          <textarea value={p.permittedUse} onChange={(e) => p.setPermittedUse(e.target.value)} rows={3} className={inputCls + " font-body text-[12.5px]"} placeholder="Women's fitness studio, including ancillary uses customary to the operation of such a studio (e.g., retail of branded apparel, member events, group classes)." />
        </Field>
        <Field label="Contingencies" hint="§14 — typically 'None'">
          <input value={p.contingencies} onChange={(e) => p.setContingencies(e.target.value)} className={inputCls} />
        </Field>
      </Section>
    </div>
  );
}
