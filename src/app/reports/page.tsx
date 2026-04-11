import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import ReportsContent from "@/components/reports-content";

export default function ReportsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <ReportsContent />
      </main>
    </>
  );
}
