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

export default function CreatePropertyModal({ open, onClose, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", address: "", city: "", state: "IN", zip: "",
    asset_type: "retail", status: "idea", asking_price: "",
    lease_rate: "", sqft: "", acreage: "", year_built: "",
    your_role: "listing_broker", notes: "",
  });

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from("properties").insert({
      organization_id: ORG_ID,
      name: form.name,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      asset_type: form.asset_type,
      status: form.status,
      asking_price: form.asking_price ? parseFloat(form.asking_price) : null,
      lease_rate: form.lease_rate ? parseFloat(form.lease_rate) : null,
      sqft: form.sqft ? parseInt(form.sqft) : null,
      acreage: form.acreage ? parseFloat(form.acreage) : null,
      year_built: form.year_built ? parseInt(form.year_built) : null,
      your_role: form.your_role,
      notes: form.notes || null,
    });

    setSaving(false);
    if (!error) {
      setForm({ name: "", address: "", city: "", state: "IN", zip: "", asset_type: "retail", status: "idea", asking_price: "", lease_rate: "", sqft: "", acreage: "", year_built: "", your_role: "listing_broker", notes: "" });
      onCreated();
      onClose();
    } else {
      alert("Error: " + error.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Property" width={580}>
      <form onSubmit={handleSubmit}>
        <FormField label="Property Name *">
          <input style={inputStyle} required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Liberty Square Shopping Center" />
        </FormField>
        <FormField label="Address">
          <input style={inputStyle} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St" />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0 14px" }}>
          <FormField label="City">
            <input style={inputStyle} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Merrillville" />
          </FormField>
          <FormField label="State">
            <input style={inputStyle} value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="IN" />
          </FormField>
          <FormField label="Zip">
            <input style={inputStyle} value={form.zip} onChange={(e) => set("zip", e.target.value)} placeholder="46410" />
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 14px" }}>
          <FormField label="Asset Type">
            <select style={selectStyle} value={form.asset_type} onChange={(e) => set("asset_type", e.target.value)}>
              {["retail", "office", "industrial", "multifamily", "hotel", "land", "mixed_use", "restaurant", "medical", "flex"].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Status">
            <select style={selectStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["idea", "pre_listing", "listed", "under_contract", "sold", "for_lease", "leased", "off_market"].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Your Role">
            <select style={selectStyle} value={form.your_role} onChange={(e) => set("your_role", e.target.value)}>
              {["listing_broker", "buyer_rep", "dual_agent", "referral", "consulting", "prospect"].map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
              ))}
            </select>
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 14px" }}>
          <FormField label="Asking Price">
            <input style={inputStyle} type="number" value={form.asking_price} onChange={(e) => set("asking_price", e.target.value)} placeholder="5500000" />
          </FormField>
          <FormField label="Lease Rate ($/SF)">
            <input style={inputStyle} type="number" step="0.01" value={form.lease_rate} onChange={(e) => set("lease_rate", e.target.value)} placeholder="12.50" />
          </FormField>
          <FormField label="Square Feet">
            <input style={inputStyle} type="number" value={form.sqft} onChange={(e) => set("sqft", e.target.value)} placeholder="48000" />
          </FormField>
          <FormField label="Year Built">
            <input style={inputStyle} type="number" value={form.year_built} onChange={(e) => set("year_built", e.target.value)} placeholder="1995" />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any notes about this property..." />
        </FormField>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button type="button" style={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Creating..." : "Create Property"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
