"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * CreateContactDialog — quick-add for a new person. Captures the minimum to
 * make a useful contact row: name + email/phone + (optional) company + role
 * + relationship type + warmth.
 *
 * If the company-name field is filled, the API will create the company on
 * the fly (no separate "add company" flow needed).
 */
export function CreateContactDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (contactId: string) => void;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [contactType, setContactType] = useState<string>("buyer");
  const [warmth, setWarmth] = useState<string>("warm");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("IN");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        role: role.trim() || undefined,
        contact_type: contactType,
        warmth,
        city: city.trim() || undefined,
        state: stateCode.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (onCreated) onCreated(json.contact.id);
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">New contact</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">Add a person to your network</h2>
          </div>
          <button onClick={onClose} className="text-cream-subtle hover:text-cream font-mono text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <Field label="Full name *">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Smith" autoFocus className={fieldCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@firm.com" className={fieldCls} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(312) 555-0123" className={fieldCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Capital" className={fieldCls} />
            </Field>
            <Field label="Role / title">
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Acquisitions Director" className={fieldCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={contactType} onChange={(e) => setContactType(e.target.value)} className={fieldCls}>
                <option value="buyer">Buyer / Investor</option>
                <option value="seller">Seller / Owner</option>
                <option value="tenant">Tenant</option>
                <option value="broker">Broker (other side)</option>
                <option value="lender">Lender</option>
                <option value="attorney">Attorney</option>
                <option value="vendor">Vendor</option>
                <option value="referral">Referral source</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Warmth">
              <select value={warmth} onChange={(e) => setWarmth(e.target.value)} className={fieldCls}>
                <option value="hot">Hot — recent contact, active</option>
                <option value="warm">Warm — known, engaged</option>
                <option value="cool">Cool — distant, occasional</option>
                <option value="cold">Cold — no recent contact</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} className={fieldCls} /></Field>
            <Field label="State"><input value={stateCode} onChange={(e) => setStateCode(e.target.value)} maxLength={2} className={fieldCls} /></Field>
            <div />
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What they're looking for, intro context…" className={`${fieldCls} resize-y`} />
          </Field>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
            <button onClick={onClose} className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream">Cancel</button>
            <button onClick={submit} disabled={busy} className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40">
              {busy ? "Adding…" : "Add contact"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
