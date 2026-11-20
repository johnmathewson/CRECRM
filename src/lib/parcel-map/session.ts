/**
 * Parcel-map registration session.
 *
 * A registered visitor (developer / contractor / investor who gave name,
 * email, phone) gets an HttpOnly cookie carrying their CRM contact id,
 * signed with HMAC so it can't be forged. No DB lookup per request: the
 * cookie IS the session. Lives beside the map (/map, /api/map) only.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { isMapViewer } from "@/lib/auth-role";
import type { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const MAP_SESSION_COOKIE = "pm_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.MAP_SESSION_SECRET || process.env.CRON_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("MAP_SESSION_SECRET (or CRON_SECRET) is required to sign map sessions");
  return "dev-only-parcel-map-secret";
}

export interface MapSession {
  contactId: string;
  name: string | null;
  exp: number; // unix seconds
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(s: MapSession): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined | null): MapSession | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expect = sign(payload);
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as MapSession;
    if (!s.contactId || !s.exp || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export function readSession(req: NextRequest): MapSession | null {
  return decodeSession(req.cookies.get(MAP_SESSION_COOKIE)?.value);
}

export function setSessionCookie(res: NextResponse, s: Omit<MapSession, "exp">): void {
  const session: MapSession = { ...s, exp: Math.floor(Date.now() / 1000) + ONE_YEAR };
  res.cookies.set({
    name: MAP_SESSION_COOKIE,
    value: encodeSession(session),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}


/** Who is looking at the map. A signed-in CRM user (John) is the admin and
 *  sees every tier without registering; otherwise the registration cookie
 *  decides. The CRM is single-user, so "any CRM session" == admin. */
export interface Viewer {
  admin: boolean;
  /** Signed in with a Supabase login (John, or a partner with the map_viewer role). */
  login: boolean;
  registered: boolean;
  name: string | null;
  email: string | null;
  contactId: string | null;
}

export async function resolveViewer(req: NextRequest): Promise<Viewer> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
    });
    const { data } = await sb.auth.getUser();
    if (data.user) {
      const email = data.user.email ?? null;
      const name = (data.user.user_metadata?.full_name as string | undefined) ?? (email === "john@johnmathewson.co" ? "John Mathewson" : email);
      return { admin: !isMapViewer(data.user), login: true, registered: true, name, email, contactId: null };
    }
  } catch {
    /* no CRM session */
  }
  const s = readSession(req);
  return s ? { admin: false, login: false, registered: true, name: s.name, email: null, contactId: s.contactId } : { admin: false, login: false, registered: false, name: null, email: null, contactId: null };
}
