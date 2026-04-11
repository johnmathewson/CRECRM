import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import IntakeContent from "@/components/intake-content";

export default function IntakePage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        <IntakeContent />
      </main>
    </>
  );
}
