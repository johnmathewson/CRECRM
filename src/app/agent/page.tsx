import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import AgentDashboardContent from "@/components/agent-dashboard-content";

export default function AgentPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <AgentDashboardContent />
      </main>
    </>
  );
}
