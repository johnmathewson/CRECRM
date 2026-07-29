"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * BottomNav — mobile primary navigation bar, fixed to the bottom of the
 * viewport. Visible only below the `lg` breakpoint; on lg+ the Sidebar
 * is always inline so this would be redundant.
 *
 * Picks the 5 destinations a broker hits constantly from their phone:
 *   Home · Prospector · Inbox · Properties · Inbox (lead inbox)
 *
 * Uses iOS safe-area-inset-bottom padding so the bar sits above the
 * home indicator on iPhones with notches. Active state matches the
 * Sidebar's coral underline so the visual language is consistent.
 */

interface BottomTab {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_HOME = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
    <path d="M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V11z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICON_RADAR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.75" fill="currentColor" />
  </svg>
);
const ICON_BUILDING = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
    <rect x="4" y="4" width="16" height="17" rx="1" />
    <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" strokeLinecap="round" />
  </svg>
);
const ICON_PIPELINE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
    <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
  </svg>
);
const ICON_INBOX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
    <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TABS: BottomTab[] = [
  { href: "/cre-os",                label: "Home",       icon: ICON_HOME },
  { href: "/cre-os/prospector",     label: "Prospector", icon: ICON_RADAR },
  // Inbox retired 2026-07-29 — Communications (the stream + ThreadPanel
  // reply bar) is the one front door. Lead files at /cre-os/inbox/[id]
  // still exist and every deeplink keeps working.
  { href: "/cre-os/stream",         label: "Comms",      icon: ICON_INBOX },
  { href: "/cre-os/properties",     label: "Properties", icon: ICON_BUILDING },
  { href: "/cre-os/pipeline",       label: "Pipeline",   icon: ICON_PIPELINE },
];

export function BottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-steward-base/95 backdrop-blur-md border-t border-white/[0.06]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary navigation"
    >
      <div className="flex items-stretch justify-around">
        {TABS.map((t) => {
          // Active if exact match OR a sub-route (e.g. /cre-os/properties/[slug]).
          // Special-case Home — exact match only (otherwise / would match all).
          const active =
            t.href === "/cre-os"
              ? pathname === "/cre-os" || pathname === "/cre-os/"
              : pathname === t.href || pathname.startsWith(t.href + "/");

          return (
            <Link
              key={t.href}
              href={t.href}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] transition-colors"
              aria-current={active ? "page" : undefined}
            >
              <span
                className={`transition-colors ${
                  active ? "text-coral-300" : "text-cream-subtle"
                }`}
              >
                {t.icon}
              </span>
              <span
                className={`font-mono text-[9.5px] uppercase tracking-eyebrow transition-colors ${
                  active ? "text-coral-300" : "text-cream-subtle"
                }`}
              >
                {t.label}
              </span>
              {/* Active-state indicator at the top edge of the tab */}
              {active && (
                <span className="absolute top-0 inset-x-3 h-[2px] bg-coral-400" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
