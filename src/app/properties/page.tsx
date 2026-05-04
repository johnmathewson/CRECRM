import { Suspense } from "react";
import Nav from "@/components/nav";
import AiBar from "@/components/ai-bar";
import PropertiesContent from "@/components/properties-content";

export default function PropertiesPage() {
  return (
    <>
      <Nav />
      <main className="relative z-[1] px-7 py-[22px] max-w-[1480px] mx-auto">
        <AiBar />
        {/* PropertiesContent uses useSearchParams() to handle ?focus=<property_id>
            deep-links from the deals modal. Next.js requires that to be inside a
            Suspense boundary so the rest of the page can still pre-render. */}
        <Suspense fallback={null}>
          <PropertiesContent />
        </Suspense>
      </main>
    </>
  );
}
