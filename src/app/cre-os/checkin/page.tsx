import { CheckinView } from "@/components/cre-os/checkin/CheckinView";
import { loadLatestCheckin } from "@/lib/cre-os/checkin-queries";
import { chicagoDate } from "@/lib/agents/deal-checkin";

/**
 * /cre-os/checkin — the nightly deal check-in. The 8:45 PM text links
 * here; it's also in the sidebar (More) and on Today while questions are
 * open.
 */
export const dynamic = "force-dynamic";

export default async function CheckinPage() {
  const checkin = await loadLatestCheckin();
  return <CheckinView checkin={checkin} today={chicagoDate()} />;
}
