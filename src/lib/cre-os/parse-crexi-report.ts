/**
 * Parser for Crexi's daily Lead Report XLSX.
 *
 * Crexi emails these to listing brokers from emails@notifications.crexi.com
 * each morning. Filename pattern: `Lead Report - {Property Name}.xlsx`.
 *
 * Three sheets:
 *   1. "Lead Report" — activity summary (page views, OMs opened, CAs
 *      executed, info requests). Useful as a daily metric snapshot.
 *   2. "Marketing Campaigns" — email campaign performance.
 *   3. "Detail" — the gold. One row per lead with name, phone, email,
 *      company, role, level of interest, lead score, date, visit count,
 *      buyer profile (AUM, buying power, etc.).
 *
 * This parser extracts:
 *   - The property identity (name + address) from the Detail sheet header
 *   - The activity summary metrics from the Lead Report sheet
 *   - Every lead with their full contact + qualification data from Detail
 *
 * Sheet structure notes (Detail sheet):
 *   row 1: property name (col0 = "Liberty Square Retail Center")
 *   row 2: address ("7880-7896 Broadway, Merrillville, Lake, IN 46410")
 *   row 3: descriptor ("Retail | 8.69% CAP | 48,327 SqFt")
 *   row 4: section labels ("Contact" "Action" "Buyer Profile" "Broker Comments")
 *   row 5: column headers ("First","Last","Phone","Email","Company",...)
 *   row 6+: actual lead data
 */

import * as XLSX from "xlsx";

export interface CrexiLead {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  industryRole: string | null;
  levelOfInterest: string | null;
  crexiLeadScore: number | null;
  /** Date of the activity (when CREXi recorded this lead's interest) */
  activityDate: string | null;
  numberOfVisits: number | null;
  estimatedBuyingPower: string | null;
  aumNumber: string | null;
  aumValue: string | null;
  buyerBackground: string | null;
  proofOfFunds: string | null;
  confidence: string | null;
  notes: string | null;
  /** Raw row map for audit / future fields */
  raw: Record<string, unknown>;
}

export interface CrexiActivitySummary {
  pageViews: number | null;
  visitors: number | null;
  openedOmsFlyers: number | null;
  executedCas: number | null;
  offers: number | null;
  infoRequests: number | null;
}

export interface ParsedCrexiReport {
  /** Property name as Crexi recorded it (from Detail sheet header) */
  propertyName: string | null;
  /** Property address as Crexi recorded it */
  propertyAddress: string | null;
  /** Descriptor (e.g. "Retail | 8.69% CAP | 48,327 SqFt") */
  propertyDescriptor: string | null;
  activity: CrexiActivitySummary;
  leads: CrexiLead[];
  /** Warnings encountered during parse (non-fatal) */
  warnings: string[];
}

export function parseCrexiReport(buffer: Buffer): ParsedCrexiReport {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const warnings: string[] = [];

  const result: ParsedCrexiReport = {
    propertyName: null,
    propertyAddress: null,
    propertyDescriptor: null,
    activity: {
      pageViews: null, visitors: null, openedOmsFlyers: null,
      executedCas: null, offers: null, infoRequests: null,
    },
    leads: [],
    warnings,
  };

  // ── Parse Lead Report sheet (activity summary) ──────────────────────────
  const summarySheetName = wb.SheetNames.find((n) => n.toLowerCase().includes("lead report"));
  if (summarySheetName) {
    const sheet = wb.Sheets[summarySheetName];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

    // First col header = property name; row 1 = address; row 2 = descriptor
    if (matrix.length >= 3) {
      const r0 = matrix[0]?.[0];
      const r1 = matrix[1]?.[0];
      const r2 = matrix[2]?.[0];
      if (typeof r0 === "string") result.propertyName = r0.trim();
      if (typeof r1 === "string") result.propertyAddress = r1.trim();
      if (typeof r2 === "string") result.propertyDescriptor = r2.trim();
    }

    // Find the activity-summary header row ("Page Views", "Visitors", ...)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
      const row = matrix[i] ?? [];
      if (row[0] === "Page Views") { headerIdx = i; break; }
    }
    if (headerIdx >= 0 && matrix[headerIdx + 1]) {
      const dataRow = matrix[headerIdx + 1];
      result.activity = {
        pageViews: asInt(dataRow[0]),
        visitors: asInt(dataRow[1]),
        openedOmsFlyers: asInt(dataRow[2]),
        executedCas: asInt(dataRow[3]),
        offers: asInt(dataRow[4]),
        infoRequests: asInt(dataRow[5]),
      };
    }
  } else {
    warnings.push("No 'Lead Report' sheet found — activity summary will be null");
  }

  // ── Parse Detail sheet (the leads) ──────────────────────────────────────
  const detailSheetName = wb.SheetNames.find((n) => n.toLowerCase() === "detail");
  if (!detailSheetName) {
    warnings.push("No 'Detail' sheet found — no leads will be extracted");
    return result;
  }

  const detail = wb.Sheets[detailSheetName];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detailMatrix: any[][] = XLSX.utils.sheet_to_json(detail, { header: 1, defval: null, blankrows: false });

  // Also fall back to grabbing property name from detail header if Lead
  // Report sheet wasn't found
  if (!result.propertyName && detailMatrix[0]?.[0]) {
    result.propertyName = String(detailMatrix[0][0]).trim();
  }
  if (!result.propertyAddress && detailMatrix[1]?.[0]) {
    result.propertyAddress = String(detailMatrix[1][0]).trim();
  }

  // Find the column-headers row by looking for "First" in column 0
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(detailMatrix.length, 15); i++) {
    const row = detailMatrix[i] ?? [];
    if (row[0] === "First" || (typeof row[0] === "string" && row[0].toLowerCase() === "first")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    warnings.push("Could not locate 'First' header row in Detail sheet");
    return result;
  }

  // Build column map from the discovered header row
  const headers = (detailMatrix[headerRowIdx] ?? []).map((h: unknown) => String(h ?? "").trim());
  const colMap = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]) colMap.set(headers[i].toLowerCase(), i);
  }

  function col(name: string): number {
    return colMap.get(name.toLowerCase()) ?? -1;
  }

  const idxFirst = col("first");
  const idxLast = col("last");
  const idxPhone = col("phone");
  const idxEmail = col("email");
  const idxCompany = col("company");
  const idxRole = col("industry role");
  const idxInterest = col("level of interest");
  const idxScore = col("crexi lead score");
  const idxDate = col("date");
  const idxVisits = col("no. visits");
  const idxBuyingPower = col("estimated buying power");
  const idxAumNum = col("assets under management number");
  const idxAumVal = col("assets under management value");
  const idxBackground = col("buyer background");
  const idxProofFunds = col("proof of funds");
  const idxConfidence = col("confidence");
  const idxNote1 = col("note 1");
  const idxNote2 = col("note 2");
  const idxNote3 = col("note 3");

  // Iterate data rows
  for (let i = headerRowIdx + 1; i < detailMatrix.length; i++) {
    const row = detailMatrix[i] ?? [];
    const firstName = asStr(row[idxFirst]);
    const lastName = asStr(row[idxLast]);
    if (!firstName && !lastName) continue; // skip blank rows

    const noteParts = [
      asStr(row[idxNote1]),
      asStr(row[idxNote2]),
      asStr(row[idxNote3]),
    ].filter(Boolean) as string[];

    const lead: CrexiLead = {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" ").trim() || "(unknown)",
      phone: normalizePhone(row[idxPhone]),
      email: asStr(row[idxEmail])?.toLowerCase() ?? null,
      company: asStr(row[idxCompany]),
      industryRole: asStr(row[idxRole]),
      levelOfInterest: asStr(row[idxInterest]),
      crexiLeadScore: asNum(row[idxScore]),
      activityDate: asDateString(row[idxDate]),
      numberOfVisits: asInt(row[idxVisits]),
      estimatedBuyingPower: asStr(row[idxBuyingPower]),
      aumNumber: asStr(row[idxAumNum]),
      aumValue: asStr(row[idxAumVal]),
      buyerBackground: asStr(row[idxBackground]),
      proofOfFunds: asStr(row[idxProofFunds]),
      confidence: asStr(row[idxConfidence]),
      notes: noteParts.length > 0 ? noteParts.join("\n\n") : null,
      raw: rowToObject(row, headers),
    };
    result.leads.push(lead);
  }

  return result;
}

// ── helpers ──────────────────────────────────────────────────────────────

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function asInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[, ]/g, ""), 10);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function asDateString(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  // Excel serial date (cellDates wasn't applied for this cell)
  if (typeof v === "number" && v > 25569 && v < 80000) {
    // Excel 1900 serial → JS Date (with the 1900 leap-year bug accounted for via 25569 epoch)
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(String(v));
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
function normalizePhone(v: unknown): string | null {
  if (v == null || v === "") return null;
  // Could be number (e.g. 6179668666) or string with formatting
  const digits = String(v).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}
function rowToObject(row: unknown[], headers: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]) obj[headers[i]] = row[i] ?? null;
  }
  return obj;
}
