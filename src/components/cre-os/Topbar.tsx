"use client";

import { useState } from "react";

/**
 * Topbar — full-width header above the 3-column body. Holds the global search
 * (cmd-K), saved-views menu placeholder, notifications, user. Compact, calm.
 */
export function Topbar() {
  const [q, setQ] = useState("");
  return (
    <header className="h-14 shrink-0 border-b border-white/[0.04] bg-steward-base/40 backdrop-blur-md px-5 flex items-center gap-4">
      {/* Search */}
      <div className="flex-1 max-w-2xl">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-cream-subtle"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search properties, contacts, deals…"
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md pl-9 pr-14 py-2 text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-cream-subtle bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right cluster — placeholder for future controls */}
      <div className="flex items-center gap-3">
        <button className="relative p-2 text-cream-subtle hover:text-cream transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="h-5 w-px bg-white/10" />
        <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-coral-400 to-coral-600 flex items-center justify-center font-heading text-[11px] font-bold text-steward-base">
            JM
          </div>
          <div className="hidden sm:block">
            <div className="font-heading text-[11px] text-cream font-medium leading-tight">John Mathewson</div>
            <div className="font-mono text-[9px] text-cream-subtle leading-tight">Stewardship CRE</div>
          </div>
        </div>
      </div>
    </header>
  );
}
