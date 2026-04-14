import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import ValuateContent from "@/components/valuate-content";

export default function ValuatePage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <ValuateContent />
      </main>
    </>
  );
}
