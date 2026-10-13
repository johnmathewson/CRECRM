"use client";

import { useEffect, useState } from "react";

/**
 * lg breakpoint (1024px) — the same line the nav flips on. SSR renders
 * the phone layout, then the client upgrades. Pages use it to decide the
 * MOUNT mode of a thread (inline column vs. overlay sheet); the grid
 * itself is CSS, so there's no layout thrash on desktop.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/** True when the keystroke happened inside something that takes typing. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
