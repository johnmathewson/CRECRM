"use client";

import type { ReportSnapshot } from "@/lib/cre-os/report-queries";

const fmtMoneyExact = (n: number | null | undefined) =>
  n !== null && n !== undefined && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "$0";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * Branded reports executive summary. Same print-CSS pattern as the
 * seller-net PDF — Stewardship masthead, charcoal-on-white, sticky
 * toolbar with Print or save as PDF button. Sections paginate via
 * page-break-inside: avoid.
 */
export function ReportsPrintView({ snapshot }: { snapshot: ReportSnapshot }) {
  const t = snapshot.totals;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Forecast bar dimensions
  const forecastMax = Math.max(1, ...snapshot.forecast.map((r) => r.pipelineValue));
  const closedMax = Math.max(1, ...snapshot.closedByMonth.map((r) => r.volume));
  const stageMaxCount = Math.max(1, ...snapshot.stageRollup.map((r) => r.count));

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in 0.55in; }
        :root {
          --charcoal-950: #0D0D0D;
          --charcoal-700: #383838;
          --charcoal-500: #666666;
          --charcoal-400: #818181;
          --cream-100: #F0EDE4;
          --coral-300: #EA9A82;
          --coral-400: #E07A5F;
          --coral-500: #C66648;
          --teal-400: #4ECDC4;
        }
        html, body {
          background: white;
          color: var(--charcoal-950);
          font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
          font-size: 11px;
          line-height: 1.45;
          margin: 0; padding: 0;
          height: auto; overflow: auto;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc { max-width: 7.5in; margin: 0 auto; padding: 24px 16px 48px; }
        .brand { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid var(--charcoal-950); margin-bottom: 22px; }
        .brand h1 { margin: 0; font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 22px; font-weight: 500; letter-spacing: 0.04em; color: var(--charcoal-950); }
        .brand .sub { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--coral-500); margin-top: 3px; }
        .brand .meta { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--charcoal-500); }
        h2 { font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 14px; font-weight: 500; color: var(--charcoal-950); margin: 0 0 4px; line-height: 1.2; }
        .label-line { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--charcoal-500); margin-bottom: 6px; }
        .section { margin-bottom: 22px; page-break-inside: avoid; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 4px; }
        .kpi { border: 1px solid var(--charcoal-700); border-radius: 4px; padding: 10px 12px; background: #FAFAF8; }
        .kpi.accent { background: rgba(224,122,95,0.06); border-color: var(--coral-400); }
        .kpi .label { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--charcoal-500); }
        .kpi .value { font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 18px; font-weight: 500; line-height: 1.1; margin-top: 4px; color: var(--charcoal-950); }
        .kpi.accent .value { color: var(--coral-500); }
        .kpi .caption { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; color: var(--charcoal-500); margin-top: 3px; }
        .table { width: 100%; border-collapse: collapse; }
        .table td, .table th { padding: 5px 7px; text-align: left; vertical-align: top; }
        .table th { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--charcoal-500); border-bottom: 1px solid var(--charcoal-700); }
        .table td { border-bottom: 1px solid #E5E0D8; font-size: 10.5px; }
        .num { font-family: 'JetBrains Mono', ui-monospace, monospace; text-align: right; }
        .num.accent { color: var(--coral-500); font-weight: 600; }
        .bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 110px; padding: 6px 0; }
        .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .bar-col .bar-stack { width: 100%; position: relative; height: 80px; }
        .bar-col .bar { position: absolute; bottom: 0; left: 0; right: 0; border-radius: 2px 2px 0 0; }
        .bar-col .label { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; color: var(--charcoal-500); }
        .bar-col .value { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; color: var(--charcoal-700); }
        .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid #E5E0D8; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8.5px; color: var(--charcoal-500); display: flex; justify-content: space-between; }
        .toolbar {
          position: sticky; top: 0; z-index: 10;
          background: var(--charcoal-950); color: var(--cream-100);
          padding: 10px 14px;
          font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px;
          display: flex; gap: 12px; align-items: center;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        }
        .toolbar button { color: var(--coral-400); background: transparent; border: 1px solid var(--coral-400); padding: 4px 10px; border-radius: 3px; font: inherit; cursor: pointer; }
        .toolbar button:hover { background: rgba(224, 122, 95, 0.15); }
        .toolbar .primary { background: var(--coral-400); color: var(--charcoal-950); border-color: var(--coral-400); font-weight: 600; }
        .toolbar .primary:hover { background: var(--coral-500); border-color: var(--coral-500); }
        @media print {
          .toolbar { display: none; }
          html, body { background: white; }
          .doc { padding: 0; }
        }
      `}</style>

      <div className="toolbar">
        <span>Stewardship CRE — Reports &amp; Analytics</span>
        <span style={{ marginLeft: "auto", color: "var(--charcoal-400)" }}>Scroll to preview · click to save</span>
        <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>

      <div className="doc">
        <div className="brand">
          <div>
            <h1>STEWARDSHIP</h1>
            <div className="sub">Reports &amp; Analytics</div>
          </div>
          <div className="meta">
            {today}<br />
            stewardshipcre.com
          </div>
        </div>

        {/* Synthesis */}
        <p style={{ fontSize: 11.5, color: "var(--charcoal-700)", marginTop: 0, marginBottom: 18, fontStyle: "italic" }}>
          {snapshot.synthesis}
        </p>

        {/* KPI grid */}
        <div className="section">
          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">Pipeline value</div>
              <div className="value">{fmtMoney(t.pipelineValue)}</div>
              <div className="caption">{t.activeDeals} active · gross</div>
            </div>
            <div className="kpi">
              <div className="label">Weighted commission</div>
              <div className="value">{fmtMoney(t.weightedValue)}</div>
              <div className="caption">Probability-adjusted</div>
            </div>
            <div className="kpi accent">
              <div className="label">Earned YTD</div>
              <div className="value">{fmtMoney(t.earnedYtd)}</div>
              <div className="caption">Commission · {t.wonYtdCount} closed</div>
            </div>
            <div className="kpi">
              <div className="label">Closed volume YTD</div>
              <div className="value">{fmtMoney(t.wonYtdVolume)}</div>
              <div className="caption">Gross sales price</div>
            </div>
          </div>
          <p style={{ fontSize: 9.5, color: "var(--charcoal-500)", margin: "8px 0 0", fontFamily: "JetBrains Mono, monospace" }}>
            <span style={{ color: "var(--coral-500)", fontWeight: 600 }}>{fmtMoneyExact(t.expectedThisQuarter)}</span> in weighted commission expected to close this quarter.
          </p>
        </div>

        {/* Pipeline forecast */}
        <div className="section">
          <div className="label-line">Pipeline forecast</div>
          <h2>Active deals · next 6 months</h2>
          <div className="bar-chart">
            {snapshot.forecast.map((r) => {
              const grossPct = (r.pipelineValue / forecastMax) * 100;
              const weightedPct = forecastMax > 0 ? (r.weightedValue / forecastMax) * 100 : 0;
              return (
                <div key={r.month} className="bar-col">
                  <div className="value">{r.activeCount > 0 ? fmtMoney(r.weightedValue) : ""}</div>
                  <div className="bar-stack">
                    <div className="bar" style={{ height: `${grossPct}%`, background: "rgba(224,122,95,0.25)" }} />
                    <div className="bar" style={{ height: `${weightedPct}%`, background: "var(--coral-400)" }} />
                  </div>
                  <div className="label">{r.monthLabel}</div>
                  <div className="label">{r.activeCount} deals</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stage rollup */}
        {snapshot.stageRollup.length > 0 && (
          <div className="section">
            <div className="label-line">Stage rollup</div>
            <h2>Active deals by current stage</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="num" style={{ textAlign: "right" }}>Count</th>
                  <th className="num" style={{ textAlign: "right" }}>Value</th>
                  <th className="num" style={{ textAlign: "right" }}>Weighted</th>
                  <th className="num" style={{ textAlign: "right" }}>Avg prob</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.stageRollup.map((r) => (
                  <tr key={r.stage}>
                    <td><b>{r.stage}</b></td>
                    <td className="num">{r.count}</td>
                    <td className="num">{fmtMoney(r.totalValue)}</td>
                    <td className="num accent">{fmtMoney(r.weightedValue)}</td>
                    <td className="num">{r.avgProbability !== null ? Math.round(r.avgProbability) + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Closed YTD chart */}
        <div className="section">
          <div className="label-line">Closed · last 12 months</div>
          <h2>{t.wonYtdCount} closed YTD · {fmtMoney(t.wonYtdVolume)} volume · {fmtMoney(t.earnedYtd)} commission</h2>
          <div className="bar-chart">
            {snapshot.closedByMonth.map((r) => {
              const pct = r.volume === 0 ? 2 : Math.max(4, (r.volume / closedMax) * 90);
              return (
                <div key={r.month} className="bar-col">
                  <div className="value">{r.count > 0 ? fmtMoney(r.volume) : ""}</div>
                  <div className="bar-stack">
                    <div className="bar" style={{ height: pct, background: "rgba(78,205,196,0.65)" }} />
                  </div>
                  <div className="label">{r.monthLabel}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lead intake */}
        <div className="section">
          <div className="label-line">Lead intake</div>
          <h2>Last 8 weeks</h2>
          <div className="bar-chart">
            {snapshot.leadsByWeek.map((r, i) => {
              const max = Math.max(1, ...snapshot.leadsByWeek.map((x) => x.count));
              const pct = r.count === 0 ? 2 : Math.max(4, (r.count / max) * 90);
              const isLatest = i === snapshot.leadsByWeek.length - 1;
              return (
                <div key={r.week} className="bar-col">
                  <div className="value">{r.count > 0 ? r.count : ""}</div>
                  <div className="bar-stack">
                    <div
                      className="bar"
                      style={{ height: pct, background: isLatest ? "var(--coral-400)" : "rgba(224,122,95,0.6)" }}
                    />
                  </div>
                  <div className="label">{r.weekLabel}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lead source */}
        {snapshot.leadsBySource.length > 0 && (
          <div className="section">
            <div className="label-line">Lead source</div>
            <table className="table" style={{ maxWidth: "100%" }}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="num" style={{ textAlign: "right" }}>Leads (8w)</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.leadsBySource.slice(0, 10).map((r) => (
                  <tr key={r.source}>
                    <td>{r.source || "—"}</td>
                    <td className="num">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Listing performance */}
        {snapshot.listingReach.length > 0 && (
          <div className="section">
            <div className="label-line">Listing performance · last 7 days</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th className="num" style={{ textAlign: "right" }}>Reach</th>
                  <th className="num" style={{ textAlign: "right" }}>Inq</th>
                  <th className="num" style={{ textAlign: "right" }}>OMs</th>
                  <th className="num" style={{ textAlign: "right" }}>NDAs</th>
                  <th className="num" style={{ textAlign: "right" }}>Conv/1k</th>
                  <th className="num" style={{ textAlign: "right" }}>DOM</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.listingReach.map((r) => (
                  <tr key={r.propertyId}>
                    <td>
                      <b>{r.headline || r.name}</b>
                      <div style={{ fontSize: 9, color: "var(--charcoal-500)" }}>
                        {[r.city, r.state].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td className="num">{r.reach7d.toLocaleString()}</td>
                    <td className="num accent">{r.inquiries7d}</td>
                    <td className="num">{r.omDownloads7d}</td>
                    <td className="num">{r.ndaSignatures7d}</td>
                    <td className="num">{r.conversionPer1k === null ? "—" : r.conversionPer1k}</td>
                    <td className="num">{r.daysOnMarket === null ? "—" : `${r.daysOnMarket}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="footer">
          <span>Stewardship CRE — confidential · internal use only</span>
          <span>Generated {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </>
  );
}
