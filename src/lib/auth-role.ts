/**
 * Who a signed-in Supabase user is to this app.
 *
 * The CRM is single-operator (John). Everyone else who gets a login is a
 * "map viewer": a partner (City of Hobart staff, for instance) who should see
 * the public parcel map with every data tier unlocked and nothing else. The
 * role lives in auth.users.app_metadata (set server-side only; users cannot
 * edit app_metadata), so middleware can read it from the session without a
 * database round-trip.
 */

import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "map_viewer";

export function roleOf(user: User | null | undefined): AppRole | null {
  if (!user) return null;
  const r = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  return r === "map_viewer" ? "map_viewer" : "admin";
}

export const isMapViewer = (user: User | null | undefined) => roleOf(user) === "map_viewer";

/** Paths a map viewer may reach. Everything else bounces to the map. */
export function mapViewerAllowed(pathname: string): boolean {
  return (
    pathname.startsWith("/map/") || pathname.startsWith("/data/") || pathname.startsWith("/auth/") ||
    pathname.startsWith("/login") || pathname.startsWith("/api/map/") || pathname.startsWith("/api/auth/") ||
    pathname === "/" || pathname === "/hobart"
  );
}
