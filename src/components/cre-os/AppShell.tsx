"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { InsightsRail, RailSection } from "./InsightsRail";
import { BottomNav } from "./BottomNav";

/**
 * AppShell — the operating-system frame for every CRE OS page.
 *
 * Wide desktop (≥ xl / 1280px):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Topbar                                                        │
 *   ├──────────┬──────────────────────────────┬───────────────────┤
 *   │ Sidebar  │ Main scroll                  │ InsightsRail       │
 *   └──────────┴──────────────────────────────┴───────────────────┘
 *
 * Laptop (lg / 1024-1279px):
 *   - Sidebar inline, InsightsRail collapses to drawer (sparkles in Topbar).
 *   - Frees up ~300px so KPI grids and tables don't get squeezed.
 *
 * Mobile/tablet (< lg):
 *   - Sidebar collapses to an overlay drawer (hamburger in Topbar).
 *   - InsightsRail collapses to a right-side overlay drawer.
 *   - Main becomes single-column, full-width, with reduced padding.
 *
 * Drawers auto-close on route change.
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
    <div
      className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-steward-base text-cream font-body"
      // viewport-fit=cover lets us paint into the notch area; this padding
      // keeps content out from under it on phones.
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <Topbar
        onMenuClick={() => setSidebarOpen(true)}
        onRailClick={hasRail ? () => setRailOpen(true) : undefined}
      />
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar — inline on lg+, drawer below */}
        <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main — full-width on mobile, padded on desktop. The pb-24 on
            mobile reserves space so the fixed BottomNav doesn't cover
            content at the end of every page. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-[1600px] mx-auto px-4 py-5 pb-24 lg:px-8 lg:py-6 lg:pb-6">{children}</div>
        </main>

        {/* InsightsRail — inline on xl+, drawer below */}
        {hasRail && (
          <InsightsRail
            sections={rail!}
            mobileOpen={railOpen}
            onClose={() => setRailOpen(false)}
          />
        )}
      </div>

      {/* Mobile-only primary navigation, fixed to the bottom edge. */}
      <BottomNav />
    </div>
  );
}
