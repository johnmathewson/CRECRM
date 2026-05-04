"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
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
  is_closed: boolean;
  property?: { name: string; asset_type: string; city: string };
  client?: { full_name: string };
  current_stage?: string;
}

interface Property {
  id: string;
  name: string;
  asset_type: string;
  city: string;
  asking_price: number;
}

// ── Colors ─────────────────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)", redM: "rgba(231,76,60,0.20)",
};

const fmt = (n: number) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtF = (n: number) => `$${n.toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// ── Small components ───────────────────────────────────────
function StatCard({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div
      className="glass flex items-center gap-3.5 flex-1 min-w-[200px]"
      style={{ padding: "16px 18px", borderTopColor: "rgba(255,255,255,0.12)" }}
    >
      <div
        className="w-[42px] h-[42px] flex-shrink-0 flex items-center justify-center text-[19px]"
        style={{
          borderRadius: 6,
          background: `linear-gradient(135deg, ${accent}15, ${accent}08)`,
          border: `1px solid ${accent}28`,
        }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10.5px] text-cream-subtle uppercase tracking-wider mb-1 font-medium">
          {label}
        </div>
        <div className="text-[25px] font-bold text-cream leading-none tracking-tight">
          {value}
        </div>
        {sub && (
          <div className="text-[11px] mt-1 font-medium opacity-85" style={{ color: accent }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { bg: string; t: string }> = {
    Lead: { bg: C.amberM, t: C.amber },
    "Touring/Underwriting": { bg: C.tealM, t: C.teal },
    Touring: { bg: C.tealM, t: C.teal },
    "Under Contract": { bg: C.coralM, t: C.coral },
    Closed: { bg: C.greenM, t: C.green },
  };
  const c = map[stage] || map.Lead;
  return (
    <span
      className="px-2.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ borderRadius: 4, background: c.bg, color: c.t }}
    >
      {stage === "Touring/Underwriting" ? "Touring" : stage}
    </span>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-inner p-2.5 text-[11.5px] text-cream" style={{ backdropFilter: "blur(12px)" }}>
      <div className="font-semibold mb-0.5">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }} className="mt-0.5">
          {p.name}: {p.value > 100 ? fmtF(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

function ProgressRing({ percent, size = 145, stroke = 10 }: {
  percent: number; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.coral} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(percent, 1))} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 8px rgba(224,122,95,0.5))` }}
      />
    </svg>
  );
}

// ── Main Dashboard Content ─────────────────────────────────
export default function DashboardContent() {
  const router = useRouter();
  // Deep-link a dashboard summary row to the editor on /deals.
  const openDeal = useCallback((dealId: string) => {
    router.push(`/deals?focus=${dealId}`);
  }, [router]);

  const [activeDeals, setActiveDeals] = useState<Deal[]>([]);
  const [closedDeals, setClosedDeals] = useState<Deal[]>([]);
  const [propertyCount, setPropertyCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [inboxActive, setInboxActive] = useState(0);
  const [inboxToday, setInboxToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreateDeal, setShowCreateDeal] = useState(false);

  const load = useCallback(async () => {
      const supabase = createClient();

      // Fetch active deals with property + client + current stage
      const { data: active } = await supabase
        .from("deals")
        .select(`
          id, deal_name, deal_type, price, commission_pct,
          estimated_commission, probability_pct, weighted_commission,
          is_closed,
          property:properties(name, asset_type, city),
          client:contacts!deals_client_contact_id_fkey(full_name)
        `)
        .eq("is_closed", false)
        .order("weighted_commission", { ascending: false });

      // Get current stage for each deal
      if (active) {
        for (const deal of active) {
          const { data: stage } = await supabase
            .from("deal_stages")
            .select("stage")
            .eq("deal_id", deal.id)
            .is("exited_at", null)
            .limit(1)
            .single();
          (deal as any).current_stage = stage?.stage || "—";
        }
      }

      // Fetch closed deals
      const { data: closed } = await supabase
        .from("deals")
        .select("id, deal_name, deal_type, estimated_commission, is_closed")
        .eq("is_closed", true)
        .gt("estimated_commission", 0)
        .order("estimated_commission", { ascending: false });

      // Counts
      const { count: pCount } = await supabase.from("properties").select("id", { count: "exact", head: true });
      const { count: cCount } = await supabase.from("contacts").select("id", { count: "exact", head: true });

      // Inbox stats
      const { count: inboxActiveCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .in("status", ["new", "reviewing", "unmatched"]);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: inboxTodayCount } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString());

      setActiveDeals((active as any) || []);
      setClosedDeals((closed as any) || []);
      setPropertyCount(pCount || 0);
      setContactCount(cCount || 0);
      setInboxActive(inboxActiveCount || 0);
      setInboxToday(inboxTodayCount || 0);
      setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived stats
  const pipeTotal = activeDeals.reduce((s, d) => s + (d.estimated_commission || 0), 0);
  const weightTotal = activeDeals.reduce((s, d) => s + (d.weighted_commission || 0), 0);
  const earned = closedDeals.reduce((s, d) => s + (d.estimated_commission || 0), 0);
  const GOAL = 2000000;
  const goalPct = earned / GOAL;

  // Stage counts for bar chart
  const stageCounts: Record<string, number> = {};
  activeDeals.forEach((d) => {
    const s = d.current_stage || "Unknown";
    stageCounts[s] = (stageCounts[s] || 0) + 1;
  });
  const stageData = Object.entries(stageCounts).map(([stage, count]) => ({ stage, count }));

  // Property type aggregation (from deals for now)
  const assetCounts: Record<string, { count: number; value: number }> = {};
  activeDeals.forEach((d) => {
    const t = (d.property as any)?.name ? ((d.property as any)?.asset_type || "Other") : "Other";
    if (!assetCounts[t]) assetCounts[t] = { count: 0, value: 0 };
    assetCounts[t].count++;
    assetCounts[t].value += d.price || 0;
  });
  const assetData = Object.entries(assetCounts).map(([name, v]) => ({ name, ...v }));

  // Trend data (placeholder for now — would come from time-series queries)
  const trend = [
    { month: "Jan", earned: 8970, pipeline: 720000 },
    { month: "Feb", earned: 55000, pipeline: 755000 },
    { month: "Mar", earned: 2052, pipeline: 790000 },
    { month: "Apr", earned: 2268, pipeline: 815000 },
    { month: "May", earned: 4500, pipeline: 830000 },
    { month: "Jun", earned: 2774, pipeline: pipeTotal },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const pieColors = [C.coral, C.teal, C.amber, C.green];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Loading your pipeline...</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">
            Good {greeting}, John
          </h1>
          <p className="mt-1 text-cream-muted text-[13px] font-normal">
            <span className="text-coral font-semibold">{activeDeals.length} active deals</span>
            {" · "}{fmt(pipeTotal)} pipeline · {fmt(weightTotal)} weighted
          </p>
        </div>
        <div className="flex gap-2">
          <button className="glass-inner px-4 py-1.5 cursor-pointer text-xs font-medium text-cream-muted">
            📊 Export
          </button>
          <button
            onClick={() => setShowCreateDeal(true)}
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

      <CreateDealModal open={showCreateDeal} onClose={() => setShowCreateDeal(false)} onCreated={load} />

      {/* Stat cards */}
      <div className="flex gap-3 mb-[18px] flex-wrap">
        <StatCard icon="💰" label="Pipeline Value" value={fmt(pipeTotal)} sub={`${activeDeals.length} active deals`} accent={C.coral} />
        <StatCard icon="⚖️" label="Weighted" value={fmt(weightTotal)} sub={pipeTotal > 0 ? `${pct(weightTotal / pipeTotal)} avg probability` : "—"} accent={C.teal} />
        <StatCard icon="✅" label="Earned YTD" value={fmt(earned)} sub={`${pct(goalPct)} of $2M goal`} accent={C.green} />
        <StatCard icon="🏢" label="Properties" value={String(propertyCount)} sub={`${contactCount} contacts`} accent={C.amber} />
        <Link href="/inbox" className="flex-1 min-w-[200px]" style={{ textDecoration: "none" }}>
          <StatCard
            icon="📨"
            label="Inbox"
            value={String(inboxActive)}
            sub={inboxToday > 0 ? `${inboxToday} new today · agent →` : "agent activity →"}
            accent={C.red}
          />
        </Link>
      </div>

      {/* Grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 370px" }}>

        {/* LEFT */}
        <div className="flex flex-col gap-4">

          {/* Trend chart */}
          <Panel title="Commission Trend" actions={
            <div className="flex gap-3.5 items-center mr-2">
              <span className="flex items-center gap-1.5 text-[10.5px] text-cream-subtle">
                <span className="inline-block w-2 h-[2.5px] rounded-sm" style={{ background: C.coral }} /> Pipeline
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px] text-cream-subtle">
                <span className="inline-block w-2 h-[2.5px] rounded-sm" style={{ background: C.teal }} /> Earned
              </span>
              <IconBtn>↻</IconBtn>
              <IconBtn>↓</IconBtn>
            </div>
          }>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.coral} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={C.coral} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.teal} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={C.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10.5 }} axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false} />
                <YAxis tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="pipeline" name="Pipeline" stroke={C.coral} fill="url(#gC)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="earned" name="Earned" stroke={C.teal} fill="url(#gT)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* Pipeline table */}
          <Panel title="Active Pipeline" actions={
            <div className="flex gap-1 items-center">
              <span className="text-[10.5px] text-cream-subtle mr-2">Sorted by weighted</span>
              <IconBtn>↻</IconBtn>
              <IconBtn>↓</IconBtn>
              <IconBtn>⋯</IconBtn>
            </div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
                <thead>
                  <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
                    {["Deal", "Client", "Stage", "Price", "Est. Comm", "Prob", "Weighted"].map((h, i) => (
                      <th key={h} className={`px-2.5 pb-2 font-medium ${i >= 3 ? (i === 5 ? "text-center" : "text-right") : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeDeals.map((d) => {
                    const prop = d.property as any;
                    const client = d.client as any;
                    return (
                      <tr
                        key={d.id}
                        className="cursor-pointer hover:brightness-125 transition-all"
                        onClick={() => openDeal(d.id)}
                        title="Open in Deals"
                      >
                        <td className="px-2.5 py-2.5 text-[12.5px] font-medium" style={{ borderRadius: "4px 0 0 4px", background: "rgba(255,255,255,0.02)" }}>
                          {d.deal_name?.replace(" Sale", "")}
                          <div className="text-[10px] text-cream-subtle mt-0.5">{prop?.asset_type || "—"}</div>
                        </td>
                        <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {client?.full_name || "—"}
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: "rgba(255,255,255,0.02)" }}>
                          <StageBadge stage={d.current_stage || "—"} />
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs text-cream-muted tnum" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {d.price > 0 ? fmtF(d.price) : "—"}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ color: C.coral, background: "rgba(255,255,255,0.02)" }}>
                          {d.estimated_commission > 0 ? fmtF(d.estimated_commission) : "—"}
                        </td>
                        <td className="px-2.5 py-2.5 text-center" style={{ background: "rgba(255,255,255,0.02)" }}>
                          <span
                            className="inline-flex items-center justify-center w-10 h-5 text-[10.5px] font-semibold"
                            style={{
                              borderRadius: 4,
                              background: d.probability_pct >= 0.5 ? C.greenM : d.probability_pct >= 0.25 ? C.amberM : C.redM,
                              color: d.probability_pct >= 0.5 ? C.green : d.probability_pct >= 0.25 ? C.amber : C.red,
                            }}
                          >
                            {pct(d.probability_pct)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ borderRadius: "0 4px 4px 0", background: "rgba(255,255,255,0.02)" }}>
                          {d.weighted_commission > 0 ? fmtF(d.weighted_commission) : "—"}
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
              </div>
            </div>
          </Panel>

          {/* Closed deals */}
          <Panel title="Closed Commissions — 2026" actions={
            <div className="flex gap-1"><IconBtn>↻</IconBtn><IconBtn>↓</IconBtn></div>
          }>
            <div className="flex flex-col gap-1">
              {closedDeals.map((d) => (
                <div
                  key={d.id}
                  className="glass-inner flex justify-between items-center px-3 py-2.5 cursor-pointer hover:brightness-125 transition-all"
                  onClick={() => openDeal(d.id)}
                  title="Open in Deals"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{d.deal_name}</span>
                    <span
                      className="px-1.5 py-0.5 text-[9.5px] font-semibold"
                      style={{
                        borderRadius: 4,
                        background: d.deal_type === "sale" ? C.coralM : C.tealM,
                        color: d.deal_type === "sale" ? C.coral : C.teal,
                      }}
                    >
                      {d.deal_type}
                    </span>
                  </div>
                  <span className="text-[12.5px] font-bold tnum" style={{ color: C.green }}>
                    +{fmtF(d.estimated_commission)}
                  </span>
                </div>
              ))}
            </div>
            <div className="glass-inner flex justify-between mt-2 px-3.5 py-2.5">
              <span className="text-xs font-semibold">Total Earned</span>
              <span className="text-sm font-bold tnum" style={{ color: C.green }}>{fmtF(earned)}</span>
            </div>
          </Panel>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">

          {/* Goal ring */}
          <Panel title="2026 Commission Goal" actions={<IconBtn>⋯</IconBtn>}>
            <div className="flex flex-col items-center">
              <div className="relative mb-4">
                <ProgressRing percent={goalPct} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[28px] font-extrabold tracking-tight" style={{ color: C.coral }}>
                    {(goalPct * 100).toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-cream-subtle mt-0.5">of $2M goal</span>
                </div>
              </div>
              <div className="flex gap-5 w-full justify-center mb-4">
                <div className="text-center">
                  <div className="text-base font-bold" style={{ color: C.green }}>{fmt(earned)}</div>
                  <div className="text-[10px] text-cream-subtle mt-0.5">Earned</div>
                </div>
                <div className="w-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                <div className="text-center">
                  <div className="text-base font-bold" style={{ color: C.coral }}>{fmt(GOAL - earned)}</div>
                  <div className="text-[10px] text-cream-subtle mt-0.5">Remaining</div>
                </div>
              </div>
              <div className="w-full">
                <div className="h-1 rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.min(goalPct * 100, 100)}%`,
                      background: `linear-gradient(90deg, ${C.coral}, ${C.teal})`,
                      boxShadow: `0 0 10px rgba(224,122,95,0.35)`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-[9px] text-cream-subtle">
                  {["$0", "$500K", "$1M", "$1.5M", "$2M"].map((l) => <span key={l}>{l}</span>)}
                </div>
              </div>
            </div>
          </Panel>

          {/* Stage chart */}
          <Panel title="Pipeline by Stage" actions={<IconBtn>↻</IconBtn>}>
            <ResponsiveContainer width="100%" height={165}>
              <BarChart data={stageData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="stage" tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="count" name="Deals" radius={[3, 3, 0, 0]}>
                  {stageData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} fillOpacity={0.75} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* Portfolio donut */}
          {assetData.length > 0 && (
            <Panel title="Active Deals by Asset Type" actions={<IconBtn>↻</IconBtn>}>
              <div className="flex items-center gap-3.5">
                <ResponsiveContainer width={110} height={110}>
                  <PieChart>
                    <Pie data={assetData} innerRadius={33} outerRadius={50} dataKey="count" stroke="none" startAngle={90} endAngle={-270}>
                      {assetData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} fillOpacity={0.8} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 flex flex-col gap-2.5">
                  {assetData.map((p, i) => (
                    <div key={p.name} className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-[7px] h-[7px] inline-block" style={{ borderRadius: 2, background: pieColors[i % pieColors.length], boxShadow: `0 0 5px ${pieColors[i % pieColors.length]}35` }} />
                        <span className="text-xs capitalize">{p.name}</span>
                      </div>
                      <div>
                        <span className="text-[12.5px] font-bold">{p.count}</span>
                        <span className="text-[10px] text-cream-subtle ml-1.5">{fmt(p.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {/* Signals */}
          <Panel title="Signals" actions={
            <div className="flex gap-1">
              <span className="text-[10px] font-semibold px-2 py-0.5 mr-1" style={{ color: C.coral, background: C.coralM, borderRadius: 4 }}>5 new</span>
              <IconBtn>↻</IconBtn>
              <IconBtn>✕</IconBtn>
            </div>
          }>
            <div className="flex flex-col gap-1.5">
              {[
                { icon: "🔥", text: "Liberty Square — highest weighted deal at $137.5K", tag: "Hot deal", c: C.coral },
                { icon: "📋", text: "Econolodge Under Contract — needs price update", tag: "Action", c: C.amber },
                { icon: "📞", text: "7 contacts missing phone or email", tag: "Data gap", c: C.teal },
                { icon: "📈", text: "Mosley Motel at 75% — highest close likelihood", tag: "Hot", c: C.green },
                { icon: "⚠️", text: "Trucking Lot + Econolodge at $0 price", tag: "Missing", c: C.red },
              ].map((s, i) => (
                <div key={i} className="glass-inner flex gap-2.5 px-2.5 py-2 cursor-pointer items-start">
                  <span className="text-[13px] flex-shrink-0 mt-0.5">{s.icon}</span>
                  <div className="flex-1">
                    <div className="text-[11.5px] leading-snug text-cream">{s.text}</div>
                    <span
                      className="mt-1 inline-block px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{ borderRadius: 4, background: `${s.c}15`, color: s.c }}
                    >
                      {s.tag}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex justify-between mt-6 pt-3 text-[10px] text-cream-subtle"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span>Stewardship Asset Group — CRE Intelligence Platform</span>
        <span>{contactCount} contacts · {propertyCount} properties · {activeDeals.length + closedDeals.length} deals</span>
      </div>
    </>
  );
}
