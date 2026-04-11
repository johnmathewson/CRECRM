"use client";

import { useState } from "react";
import Modal, { FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from "./modal";
import { createClient } from "@/lib/supabase/client";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateContactModal({ open, onClose, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "", role: "", phone: "", email: "",
    city: "", state: "", contact_type: "owner",
    warmth: "warm", relationship_type: "prospect", notes: "",
  });

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from("contacts").insert({
      organization_id: ORG_ID,
      full_name: form.full_name,
      role: form.role || null,
      phone: form.phone || null,
      email: form.email || null,
      city: form.city || null,
      state: form.state || null,
      contact_type: form.contact_type,
      warmth: form.warmth,
      relationship_type: form.relationship_type,
      notes: form.notes || null,
    });

    setSaving(false);
    if (!error) {
      setForm({ full_name: "", role: "", phone: "", email: "", city: "", state: "", contact_type: "owner", warmth: "warm", relationship_type: "prospect", notes: "" });
      onCreated();
      onClose();
    } else {
      alert("Error: " + error.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Contact">
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
          <FormField label="Full Name *">
            <input style={inputStyle} required value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Jane Smith" />
          </FormField>
          <FormField label="Role / Title">
            <input style={inputStyle} value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="Owner, VP, Investor..." />
          </FormField>
          <FormField label="Email">
            <input style={inputStyle} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@example.com" />
          </FormField>
          <FormField label="Phone">
            <input style={inputStyle} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(219) 555-0000" />
          </FormField>
          <FormField label="City">
            <input style={inputStyle} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Merrillville" />
          </FormField>
          <FormField label="State">
            <input style={inputStyle} value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="IN" />
          </FormField>
          <FormField label="Contact Type">
            <select style={selectStyle} value={form.contact_type} onChange={(e) => set("contact_type", e.target.value)}>
              <option value="owner">Owner</option>
              <option value="buyer/tenant">Buyer/Tenant</option>
              <option value="broker">Broker</option>
              <option value="vendor">Vendor</option>
              <option value="lender">Lender</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Warmth">
            <select style={selectStyle} value={form.warmth} onChange={(e) => set("warmth", e.target.value)}>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
              <option value="new">New</option>
            </select>
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any notes about this contact..." />
        </FormField>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button type="button" style={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Creating..." : "Create Contact"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
