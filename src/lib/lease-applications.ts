/**
 * Commercial lease applications — shared constants + input sanitizing for
 * the public endpoints (/api/public/lease-applications/*) and the CRM views.
 *
 * The public site never sees a storage policy: the create endpoint hands the
 * browser one signed upload URL per file (service role), the browser uploads
 * straight to Storage, and finalize records whatever actually landed.
 */

import { createHash, randomBytes } from "crypto";

export const LEASE_APP_BUCKET = "lease-applications";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 20;

export const DOC_TYPES = [
  "photo_id",
  "business_tax_return",
  "personal_tax_return",
  "bank_statement",
  "profit_loss",
  "balance_sheet",
  "personal_financial_statement",
  "business_plan",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  photo_id: "Photo ID",
  business_tax_return: "Business tax return",
  personal_tax_return: "Personal tax return",
  bank_statement: "Bank statement",
  profit_loss: "Profit & loss",
  balance_sheet: "Balance sheet",
  personal_financial_statement: "Personal financial statement",
  business_plan: "Business plan / pro forma",
  other: "Other",
};

export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export const ENTITY_TYPES = ["llc", "corporation", "partnership", "sole_proprietor", "other"] as const;

export function newFinalizeToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── Sanitizers — every value from the public form passes through one ─────

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

export function longStr(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function money(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(v, 1e12));
  if (typeof v !== "string") return null;
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 1e12)) : null;
}

export function pct(v: unknown): number | null {
  const n = money(v);
  return n === null ? null : Math.min(n, 100);
}

export function email(v: unknown): string | null {
  const s = str(v, 320);
  if (!s) return null;
  const lower = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower) ? lower : null;
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

export interface OwnerInput {
  name: string;
  title: string | null;
  ownership_pct: number | null;
  guarantor: boolean;
  phone: string | null;
  email: string | null;
  home_address: string | null;
}

export interface ReferenceInput {
  name: string;
  phone: string | null;
  email: string | null;
}

export interface FileManifestEntry {
  doc_type: DocType;
  file_name: string;
  size: number;
  mime_type: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOwners(v: unknown): OwnerInput[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).flatMap((o): OwnerInput[] => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    const name = str(r.name, 120);
    if (!name) return [];
    return [{
      name,
      title: str(r.title, 80),
      ownership_pct: pct(r.ownership_pct),
      guarantor: r.guarantor === true,
      phone: str(r.phone, 40),
      email: email(r.email),
      home_address: str(r.home_address, 240),
    }];
  });
}

export function parseReferences(v: unknown): ReferenceInput[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 4).flatMap((o): ReferenceInput[] => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    const name = str(r.name, 160);
    if (!name) return [];
    return [{ name, phone: str(r.phone, 40), email: email(r.email) }];
  });
}

export function parseFiles(v: unknown): { files: FileManifestEntry[]; error: string | null } {
  if (!Array.isArray(v)) return { files: [], error: null };
  if (v.length > MAX_FILES) return { files: [], error: `Attach at most ${MAX_FILES} files.` };
  const files: FileManifestEntry[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") return { files: [], error: "Invalid file entry." };
    const r = o as Record<string, unknown>;
    const docType = typeof r.doc_type === "string" && (DOC_TYPES as readonly string[]).includes(r.doc_type)
      ? (r.doc_type as DocType)
      : null;
    const fileName = str(r.file_name, 200);
    const size = typeof r.size === "number" ? r.size : NaN;
    const mime = typeof r.mime_type === "string" ? r.mime_type.toLowerCase() : "";
    if (!docType || !fileName) return { files: [], error: "Each file needs a document type and name." };
    if (!Number.isFinite(size) || size <= 0) return { files: [], error: `"${fileName}" is empty.` };
    if (size > MAX_FILE_BYTES) return { files: [], error: `"${fileName}" is over the 25 MB limit.` };
    if (!ALLOWED_MIME.includes(mime)) return { files: [], error: `"${fileName}" is not a supported file type (PDF, image, Excel, Word or CSV).` };
    files.push({ doc_type: docType, file_name: fileName, size, mime_type: mime });
  }
  return { files, error: null };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
