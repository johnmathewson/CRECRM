"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Topbar — full-width header above the body. Holds the global search
 * (⌘K / Ctrl+K — people, properties, leads in one box), the user, and on
 * mobile the hamburger (left) and the Insights button (right).
 *
 * The search is the desktop's front door: type a name or an address,
 * arrow to the hit, Enter. Esc clears.
 */

interface SearchHit {
  kind: "person" | "property" | "lead";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  person: "Person",
  property: "Property",
  lead: "Lead",
};

export function Topbar({
  onMenuClick,
  onRailClick,
}: {
  onMenuClick?: () => void;
  /** Provided only when the current page has a rail to show. */
  onRailClick?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [openList, setOpenList] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K anywhere → focus the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced lookup.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, cache: "no-store" });
        const json = await res.json();
        setHits(Array.isArray(json?.hits) ? json.hits : []);
        setActive(0);
        setOpenList(true);
      } catch {
        /* aborted or offline — keep what we had */
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Click outside closes the list.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpenList(false);
      setQ("");
      setHits([]);
      router.push(hit.href);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpenList(false);
      setQ("");
      inputRef.current?.blur();
      return;
    }
    if (!openList || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <header className="h-14 shrink-0 border-b border-white/[0.06] bg-steward-base px-3 lg:px-5 flex items-center gap-2 lg:gap-4">
      {/* Mobile hamburger (lg:hidden) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden -ml-1 p-2 text-cream-dim hover:text-cream transition-colors"
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
          <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
          <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
          <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
        </svg>
      </button>

      {/* Brand on mobile (sidebar holds it on desktop) */}
      <div className="lg:hidden font-display font-extrabold text-[15px] text-cream">Stewardship</div>

      {/* Search */}
      <div ref={boxRef} className="flex-1 max-w-2xl ml-auto lg:ml-0 relative">
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
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length > 0 && setOpenList(true)}
            onKeyDown={onKeyDown}
            placeholder="Search people, properties, leads…"
            autoComplete="off"
            aria-label="Search"
            aria-expanded={openList}
            aria-controls="topbar-search-results"
            // text-base (16px) on mobile prevents iOS auto-zoom on focus.
            className="w-full bg-white/[0.04] border border-white/[0.08] pl-9 pr-3 lg:pr-14 py-2 text-base lg:text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400 transition-colors"
          />
          <kbd className="hidden lg:block absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-cream-subtle border border-white/[0.10] px-1.5 py-0.5">
            ⌘K
          </kbd>
        </div>

        {openList && (q.trim().length >= 2) && (
          <div
            id="topbar-search-results"
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1 z-[60] bg-steward-base border-2 border-cream max-h-[70vh] overflow-y-auto"
          >
            {hits.length === 0 ? (
              <div className="px-3 py-3 font-body text-[13px] text-cream-subtle">
                {searching ? "Searching…" : `Nothing matches “${q.trim()}”.`}
              </div>
            ) : (
              hits.map((h, i) => (
                <button
                  key={`${h.kind}:${h.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-white/[0.06] last:border-b-0 ${
                    i === active ? "bg-white/[0.06]" : ""
                  }`}
                >
                  <span className="w-16 shrink-0 font-heading text-[9px] font-bold uppercase tracking-eyebrow text-coral-300">
                    {KIND_LABEL[h.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading text-[13px] font-semibold text-cream truncate">{h.title}</span>
                    {h.subtitle && (
                      <span className="block font-body text-[11.5px] text-cream-subtle truncate">{h.subtitle}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2 lg:gap-3">
        {/* Insights drawer trigger — shown below xl since the rail only inlines at xl+. */}
        {onRailClick && (
          <button
            onClick={onRailClick}
            className="xl:hidden p-2 text-cream-dim hover:text-cream transition-colors"
            aria-label="Open insights"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
              <path d="M12 2L9.09 8.26 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21 17 14.14l5-4.87-7.09-1.01L12 2z" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* User */}
        <div className="flex items-center gap-2 px-1 py-1 lg:px-2">
          <div className="w-8 h-8 lg:w-7 lg:h-7 rounded-full bg-copper-600 flex items-center justify-center font-heading text-[12px] lg:text-[11px] font-bold text-white">
            JM
          </div>
          <div className="hidden xl:block">
            <div className="font-heading text-[11px] text-cream font-semibold leading-tight">John Mathewson</div>
            <div className="font-mono text-[9px] text-cream-subtle leading-tight">Stewardship CRE</div>
          </div>
        </div>
      </div>
    </header>
  );
}
