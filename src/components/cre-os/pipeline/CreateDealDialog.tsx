"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PropertyOption {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}
interface ContactOption {
  id: string;
  fullName: string;
  email: string | null;
}

/**
 * CreateDealDialog — for the deals that *aren't* a side-effect of a property
 * (those auto-create when you add a property). Used to track:
 *   • Buyer-rep pursuits (a buyer with criteria, no specific property yet)
 *   • Side deals on an existing property (a second offer after one fell out)
 *   • Anything else that lives in pipeline but doesn't begin with adding a
 *     property.
 *
 * Picks: deal type, property (optional), client contact (optional), price,
 * stage, expected close.
 */
export function CreateDealDialog({
  open,
  onClose,
  properties,
  contacts,
  defaultDealType = "sale",
  defaultPropertyId,
}: {
  open: boolean;
  onClose: () => void;
  properties: PropertyOption[];
  contacts: ContactOption[];
  defaultDealType?: "sale" | "lease" | "buyer_rep";
  defaultPropertyId?: string;
}) {
  const router = useRouter();
  const [dealType, setDealType] = useState<"sale" | "lease" | "buyer_rep">(defaultDealType);
  const [dealName, setDealName] = useState("");
  const [propertyId, setPropertyId] = useState<string>(defaultPropertyId || "");
  const [contactId, setContactId] = useState<string>("");
  const [propertyQuery, setPropertyQuery] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [price, setPrice] = useState("");
  // Commission inputs — broker-side. For sale the natural default
  // is price × commission_pct; for lease the dollar amount typically
  // comes from total lease consideration (term × annual rent × pct)
  // which the broker computes externally. So we let them set either
  // % OR a dollar amount and store both, no auto-overwrite.
  const [commissionPct, setCommissionPct] = useState("");
  const [estimatedCommission, setEstimatedCommission] = useState("");
  const [probability, setProbability] = useState<number>(25);
  const [expectedClose, setExpectedClose] = useState("");
  const [initialStage, setInitialStage] = useState<string>("Lead");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setError(null); setBusy(false); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filteredProps = propertyQuery
    ? properties.filter((p) =>
        [p.name, p.city, p.state].some((v) => v && v.toLowerCase().includes(propertyQuery.toLowerCase()))
      )
    : properties;
  const filteredContacts = contactQuery
    ? contacts.filter((c) =>
        [c.fullName, c.email].some((v) => v && v.toLowerCase().includes(contactQuery.toLowerCase()))
      )
    : contacts;

  async function submit() {
    setError(null);
    if (!propertyId && !contactId) {
      setError("Pick at least a property or a client contact.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        deal_type: dealType,
        deal_name: dealName.trim() || undefined,
        property_id: propertyId || undefined,
        client_contact_id: contactId || undefined,
        probability_pct: probability,
        expected_close: expectedClose || undefined,
        initial_stage: initialStage,
        notes: notes.trim() || undefined,
      };
      if (price) {
        const n = Number(price.replace(/[$,]/g, ""));
        if (!Number.isNaN(n)) payload.price = n;
      }
      if (commissionPct) {
        const n = Number(commissionPct.replace(/[%]/g, ""));
        if (!Number.isNaN(n)) payload.commission_pct = n;
      }
      if (estimatedCommission) {
        const n = Number(estimatedCommission.replace(/[$,]/g, ""));
        if (!Number.isNaN(n)) payload.estimated_commission = n;
      }
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      if (json.deal?.id) {
        router.push(`/cre-os/pipeline/${json.deal.id}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="my-2 mx-2 lg:my-12 w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">New deal</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">Add a deal to the pipeline</h2>
          </div>
          <button onClick={onClose} className="text-cream-subtle hover:text-cream font-mono text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <Field label="Type" hint="Buyer-rep is for tracking pursuits where there's no specific property yet.">
            <div className="flex gap-2">
              <RadioChip active={dealType === "sale"} onClick={() => setDealType("sale")} label="Sale" sub="seller side" />
              <RadioChip active={dealType === "lease"} onClick={() => setDealType("lease")} label="Lease" sub="leasing side" />
              <RadioChip active={dealType === "buyer_rep"} onClick={() => setDealType("buyer_rep")} label="Buyer rep" sub="buy-side pursuit" />
            </div>
          </Field>

          <Field label="Property" hint={dealType === "buyer_rep" ? "Optional for buyer-rep — fill once you have a target." : "Tie this deal to a property in your portfolio."}>
            <input
              type="text"
              value={propertyQuery}
              onChange={(e) => setPropertyQuery(e.target.value)}
              placeholder="Filter by name, city, state…"
              className={fieldCls}
            />
            <div className="mt-2 max-h-32 overflow-y-auto rounded border border-white/[0.04] bg-steward-surface/30">
              {filteredProps.slice(0, 30).map((p) => {
                const sel = p.id === propertyId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPropertyId(sel ? "" : p.id)}
                    className={`w-full px-3 py-2 text-left border-b border-white/[0.03] last:border-b-0 transition-colors ${sel ? "bg-coral-400/[0.10]" : "hover:bg-white/[0.03]"}`}
                  >
                    <div className="font-body text-[12px] text-cream truncate">{p.name}</div>
                    <div className="font-body text-[10px] text-cream-subtle truncate">{[p.city, p.state].filter(Boolean).join(", ")}</div>
                  </button>
                );
              })}
              {filteredProps.length === 0 && (
                <div className="px-3 py-2 font-body text-[11px] text-cream-subtle">No properties match.</div>
              )}
            </div>
            {propertyId && (
              <div className="mt-1 font-body text-[10px] text-coral-300">
                Selected: {properties.find((p) => p.id === propertyId)?.name}{" "}
                <button onClick={() => setPropertyId("")} className="underline ml-1">clear</button>
              </div>
            )}
          </Field>

          <Field label="Client contact (optional)">
            <input
              type="text"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Filter contacts…"
              className={fieldCls}
            />
            {contactQuery && (
              <div className="mt-2 max-h-32 overflow-y-auto rounded border border-white/[0.04] bg-steward-surface/30">
                {filteredContacts.slice(0, 30).map((c) => {
                  const sel = c.id === contactId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setContactId(sel ? "" : c.id); if (!sel) setContactQuery(c.fullName); }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left border-b border-white/[0.03] last:border-b-0 transition-colors ${sel ? "bg-coral-400/[0.10]" : "hover:bg-white/[0.03]"}`}
                    >
                      <span className="font-body text-[12px] text-cream truncate">{c.fullName}</span>
                      <span className="font-body text-[10px] text-cream-subtle ml-2 truncate">{c.email}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Deal name (optional)" hint="Defaults to property + contact.">
            <input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="e.g. 850 Lakeshore — Acme Capital" className={fieldCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={dealType === "lease" ? "Rate ($/SF/yr)" : "Price"}>
              <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={dealType === "lease" ? "$24.50" : "$2,400,000"} className={fieldCls} />
            </Field>
            <Field label="Probability %">
              <input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(Number(e.target.value))} className={fieldCls} />
            </Field>
          </div>

          {/* Commission — broker's take-home. For sale the natural
              calc is price × pct. For lease the dollar amount is
              usually computed off total lease consideration, so we
              accept either or both rather than auto-overwrite one
              from the other. */}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Commission %"
              hint={dealType === "sale" ? "Typical sale: 3-6%" : dealType === "lease" ? "Of total lease value" : ""}
            >
              <input
                type="text"
                inputMode="decimal"
                value={commissionPct}
                onChange={(e) => {
                  setCommissionPct(e.target.value);
                  // Auto-suggest est. commission on SALE deals when price is set
                  // and the broker hasn't manually overridden it. Lease commission
                  // calculation is too varied to auto-derive, so we leave it alone.
                  if (dealType === "sale" && price && !estimatedCommission) {
                    const p = Number(price.replace(/[$,]/g, ""));
                    const pct = Number(e.target.value.replace(/[%]/g, ""));
                    if (!Number.isNaN(p) && !Number.isNaN(pct)) {
                      setEstimatedCommission(String(Math.round((p * pct) / 100)));
                    }
                  }
                }}
                placeholder={dealType === "sale" ? "5" : "6"}
                className={fieldCls}
              />
            </Field>
            <Field
              label="Est. commission ($)"
              hint={dealType === "sale" ? "Auto-fills from price × %" : "You enter — varies by lease structure"}
            >
              <input
                type="text"
                inputMode="decimal"
                value={estimatedCommission}
                onChange={(e) => setEstimatedCommission(e.target.value)}
                placeholder="$120,000"
                className={fieldCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting stage">
              <select value={initialStage} onChange={(e) => setInitialStage(e.target.value)} className={fieldCls}>
                <option value="Lead">Lead</option>
                <option value="Prospecting">Prospecting</option>
                <option value="Qualifying">Qualifying</option>
                <option value="BOV">BOV</option>
                <option value="Pre-listing">Pre-listing</option>
                <option value="Active Listing">Active Listing</option>
                <option value="LOI">LOI</option>
                <option value="Underwriting">Underwriting</option>
                <option value="Due Diligence">Due Diligence</option>
                <option value="Financing">Financing</option>
                <option value="Closing">Closing</option>
              </select>
            </Field>
            <Field label="Expected close">
              <input type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} className={fieldCls} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldCls} resize-y`} />
          </Field>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
            <button onClick={onClose} className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream">Cancel</button>
            <button onClick={submit} disabled={busy} className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40">
              {busy ? "Adding…" : "Add deal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      {hint && <div className="mt-0.5 font-body text-[10px] text-cream-subtle">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function RadioChip({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 rounded border text-left transition-colors ${active ? "border-coral-400/40 bg-coral-400/[0.10] ring-1 ring-inset ring-coral-400/20" : "border-white/[0.06] bg-steward-surface/40 hover:bg-white/[0.04]"}`}
    >
      <div className={`font-heading text-[12px] font-semibold ${active ? "text-coral-200" : "text-cream"}`}>{label}</div>
      <div className="mt-0.5 font-body text-[10px] text-cream-subtle">{sub}</div>
    </button>
  );
}
