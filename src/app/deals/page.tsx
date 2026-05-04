import { Suspense } from "react";
import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import DealsContent from "@/components/deals-content";

export default function DealsPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        {/* DealsContent uses useSearchParams() to read ?focus=<id> for
            deep-links from the dashboard. Next.js requires that to be
            inside a Suspense boundary so the rest of the page can still
            pre-render statically. */}
        <Suspense fallback={null}>
          <DealsContent />
        </Suspense>
      </main>
    </>
  );
}
