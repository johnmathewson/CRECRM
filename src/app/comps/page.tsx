import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import CompsContent from "@/components/comps-content";

export default function CompsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <CompsContent />
      </main>
    </>
  );
}
