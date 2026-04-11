"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import Panel from "./panel";
import type { IntakeUnit } from "./intake-editable-table";

const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  green: "#6BCB77",
  amber: "#F2C94C",
};

const fmt = (n: number) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const fmtF = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="glass-inner p-2.5 text-[11.5px] text-cream"
      style={{ backdropFilter: "blur(12px)" }}
    >
      <div className="font-semibold mb-0.5">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }} className="mt-0.5">
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="glass-inner"
      style={{ padding: "12px 14px" }}
    >
      <div className="text-[10px] text-cream-subtle uppercase tracking-wider font-medium mb-1">
        {label}
      </div>
      <div
        className="text-[20px] font-bold tracking-tight tnum"
        style={{ color: accent || "#F0EDE4" }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10.5px] text-cream-muted mt-0.5">{sub}</div>
      )}
    </div>
  );
}

interface Props {
  units: IntakeUnit[];
  propertyName: string;
  confidence?: string;
  notes?: string;
}

export default function IntakeSummary({ units, propertyName, confidence, notes }: Props) {
  const totalSF = units.reduce((s, u) => s + (u.square_footage || 0), 0);
  const occupiedSF = units.filter((u) => !u.is_vacant).reduce((s, u) => s + (u.square_footage || 0), 0);
  const vacancyRate = totalSF > 0 ? ((totalSF - occupiedSF) / totalSF) * 100 : 0;
  const totalAnnual = units.reduce((s, u) => s + (u.annual_rent || 0), 0);
  const occupiedUnitsWithRate = units.filter((u) => !u.is_vacant && u.lease_rate && u.square_footage);
  const weightedAvgRate =
    occupiedUnitsWithRate.length > 0
      ? occupiedUnitsWithRate.reduce((s, u) => s + (u.lease_rate! * u.square_footage!), 0) /
        occupiedUnitsWithRate.reduce((s, u) => s + u.square_footage!, 0)
      : 0;

  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => !u.is_vacant).length;
  const vacantUnits = totalUnits - occupiedUnits;

  // Lease expiration data
  const expirationMap: Record<string, number> = {};
  units.forEach((u) => {
    if (u.lease_end) {
      const year = u.lease_end.slice(0, 4);
      expirationMap[year] = (expirationMap[year] || 0) + 1;
    }
  });
  const expirationData = Object.entries(expirationMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, count]) => ({ year, count }));

  const barColors = [C.coral, C.teal, C.amber, C.green];

  return (
    <div className="flex flex-col gap-3.5">
      <Panel title={propertyName}>
        {/* Confidence badge */}
        {confidence && (
          <div className="flex items-center gap-2 mb-3">
            <span
              className="px-2 py-0.5 text-[10px] font-semibold"
              style={{
                borderRadius: 4,
                background:
                  confidence === "high"
                    ? "rgba(107,203,119,0.15)"
                    : confidence === "medium"
                    ? "rgba(242,201,76,0.15)"
                    : "rgba(231,76,60,0.15)",
                color:
                  confidence === "high" ? C.green : confidence === "medium" ? C.amber : "#E74C3C",
              }}
            >
              {confidence} confidence
            </span>
          </div>
        )}

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Metric label="Total SF" value={totalSF.toLocaleString()} accent={C.teal} />
          <Metric
            label="Vacancy Rate"
            value={`${vacancyRate.toFixed(1)}%`}
            sub={`${vacantUnits} of ${totalUnits} units`}
            accent={vacancyRate > 10 ? "#E74C3C" : C.green}
          />
          <Metric label="Annual Revenue" value={fmt(totalAnnual)} accent={C.coral} />
          <Metric
            label="Avg Rate/SF"
            value={weightedAvgRate > 0 ? `$${weightedAvgRate.toFixed(2)}` : "—"}
            sub="weighted by SF"
            accent={C.teal}
          />
          <Metric label="Units" value={String(totalUnits)} sub={`${occupiedUnits} occupied`} />
          <Metric
            label="Monthly Revenue"
            value={fmt(totalAnnual / 12)}
            accent={C.coral}
          />
        </div>

        {/* Notes from AI */}
        {notes && (
          <div
            className="glass-inner px-3 py-2.5 text-[11px] text-cream-muted leading-relaxed mb-3"
            style={{ borderLeft: `2px solid rgba(224,122,95,0.3)` }}
          >
            <span className="text-[10px] uppercase tracking-wider text-cream-subtle font-medium block mb-1">
              AI Notes
            </span>
            {notes}
          </div>
        )}
      </Panel>

      {/* Lease expiration chart */}
      {expirationData.length > 0 && (
        <Panel title="Lease Expirations">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={expirationData} barSize={28}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.04)"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "rgba(240,237,228,0.3)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" name="Leases" radius={[3, 3, 0, 0]}>
                {expirationData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={barColors[i % barColors.length]}
                    fillOpacity={0.75}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* Quick stats */}
      <Panel title="Revenue Breakdown">
        <div className="flex flex-col gap-1.5">
          {units
            .filter((u) => !u.is_vacant && u.annual_rent)
            .sort((a, b) => (b.annual_rent || 0) - (a.annual_rent || 0))
            .slice(0, 8)
            .map((u, i) => (
              <div
                key={i}
                className="glass-inner flex justify-between items-center px-2.5 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] font-medium text-cream truncate">
                    {u.tenant_name || `Unit ${u.unit_number || i + 1}`}
                  </div>
                  <div className="text-[10px] text-cream-subtle">
                    {u.square_footage ? u.square_footage.toLocaleString() + " SF" : "—"}
                  </div>
                </div>
                <span className="text-[12px] font-bold tnum ml-2" style={{ color: C.coral }}>
                  {fmtF(u.annual_rent || 0)}
                </span>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
