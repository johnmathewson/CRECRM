/**
 * On-market listings for the parcel map — server-side helpers over the
 * map_listings RPCs (migration 0039). Same key model as data.ts.
 */

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress } from "@/lib/geocoder";

function sb() {
  // Next's data cache memoizes fetch() inside route handlers; force every
  // RPC to hit the network so overlays never serve a stale snapshot.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}
function key(): string {
  const k = process.env.MAP_DATA_KEY;
  if (!k) throw new Error("MAP_DATA_KEY is not configured");
  return k;
}

export type ListingSource = "crm" | "crexi" | "loopnet" | "manual" | "costar_bulk";
export type ListingKind = "sale" | "lease" | "both";

export interface ListingIn {
  source: ListingSource;
  external_id?: string | null;
  url?: string | null;
  kind: ListingKind;
  status?: "active" | "under_contract" | "off_market" | "unverified";
  title?: string | null;
  address?: string | null;
  city?: string;
  price?: number | null;
  price_text?: string | null;
  lease_rate_text?: string | null;
  sqft?: number | null;
  acres?: number | null;
  asset_type?: string | null;
  broker_name?: string | null;
  broker_company?: string | null;
  photo_url?: string | null;
  property_id?: string | null;
  apn?: string | null;
  lon?: number | null;
  lat?: number | null;
  seen_at?: string | null;
  raw?: unknown;
}

export interface ListingOut {
  id: string; pid: string | null; source: ListingSource; external_id: string | null; url: string | null; kind: ListingKind;
  status: string; title: string | null; address: string | null; price: number | null; price_text: string | null;
  lease_rate_text: string | null; sqft: number | null; acres: number | null; asset_type: string | null; broker_company: string | null;
  photo_url: string | null; first_seen_at: string; last_seen_at: string;
}

/** Match a listing to a parcel by APN, then address (normalized), then point;
 *  as a last resort geocode the address (US Census, free) and match the point. */
export async function matchParcel(l: { apn?: string | null; address?: string | null; lon?: number | null; lat?: number | null; city?: string }): Promise<string | null> {
  const { data, error } = await sb().rpc("map_parcel_match", {
    p_key: key(), p_apn: l.apn ?? null, p_address: l.address ?? null, p_lon: l.lon ?? null, p_lat: l.lat ?? null,
  });
  if (error) throw new Error(error.message);
  if (data) return data as string;
  if (l.address && /^\d/.test(l.address.trim()) && l.lon == null) {
    const q = /,\s*[A-Z]{2}\b/i.test(l.address) ? l.address : `${l.address}, ${l.city ?? "Hobart"}, IN`;
    const g = await geocodeAddress(q).catch(() => null);
    if (g) {
      const { data: byPoint } = await sb().rpc("map_parcel_match", { p_key: key(), p_apn: null, p_address: null, p_lon: g.lng, p_lat: g.lat });
      if (byPoint) return byPoint as string;
    }
  }
  return null;
}

/** Re-try matching for listings that have no parcel yet. Returns how many got one. */
export async function rematchUnmatched(city = "Hobart"): Promise<number> {
  const all = await activeListings(city);
  let n = 0;
  for (const l of all) {
    if (l.pid || !l.address) continue;
    const pid = await matchParcel({ address: l.address, city }).catch(() => null);
    if (!pid) continue;
    await sb().rpc("map_listings_upsert", { p_key: key(), p_rows: [{ source: l.source, external_id: l.external_id, url: l.url, pid, city }] });
    n++;
  }
  return n;
}

/** Upsert listings; resolves parcels first. Returns rows written + match count. */
export async function upsertListings(rows: ListingIn[]): Promise<{ written: number; matched: number }> {
  let matched = 0;
  const prepared = [];
  for (const r of rows) {
    const pid = await matchParcel(r).catch(() => null);
    if (pid) matched++;
    prepared.push({ ...r, pid, city: r.city ?? "Hobart" });
  }
  if (!prepared.length) return { written: 0, matched: 0 };
  const { data, error } = await sb().rpc("map_listings_upsert", { p_key: key(), p_rows: prepared });
  if (error) throw new Error(error.message);
  return { written: Number(data ?? 0), matched };
}

export async function activeListings(city = "Hobart"): Promise<ListingOut[]> {
  const { data, error } = await sb().rpc("map_listings_active", { p_key: key(), p_city: city });
  if (error) throw new Error(error.message);
  return (data ?? []) as ListingOut[];
}

/** Expire captured listings not seen for N days (search pages re-list everything active). */
export async function expireUnseen(source: ListingSource, city = "Hobart", days = 3): Promise<number> {
  const { data, error } = await sb().rpc("map_listings_expire", { p_key: key(), p_source: source, p_city: city, p_days: days });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Parse "$1,250,000", "$12.50/SF/YR", "Unpriced" → number | null. */
export function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)\s*(k|m|mm)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suf = (m[2] ?? "").toLowerCase();
  if (suf === "k") n *= 1_000; else if (suf === "m" || suf === "mm") n *= 1_000_000;
  return Number.isFinite(n) ? n : null;
}

/** Normalize a CRM property into a listing row. */
export function listingFromProperty(p: {
  id: string; name: string | null; address: string | null; city: string | null; status: string | null; transaction_type: string | null;
  asking_price: number | null; lease_rate: number | null; sqft: number | null; acreage: number | null; asset_type: string | null;
  apn: string | null; latitude: number | null; longitude: number | null; crexi_url: string | null; loopnet_url: string | null; slug: string | null;
  images?: unknown;
}): ListingIn {
  const imgs = Array.isArray(p.images) ? p.images : [];
  const first = imgs.find((i: any) => typeof i === "string" || (i && typeof i.url === "string"));
  const photo = typeof first === "string" ? first : first ? (first as any).url : null;
  const kind: ListingKind = p.status === "for_lease" || p.transaction_type === "lease" ? "lease" : "sale";
  return {
    source: "crm", external_id: p.id, url: p.crexi_url ?? p.loopnet_url ?? (p.slug ? `https://stewardshipcre.com/listings/${p.slug}` : null),
    kind, status: p.status === "under_contract" ? "under_contract" : "active",
    title: p.name, address: p.address, city: "Hobart",
    price: p.asking_price, price_text: p.asking_price ? `$${Number(p.asking_price).toLocaleString()}` : null,
    lease_rate_text: p.lease_rate ? `$${p.lease_rate}/SF/YR` : null,
    sqft: p.sqft, acres: p.acreage, asset_type: p.asset_type, broker_company: "Stewardship CRE", photo_url: photo,
    property_id: p.id, apn: p.apn, lon: p.longitude, lat: p.latitude,
  };
}
