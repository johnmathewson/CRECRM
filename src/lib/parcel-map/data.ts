/**
 * Server-side access to the parcel map data store (map_parcels) through the
 * SECURITY DEFINER RPCs from migration 0038. The anon key alone cannot read
 * the table; every call carries MAP_DATA_KEY.
 */

import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
function key(): string {
  const k = process.env.MAP_DATA_KEY;
  if (!k) throw new Error("MAP_DATA_KEY is not configured");
  return k;
}

/** Fields anyone may see. */
export const PUBLIC_FIELDS = [
  "pid", "city", "address", "zoning", "flu", "acres", "class_code", "class", "tif", "flood", "historic", "legal", "transfer_date", "lon", "lat", "bbox", "updated_at",
] as const;
/** Fields only a registered visitor may see. */
export const GATED_FIELDS = [
  "owner", "mail", "mail_city", "mail_state", "mail_zip", "deduction", "av_total", "av_land", "av_impr", "conveyance", "sales", "permits",
] as const;

export async function getParcel(pid: string, gated: boolean): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb().rpc("map_parcel_get", { p_key: key(), p_pid: pid });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f] ?? null;
  if (gated) for (const f of GATED_FIELDS) out[f] = row[f] ?? null;
  return out;
}

export async function searchParcels(q: string, includeOwner: boolean, limit = 8) {
  const { data, error } = await sb().rpc("map_parcel_search", { p_key: key(), p_q: q, p_owner: includeOwner, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ pid: string; address: string | null; zoning: string | null; owner: string | null; lon: number; lat: number }>;
}

export async function parcelsByOwner(owner: string) {
  const { data, error } = await sb().rpc("map_parcels_by_owner", { p_key: key(), p_owner: owner });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ pid: string; address: string | null; acres: number | null; av_total: number | null; lon: number; lat: number }>;
}
