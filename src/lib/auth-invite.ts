/**
 * Signed, long-lived invite links for map viewers.
 *
 * Supabase's own invite emails carry a one-hour token and land on the Site
 * URL, which is the wrong host for a partner who should only ever see
 * map.stewardshipcre.com. So the invite John sends is OUR link: an HMAC over
 * (email, expiry) with the map-session secret, good for 14 days. When it is
 * opened, /auth/invite mints a Supabase magic-link token server-side for that
 * email, verifies it immediately (which sets the session cookies on the map
 * host) and sends the viewer to set a password.
 */

import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.MAP_SESSION_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("MAP_SESSION_SECRET (or CRON_SECRET) is required to sign invites");
  return s;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(`invite:${payload}`).digest("base64url");

export function signInvite(email: string, days = 14): string {
  const payload = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), x: Date.now() + days * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyInvite(token: string | null | undefined): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e: string; x: number };
    if (!e || typeof x !== "number" || Date.now() > x) return null;
    return { email: e };
  } catch {
    return null;
  }
}

export const MAP_PUBLIC_ORIGIN = process.env.MAP_PUBLIC_ORIGIN ?? "https://map.stewardshipcre.com";
