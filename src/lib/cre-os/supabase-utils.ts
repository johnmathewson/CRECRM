/**
 * CRE OS — Supabase typing helpers.
 *
 * Supabase's PostgREST returns FK joins as arrays even when the relation is
 * 1:1 by FK constraint. This means `select("property:properties(...)")`
 * gives us `property: PropertyRow[] | null`, but at runtime when the FK is
 * scalar there's at most one row.
 *
 * `castOne()` and `castMany()` resolve the type→runtime mismatch in one
 * place, so we can stop scattering `any` casts at every join boundary.
 *
 * Usage:
 *   const property = castOne<{ id: string; name: string }>(row.property);
 *   const stages   = castMany<{ stage: string }>(row.deal_stages);
 */

export function castOne<T>(rel: unknown): T | null {
  if (rel === null || rel === undefined) return null;
  if (Array.isArray(rel)) return ((rel[0] as T | undefined) ?? null);
  return rel as T;
}

export function castMany<T>(rel: unknown): T[] {
  if (rel === null || rel === undefined) return [];
  if (Array.isArray(rel)) return rel as T[];
  return [rel as T];
}
