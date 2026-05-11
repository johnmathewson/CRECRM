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

/**
 * Map raw CoStar / PropStream asset-type strings to the values our
 * properties.asset_type CHECK constraint accepts. Keys are post-`normalize()`
 * (lowercase + alphanumeric only) so "Health Care", "HEALTH-CARE", and
 * "health_care" all match the same key `healthcare`.
 *
 * Anything unmapped falls through to 'other' rather than the raw input —
 * critical for CoStar exports, which use long-tail subcategories ("Sports
 * & Entertainment", "Distribution Warehouse", etc.) that the constraint
 * rejects.
 */
const ASSET_TYPE_MAP: Record<string, string> = {
  // Multifamily
  multifamily: "multifamily",
  multifamily7: "multifamily",
  multifamilyhouse: "multifamily",
  apartment: "multifamily",
  apartments: "multifamily",
  garden: "multifamily",
  highrise: "multifamily",
  midrise: "multifamily",
  studenthousing: "multifamily",
  seniorhousing: "multifamily",
  // Retail
  retail: "retail",
  shoppingcenter: "retail",
  stripcenter: "retail",
  freestanding: "retail",
  restaurant: "retail",
  fastfood: "retail",
  bigbox: "retail",
  conveniencestore: "retail",
  generalretail: "retail",
  storefront: "retail",
  // Industrial
  industrial: "industrial",
  warehouse: "industrial",
  distributionwarehouse: "industrial",
  flex: "industrial",
  flexrd: "industrial",
  manufacturing: "industrial",
  rd: "industrial",
  truckterminal: "industrial",
  refrigerationcoldstorage: "industrial",
  servicemaintenance: "industrial",
  // Office
  office: "office",
  creativeloftoffice: "office",
  governmentoffice: "office",
  // Medical
  medical: "medical",
  healthcare: "medical",
  medicaloffice: "medical",
  // Hospitality
  hospitality: "hospitality",
  hotel: "hospitality",
  motel: "hospitality",
  resort: "hospitality",
  // Self storage
  selfstorage: "self_storage",
  storage: "self_storage",
  // Mixed use
  mixeduse: "mixed_use",
  // Land
  land: "land",
  vacantland: "land",
  agricultural: "land",
  rawland: "land",
  // Special use — anything else CoStar tags as a non-mainstream type
  specialpurpose: "special_use",
  specialty: "special_use",
  sports: "special_use",
  sportsentertainment: "special_use",
  entertainment: "special_use",
  religious: "special_use",
  church: "special_use",
  school: "special_use",
  education: "special_use",
  daycare: "special_use",
  parking: "special_use",
  parkinggarage: "special_use",
  marina: "special_use",
  golf: "special_use",
  golfcourse: "special_use",
  funeralhome: "special_use",
  cemetery: "special_use",
  auto: "special_use",
  autoservice: "special_use",
  carwash: "special_use",
  servicestation: "special_use",
  gasstation: "special_use",
  theater: "special_use",
  theatre: "special_use",
};

export function normalizeAssetType(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const k = normalize(s);
  // Direct hit
  if (ASSET_TYPE_MAP[k]) return ASSET_TYPE_MAP[k];
  // Substring fallback — handles "Office Building", "Industrial Park", etc.
  for (const key of Object.keys(ASSET_TYPE_MAP)) {
    if (k.includes(key)) return ASSET_TYPE_MAP[key];
  }
  // Unmapped — keep the row, but tag as 'other' so it satisfies the constraint
  return "other";
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

/**
 * Generate a unique-enough slug. The properties table has a UNIQUE index
 * on slug WHERE slug IS NOT NULL, so collisions cause insert failure.
 * Combine timestamp (ms since epoch) + 8 random base36 chars to make
 * birthday-paradox collisions astronomically unlikely even at six-figure
 * import volumes.
 */
export function makeSlug(name: string | null, fallback: string): string {
  const base = (name ?? fallback ?? "property")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${base}-${ts}${rand}`;
}

// ── State normalization ───────────────────────────────────────────────────

/**
 * USPS state-code normalization. CoStar exports sometimes have full state
 * names ("Indiana", "Illinois") while our lane filters compare against
 * 2-char codes — so without normalizing, lanes silently miss imports.
 */
// Keys are post-normalize() (lowercase, no spaces/punctuation), so
// "New York", "NEW-YORK", "New York " all match the same key "newyork".
const STATE_CODE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  districtofcolumbia: "DC", florida: "FL", georgia: "GA", hawaii: "HI",
  idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", newhampshire: "NH", newjersey: "NJ", newmexico: "NM",
  newyork: "NY", northcarolina: "NC", northdakota: "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", rhodeisland: "RI",
  southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  westvirginia: "WV", wisconsin: "WI", wyoming: "WY",
};

export function normalizeState(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const k = normalize(trimmed);
  if (STATE_CODE_MAP[k]) return STATE_CODE_MAP[k];
  // Fallback: first 2 chars uppercased — better than letting the full
  // string through and silently missing every lane filter.
  return trimmed.slice(0, 2).toUpperCase();
}

// ── CoStar field aliases ──────────────────────────────────────────────────

/**
 * CoStar column aliases — comprehensive map to the actual columns CoStar's
 * Property Search export emits. Built from a real header audit of 37
 * separate exports across all property types (Office, Industrial, Retail,
 * Land, Hospitality, Healthcare, etc.).
 *
 * Aliases are matched after both sides go through normalize() — lowercase +
 * alphanumeric only. So "Maturity Date" matches "maturitydate" matches
 * "MATURITY-DATE" all the same.
 */
export const COSTAR_ALIASES = {
  // ── Identifiers ──────────────────────────────────────────────────────────
  apn: [
    // CoStar's actual column is "Parcel Number 1(Min)" — there's a second
    // for "Parcel Number 2(Max)" for multi-parcel properties.
    "parcel number 1 min", "parcel number 1(min)", "parcel number 1",
    "parcel number 2 max", "parcel number 2(max)", "parcel number 2",
    "apn", "apn number", "parcel apn", "tax parcel apn",
    "tax id", "tax id number",
    "parcel id", "parcel id number", "parcel #", "parcel number",
    "tax parcel id", "tax parcel number",
    "assessor id", "assessor parcel number",
    "property id", "propertyid",
  ],
  // ── Property core ────────────────────────────────────────────────────────
  name: ["property name", "building name", "name"],
  address: [
    "property address", "street address", "address", "primary address",
  ],
  city: ["city", "property city"],
  state: ["state", "property state"],
  zip: ["zip", "zip code", "postal code", "property zip"],
  county: ["county name", "county", "property county"],
  assetType: [
    "property type", "primary property type", "building type", "asset type",
  ],
  subType: [
    "secondary type", "secondary property type", "property sub type", "sub type",
  ],
  // CoStar uses "RBA" for office/retail/industrial; "Land Area (SF)" for land;
  // hospitality reports rooms separately. The importer picks per-row.
  sqft: [
    "rba", "rentable building area", "building sf", "bldg sf",
    "building square feet", "building size",
    "gross sf", "total building sf",
  ],
  acreage: [
    "land area (ac)", "land area ac", "land area", "lot size (ac)",
    "lot size ac", "acreage", "acres",
  ],
  landAreaSf: ["land area (sf)", "land area sf"],
  yearBuilt: ["year built", "yr built"],
  yearRenovated: ["year renovated", "yr renovated"],
  units: [
    "number of units", "# of units", "unit count", "units", "total units",
  ],
  rooms: ["rooms", "number of rooms", "# of rooms"],

  // ── Owner (three variants in CoStar; True Owner is the LLC unmask) ──────
  ownerName: ["owner name", "owner 1 name", "owner1 name"],
  ownerAddress: ["owner address", "owner mailing address"],
  ownerCityStateZip: ["owner city state zip", "owner city/state/zip"],
  ownerPhone: ["owner phone"],
  ownerContact: ["owner contact"],

  trueOwnerName: ["true owner name", "true owner"],
  trueOwnerAddress: ["true owner address", "true owner mailing address"],
  trueOwnerCityStateZip: ["true owner city state zip", "true owner city/state/zip"],
  trueOwnerPhone: ["true owner phone"],
  trueOwnerContact: ["true owner contact"],

  recordedOwnerName: ["recorded owner name", "recorded owner"],
  recordedOwnerAddress: ["recorded owner address"],
  recordedOwnerCityStateZip: ["recorded owner city state zip"],
  recordedOwnerPhone: ["recorded owner phone"],

  // ── Sale history ─────────────────────────────────────────────────────────
  lastSaleDate: ["last sale date", "sale date"],
  lastSalePrice: ["last sale price", "sale price"],

  // ── Loan / debt ──────────────────────────────────────────────────────────
  loanMaturityDate: ["maturity date", "loan maturity date", "loan maturity"],
  loanOriginationDate: ["origination date", "loan origination date"],
  loanAmount: ["origination amount", "loan amount", "mortgage amount"],
  loanLender: ["originator", "lender name", "current lender", "loan originator"],
  loanInterestRate: ["interest rate"],
  loanInterestRateType: ["interest rate type"],
  loanType: ["loan type"],
  loanCollateralType: ["collateral type"],

  // ── Listing state ────────────────────────────────────────────────────────
  forSalePrice: ["for sale price"],
  forSaleStatus: ["for sale status", "sale status"],
  daysOnMarket: ["days on market"],

  // ── Performance ──────────────────────────────────────────────────────────
  capRate: ["cap rate"],
  percentLeased: ["percent leased", "% leased"],
  vacancyPct: ["vacancy %", "vacancy percent", "vacancy pct"],
  rentPerSfYr: ["rent/sf/yr", "rent per sf per year", "asking rent"],

  // ── Building / market ────────────────────────────────────────────────────
  buildingClass: ["building class"],
  marketName: ["market name", "market"],
  submarket: ["submarket name", "submarket"],
  submarketCluster: ["submarket cluster"],
  tenancy: ["tenancy"],
  totalBuildings: ["total buildings", "# of buildings"],
  numberOfStories: ["number of stories", "stories", "# of stories"],

  // ── Tax ──────────────────────────────────────────────────────────────────
  taxYear: ["tax year"],
  taxTotal: ["taxes total", "total taxes"],
  taxPerSf: ["taxes per sf"],

  // ── Service contacts (CoStar provides listing broker + manager) ─────────
  propertyManagerName: ["property manager name"],
  propertyManagerPhone: ["property manager phone"],
  propertyManagerAddress: ["property manager address"],
  salesCompanyName: ["sale company name", "sales company"],
  salesContactName: ["sale company contact", "sales contact"],
  salesContactPhone: ["sale company phone", "sales contact phone"],
  leasingCompanyName: ["leasing company name"],
  leasingContactName: ["leasing company contact"],
  leasingContactPhone: ["leasing company phone"],

  // ── Hospitality-specific (only populated for hotel rows) ─────────────────
  hotelBrand: ["brand"],
  hotelClass: ["hotel class", "scale"],

  // ── Geographic precision ────────────────────────────────────────────────
  latitude: ["latitude"],
  longitude: ["longitude"],

  // ── Zoning ──────────────────────────────────────────────────────────────
  zoning: ["zoning"],

  // ── Legacy alias keys (kept so older code keeps compiling) ──────────────
  estimatedValue: ["estimated value", "market value", "assessed value"],
  listingStatus: ["for sale status", "sale status"],
};

/**
 * Parse CoStar's combined "City, ST Zip" field — e.g.
 *   "CROWN POINT, IN 46307-2315"
 *   "Indianapolis, IN 46201"
 *   "Chicago, IL 60601"
 * Returns city + state + zip separately. Returns nulls if unparseable.
 */
export function parseCityStateZip(v: unknown): {
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const s = asString(v);
  if (!s) return { city: null, state: null, zip: null };

  // Common shapes:
  //   "CITY, ST ZIP"
  //   "CITY, ST ZIP-EXT"
  //   "CITY, ST"
  //   "CITY ST ZIP" (no comma — rare)
  const trimmed = s.trim();
  const m = trimmed.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);
  if (m) {
    return {
      city: m[1].trim() || null,
      state: m[2]?.toUpperCase() || null,
      zip: m[3] ? m[3].split("-")[0] : null,
    };
  }
  // Fallback: try splitting on whitespace from the right
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3) {
    const lastCandidate = parts[parts.length - 1];
    const stateCandidate = parts[parts.length - 2];
    if (/^\d{5}(-\d{4})?$/.test(lastCandidate) && /^[A-Z]{2}$/i.test(stateCandidate)) {
      return {
        city: parts.slice(0, -2).join(" ").replace(/,$/, "").trim() || null,
        state: stateCandidate.toUpperCase(),
        zip: lastCandidate.split("-")[0],
      };
    }
  }
  return { city: trimmed || null, state: null, zip: null };
}

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

  // Note: PropStream's foreclosureStage value is captured in raw_data on
  // the corresponding signal row, but we DON'T emit it as a separate
  // signal_type — the DB enum is fixed and we already capture the stage
  // via the more specific lis_pendens / nod / nts / sheriff_sale flags
  // above.

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
