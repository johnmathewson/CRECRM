import { CommsStreamView } from "@/components/cre-os/comms/CommsStreamView";
import { loadCommsStream } from "@/lib/cre-os/comms-stream-queries";

/**
 * Communications — the north-star home surface. One chronological stream of
 * every touch across email / text / call, filterable by property, channel,
 * and Unanswered. Read-only over the communications log; replies happen in
 * the lead workspace each row links to.
 */
export const dynamic = "force-dynamic";

export default async function CommsStreamPage() {
  const data = await loadCommsStream();
  return <CommsStreamView data={data} />;
}
