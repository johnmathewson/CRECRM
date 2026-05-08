/**
 * CRE OS — Documents data layer.
 *
 *   loadDocumentsSnapshot() → all property-attached documents across the
 *                             portfolio, with property context.
 *
 * Lightweight wrapper. The real CRUD is on /api/properties/[id]/documents
 * — the broker uploads from the property workspace and this page is just a
 * portfolio-wide list/search.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface PortfolioDocument {
  id: string;
  name: string;
  description: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  filePath: string;
  createdAt: string;
  property: {
    id: string;
    name: string;
    headline: string | null;
    slug: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

export interface DocumentsSnapshot {
  documents: PortfolioDocument[];
  totals: {
    count: number;
    totalSize: number;
    propertyCount: number;
  };
}

export async function loadDocumentsSnapshot(): Promise<DocumentsSnapshot> {
  const sb = createServerSupabase();

  const { data: rows } = await sb
    .from("documents")
    .select(`
      id, name, description, file_type, file_size_bytes, file_path,
      created_at, property_id,
      property:properties(id, name, headline, slug, city, state)
    `)
    .eq("organization_id", ORG_ID)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const documents: PortfolioDocument[] = ((rows ?? []) as any[]).map((d) => {
    const property = Array.isArray(d.property) ? d.property[0] : d.property;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      fileType: d.file_type,
      fileSizeBytes: d.file_size_bytes ?? null,
      filePath: d.file_path,
      createdAt: d.created_at,
      property: property ? {
        id: property.id,
        name: property.name,
        headline: property.headline ?? null,
        slug: property.slug ?? null,
        city: property.city ?? null,
        state: property.state ?? null,
      } : null,
    };
  });

  const propertyIds = new Set(documents.map((d) => d.property?.id).filter(Boolean));
  const totalSize = documents.reduce((s, d) => s + (d.fileSizeBytes ?? 0), 0);

  return {
    documents,
    totals: {
      count: documents.length,
      totalSize,
      propertyCount: propertyIds.size,
    },
  };
}
