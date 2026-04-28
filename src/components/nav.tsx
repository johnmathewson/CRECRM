"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/intake", label: "Intake" },
  { href: "/comps", label: "Comps" },
  { href: "/valuate", label: "Valuation" },
  { href: "/properties", label: "Properties" },
  { href: "/contacts", label: "Contacts" },
  { href: "/deals", label: "Deals" },
  { href: "/reports", label: "Reports" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  // Close drawer/menu on route change
  useEffect(() => {
    setShowDrawer(false);
    setShowProfileMenu(false);
  }, [pathname]);

  // Close drawer on Escape
  useEffect(() => {
    if (!showDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDrawer]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (showDrawer) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showDrawer]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <nav className="glass-nav sticky top-0 z-50 flex items-center h-14 px-4 lg:px-7">
        {/* Hamburger — mobile only */}
        <button
          aria-label="Open menu"
          onClick={() => setShowDrawer(true)}
          className="lg:hidden flex items-center justify-center w-9 h-9 mr-3 text-cream-muted hover:text-cream transition-colors"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 5,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </svg>
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 lg:mr-10 no-underline">
          <div
            className="w-[30px] h-[30px] rounded flex items-center justify-center font-extrabold text-[15px] text-white"
            style={{
              background: "linear-gradient(135deg, #E07A5F, #E07A5FBB)",
              boxShadow: "0 2px 14px rgba(224,122,95,0.35)",
              borderRadius: 4,
            }}
          >
            S
          </div>
          <span className="hidden sm:inline text-[13.5px] font-semibold tracking-[1.5px] text-cream">
            STEWARDSHIP
          </span>
        </Link>

        {/* Desktop nav links — hidden on smaller screens */}
        <div className="hidden lg:flex gap-0.5">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3.5 py-1.5 rounded text-[12.5px] no-underline transition-all duration-200 ${
                  active
                    ? "font-semibold bg-coral-muted text-coral"
                    : "font-normal text-cream-muted hover:text-cream-subtle"
                }`}
                style={{ borderRadius: 5 }}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Search — desktop only */}
        <div
          className="hidden lg:flex items-center gap-2 px-3 py-1.5 w-60 transition-all duration-200 focus-within:bg-[rgba(255,255,255,0.055)] focus-within:border-[rgba(255,255,255,0.12)]"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 5,
          }}
        >
          <span className="opacity-35 text-xs">🔍</span>
          <input
            placeholder="Search properties, contacts..."
            className="bg-transparent border-none outline-none text-cream text-xs w-full font-sans"
          />
        </div>

        {/* Date + Profile */}
        <div className="flex items-center gap-3 lg:ml-5">
          <span className="hidden md:inline text-[11px] text-cream-subtle">
            {new Date().toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <div className="relative">
            <div
              className="w-8 h-8 flex items-center justify-center text-[12.5px] font-bold cursor-pointer"
              style={{
                borderRadius: 5,
                background: "rgba(255,255,255,0.05)",
                border: "1.5px solid rgba(224,122,95,0.22)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
              onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              JM
            </div>
            {showProfileMenu && (
              <div
                className="absolute right-0 top-10 w-44 py-1.5 z-50 glass"
                style={{ borderRadius: 6 }}
              >
                <div className="px-3.5 py-2 border-b border-[rgba(255,255,255,0.06)]">
                  <div className="text-xs font-semibold">John Mathewson</div>
                  <div className="text-[10px] text-cream-subtle mt-0.5">john@johnmathewson.co</div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-3.5 py-2 text-xs text-cream-muted hover:text-cream cursor-pointer border-none font-sans"
                  style={{ background: "transparent" }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Mobile drawer ──────────────────────────────────────── */}

      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-[60] bg-black/60 transition-opacity duration-300 ${
          showDrawer ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setShowDrawer(false)}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-[70] h-full w-[85vw] max-w-[340px] glass transition-transform duration-300 flex flex-col ${
          showDrawer ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          borderRadius: 0,
          borderRight: "1px solid rgba(255,255,255,0.08)",
        }}
        aria-hidden={!showDrawer}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-[30px] h-[30px] rounded flex items-center justify-center font-extrabold text-[15px] text-white"
              style={{
                background: "linear-gradient(135deg, #E07A5F, #E07A5FBB)",
                boxShadow: "0 2px 14px rgba(224,122,95,0.35)",
                borderRadius: 4,
              }}
            >
              S
            </div>
            <span className="text-[13.5px] font-semibold tracking-[1.5px] text-cream">
              STEWARDSHIP
            </span>
          </div>
          <button
            aria-label="Close menu"
            onClick={() => setShowDrawer(false)}
            className="w-8 h-8 flex items-center justify-center text-cream-muted hover:text-cream"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>

        {/* Search inside drawer */}
        <div className="px-5 pt-4 pb-3">
          <div
            className="flex items-center gap-2 px-3 py-2 w-full"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 5,
            }}
          >
            <span className="opacity-35 text-xs">🔍</span>
            <input
              placeholder="Search properties, contacts..."
              className="bg-transparent border-none outline-none text-cream text-sm w-full font-sans"
            />
          </div>
        </div>

        {/* Drawer nav links — vertical, larger tap targets */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setShowDrawer(false)}
                className={`flex items-center px-4 h-12 text-[14px] no-underline transition-all duration-150 mb-1 ${
                  active
                    ? "font-semibold bg-coral-muted text-coral"
                    : "font-normal text-cream-muted hover:bg-[rgba(255,255,255,0.04)] hover:text-cream"
                }`}
                style={{ borderRadius: 5 }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Drawer footer — profile + date + sign out */}
        <div className="border-t border-[rgba(255,255,255,0.07)] px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-9 h-9 flex items-center justify-center text-[13px] font-bold flex-shrink-0"
              style={{
                borderRadius: 5,
                background: "rgba(255,255,255,0.05)",
                border: "1.5px solid rgba(224,122,95,0.22)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              JM
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-cream truncate">John Mathewson</div>
              <div className="text-[10px] text-cream-subtle truncate">john@johnmathewson.co</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-cream-subtle">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <button
              onClick={handleSignOut}
              className="text-xs text-cream-muted hover:text-cream cursor-pointer border-none font-sans px-3 py-1.5"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 5,
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
