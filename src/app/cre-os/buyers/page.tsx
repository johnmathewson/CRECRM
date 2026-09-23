import { BuyersView } from "@/components/cre-os/buyers/BuyersView";
import { loadBuyerBoard } from "@/lib/cre-os/buyer-queries";

export const dynamic = "force-dynamic";

export default async function BuyersPage() {
  const board = await loadBuyerBoard();
  return <BuyersView board={board} />;
}
