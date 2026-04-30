import Nav from "@/components/nav";
import InboxSplitView from "@/components/inbox-split-view";

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  return (
    <>
      <Nav />
      <InboxSplitView selectedLeadId={params.id} />
    </>
  );
}
