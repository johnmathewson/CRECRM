"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";

// ── Colors ─────────────────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)",
};
const PIE_COLORS = [C.coral, C.teal, C.amber, C.green, "#A78BFA", "#F472B6"];

const fmt = (n: number) => {
  if (!n) return "$0";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtF = (n: number) => n ? `$${n.toLocaleString()}` : "—";

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-inner p-2.5 text-[11.5px] text-cream" style={{ backdropFilter: "blur(12px)" }}>
      <div className="font-semibold mb-0.5">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }} className="mt-0.5">
          {p.name}: {typeof p.value === "number" && p.value > 100 ? fmtF(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function ReportsContent() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // All deals
      const { data: deals } = await supabase
        .from("deals")
        .select("id, deal_name, deal_type, price, estimated_commission, probability_pct, weighted_commission, is_closed, is_dead, expected_close, actual_close, property:properties(name, asset_type, city)");

      // All properties
      const { data: properties } = await supabase
        .from("properties")
        .select("id, name, asset_type, status, asking_price, sqft, city");

      // All contacts
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, full_name, contact_type, warmth, last_conversation, company:companies(name)");

      // Deal stages
      const { data: stages } = await supabase
        .from("deal_stages")
        .select("deal_id, stage, entered_at, exited_at");

      setData({ deals: deals || [], properties: properties || [], contacts: contacts || [], stages: stages || [] });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Generating reports...</div>
      </div>
    );
  }

  const { deals, properties, contacts, stages } = data;

  // ── Computed analytics ─────────────────────────────────
  const active = deals.filter((d: any) => !d.is_closed && !d.is_dead);
  const closed = deals.filter((d: any) => d.is_closed);
  const dead = deals.filter((d: any) => d.is_dead);

  const pipeTotal = active.reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0);
  const weightTotal = active.reduce((s: number, d: any) => s + (d.weighted_commission || 0), 0);
  const earnedTotal = closed.reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0);
  const totalDealValue = active.reduce((s: number, d: any) => s + (d.price || 0), 0);
  const avgDealSize = active.length > 0 ? totalDealValue / active.length : 0;
  const winRate = deals.length > 0 ? closed.length / (closed.length + dead.length) : 0;
  const avgProbability = active.length > 0
    ? active.reduce((s: number, d: any) => s + (d.probability_pct || 0), 0) / active.length
    : 0;

  // Deal type breakdown
  const dealTypeData = [
    { name: "Sales", value: deals.filter((d: any) => d.deal_type === "sale").length },
    { name: "Leases", value: deals.filter((d: any) => d.deal_type === "lease").length },
  ].filter((d) => d.value > 0);

  // Commission by deal type
  const saleComm = active.filter((d: any) => d.deal_type === "sale").reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0);
  const leaseComm = active.filter((d: any) => d.deal_type === "lease").reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0);
  const commByType = [
    { name: "Sale Commissions", value: saleComm },
    { name: "Lease Commissions", value: leaseComm },
  ].filter((d) => d.value > 0);

  // Asset type breakdown from properties
  const assetMap: Record<string, { count: number; value: number }> = {};
  properties.forEach((p: any) => {
    const t = (p.asset_type || "other").replace(/_/g, " ");
    if (!assetMap[t]) assetMap[t] = { count: 0, value: 0 };
    assetMap[t].count++;
    assetMap[t].value += p.asking_price || 0;
  });
  const assetData = Object.entries(assetMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);

  // Property status breakdown
  const statusMap: Record<string, number> = {};
  properties.forEach((p: any) => {
    const s = (p.status || "unknown").replace(/_/g, " ");
    statusMap[s] = (statusMap[s] || 0) + 1;
  });
  const statusData = Object.entries(statusMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // Contact type breakdown
  const contactTypeMap: Record<string, number> = {};
  contacts.forEach((c: any) => {
    const t = c.contact_type || "unknown";
    contactTypeMap[t] = (contactTypeMap[t] || 0) + 1;
  });
  const contactTypeData = Object.entries(contactTypeMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // Contact warmth
  const warmthMap: Record<string, number> = {};
  contacts.forEach((c: any) => {
    const w = c.warmth || "unknown";
    warmthMap[w] = (warmthMap[w] || 0) + 1;
  });
  const warmthData = Object.entries(warmthMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // Top deals by commission
  const topDeals = [...active]
    .sort((a: any, b: any) => (b.estimated_commission || 0) - (a.estimated_commission || 0))
    .slice(0, 8);

  // Pipeline health: probability distribution
  const probBuckets = [
    { range: "0-25%", count: active.filter((d: any) => d.probability_pct < 0.25).length, value: active.filter((d: any) => d.probability_pct < 0.25).reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0) },
    { range: "25-50%", count: active.filter((d: any) => d.probability_pct >= 0.25 && d.probability_pct < 0.5).length, value: active.filter((d: any) => d.probability_pct >= 0.25 && d.probability_pct < 0.5).reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0) },
    { range: "50-75%", count: active.filter((d: any) => d.probability_pct >= 0.5 && d.probability_pct < 0.75).length, value: active.filter((d: any) => d.probability_pct >= 0.5 && d.probability_pct < 0.75).reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0) },
    { range: "75-100%", count: active.filter((d: any) => d.probability_pct >= 0.75).length, value: active.filter((d: any) => d.probability_pct >= 0.75).reduce((s: number, d: any) => s + (d.estimated_commission || 0), 0) },
  ];

  // Market: city distribution
  const cityMap: Record<string, number> = {};
  properties.forEach((p: any) => {
    const c = p.city || "Unknown";
    cityMap[c] = (cityMap[c] || 0) + 1;
  });
  const cityData = Object.entries(cityMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Reports & Analytics</h1>
          <p className="mt-1 text-cream-muted text-[13px]">
            Full portfolio analysis across {deals.length} deals, {properties.length} properties, {contacts.length} contacts
          </p>
        </div>
        <div className="flex gap-2">
          <button className="glass-inner px-4 py-1.5 cursor-pointer text-xs font-medium text-cream-muted border-none">
            📊 Export PDF
          </button>
          <button className="glass-inner px-4 py-1.5 cursor-pointer text-xs font-medium text-cream-muted border-none">
            📋 Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {[
          { label: "Pipeline Value", value: fmt(pipeTotal), accent: C.coral },
          { label: "Weighted Value", value: fmt(weightTotal), accent: C.teal },
          { label: "Earned YTD", value: fmt(earnedTotal), accent: C.green },
          { label: "Avg Deal Size", value: fmt(avgDealSize), accent: C.amber },
          { label: "Win Rate", value: `${(winRate * 100).toFixed(0)}%`, accent: C.green },
          { label: "Avg Probability", value: `${(avgProbability * 100).toFixed(0)}%`, accent: C.teal },
        ].map((kpi) => (
          <div key={kpi.label} className="glass p-4">
            <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1.5">{kpi.label}</div>
            <div className="text-xl font-bold tnum" style={{ color: kpi.accent }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Top deals by commission */}
        <Panel title="Top Deals by Est. Commission" actions={<div className="flex gap-1"><IconBtn>↻</IconBtn><IconBtn>↓</IconBtn></div>}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topDeals.map((d: any) => ({ name: d.deal_name?.replace(" Sale", "").replace(" Lease", "").slice(0, 20), commission: d.estimated_commission, weighted: d.weighted_commission }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: "rgba(240,237,228,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={120} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="commission" name="Est. Commission" fill={C.coral} fillOpacity={0.75} radius={[0, 3, 3, 0]} barSize={14} />
              <Bar dataKey="weighted" name="Weighted" fill={C.teal} fillOpacity={0.6} radius={[0, 3, 3, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Pipeline health: probability distribution */}
        <Panel title="Pipeline Health — Probability Distribution" actions={<IconBtn>↻</IconBtn>}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={probBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="range" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" name="Deals" radius={[3, 3, 0, 0]} barSize={36}>
                {probBuckets.map((_, i) => (
                  <Cell key={i} fill={[C.red, C.amber, C.teal, C.green][i]} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-between mt-2 px-2">
            {probBuckets.map((b, i) => (
              <div key={b.range} className="text-center">
                <div className="text-[10px] font-semibold tnum" style={{ color: [C.red, C.amber, C.teal, C.green][i] }}>{fmt(b.value)}</div>
                <div className="text-[9px] text-cream-subtle">{b.range}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Asset type breakdown */}
        <Panel title="Portfolio by Asset Type" actions={<IconBtn>↻</IconBtn>}>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={assetData} innerRadius={40} outerRadius={65} dataKey="count" stroke="none" startAngle={90} endAngle={-270}>
                  {assetData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 flex flex-col gap-2">
              {assetData.map((p, i) => (
                <div key={p.name} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 inline-block" style={{ borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-xs capitalize">{p.name}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-xs font-bold tnum">{p.count}</span>
                    <span className="text-[10.5px] text-cream-subtle tnum">{fmt(p.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Commission by deal type */}
        <Panel title="Active Commission by Deal Type" actions={<IconBtn>↻</IconBtn>}>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={commByType} innerRadius={40} outerRadius={65} dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                  <Cell fill={C.coral} fillOpacity={0.8} />
                  <Cell fill={C.teal} fillOpacity={0.8} />
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 flex flex-col gap-3">
              {commByType.map((d, i) => (
                <div key={d.name}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 inline-block" style={{ borderRadius: 2, background: i === 0 ? C.coral : C.teal }} />
                      <span className="text-xs">{d.name}</span>
                    </div>
                    <span className="text-sm font-bold tnum" style={{ color: i === 0 ? C.coral : C.teal }}>{fmt(d.value)}</span>
                  </div>
                  <div className="h-1 rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${pipeTotal > 0 ? (d.value / pipeTotal) * 100 : 0}%`,
                        background: i === 0 ? C.coral : C.teal,
                        boxShadow: `0 0 6px ${i === 0 ? C.coral : C.teal}40`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Property status */}
        <Panel title="Property Status Breakdown" actions={<IconBtn>↻</IconBtn>}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" name="Properties" radius={[3, 3, 0, 0]}>
                {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.7} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Market geography */}
        <Panel title="Properties by Market" actions={<IconBtn>↻</IconBtn>}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cityData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" name="Properties" radius={[3, 3, 0, 0]}>
                {cityData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.7} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Contact breakdown */}
        <Panel title="Contact Types" actions={<IconBtn>↻</IconBtn>}>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie data={contactTypeData} innerRadius={35} outerRadius={55} dataKey="count" stroke="none" startAngle={90} endAngle={-270}>
                  {contactTypeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.8} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 flex flex-col gap-2">
              {contactTypeData.map((c, i) => (
                <div key={c.name} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 inline-block" style={{ borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-xs capitalize">{c.name}</span>
                  </div>
                  <span className="text-xs font-bold tnum">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Contact warmth */}
        <Panel title="Contact Warmth" actions={<IconBtn>↻</IconBtn>}>
          <div className="flex flex-col gap-2.5">
            {warmthData.map((w) => {
              const warmthColors: Record<string, string> = { hot: C.coral, warm: C.amber, cold: C.teal, unknown: "rgba(240,237,228,0.3)" };
              const color = warmthColors[w.name.toLowerCase()] || warmthColors.unknown;
              const pctVal = contacts.length > 0 ? (w.count / contacts.length) * 100 : 0;
              return (
                <div key={w.name}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs capitalize font-medium" style={{ color }}>{w.name}</span>
                    <span className="text-xs font-bold tnum">{w.count} <span className="text-cream-subtle font-normal">({pctVal.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-1.5 rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-sm transition-all" style={{ width: `${pctVal}%`, background: color, boxShadow: `0 0 6px ${color}40` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Footer */}
      <div className="flex justify-between pt-3 text-[10px] text-cream-subtle" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span>Stewardship Asset Group — Analytics Report</span>
        <span>Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
      </div>
    </>
  );
}
