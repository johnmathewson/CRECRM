"use client";

import { useEffect, useState } from "react";
import Modal, { FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from "./modal";
import { createClient } from "@/lib/supabase/client";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateDealModal({ open, onClose, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [contacts, setContacts] = useState<{ id: string; full_name: string }[]>([]);
  const [form, setForm] = useState({
    deal_name: "", deal_type: "sale", property_id: "", client_contact_id: "",
    price: "", commission_pct: "2.5", probability_pct: "25",
    expected_close: "", stage: "Lead", notes: "",
  });

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  // Load properties and contacts for dropdowns
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase.from("properties").select("id, name").order("name").then(({ data }) => setProperties(data || []));
    supabase.from("contacts").select("id, full_name").order("full_name").then(({ data }) => setContacts(data || []));
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();

    const price = form.price ? parseFloat(form.price) : 0;
    const commPct = form.commission_pct ? parseFloat(form.commission_pct) / 100 : 0;
    const prob = form.probability_pct ? parseFloat(form.probability_pct) / 100 : 0;
    const estComm = price * commPct;
    const weighted = estComm * prob;

    // Create the deal
    const { data: deal, error } = await supabase.from("deals").insert({
      organization_id: ORG_ID,
      deal_name: form.deal_name,
      deal_type: form.deal_type,
      property_id: form.property_id || null,
      client_contact_id: form.client_contact_id || null,
      price,
      commission_pct: commPct,
      estimated_commission: estComm,
      probability_pct: prob,
      weighted_commission: weighted,
      expected_close: form.expected_close || null,
      assigned_to: USER_ID,
      notes: form.notes || null,
    }).select("id").single();

    if (!error && deal) {
      // Create initial deal stage
      await supabase.from("deal_stages").insert({
        deal_id: deal.id,
        stage: form.stage,
        entered_at: new Date().toISOString(),
        entered_by: USER_ID,
      });
    }

    setSaving(false);
    if (!error) {
      setForm({ deal_name: "", deal_type: "sale", property_id: "", client_contact_id: "", price: "", commission_pct: "2.5", probability_pct: "25", expected_close: "", stage: "Lead", notes: "" });
      onCreated();
      onClose();
    } else {
      alert("Error: " + error.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Deal" width={580}>
      <form onSubmit={handleSubmit}>
        <FormField label="Deal Name *">
          <input style={inputStyle} required value={form.deal_name} onChange={(e) => set("deal_name", e.target.value)} placeholder="Liberty Square Sale" />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
          <FormField label="Deal Type">
            <select style={selectStyle} value={form.deal_type} onChange={(e) => set("deal_type", e.target.value)}>
              <option value="sale">Sale</option>
              <option value="lease">Lease</option>
            </select>
          </FormField>
          <FormField label="Initial Stage">
            <select style={selectStyle} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
              <option value="Lead">Lead</option>
              <option value="LOI">LOI</option>
              <option value="Listing">Listing</option>
              <option value="Under Contract">Under Contract</option>
              <option value="Closed">Closed</option>
            </select>
          </FormField>
          <FormField label="Property">
            <select style={selectStyle} value={form.property_id} onChange={(e) => set("property_id", e.target.value)}>
              <option value="">— Select property —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
          <FormField label="Client Contact">
            <select style={selectStyle} value={form.client_contact_id} onChange={(e) => set("client_contact_id", e.target.value)}>
              <option value="">— Select contact —</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 14px" }}>
          <FormField label="Price ($)">
            <input style={inputStyle} type="number" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="5500000" />
          </FormField>
          <FormField label="Commission %">
            <input style={inputStyle} type="number" step="0.1" value={form.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} placeholder="2.5" />
          </FormField>
          <FormField label="Probability %">
            <input style={inputStyle} type="number" value={form.probability_pct} onChange={(e) => set("probability_pct", e.target.value)} placeholder="25" />
          </FormField>
          <FormField label="Expected Close">
            <input style={inputStyle} type="date" value={form.expected_close} onChange={(e) => set("expected_close", e.target.value)} />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any notes about this deal..." />
        </FormField>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button type="button" style={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Creating..." : "Create Deal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
