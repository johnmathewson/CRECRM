/**
 * Shared utilities for CoStar / PropStream CSV-XLSX imports.
 *
 * Both vendors export with column names that vary slightly (CoStar varies
 * across customer license tiers; PropStream varies based on what the user
 * selected). The helpers in this module normalize header strings, match
 * them to canonical fields with fuzzy aliasing, and parse cells defensively.
 */

import * as XLSX from "xlsx";

// ── File parsing ───────────────────────────────────────────────────────────

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** Parse an uploaded XLSX/XLS/CSV file into a header-keyed row array. */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (matrix.length < 2) return { headers: [], rows: [], rowCount: 0 };

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => c == null || c === "")) continue;
    const obj: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] ?? null;
    }
    rows.push(obj);
  }

  return { headers, rows, rowCount: rows.length };
}

// ── Header normalization + alias matching ─────────────────────────────────

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

/**
 * Resolve a logical field name to whichever header in the file matches.
 * Aliases are matched after both sides are normalized (case + punctuation
 * removed), so "Property Address", "PROPERTY_ADDRESS", and "Property
 * Address " all map to the same alias.
 */
export function pickColumn(
  headers: string[],
  aliases: string[]
): string | null {
  const map = new Map(headers.map((h) => [normalize(h), h]));
  for (const a of aliases) {
    const hit = map.get(normalize(a));
    if (hit) return hit;
  }
  return null;
}

/** Extract a value from a row using alias resolution. */
export function getCell(
  row: Record<string, unknown>,
  headers: string[],
  aliases: string[]
): unknown {
  const col = pickColumn(headers, aliases);
  return col ? row[col] : null;
}

// ── Cell coercion ──────────────────────────────────────────────────────────

export function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "").replace(/[()]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function asInteger(v: unknown): number | null {
  const n = asNumber(v);
  return n == null ? null : Math.round(n);
}

export function asDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try common formats
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function asBoolean(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["yes", "y", "true", "1", "x"].includes(s)) return true;
  if (["no", "n", "false", "0", ""].includes(s)) return false;
  return null;
}

// ── Asset-type normalization ──────────────────────────────────────────────

const ASSET_TYPE_MAP: Record<string, string> = {
  multifamily: "multifamily",
  multi_family: "multifamily",
  apartment: "multifamily",
  apartments: "multifamily",
  retail: "retail",
  shopping_center: "retail",
  strip_center: "retail",
  industrial: "industrial",
  warehouse: "industrial",
  flex: "industrial",
  manufacturing: "industrial",
  office: "office",
  medicaloffice: "office",
  hospitality: "hospitality",
  hotel: "hospitality",
  motel: "hospitality",
  selfstorage: "self_storage",
  storage: "self_storage",
  mixeduse: "mixed_use",
  mixed_use: "mixed_use",
  specialpurpose: "special_use",
  specialty: "special_use",
  land: "land",
  vacantland: "land",
  agricultural: "land",
  health_care: "medical",
  medical: "medical",
};

export function normalizeAssetType(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const k = normalize(s);
  return ASSET_TYPE_MAP[k] ?? s.toLowerCase();
}

// ── Owner-type heuristic ──────────────────────────────────────────────────

export function inferOwnerType(ownerName: string | null): string | null {
  if (!ownerName) return null;
  const u = ownerName.toUpperCase();
  if (/\b(LLC|L\.L\.C\.?|LP|L\.P\.|LIMITED|LTD|INC|CORPORATION|CORP|CO\.?)\b/.test(u))
    return "llc";
  if (/\bTRUST\b|\bTR\b/.test(u)) return "trust";
  if (/\bFUND\b|\bCAPITAL\b|\bPARTNERS\b|\bGROUP\b|\bHOLDINGS\b/.test(u))
    return "institutional";
  return "individual";
}

// ── Address normalization for fuzzy fallback matching ─────────────────────

export function normalizeAddress(addr: string | null): string {
  if (!addr) return "";
  return addr
    .toUpperCase()
    .replace(/[.,#\\/]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .trim();
}

// ── Slug generator ────────────────────────────────────────────────────────

export function makeSlug(name: string | null, fallback: string): string {
  const base = (name ?? fallback ?? "property")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Append short hash suffix for uniqueness
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

// ── CoStar field aliases ──────────────────────────────────────────────────

export const COSTAR_ALIASES = {
  apn: ["apn", "tax id", "parcel id", "parcel number", "tax parcel id", "parcel #"],
  name: ["property name", "building name"],
  address: ["property address", "street address", "address", "location address"],
  city: ["city", "property city"],
  state: ["state", "property state"],
  zip: ["zip", "zip code", "postal code", "property zip"],
  county: ["county", "property county"],
  assetType: [
    "property type", "building type", "primary property type", "asset type",
    "property type id",
  ],
  subType: ["secondary type", "property sub type", "sub type"],
  sqft: ["building sf", "rba", "rentable building area", "bldg sf", "building size", "gross sf"],
  acreage: ["land area (ac)", "land area", "lot size (ac)", "acreage", "acres"],
  yearBuilt: ["year built"],
  units: ["number of units", "# of units", "unit count", "units"],
  ownerName: [
    "true owner name", "owner name", "primary owner name", "recorded owner",
    "current owner",
  ],
  ownerAddress: ["true owner address", "owner address", "owner mailing address"],
  ownerCity: ["true owner city", "owner city"],
  ownerState: ["true owner state", "owner state"],
  ownerZip: ["true owner zip", "owner zip"],
  lastSaleDate: ["last sale date", "sale date", "recorded sale date"],
  lastSalePrice: ["last sale price", "sale price", "recorded sale price"],
  estimatedValue: ["estimated value", "market value", "true tax assessed value"],
  loanAmount: ["loan amount", "mortgage amount", "current loan amount"],
  loanLender: ["lender name", "current lender", "loan originator"],
  loanOriginationDate: ["loan origination date", "loan date", "mortgage date"],
  loanMaturityDate: ["loan maturity date", "loan maturity", "mortgage maturity date"],
  listingStatus: ["sale status", "for sale status", "status"],
};

// ── PropStream field aliases ──────────────────────────────────────────────

export const PROPSTREAM_ALIASES = {
  apn: ["apn", "parcel number", "parcel id", "tax id"],
  name: ["property name"],
  address: ["address", "property address", "street address", "site address"],
  city: ["city", "property city"],
  state: ["state", "property state"],
  zip: ["zip", "zip code", "property zip", "site zip"],
  county: ["county", "property county"],
  assetType: ["property type", "land use"],
  subType: ["property sub type", "sub type"],
  sqft: ["building sqft", "building sf", "total building square feet", "sqft"],
  units: ["number of units", "units"],
  yearBuilt: ["year built"],
  ownerName: ["owner name", "owner 1 name", "owner first name"],
  ownerAddress: ["owner mailing address", "owner address", "mailing address"],
  ownerCity: ["owner mailing city", "owner city", "mailing city"],
  ownerState: ["owner mailing state", "owner state", "mailing state"],
  ownerZip: ["owner mailing zip", "owner zip", "mailing zip"],
  // Foreclosure / distress signals
  preForeclosure: ["pre foreclosure", "preforeclosure", "in pre foreclosure"],
  foreclosureStage: ["foreclosure stage", "foreclosure status", "fc stage"],
  lisPendens: ["lis pendens"],
  nod: ["notice of default", "nod"],
  noticeOfTrusteeSale: ["notice of trustee sale", "nts"],
  sheriffSale: ["sheriff sale", "auction date", "sale date trustee"],
  reo: ["bank owned", "reo"],
  taxDelinquent: ["tax delinquent", "tax delinquency"],
  taxAmountOwed: ["tax amount owed", "delinquent tax amount"],
  // Owner stats
  yearsOwned: ["years owned", "ownership length", "ownership duration"],
  ownerOccupied: ["owner occupied", "absentee owner"],
  // Financials
  estimatedValue: ["estimated value", "estimated market value", "avm"],
  lastSaleDate: ["last sale date", "sale date"],
  lastSalePrice: ["last sale price", "sale price"],
  mortgageAmount: ["loan amount", "mortgage amount"],
  mortgageDate: ["mortgage date", "loan origination date", "deed date"],
  mortgageMaturityDate: ["mortgage maturity date", "loan maturity date", "due date"],
  mortgageLender: ["lender name", "lender", "loan originator"],
  // PropStream Foreclosure Factor (AI score)
  foreclosureFactor: ["foreclosure factor", "fc score", "default risk score"],
};

// ── Signal-flag derivation ────────────────────────────────────────────────

/**
 * Given a parsed PropStream row, produce the array of signal flags that
 * apply. These are stamped onto properties.prospector_signal_flags so lane
 * filters can pick them up via the JSONB GIN index.
 */
export function deriveSignalFlags(
  row: Record<string, unknown>,
  headers: string[]
): string[] {
  const flags = new Set<string>();
  const A = PROPSTREAM_ALIASES;

  if (asBoolean(getCell(row, headers, A.preForeclosure))) flags.add("pre_foreclosure");
  if (asBoolean(getCell(row, headers, A.lisPendens))) flags.add("lis_pendens");
  if (asBoolean(getCell(row, headers, A.nod))) flags.add("notice_of_default");
  if (asBoolean(getCell(row, headers, A.noticeOfTrusteeSale))) flags.add("notice_of_trustee_sale");
  if (asBoolean(getCell(row, headers, A.sheriffSale))) flags.add("sheriff_sale");
  if (asBoolean(getCell(row, headers, A.reo))) flags.add("reo");
  if (asBoolean(getCell(row, headers, A.taxDelinquent))) flags.add("tax_delinquent");

  const fcStage = asString(getCell(row, headers, A.foreclosureStage));
  if (fcStage) flags.add(`fc_stage_${normalize(fcStage)}`);

  // Refi maturity windows
  const maturityStr = asDate(getCell(row, headers, A.mortgageMaturityDate));
  if (maturityStr) {
    const maturity = new Date(maturityStr);
    const now = new Date();
    const monthsUntil = (maturity.getFullYear() - now.getFullYear()) * 12 + (maturity.getMonth() - now.getMonth());
    if (monthsUntil >= 0 && monthsUntil <= 12) flags.add("refi_maturing_12mo");
    if (monthsUntil >= 0 && monthsUntil <= 24) flags.add("refi_maturing_24mo");
    if (monthsUntil >= 0 && monthsUntil <= 36) flags.add("refi_maturing_36mo");
  }

  // Tired owner heuristic
  const yearsOwned = asInteger(getCell(row, headers, A.yearsOwned));
  if (yearsOwned != null && yearsOwned >= 15) flags.add("long_hold_15plus");
  if (yearsOwned != null && yearsOwned >= 20) flags.add("long_hold_20plus");

  const absentee = asBoolean(getCell(row, headers, A.ownerOccupied));
  if (absentee === false) flags.add("absentee_owner");

  return Array.from(flags);
}
