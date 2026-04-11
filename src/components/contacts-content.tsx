"use client";

import { useEffect, useState, useCallback } from "react";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";
import CreateContactModal from "./create-contact-modal";

// ── Types ──────────────────────────────────────────────────
interface Contact {
  id: string;
  full_name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  relationship_type: string | null;
  warmth: string | null;
  contact_type: string | null;
  last_conversation: string | null;
  next_follow_up: string | null;
  notes: string | null;
  company?: { name: string } | null;
  deals?: { id: string; deal_name: string; is_closed: boolean }[];
  demand_profiles?: { id: string; profile_type: string; asset_types: string[] }[];
}

// ── Colors ─────────────────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)", redM: "rgba(231,76,60,0.20)",
};

function WarmthBadge({ warmth }: { warmth: string | null }) {
  const map: Record<string, { bg: string; t: string; label: string }> = {
    hot: { bg: C.coralM, t: C.coral, label: "Hot" },
    warm: { bg: C.amberM, t: C.amber, label: "Warm" },
    cold: { bg: C.tealM, t: C.teal, label: "Cold" },
    new: { bg: "rgba(255,255,255,0.08)", t: "rgba(240,237,228,0.5)", label: "New" },
  };
  const c = map[(warmth || "new").toLowerCase()] || map.new;
  return (
    <span
      className="px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ borderRadius: 4, background: c.bg, color: c.t }}
    >
      {c.label}
    </span>
  );
}

function TypeBadge({ type }: { type: string | null }) {
  const isOwner = type?.toLowerCase().includes("owner");
  const isBuyer = type?.toLowerCase().includes("buyer");
  const isTenant = type?.toLowerCase().includes("tenant");
  const isBroker = type?.toLowerCase().includes("broker");
  const color = isOwner ? C.coral : isBuyer ? C.green : isTenant ? C.teal : isBroker ? C.amber : "rgba(240,237,228,0.5)";
  const bg = isOwner ? C.coralM : isBuyer ? C.greenM : isTenant ? C.tealM : isBroker ? C.amberM : "rgba(255,255,255,0.08)";
  return (
    <span
      className="px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap capitalize"
      style={{ borderRadius: 4, background: bg, color }}
    >
      {type || "—"}
    </span>
  );
}

function daysSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 30) return `${diff}d ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}yr ago`;
}

// ── Main ──────────────────────────────────────────────────
export default function ContactsContent() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("contacts")
        .select(`
          id, full_name, role, phone, email, city, state,
          relationship_type, warmth, contact_type, last_conversation,
          next_follow_up, notes,
          company:companies(name),
          deals(id, deal_name, is_closed),
          demand_profiles(id, profile_type, asset_types)
        `)
        .order("full_name");

      setContacts((data as any) || []);
      setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter + search
  const filtered = contacts.filter((c) => {
    if (filter !== "all" && c.contact_type?.toLowerCase() !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.full_name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.role || "").toLowerCase().includes(q) ||
        ((c.company as any)?.name || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Counts by type
  const typeCounts: Record<string, number> = { all: contacts.length };
  contacts.forEach((c) => {
    const t = (c.contact_type || "other").toLowerCase();
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Loading contacts...</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Contacts</h1>
          <p className="mt-1 text-cream-muted text-[13px]">
            <span className="text-coral font-semibold">{contacts.length} contacts</span>
            {" · "}{typeCounts["owner"] || 0} owners · {typeCounts["buyer/tenant"] || 0} buyers/tenants · {typeCounts["broker"] || 0} brokers
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-1.5 border-none cursor-pointer text-xs font-semibold text-white"
          style={{
            borderRadius: 5,
            background: "linear-gradient(135deg, #E07A5F, #E07A5FCC)",
            boxShadow: "0 3px 16px rgba(224,122,95,0.35)",
          }}
        >
          + New Contact
        </button>
      </div>

      <CreateContactModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />

      {/* Filter tabs + search */}
      <div className="flex items-center gap-2 mb-4">
        {Object.entries(typeCounts).map(([key, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-[11.5px] font-medium border-none cursor-pointer transition-all ${
              filter === key
                ? "text-coral font-semibold"
                : "text-cream-subtle hover:text-cream-muted"
            }`}
            style={{
              borderRadius: 5,
              background: filter === key ? C.coralM : "rgba(255,255,255,0.03)",
              border: `1px solid ${filter === key ? "rgba(224,122,95,0.2)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <span className="capitalize">{key}</span>
            <span className="ml-1.5 opacity-50">{count}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div
          className="flex items-center gap-2 px-3 py-1.5 w-64"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 5,
          }}
        >
          <span className="opacity-35 text-xs">🔍</span>
          <input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-cream text-xs w-full font-sans"
          />
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: selected ? "1fr 400px" : "1fr" }}>
        {/* Contact list */}
        <Panel title={`${filtered.length} Contacts`} actions={
          <div className="flex gap-1">
            <IconBtn>↻</IconBtn>
            <IconBtn>↓</IconBtn>
            <IconBtn>⋯</IconBtn>
          </div>
        }>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
              <thead>
                <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
                  {["Name", "Company", "Type", "Warmth", "Phone", "Last Contact", "Deals"].map((h) => (
                    <th key={h} className="px-2.5 pb-2 font-medium text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const company = c.company as any;
                  const activeDeals = (c.deals || []).filter((d: any) => !d.is_closed);
                  const isSelected = selected?.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(isSelected ? null : c)}
                      style={{ background: isSelected ? "rgba(224,122,95,0.08)" : undefined }}
                    >
                      <td className="px-2.5 py-2.5 text-[12.5px] font-medium" style={{ borderRadius: "4px 0 0 4px", background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        {c.full_name}
                        {c.role && <div className="text-[10px] text-cream-subtle mt-0.5">{c.role}</div>}
                      </td>
                      <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        {company?.name || "—"}
                      </td>
                      <td className="px-2.5 py-2.5" style={{ background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        <TypeBadge type={c.contact_type} />
                      </td>
                      <td className="px-2.5 py-2.5" style={{ background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        <WarmthBadge warmth={c.warmth} />
                      </td>
                      <td className="px-2.5 py-2.5 text-xs text-cream-muted tnum" style={{ background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        {c.phone || "—"}
                      </td>
                      <td className="px-2.5 py-2.5 text-xs text-cream-subtle" style={{ background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        {daysSince(c.last_conversation)}
                      </td>
                      <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ borderRadius: "0 4px 4px 0", background: isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)" }}>
                        {activeDeals.length > 0 ? (
                          <span className="font-semibold" style={{ color: C.coral }}>{activeDeals.length}</span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Detail sidebar */}
        {selected && (
          <div className="flex flex-col gap-4">
            <Panel title="Contact Detail" actions={
              <div className="flex gap-1">
                <IconBtn onClick={() => setSelected(null)}>✕</IconBtn>
              </div>
            }>
              <div className="flex items-center gap-3.5 mb-4">
                <div
                  className="w-12 h-12 flex items-center justify-center text-lg font-bold flex-shrink-0"
                  style={{
                    borderRadius: 6,
                    background: `linear-gradient(135deg, ${C.coral}20, ${C.coral}08)`,
                    border: `1px solid ${C.coral}30`,
                    color: C.coral,
                  }}
                >
                  {selected.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <div className="text-base font-bold">{selected.full_name}</div>
                  <div className="text-xs text-cream-muted">{selected.role || "—"}</div>
                  {(selected.company as any)?.name && (
                    <div className="text-xs text-cream-subtle mt-0.5">{(selected.company as any).name}</div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <TypeBadge type={selected.contact_type} />
                <WarmthBadge warmth={selected.warmth} />
                {selected.relationship_type && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold capitalize" style={{ borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(240,237,228,0.5)" }}>
                    {selected.relationship_type}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                {[
                  { label: "Email", value: selected.email },
                  { label: "Phone", value: selected.phone },
                  { label: "Location", value: [selected.city, selected.state].filter(Boolean).join(", ") || null },
                  { label: "Last Contact", value: selected.last_conversation ? `${daysSince(selected.last_conversation)} (${new Date(selected.last_conversation).toLocaleDateString()})` : null },
                  { label: "Next Follow-up", value: selected.next_follow_up ? new Date(selected.next_follow_up).toLocaleDateString() : null },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center glass-inner px-3 py-2">
                    <span className="text-[10.5px] text-cream-subtle uppercase tracking-wider font-medium">{row.label}</span>
                    <span className="text-xs text-cream font-medium">{row.value || "—"}</span>
                  </div>
                ))}
              </div>

              {selected.notes && (
                <div className="glass-inner px-3 py-2.5 mt-3">
                  <div className="text-[10.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Notes</div>
                  <div className="text-xs text-cream-muted leading-relaxed">{selected.notes}</div>
                </div>
              )}
            </Panel>

            {/* Deals */}
            {(selected.deals || []).length > 0 && (
              <Panel title="Deals" actions={<IconBtn>↻</IconBtn>}>
                <div className="flex flex-col gap-1.5">
                  {(selected.deals || []).map((d: any) => (
                    <div key={d.id} className="glass-inner flex justify-between items-center px-3 py-2">
                      <span className="text-xs font-medium">{d.deal_name}</span>
                      <span
                        className="px-2 py-0.5 text-[9.5px] font-semibold"
                        style={{
                          borderRadius: 4,
                          background: d.is_closed ? C.greenM : C.coralM,
                          color: d.is_closed ? C.green : C.coral,
                        }}
                      >
                        {d.is_closed ? "Closed" : "Active"}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Demand profiles */}
            {(selected.demand_profiles || []).length > 0 && (
              <Panel title="Demand Profile" actions={<IconBtn>⋯</IconBtn>}>
                {(selected.demand_profiles || []).map((dp: any) => (
                  <div key={dp.id} className="glass-inner px-3 py-2.5 mb-1.5">
                    <div className="text-xs font-semibold capitalize mb-1.5">{dp.profile_type}</div>
                    <div className="flex flex-wrap gap-1">
                      {(dp.asset_types || []).map((t: string) => (
                        <span key={t} className="px-2 py-0.5 text-[10px] font-medium capitalize" style={{ borderRadius: 4, background: C.tealM, color: C.teal }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </Panel>
            )}

            {/* Quick actions */}
            <Panel title="Quick Actions" actions={<IconBtn>⋯</IconBtn>}>
              <div className="flex flex-col gap-1.5">
                {[
                  { icon: "📧", label: "Draft email", desc: `Send a follow-up to ${selected.full_name.split(" ")[0]}` },
                  { icon: "📞", label: "Log call", desc: "Record a phone conversation" },
                  { icon: "📝", label: "Add note", desc: "Update contact notes" },
                  { icon: "🤝", label: "Create deal", desc: `Start a new deal with ${selected.full_name.split(" ")[0]}` },
                ].map((a) => (
                  <button
                    key={a.label}
                    className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <span className="text-[13px]">{a.icon}</span>
                    <div>
                      <div className="text-xs font-medium text-cream">{a.label}</div>
                      <div className="text-[10px] text-cream-subtle">{a.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}
