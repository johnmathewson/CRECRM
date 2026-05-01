import Nav from "@/components/nav";
import IntegrationsContent from "@/components/integrations-content";

export default function IntegrationsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[920px] mx-auto">
        <IntegrationsContent />
      </main>
    </>
  );
}
