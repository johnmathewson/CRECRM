"use client";

/**
 * EditContactDialog — modal for editing every mutable field on an
 * existing contact. Pre-populated from a fresh GET /api/contacts/[id]
 * (so we get the joined company name); PATCHes the same endpoint on
 * save and refreshes the page.
 *
 * Mirrors CreateContactDialog's section structure so the broker's
 * mental model carries between create and edit.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  contactId: string;
  initialFullName: string;
  onClose: () => void;
}

interface FullContactRow {
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  contact_type: string | null;
  relationship_type: string | null;
  warmth: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  next_follow_up: string | null;
  last_conversation: string | null;
  company_id: string | null;
  company_name: string | null;
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function EditContactDialog({ open, contactId, initialFullName, onClose }: Props) {
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
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [lastConversation, setLastConversation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate when opening — pull the fresh row so we don't miss any field.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setHydrating(true);
    fetch(`/api/contacts/${contactId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        const c = json.contact as FullContactRow;
        setFullName(c.full_name ?? "");
        setEmail(c.email ?? "");
        setPhone(c.phone ?? "");
        setCompany(c.company_name ?? "");
        setRole(c.role ?? "");
        setContactType(c.contact_type ?? "buyer");
        setWarmth(c.warmth ?? "warm");
        setCity(c.city ?? "");
        setStateCode(c.state ?? "IN");
        setNextFollowUp(c.next_follow_up ?? "");
        setLastConversation(c.last_conversation ?? "");
        setNotes(c.notes ?? "");
      })
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => setHydrating(false));
  }, [open, contactId]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
      // Build payload — explicit "" → null lets cleared inputs actually clear.
      const payload: Record<string, any> = {
        full_name: fullName.trim(),
        email: orNull(email),
        phone: orNull(phone),
        company: company.trim(),  // server will resolve to company_id (or clear if empty)
        role: orNull(role),
        contact_type: contactType,
        warmth,
        city: orNull(city),
        state: orNull(stateCode),
        next_follow_up: orNull(nextFollowUp),
        last_conversation: orNull(lastConversation),
        notes: orNull(notes),
      };
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
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
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">Edit contact</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate max-w-md">
              {fullName || initialFullName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-cream-subtle hover:text-cream font-mono text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {hydrating && (
            <div className="font-mono text-[10px] text-cream-subtle text-center py-1">Loading contact…</div>
          )}

          <Field label="Full name *">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company" hint="Type a name; new companies are auto-created. Clear to detach.">
              <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Role / title">
              <input value={role} onChange={(e) => setRole(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={contactType} onChange={(e) => setContactType(e.target.value)} className={inputCls}>
                <option value="buyer">Buyer / Investor</option>
                <option value="seller">Seller / Owner</option>
                <option value="owner">Owner</option>
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
              <select value={warmth} onChange={(e) => setWarmth(e.target.value)} className={inputCls}>
                <option value="hot">Hot — recent contact, active</option>
                <option value="warm">Warm — known, engaged</option>
                <option value="cool">Cool — distant, occasional</option>
                <option value="cold">Cold — no recent contact</option>
                <option value="dormant">Dormant — long time, archived</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
            </Field>
            <Field label="State">
              <input value={stateCode} onChange={(e) => setStateCode(e.target.value)} maxLength={2} className={inputCls} />
            </Field>
            <div />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last conversation" hint="When you last spoke. Drives the warmth score.">
              <input
                type="date"
                value={lastConversation}
                onChange={(e) => setLastConversation(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Next follow-up" hint="Surfaces in 'Follow-ups due' triage.">
              <input
                type="date"
                value={nextFollowUp}
                onChange={(e) => setNextFollowUp(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-y`} />
          </Field>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.04]">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</span>
      {hint && <span className="block mt-0.5 font-body text-[10px] text-cream-subtle">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
