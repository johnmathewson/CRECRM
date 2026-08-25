/**
 * Staff-session gate for API route handlers.
 *
 * WHY THIS EXISTS: `src/middleware.ts` deliberately excludes `/api` from its
 * matcher ("let them handle their own auth"). Several admin routes were written
 * assuming middleware covered them — it never did, leaving them reachable
 * unauthenticated from the public internet. Any in-app admin route must call
 * this itself.
 *
 * Usage:
 *
 *   const denied = await requireStaff();
 *   if (denied) return denied;
 *
 * Returns a 401 NextResponse when there is no signed-in user, or null when the
 * caller is authenticated and the handler should proceed.
 *
 * This validates the Supabase session cookie via `getUser()`, which verifies
 * the JWT against the auth server rather than trusting the cookie's contents.
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function requireStaff(): Promise<NextResponse | null> {
  try {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  } catch {
    // No cookie store (called outside a request scope) or auth server
    // unreachable — fail closed.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
