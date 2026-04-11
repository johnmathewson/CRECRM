import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import DashboardContent from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <DashboardContent />
      </main>
    </>
  );
}
