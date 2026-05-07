/**
 * CRE OS — Portals admin data layer.
 *
 *   loadPortalSnapshot() → list of magic-link tokens (owner + investor)
 *                          with property/deal context, status, and stats
 *   loadPortalCandidates() → properties + contacts the create dialog needs
 *
 * The marketing-site dashboard at stewardshipcre.com/owner/[token] is what
 * the link recipient actually opens. This module is the *admin* side: John's
 * view of who can see what.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export type PortalAudience = "owner" | "investor";
export type PortalStatus = "active" | "expired" | "revoked";

export interface PortalPropertyRef {
  id: string;
  name: string;
  headline: string | null;
  city: string | null;
  state: string | null;
}

export interface PortalToken {
  id: string;
  token: string;
  label: string;
  audience: PortalAudience;
  status: PortalStatus;
  expiresAt: string;
  createdAt: string;
  lastViewedAt: string | null;
  daysUntilExpiry: number | null;
  daysSinceLastView: number | null;
  ownerContact: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  properties: PortalPropertyRef[];
  /** Public dashboard URL the recipient opens. */
  shareUrl: string;
}

export interface PortalSnapshot {
  tokens: PortalToken[];
  totals: {
    active: number;
    expired: number;
    revoked: number;
    ownerActive: number;
    investorActive: number;
    /** Tokens that have been viewed at least once. */
    everViewed: number;
    /** Tokens active and viewed in the last 7 days. */
    viewedThisWeek: number;
  };
  synthesis: string;
}

export interface PortalCandidate {
  id: string;
  name: string;
  headline: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  transactionType: string | null;
}

export interface PortalContactCandidate {
  id: string;
  name: string;
  email: string | null;
  type: string | null;
}

// ── Loader ────────────────────────────────────────────────────────────────
export async function loadPortalSnapshot(): Promise<PortalSnapshot> {
  const sb = createServerSupabase();

  const { data: tokenRows } = await sb
    .from("owner_access_tokens")
    .select(`
      id, token, label, audience, property_ids, expires_at, last_viewed_at,
      created_at, revoked_at,
      owner:contacts(id, full_name, email)
    `)
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false });

  const tokens = (tokenRows ?? []) as any[];

  // Hydrate property summaries in one round-trip.
  const allPropertyIds = Array.from(new Set(tokens.flatMap((t) => t.property_ids ?? [])));
  let propsById = new Map<string, PortalPropertyRef>();
  if (allPropertyIds.length > 0) {
    const { data: propsData } = await sb
      .from("properties")
      .select("id, name, headline, city, state")
      .eq("organization_id", ORG_ID)
      .in("id", allPropertyIds);
    for (const p of (propsData ?? []) as any[]) {
      propsById.set(p.id, {
        id: p.id,
        name: p.name,
        headline: p.headline ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
      });
    }
  }

  const marketingBase =
    process.env.NEXT_PUBLIC_MARKETING_URL || "https://stewardshipcre.com";

  const now = Date.now();
  const portals: PortalToken[] = tokens.map((t) => {
    const expires = new Date(t.expires_at).getTime();
    const status: PortalStatus = t.revoked_at
      ? "revoked"
      : expires < now
        ? "expired"
        : "active";

    const ownerJoin = Array.isArray(t.owner) ? t.owner[0] : t.owner;
    const audience: PortalAudience = t.audience === "investor" ? "investor" : "owner";
    const audienceSlug = audience === "investor" ? "investor" : "owner";

    return {
      id: t.id,
      token: t.token,
      label: t.label || `${audience === "investor" ? "Investor" : "Owner"} link`,
      audience,
      status,
      expiresAt: t.expires_at,
      createdAt: t.created_at,
      lastViewedAt: t.last_viewed_at ?? null,
      daysUntilExpiry: status === "active"
        ? Math.max(0, Math.ceil((expires - now) / 86400000))
        : null,
      daysSinceLastView: t.last_viewed_at
        ? Math.floor((now - new Date(t.last_viewed_at).getTime()) / 86400000)
        : null,
      ownerContact: ownerJoin
        ? { id: ownerJoin.id, name: ownerJoin.full_name ?? null, email: ownerJoin.email ?? null }
        : null,
      properties: (t.property_ids ?? [])
        .map((pid: string) => propsById.get(pid))
        .filter(Boolean) as PortalPropertyRef[],
      shareUrl: `${marketingBase}/${audienceSlug}/${t.token}`,
    };
  });

  const active = portals.filter((p) => p.status === "active");
  const expired = portals.filter((p) => p.status === "expired");
  const revoked = portals.filter((p) => p.status === "revoked");
  const ownerActive = active.filter((p) => p.audience === "owner").length;
  const investorActive = active.filter((p) => p.audience === "investor").length;
  const everViewed = portals.filter((p) => p.lastViewedAt !== null).length;
  const viewedThisWeek = active.filter(
    (p) => p.daysSinceLastView !== null && p.daysSinceLastView <= 7
  ).length;

  return {
    tokens: portals,
    totals: {
      active: active.length,
      expired: expired.length,
      revoked: revoked.length,
      ownerActive,
      investorActive,
      everViewed,
      viewedThisWeek,
    },
    synthesis: buildSynthesis(active.length, ownerActive, investorActive, viewedThisWeek, expired.length),
  };
}

export async function loadPortalCandidates(): Promise<{
  properties: PortalCandidate[];
  contacts: PortalContactCandidate[];
}> {
  const sb = createServerSupabase();
  const [{ data: propRows }, { data: contactRows }] = await Promise.all([
    sb
      .from("properties")
      .select("id, name, headline, city, state, status, transaction_type")
      .eq("organization_id", ORG_ID)
      .order("name", { ascending: true }),
    sb
      .from("contacts")
      .select("id, full_name, email, contact_type")
      .eq("organization_id", ORG_ID)
      .order("full_name", { ascending: true })
      .limit(500),
  ]);

  const properties: PortalCandidate[] = ((propRows ?? []) as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    headline: p.headline ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    status: p.status ?? null,
    transactionType: p.transaction_type ?? null,
  }));

  const contacts: PortalContactCandidate[] = ((contactRows ?? []) as any[])
    .filter((c) => c.full_name && c.full_name.trim().length > 0)
    .map((c) => ({
      id: c.id,
      name: c.full_name,
      email: c.email ?? null,
      type: c.contact_type ?? null,
    }));

  return { properties, contacts };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function buildSynthesis(
  active: number,
  ownerActive: number,
  investorActive: number,
  viewedThisWeek: number,
  expired: number,
): string {
  if (active === 0 && expired === 0) {
    return "No magic links yet. Create one to share listing performance with an owner or pursuit progress with an investor.";
  }
  const parts: string[] = [];
  parts.push(`${active} active link${active === 1 ? "" : "s"} (${ownerActive} owner · ${investorActive} investor).`);
  if (viewedThisWeek > 0) {
    parts.push(`${viewedThisWeek} viewed in the last 7 days.`);
  } else if (active > 0) {
    parts.push("None viewed in the last 7 days.");
  }
  if (expired > 0) {
    parts.push(`${expired} expired.`);
  }
  return parts.join(" ");
}
