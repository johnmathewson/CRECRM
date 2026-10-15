/**
 * CRE OS — lease applications data layer (/cre-os/applications).
 * Reads as the logged-in session: these tables have no anon policy.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { createStorageClient } from "@/lib/supabase/admin";
import { LEASE_APP_BUCKET, DOC_TYPE_LABELS, type DocType } from "@/lib/lease-applications";
import { relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type ApplicationStatus = "pending_upload" | "submitted" | "reviewing" | "approved" | "declined" | "withdrawn";

export interface ApplicationOwner {
  name: string;
  title: string | null;
  ownership_pct: number | null;
  guarantor: boolean;
  phone: string | null;
  email: string | null;
  home_address: string | null;
}

export interface ApplicationListRow {
  id: string;
  status: ApplicationStatus;
  businessLegalName: string;
  intendedUse: string | null;
  propertyLabel: string | null;
  suite: string | null;
  primaryName: string | null;
  primaryEmail: string | null;
  monthlyRevenue: number | null;
  documentCount: number;
  leadId: string | null;
  createdAt: string;
  createdRelative: string;
}

export interface ApplicationDocument {
  id: string;
  docType: DocType;
  docLabel: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  signedUrl: string | null;
}

export interface ApplicationDetail {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Record<string, any>;
  owners: ApplicationOwner[];
  references: Array<{ name: string; phone: string | null; email: string | null }>;
  signatures: Array<{ name: string; signed_at: string }>;
  documents: ApplicationDocument[];
  missingFiles: string[];
  property: { id: string; name: string; slug: string | null } | null;
  createdRelative: string;
}

export async function loadApplications(): Promise<ApplicationListRow[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("lease_applications")
    .select("id, status, business_legal_name, intended_use, property_label, suite, owners, business_email, monthly_revenue, lead_id, created_at, lease_application_documents(count)")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const owners = (Array.isArray(r.owners) ? r.owners : []) as ApplicationOwner[];
    const countRow = Array.isArray(r.lease_application_documents) ? r.lease_application_documents[0] : null;
    return {
      id: r.id,
      status: r.status,
      businessLegalName: r.business_legal_name,
      intendedUse: r.intended_use ?? null,
      propertyLabel: r.property_label ?? null,
      suite: r.suite ?? null,
      primaryName: owners[0]?.name ?? null,
      primaryEmail: owners[0]?.email ?? r.business_email ?? null,
      monthlyRevenue: r.monthly_revenue === null ? null : Number(r.monthly_revenue),
      documentCount: Number(countRow?.count ?? 0),
      leadId: r.lead_id ?? null,
      createdAt: r.created_at,
      createdRelative: relativeTime(r.created_at),
    };
  });
}

export async function loadApplication(id: string): Promise<ApplicationDetail | null> {
  const sb = createServerSupabase();
  const { data: app } = await sb
    .from("lease_applications")
    .select("*, property:properties(id, name, slug)")
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  if (!app) return null;

  const { data: docs } = await sb
    .from("lease_application_documents")
    .select("id, doc_type, file_name, storage_path, file_size, mime_type")
    .eq("application_id", id)
    .order("uploaded_at", { ascending: true });

  const { client: storage } = await createStorageClient();
  const documents: ApplicationDocument[] = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((docs ?? []) as any[]).map(async (d) => {
      const { data: signed } = await storage.storage.from(LEASE_APP_BUCKET).createSignedUrl(d.storage_path, 60 * 10);
      return {
        id: d.id,
        docType: d.doc_type,
        docLabel: DOC_TYPE_LABELS[d.doc_type as DocType] ?? d.doc_type,
        fileName: d.file_name,
        fileSize: d.file_size === null ? null : Number(d.file_size),
        mimeType: d.mime_type ?? null,
        signedUrl: signed?.signedUrl ?? null,
      };
    }),
  );

  const recorded = new Set(((docs ?? []) as Array<{ storage_path: string }>).map((d) => d.storage_path));
  const pending = (Array.isArray(app.pending_files) ? app.pending_files : []) as Array<{ path: string; file_name: string }>;
  const missingFiles = app.status === "pending_upload" ? [] : pending.filter((f) => !recorded.has(f.path)).map((f) => f.file_name);

  const prop = Array.isArray(app.property) ? app.property[0] : app.property;
  return {
    raw: app,
    owners: (Array.isArray(app.owners) ? app.owners : []) as ApplicationOwner[],
    references: Array.isArray(app.trade_references) ? app.trade_references : [],
    signatures: Array.isArray(app.signatures) ? app.signatures : [],
    documents,
    missingFiles,
    property: prop ? { id: prop.id, name: prop.name, slug: prop.slug ?? null } : null,
    createdRelative: relativeTime(app.created_at),
  };
}
