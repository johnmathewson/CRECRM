import Nav from "@/components/nav";
import LeadDetailContent from "@/components/lead-detail-content";

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[920px] mx-auto pb-[100px]">
        <LeadDetailContent leadId={params.id} />
      </main>
    </>
  );
}
