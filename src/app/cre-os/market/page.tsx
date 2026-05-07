import { MarketView } from "@/components/cre-os/market/MarketView";
import { loadMarketSnapshot } from "@/lib/cre-os/market-queries";

/**
 * Phase 6 — Market Intelligence command surface. Loads aggregated submarket,
 * asset-class, and comp-pulse data on the server, then hands the snapshot to
 * the client view for filtering + interaction.
 */
export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const snapshot = await loadMarketSnapshot();
  return <MarketView snapshot={snapshot} />;
}
