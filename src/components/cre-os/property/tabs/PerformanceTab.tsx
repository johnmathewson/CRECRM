"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

/**
 * Performance tab — listing engagement intelligence. Real wiring lands in
 * Phase 6 (Listing Performance & Market Intel) when the Chrome extension's
 * sync feeds populate impressions/inquiries/conversion. v1 ships an honest
 * "wiring in flight" state with the slot for the eventual viz.
 */
export function PerformanceTab({ p }: { p: PropertyDetail }) {
  return (
    <div className="space-y-6">
      <Panel eyebrow="Listing performance" num={1} title="Engagement funnel">
        <PendingState
          headline="Live listing analytics arrive in Phase 6"
          body="Once the Chrome extension's sync writes to listing_metrics, this panel will show impressions → page views → OM opens → inquiries → executed NDAs → offers, with anomaly detection and source-platform breakdown (CREXi vs LoopNet vs Buildout)."
        />
      </Panel>

      <Panel eyebrow="Inbound inquiries" num={2} title={`Leads on this asset (${p.leads.length})`}>
        {p.leads.length === 0 ? (
          <p className="font-body text-[13px] text-cream-subtle py-4">No inquiries yet.</p>
        ) : (
          <div className="space-y-2">
            {p.leads.map((l) => (
              <div key={l.id} className="border border-white/[0.05] rounded p-3 bg-white/[0.02]">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="font-heading text-[12px] font-semibold text-cream">{l.senderName || l.senderEmail || "Unknown"}</div>
                    {l.qualifierSummary && (
                      <p className="mt-1 font-body text-[11px] text-cream-dim leading-snug">{l.qualifierSummary}</p>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-cream-subtle text-right shrink-0">
                    {l.urgency && <span className="uppercase tracking-eyebrow">{l.urgency}</span>}
                    {l.intent && <div className="mt-0.5">{l.intent}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Marketing reach" num={3} title="Where this asset is exposed">
        <PendingState
          headline="Multi-channel reach map arrives with the listing-sync layer"
          body="Will surface platform parity (CREXi vs LoopNet vs Buildout vs site), days-on-market per channel, and price-change history."
        />
      </Panel>
    </div>
  );
}

function PendingState({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="py-8 px-4 text-center">
      <Eyebrow tone="muted">Coming in Phase 6</Eyebrow>
      <p className="mt-3 font-heading text-[14px] text-cream-dim max-w-md mx-auto">{headline}</p>
      <p className="mt-2 font-body text-[12px] text-cream-subtle max-w-md mx-auto leading-relaxed">{body}</p>
    </div>
  );
}
