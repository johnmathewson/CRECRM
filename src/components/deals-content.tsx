"use client";

import { useEffect, useState, useCallback } from "react";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";
import CreateDealModal from "./create-deal-modal";

// ── Types ──────────────────────────────────────────────────
interface Deal {
  id: string;
  deal_name: string;
  deal_type: string;
  price: number;
  commission_pct: number;
  estimated_commission: number;
  probability_pct: number;
  weighted_commission: number;
  expected_close: string | null;
  actual_close: string | null;
  is_closed: boolean;
  is_dead: boolean;
  dead_reason: string | null;
  notes: string | null;
  property?: { name: string; asset_type: string; city: string; address: string } | null;
  client?: { full_name: string; phone: string; email: string } | null;
  current_stage?: string;
}

// ── Colors & helpers ───────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)", redM: "rgba(231,76,60,0.20)",
};

const STAGES = ["Lead", "Touring/Underwriting", "Under Contract", "Closed"];

const stageColors: Record<string, { bg: string; t: string; border: string }> = {
  Lead: { bg: C.amberM, t: C.amber, border: "rgba(242,201,76,0.25)" },
  "Touring/Underwriting": { bg: C.tealM, t: C.teal, border: "rgba(78,205,196,0.25)" },
  "Under Contract": { bg: C.coralM, t: C.coral, border: "rgba(224,122,95,0.25)" },
  Closed: { bg: C.greenM, t: C.green, border: "rgba(107,203,119,0.25)" },
};

const fmt = (n: number) => {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtF = (n: number) => n ? `$${n.toLocaleString()}` : "—";
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// ── Main ──────────────────────────────────────────────────
export default function DealsContent() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const [showDead, setShowDead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
      const supabase = createClient();

      const { data } = await supabase
        .from("deals")
        .select(`
          id, deal_name, deal_type, price, commission_pct,
          estimated_commission, probability_pct, weighted_commission,
          expected_close, actual_close, is_closed, is_dead, dead_reason, notes,
          property:properties(name, asset_type, city, address),
          client:contacts!deals_client_contact_id_fkey(full_name, phone, email)
        `)
        .order("weighted_commission", { ascending: false });

      if (data) {
        for (const deal of data) {
          const { data: stage } = await supabase
            .from("deal_stages")
            .select("stage")
            .eq("deal_id", deal.id)
            .is("exited_at", null)
            .limit(1)
            .single();
          (deal as any).current_stage = stage?.stage || "Lead";
        }
      }

      setDeals((data as any) || []);
      setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter out dead deals unless toggled
  const visible = deals.filter((d) => showDead || !d.is_dead);

  // Group by stage for pipeline view
  const byStage: Record<string, Deal[]> = {};
  STAGES.forEach((s) => (byStage[s] = []));
  visible.forEach((d) => {
    const s = d.current_stage || "Lead";
    if (byStage[s]) byStage[s].push(d);
    else byStage["Lead"].push(d);
  });

  // Stats
  const active = deals.filter((d) => !d.is_closed && !d.is_dead);
  const closed = deals.filter((d) => d.is_closed);
  const dead = deals.filter((d) => d.is_dead);
  const pipeTotal = active.reduce((s, d) => s + (d.estimated_commission || 0), 0);
  const weightTotal = active.reduce((s, d) => s + (d.weighted_commission || 0), 0);
  const earnedTotal = closed.reduce((s, d) => s + (d.estimated_commission || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Loading deals...</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Deal Pipeline</h1>
          <p className="mt-1 text-cream-muted text-[13px]">
            <span className="text-coral font-semibold">{active.length} active</span>
            {" · "}{fmt(pipeTotal)} pipeline · {fmt(weightTotal)} weighted
            {" · "}<span style={{ color: C.green }}>{closed.length} closed ({fmt(earnedTotal)})</span>
            {dead.length > 0 && <span className="text-cream-subtle"> · {dead.length} dead</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1.5 text-[11px] text-cream-subtle cursor-pointer">
            <input
              type="checkbox"
              checked={showDead}
              onChange={(e) => setShowDead(e.target.checked)}
              className="accent-coral"
            />
            Show dead
          </label>
          <div className="glass-inner flex overflow-hidden" style={{ borderRadius: 5 }}>
            <button
              onClick={() => setView("pipeline")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "pipeline" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "pipeline" ? C.coralM : "transparent" }}
            >
              ▤ Pipeline
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "table" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "table" ? C.coralM : "transparent" }}
            >
              ☰ Table
            </button>
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
            + New Deal
          </button>
        </div>
      </div>

      <CreateDealModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />

      <div className="grid gap-4" style={{ gridTemplateColumns: selected ? "1fr 400px" : "1fr" }}>
        {/* Pipeline / Kanban view */}
        {view === "pipeline" ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${STAGES.length}, 1fr)` }}>
            {STAGES.map((stage) => {
              const sc = stageColors[stage] || stageColors.Lead;
              const stageDeals = byStage[stage] || [];
              const stageValue = stageDeals.reduce((s, d) => s + (d.estimated_commission || 0), 0);
              return (
                <div key={stage} className="flex flex-col">
                  {/* Column header */}
                  <div
                    className="glass px-3 py-2.5 mb-2.5"
                    style={{ borderTopColor: sc.border }}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 inline-block"
                          style={{ borderRadius: 2, background: sc.t, boxShadow: `0 0 6px ${sc.t}40` }}
                        />
                        <span className="text-xs font-semibold">{stage === "Touring/Underwriting" ? "Touring" : stage}</span>
                      </div>
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ borderRadius: 4, background: sc.bg, color: sc.t }}
                      >
                        {stageDeals.length}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-cream-subtle mt-1 tnum">{fmt(stageValue)} est. comm.</div>
                  </div>

                  {/* Deal cards */}
                  <div className="flex flex-col gap-2">
                    {stageDeals.map((d) => {
                      const prop = d.property as any;
                      const client = d.client as any;
                      const isSelected = selected?.id === d.id;
                      return (
                        <div
                          key={d.id}
                          className="glass cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.06)]"
                          style={{
                            borderColor: isSelected ? sc.border : undefined,
                            boxShadow: isSelected ? `0 0 16px ${sc.t}20` : undefined,
                            opacity: d.is_dead ? 0.5 : 1,
                          }}
                          onClick={() => setSelected(isSelected ? null : d)}
                        >
                          <div className="p-3">
                            <div className="flex justify-between items-start mb-1.5">
                              <div className="text-xs font-bold leading-snug pr-2">
                                {d.deal_name?.replace(" Sale", "").replace(" Lease", "")}
                              </div>
                              <span
                                className="px-1.5 py-0.5 text-[9px] font-semibold flex-shrink-0"
                                style={{
                                  borderRadius: 4,
                                  background: d.deal_type === "sale" ? C.coralM : C.tealM,
                                  color: d.deal_type === "sale" ? C.coral : C.teal,
                                }}
                              >
                                {d.deal_type}
                              </span>
                            </div>
                            {prop?.name && (
                              <div className="text-[10.5px] text-cream-subtle mb-1">{prop.asset_type} · {prop.city}</div>
                            )}
                            {client?.full_name && (
                              <div className="text-[10.5px] text-cream-muted mb-2">{client.full_name}</div>
                            )}
                            <div className="flex justify-between items-end">
                              <div>
                                <div className="text-[9px] text-cream-subtle uppercase tracking-wider">Comm.</div>
                                <div className="text-sm font-bold tnum" style={{ color: sc.t }}>{fmt(d.estimated_commission)}</div>
                              </div>
                              <span
                                className="inline-flex items-center justify-center w-10 h-5 text-[10px] font-semibold"
                                style={{
                                  borderRadius: 4,
                                  background: d.probability_pct >= 0.5 ? C.greenM : d.probability_pct >= 0.25 ? C.amberM : C.redM,
                                  color: d.probability_pct >= 0.5 ? C.green : d.probability_pct >= 0.25 ? C.amber : C.red,
                                }}
                              >
                                {pct(d.probability_pct)}
                              </span>
                            </div>
                            {d.is_dead && (
                              <div className="mt-2 px-2 py-1 text-[10px] font-medium" style={{ borderRadius: 4, background: C.redM, color: C.red }}>
                                Dead: {d.dead_reason || "No reason"}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table view */
          <Panel title={`${visible.length} Deals`} actions={
            <div className="flex gap-1"><IconBtn>↻</IconBtn><IconBtn>↓</IconBtn><IconBtn>⋯</IconBtn></div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
                <thead>
                  <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
                    {["Deal", "Client", "Stage", "Type", "Price", "Est. Comm", "Prob", "Weighted", "Close"].map((h, i) => (
                      <th key={h} className={`px-2.5 pb-2 font-medium ${i >= 4 && i !== 6 ? "text-right" : i === 6 ? "text-center" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => {
                    const client = d.client as any;
                    const sc = stageColors[d.current_stage || "Lead"] || stageColors.Lead;
                    const isSelected = selected?.id === d.id;
                    const bg = isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)";
                    return (
                      <tr key={d.id} className="cursor-pointer" onClick={() => setSelected(isSelected ? null : d)} style={{ opacity: d.is_dead ? 0.5 : 1 }}>
                        <td className="px-2.5 py-2.5 text-[12.5px] font-medium" style={{ borderRadius: "4px 0 0 4px", background: bg }}>
                          {d.deal_name?.replace(" Sale", "").replace(" Lease", "")}
                        </td>
                        <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ background: bg }}>
                          {client?.full_name || "—"}
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <span className="px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 4, background: sc.bg, color: sc.t }}>
                            {(d.current_stage || "Lead") === "Touring/Underwriting" ? "Touring" : d.current_stage || "Lead"}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <span className="px-1.5 py-0.5 text-[9.5px] font-semibold" style={{
                            borderRadius: 4,
                            background: d.deal_type === "sale" ? C.coralM : C.tealM,
                            color: d.deal_type === "sale" ? C.coral : C.teal,
                          }}>
                            {d.deal_type}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs text-cream-muted tnum" style={{ background: bg }}>{fmtF(d.price)}</td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ color: C.coral, background: bg }}>{fmtF(d.estimated_commission)}</td>
                        <td className="px-2.5 py-2.5 text-center" style={{ background: bg }}>
                          <span className="inline-flex items-center justify-center w-10 h-5 text-[10.5px] font-semibold" style={{
                            borderRadius: 4,
                            background: d.probability_pct >= 0.5 ? C.greenM : d.probability_pct >= 0.25 ? C.amberM : C.redM,
                            color: d.probability_pct >= 0.5 ? C.green : d.probability_pct >= 0.25 ? C.amber : C.red,
                          }}>
                            {pct(d.probability_pct)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ background: bg }}>{fmtF(d.weighted_commission)}</td>
                        <td className="px-2.5 py-2.5 text-right text-[11px] text-cream-subtle" style={{ borderRadius: "0 4px 4px 0", background: bg }}>
                          {d.actual_close ? new Date(d.actual_close).toLocaleDateString("en-US", { month: "short", day: "numeric" }) :
                           d.expected_close ? new Date(d.expected_close).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="glass-inner flex justify-between items-center mt-2 px-3.5 py-2.5">
              <span className="text-xs font-semibold">Pipeline Total</span>
              <div className="flex gap-5 text-xs tnum">
                <span>Est: <span className="font-bold" style={{ color: C.coral }}>{fmtF(pipeTotal)}</span></span>
                <span>Weighted: <span className="font-bold" style={{ color: C.teal }}>{fmtF(weightTotal)}</span></span>
                <span>Earned: <span className="font-bold" style={{ color: C.green }}>{fmtF(earnedTotal)}</span></span>
              </div>
            </div>
          </Panel>
        )}

        {/* Detail sidebar */}
        {selected && (
          <div className="flex flex-col gap-4">
            <Panel title="Deal Detail" actions={
              <div className="flex gap-1"><IconBtn onClick={() => setSelected(null)}>✕</IconBtn></div>
            }>
              <div className="mb-3">
                <div className="text-lg font-bold">{selected.deal_name}</div>
                <div className="flex gap-2 mt-1.5">
                  <span className="px-2 py-0.5 text-[10px] font-semibold" style={{
                    borderRadius: 4,
                    background: selected.deal_type === "sale" ? C.coralM : C.tealM,
                    color: selected.deal_type === "sale" ? C.coral : C.teal,
                  }}>
                    {selected.deal_type}
                  </span>
                  {(() => {
                    const sc = stageColors[selected.current_stage || "Lead"] || stageColors.Lead;
                    return (
                      <span className="px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 4, background: sc.bg, color: sc.t }}>
                        {selected.current_stage || "Lead"}
                      </span>
                    );
                  })()}
                  {selected.is_dead && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 4, background: C.redM, color: C.red }}>
                      Dead
                    </span>
                  )}
                </div>
              </div>

              {/* Financials */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "Price", value: fmtF(selected.price), accent: false },
                  { label: "Commission %", value: selected.commission_pct ? `${(selected.commission_pct * 100).toFixed(1)}%` : "—" },
                  { label: "Est. Commission", value: fmtF(selected.estimated_commission), accent: true },
                  { label: "Probability", value: pct(selected.probability_pct) },
                  { label: "Weighted", value: fmtF(selected.weighted_commission) },
                  { label: "Expected Close", value: selected.expected_close ? new Date(selected.expected_close).toLocaleDateString() : "—" },
                ].map((row) => (
                  <div key={row.label} className="glass-inner px-3 py-2.5">
                    <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">{row.label}</div>
                    <div className={`text-sm font-semibold tnum`} style={row.accent ? { color: C.coral } : undefined}>
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Property info */}
              {(selected.property as any)?.name && (
                <div className="glass-inner px-3 py-2.5 mb-3">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Property</div>
                  <div className="text-xs font-semibold">{(selected.property as any).name}</div>
                  <div className="text-[10.5px] text-cream-subtle mt-0.5">
                    {(selected.property as any).asset_type} · {(selected.property as any).city}
                  </div>
                </div>
              )}

              {/* Client info */}
              {(selected.client as any)?.full_name && (
                <div className="glass-inner px-3 py-2.5 mb-3">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Client</div>
                  <div className="text-xs font-semibold">{(selected.client as any).full_name}</div>
                  <div className="text-[10.5px] text-cream-subtle mt-0.5">
                    {[(selected.client as any).phone, (selected.client as any).email].filter(Boolean).join(" · ") || "No contact info"}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="glass-inner px-3 py-2.5">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Notes</div>
                  <div className="text-xs text-cream-muted leading-relaxed">{selected.notes}</div>
                </div>
              )}

              {selected.is_dead && selected.dead_reason && (
                <div className="px-3 py-2.5 mt-2" style={{ borderRadius: 4, background: C.redM, border: `1px solid rgba(231,76,60,0.15)` }}>
                  <div className="text-[9.5px] uppercase tracking-wider font-medium mb-1" style={{ color: C.red }}>Dead Reason</div>
                  <div className="text-xs text-cream-muted">{selected.dead_reason}</div>
                </div>
              )}
            </Panel>

            {/* Quick actions */}
            <Panel title="Quick Actions" actions={<IconBtn>⋯</IconBtn>}>
              <div className="flex flex-col gap-1.5">
                {[
                  { icon: "📧", label: "Draft follow-up", desc: `Email ${(selected.client as any)?.full_name?.split(" ")[0] || "client"}` },
                  { icon: "📝", label: "Log activity", desc: "Record a call, meeting, or note" },
                  { icon: "📄", label: "Generate LOI", desc: "Draft a letter of intent" },
                  { icon: "📊", label: "Update stage", desc: "Move deal to next stage" },
                  { icon: "💀", label: "Mark dead", desc: "Kill this deal with a reason" },
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
