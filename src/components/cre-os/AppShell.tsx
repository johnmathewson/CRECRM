"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { InsightsRail, RailSection } from "./InsightsRail";

/**
 * AppShell — the operating-system frame for every CRE OS page.
 *
 * Desktop (≥ lg / 1024px):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Topbar                                                        │
 *   ├──────────┬──────────────────────────────┬───────────────────┤
 *   │ Sidebar  │ Main scroll                  │ InsightsRail       │
 *   └──────────┴──────────────────────────────┴───────────────────┘
 *
 * Mobile (< lg):
 *   - Sidebar collapses to an overlay drawer (hamburger in Topbar).
 *   - InsightsRail collapses to a right-side overlay drawer (a "sparkles"
 *     button in Topbar — only shown when the page passes a rail).
 *   - Main becomes single-column, full-width, with reduced padding.
 *
 * Drawers auto-close on route change (so tapping a sidebar link feels like
 * a normal nav).
 */
export function AppShell({
  rail,
  children,
}: {
  rail?: RailSection[];
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const pathname = usePathname();
  const hasRail = !!rail && rail.length > 0;

  // Close drawers on route change.
  useEffect(() => {
    setSidebarOpen(false);
    setRailOpen(false);
  }, [pathname]);

  // Lock body scroll while a drawer is open on mobile.
  useEffect(() => {
    const open = sidebarOpen || railOpen;
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [sidebarOpen, railOpen]);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-steward-base text-cream font-body">
      <Topbar
        onMenuClick={() => setSidebarOpen(true)}
        onRailClick={hasRail ? () => setRailOpen(true) : undefined}
      />
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar — inline on lg+, drawer on mobile */}
        <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main — full-width on mobile, padded on desktop */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-[1600px] mx-auto px-4 py-5 lg:px-8 lg:py-6">{children}</div>
        </main>

        {/* InsightsRail — inline on lg+, drawer on mobile */}
        {hasRail && (
          <InsightsRail
            sections={rail!}
            mobileOpen={railOpen}
            onClose={() => setRailOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
