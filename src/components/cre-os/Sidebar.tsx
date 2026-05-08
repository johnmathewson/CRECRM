"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar — left navigation rail for CRE OS. The full operating-system nav,
 * grouped by intent: Operate (daily flow), Intelligence (analysis layers),
 * System (settings).
 *
 * Compact, always-visible. Hover surfaces description tooltips later.
 */

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Phase flag controls whether this lights up a real CRE OS route or
   *  falls back to the legacy page. */
  legacyHref?: string;
  badge?: number;
}

const ICON = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V11z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  building: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <rect x="4" y="4" width="16" height="17" rx="1" />
      <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" strokeLinecap="round" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 6 23 6 23 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M12 3v18M5 8l7-3 7 3M2 14l3-6 3 6a3 3 0 0 1-6 0zM16 14l3-6 3 6a3 3 0 0 1-6 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <line x1="12" y1="20" x2="12" y2="10" strokeLinecap="round" />
      <line x1="18" y1="20" x2="18" y2="4" strokeLinecap="round" />
      <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  cog: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operate",
    items: [
      { label: "Home",          href: "/cre-os",                icon: ICON.home,     legacyHref: "/" },
      { label: "Properties",    href: "/cre-os/properties",     icon: ICON.building, legacyHref: "/properties" },
      { label: "Pipeline",      href: "/cre-os/pipeline",       icon: ICON.pipeline, legacyHref: "/deals" },
      { label: "Inbox",         href: "/cre-os/inbox",          icon: ICON.inbox },
      { label: "Relationships", href: "/cre-os/relationships",  icon: ICON.users,    legacyHref: "/contacts" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Market",     href: "/cre-os/market",     icon: ICON.globe,    legacyHref: "/comps" },
      { label: "Valuation",  href: "/cre-os/valuate",    icon: ICON.scale,    legacyHref: "/valuate" },
      { label: "Reports",    href: "/cre-os/reports",    icon: ICON.chart },
      { label: "Documents",  href: "/cre-os/documents",  icon: ICON.doc },
      { label: "Listings",   href: "/cre-os/listings",   icon: ICON.trending },
    ],
  },
  {
    label: "Share",
    items: [
      { label: "Portals", href: "/cre-os/portals", icon: ICON.link },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/cre-os/settings", icon: ICON.cog },
    ],
  },
];

export function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop (only when drawer open) */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`
          flex flex-col bg-steward-base/95 lg:bg-steward-base/40 backdrop-blur-md border-r border-white/[0.04]
          /* Mobile: fixed drawer that slides in from the left */
          fixed lg:static inset-y-0 left-0 z-50
          w-72 lg:w-56 shrink-0 h-full
          transition-transform duration-200 ease-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
        `}
      >
        {/* Brand + mobile close */}
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-start justify-between gap-2">
          <div>
            <div className="font-display font-medium text-base text-cream tracking-wider">STEWARDSHIP</div>
            <div className="font-mono text-[9px] text-coral-400 uppercase tracking-eyebrow mt-0.5">CRE OS · Beta</div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden -mr-1 p-2 text-cream-subtle hover:text-cream transition-colors"
            aria-label="Close navigation"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 mb-2 font-heading text-[9px] font-semibold uppercase tracking-eyebrow text-cream-subtle">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-2.5 py-2.5 lg:py-2 rounded transition-colors ${
                        active
                          ? "bg-coral-400/[0.10] text-cream border-l-2 border-coral-400 pl-2"
                          : "text-cream-dim hover:bg-white/[0.04] hover:text-cream active:bg-white/[0.06]"
                      }`}
                    >
                      <span className={active ? "text-coral-300" : "text-cream-subtle"}>{item.icon}</span>
                      <span className="font-heading text-[13px] lg:text-[12px] font-medium flex-1">{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="font-mono text-[9px] text-coral-300">{item.badge}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.04]">
          <div className="font-mono text-[10px] lg:text-[9px] text-cream-subtle">
            john@stewardshipcre.com
          </div>
        </div>
      </aside>
    </>
  );
}
