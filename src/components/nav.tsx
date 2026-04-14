"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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
  const [showMenu, setShowMenu] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <nav className="glass-nav sticky top-0 z-50 flex items-center h-14 px-7">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 mr-10 no-underline">
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
      </Link>

      {/* Nav links */}
      <div className="flex gap-0.5">
        {links.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
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

      {/* Search */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 w-60 transition-all duration-200 focus-within:bg-[rgba(255,255,255,0.055)] focus-within:border-[rgba(255,255,255,0.12)]"
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
      <div className="flex items-center gap-3 ml-5">
        <span className="text-[11px] text-cream-subtle">
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
              boxShadow:
                "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
            onClick={() => setShowMenu(!showMenu)}
          >
            JM
          </div>
          {showMenu && (
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
  );
}
