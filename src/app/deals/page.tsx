import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import DealsContent from "@/components/deals-content";

export default function DealsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <DealsContent />
      </main>
    </>
  );
}
