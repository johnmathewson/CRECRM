/**
 * Parcel-map registration session.
 *
 * A registered visitor (developer / contractor / investor who gave name,
 * email, phone) gets an HttpOnly cookie carrying their CRM contact id,
 * signed with HMAC so it can't be forged. No DB lookup per request: the
 * cookie IS the session. Lives beside the map (/map, /api/map) only.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

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
