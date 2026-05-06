"use client";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { InsightsRail, RailSection } from "./InsightsRail";

/**
 * AppShell — the 3-column operating-system frame for every CRE OS page.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Topbar (search · notifications · user)                            │
 *   ├──────────┬──────────────────────────────────┬─────────────────────┤
 *   │ Sidebar  │ Main scroll region (page content)│ Insights rail       │
 *   │ (nav)    │                                  │ (AI insights        │
 *   │          │                                  │  + reminders        │
 *   │          │                                  │  + next actions)    │
 *   └──────────┴──────────────────────────────────┴─────────────────────┘
 *
 * The rail can be omitted on pages that don't need it (settings, doc viewers).
 */
export function AppShell({
  rail,
  children,
}: {
  rail?: RailSection[];
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-steward-base text-cream font-body">
      <Topbar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto px-8 py-6">{children}</div>
        </main>
        {rail && rail.length > 0 && <InsightsRail sections={rail} />}
      </div>
    </div>
  );
}
