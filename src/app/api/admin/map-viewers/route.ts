/**
 * POST /api/admin/map-viewers  { email, full_name }
 *
 * John-only. Creates (or updates) a Supabase login with the map_viewer role
 * and returns a 14-day invite link for map.stewardshipcre.com. The viewer
 * opens the link, lands signed in, sets a password, and from then on signs
 * in at map.stewardshipcre.com/login. They never see the CRM (middleware).
 *
 * GET lists current map viewers.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMapViewer } from "@/lib/auth-role";
import { signInvite, MAP_PUBLIC_ORIGIN } from "@/lib/auth-invite";

export const dynamic = "force-dynamic";

async function requireJohn() {
  const { data: { user } } = await createServerSupabase().auth.getUser();
  if (!user || isMapViewer(user)) return null;
  return user;
}

export async function GET() {
  if (!(await requireJohn())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 500 });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const viewers = data.users.filter((u) => u.app_metadata?.role === "map_viewer").map((u) => ({
    id: u.id, email: u.email, name: u.user_metadata?.full_name ?? null, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
  }));
  return NextResponse.json({ viewers });
}

export async function POST(req: NextRequest) {
  if (!(await requireJohn())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const full_name = String(body.full_name ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "valid email required" }, { status: 400 });

  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: full_name ? { full_name } : undefined,
    app_metadata: { role: "map_viewer" },
  });
  if (created.data.user) userId = created.data.user.id;
  else {
    // Already exists: make sure the role is set, keep everything else.
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const existing = data?.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) return NextResponse.json({ error: created.error?.message ?? "could not create user" }, { status: 500 });
    if (existing.email === "john@johnmathewson.co") return NextResponse.json({ error: "that is the admin account" }, { status: 400 });
    await admin.auth.admin.updateUserById(existing.id, {
      app_metadata: { ...(existing.app_metadata ?? {}), role: "map_viewer" },
      user_metadata: full_name ? { ...(existing.user_metadata ?? {}), full_name } : existing.user_metadata,
    });
    userId = existing.id;
  }

  const token = signInvite(email, 14);
  return NextResponse.json({
    ok: true, user_id: userId, email, full_name: full_name || null,
    invite_url: `${MAP_PUBLIC_ORIGIN}/auth/invite?t=${token}`,
    expires_in_days: 14,
    sign_in_url: `${MAP_PUBLIC_ORIGIN}/login`,
  });
}
