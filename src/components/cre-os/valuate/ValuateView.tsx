"use client";

import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { ValuateContext, RecentBov } from "@/lib/cre-os/valuate-queries";
import ValuateContent from "@/components/valuate-content";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};
const fmtCap = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : (n * 100).toFixed(2) + "%";
const fmtPpsf = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : "$" + n.toFixed(0);

/**
 * ValuateView — wraps the legacy ValuateContent in the CRE OS shell.
 *
 * The actual valuation tool (rent roll, OM upload, three-approach BOV) is
 * untouched — too much logic to rewrite for cosmetic reasons. We just give
 * it a proper home: dark editorial header, a context-aware insights rail
 * (recent BOVs, market benchmarks, methodology tips), and the same nav as
 * the rest of CRE OS.
 *
 * The legacy /valuate route is kept alive for direct access; sidebar
 * "Valuation" link now points to this page (/cre-os/valuate).
 */
export function ValuateView({ context }: { context: ValuateContext }) {
  const rail: RailSection[] = [
    {
      eyebrow: "Market context",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat
            label="Comp set"
            value={`${context.totals.saleCompCount.toLocaleString()} sale · ${context.totals.leaseCompCount.toLocaleString()} lease`}
          />
          <RailStat label="Median cap" value={fmtCap(context.totals.portfolioMedianCapRate)} />
          <RailStat label="Median sale $/SF" value={fmtPpsf(context.totals.portfolioMedianPpsf)} />
        </div>
      ),
    },
    {
      eyebrow: "Recent valuations",
      children: context.recentBovs.length === 0 ? (
        <p className="font-body text-[11px] text-cream-subtle italic">
          No saved BOVs yet. Run one below and click "Save Property" to add it to your portfolio.
        </p>
      ) : (
        <div className="space-y-2">
          {context.recentBovs.slice(0, 5).map((b) => (
            <RecentBovCard key={b.id} bov={b} />
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Methodology reminders",
      children: (
        <ul className="space-y-1.5 font-body text-[11px] text-cream-dim leading-relaxed list-disc list-inside marker:text-coral-400">
          <li>Three-approach reconciliation — income, sales comparison, cost. Don't lean on one.</li>
          <li>Stabilized vs. in-place: use the higher of subject's actual rents or market rate when modeling NOI.</li>
          <li>Vacant units count toward stabilized PGI even when collecting $0 today.</li>
          <li>Cap rate range comes from comps; trim outliers before averaging.</li>
        </ul>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a
            href="/cre-os/market"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Browse comp database
          </a>
          <a
            href="/cre-os/properties"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Existing portfolio →
          </a>
          <a
            href="/valuate"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-subtle hover:text-cream transition-colors"
            title="Opens the same tool in the legacy full-screen layout."
          >
            Legacy fullscreen view →
          </a>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Editorial header — matches the other CRE OS command surfaces */}
        <header>
          <Eyebrow tone="coral">Valuation · BOV / CMA</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">
            Run a valuation
          </h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            Three-approach reconciliation — income, sales comparison, cost — with rent roll
            parsing and OM-extraction. Save the result as a new property or attach it to a
            new deal.
          </p>
        </header>

        {/* The legacy ValuateContent runs untouched inside the shell, but
            it was DESIGNED for a dark theme — every inline style assumes
            cream text on dark steward-base. The CRE OS AppShell uses
            canvas-light (slate gradient) so we have to make this section
            a "dark island" with a solid dark background. Otherwise the
            cream inline text colors render invisibly on the light canvas. */}
        <div className="rounded-md border border-white/[0.08] bg-[#0D0D0D] p-5 lg:p-6 shadow-panel-soft">
          <div className="valuate-shell">
            <ValuateContent />
          </div>
        </div>
      </div>

      <style jsx global>{`
        /* The CRE OS AppShell wraps content in .canvas-light which sets
           --ink to a dark slate (#171C24). The legacy ValuateContent was
           designed for a DARK theme — it expects cream text on dark
           backgrounds. Without this override, every input + label + body
           text resolves to dark slate against the dark steward-surface
           panel and becomes invisible.

           Solution: re-pin --ink to cream INSIDE .valuate-shell so all
           text styles in the legacy tool that reference it cascade
           correctly. Also force input/select/textarea text + placeholders
           explicitly as belt + suspenders. */
        .valuate-shell {
          --ink: 240 237 228; /* cream — matches the dark-theme root */
          color: rgb(240, 237, 228);
        }
        .valuate-shell h1,
        .valuate-shell h2,
        .valuate-shell h3,
        .valuate-shell h4,
        .valuate-shell h5,
        .valuate-shell h6,
        .valuate-shell p,
        .valuate-shell span,
        .valuate-shell label,
        .valuate-shell li,
        .valuate-shell td,
        .valuate-shell th {
          color: rgb(240, 237, 228);
        }
        .valuate-shell input[type="text"],
        .valuate-shell input[type="number"],
        .valuate-shell input[type="email"],
        .valuate-shell input[type="tel"],
        .valuate-shell select,
        .valuate-shell textarea {
          color: rgb(240, 237, 228);
        }
        .valuate-shell input::placeholder,
        .valuate-shell textarea::placeholder {
          color: rgba(240, 237, 228, 0.4);
        }
      `}</style>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function RecentBovCard({ bov }: { bov: RecentBov }) {
  const fullAddress = [bov.city, bov.state].filter(Boolean).join(", ");
  return (
    <a
      href={bov.slug ? `/cre-os/properties/${bov.slug}` : "#"}
      className="block rounded border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] p-2.5 transition-colors group"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-heading text-[12px] font-semibold text-cream truncate group-hover:text-coral-300 transition-colors">
          {bov.headline || bov.name}
        </span>
        <span className="font-mono text-[9px] text-cream-subtle whitespace-nowrap">{bov.when}</span>
      </div>
      {fullAddress && (
        <div className="font-mono text-[10px] text-cream-subtle truncate mb-1.5">{fullAddress}</div>
      )}
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 font-mono text-[10px]">
        <Stat label="Ask" value={fmtMoney(bov.askingPrice)} accent />
        <Stat label="Cap" value={fmtCap(bov.capRate)} />
        <Stat label="$/SF" value={fmtPpsf(bov.pricePerSf)} />
      </div>
    </a>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-cream-subtle">{label}</div>
      <div className={accent ? "text-coral-300 font-semibold" : "text-cream"}>{value}</div>
    </div>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}
