/**
 * Comp Importer — parses CoStar Excel exports and inserts into
 * sale_comps table with PostGIS location data.
 *
 * CoStar exports include lat/lng, so no geocoding is needed for comps.
 * Handles Sold, Active, and Under Contract statuses.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────

export interface ParsedSaleComp {
  address: string;
  city: string;
  state: string;
  asset_type: string | null;
  sale_date: string | null;
  sale_price: number | null;
  price_per_sqft: number | null;
  cap_rate: number | null;
  sqft: number | null;
  acreage: number | null;
  year_built: number | null;
  buyer: string | null;
  seller: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  data_source: string | null;
}

export interface ImportResult {
  totalRows: number;
  inserted: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  byCity: Record<string, number>;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

// ── CoStar Column Indices ──────────────────────────────────
// These are the known column positions from CoStar property sales exports.
// The importer also supports header-based detection as a fallback.

interface CoStarColumnMap {
  address: number;
  city: number;
  state: number;
  propertyType: number;
  buildingSF: number;
  salePrice: number;
  pricePsf: number;
  saleDate: number;
  saleStatus: number;
  askingPrice: number;
  percentLeased: number;
  actualCapRate: number;
  proFormaCapRate: number;
  saleType: number;
  propertyName: number;
  buyer: number;
  seller: number;
  secondaryType: number;
  buildingClass: number;
  yearBuilt: number;
  numberOfUnits: number;
  landAreaAC: number;
  submarketName: number;
  latitude: number;
  longitude: number;
  zipCode: number;
  county: number;
}

function detectCoStarColumns(headers: string[]): CoStarColumnMap {
  const find = (name: string): number => {
    const idx = headers.indexOf(name);
    if (idx >= 0) return idx;
    // Fuzzy match
    const lower = name.toLowerCase();
    return headers.findIndex((h) => h.toLowerCase() === lower);
  };

  return {
    address: find("Property Address"),
    city: find("Property City"),
    state: find("Property State"),
    propertyType: find("Property Type"),
    buildingSF: find("Building SF"),
    salePrice: find("Sale Price"),
    pricePsf: find("Price Per SF"),
    saleDate: find("Sale Date"),
    saleStatus: find("Sale Status"),
    askingPrice: find("Asking Price"),
    percentLeased: find("Percent Leased"),
    actualCapRate: find("Actual Cap Rate"),
    proFormaCapRate: find("Pro Forma Cap Rate"),
    saleType: find("Sale Type"),
    propertyName: find("Property Name"),
    buyer: find("Buyer (True) Company"),
    seller: find("Seller (True) Company"),
    secondaryType: find("Secondary Type"),
    buildingClass: find("Building Class"),
    yearBuilt: find("Year Built"),
    numberOfUnits: find("Number Of Units"),
    landAreaAC: find("Land Area AC"),
    submarketName: find("Submarket Name"),
    latitude: find("Latitude"),
    longitude: find("Longitude"),
    zipCode: find("Property Zip Code"),
    county: find("Property County"),
  };
}

// ── Value Parsers ──────────────────────────────────────────

function cleanNumber(val: any): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return isFinite(val) ? val : null;
  const cleaned = String(val).replace(/[$,%\s]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function cleanString(val: any): string | null {
  if (val == null || val === "") return null;
  return String(val).trim() || null;
}

function excelDateToISO(val: any): string | null {
  if (val == null || val === "") return null;
  const str = String(val).trim();

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // MM/DD/YYYY
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, "0")}-${mdyMatch[2].padStart(2, "0")}`;

  // Excel serial number (days since 1899-12-30)
  const serial = Number(str);
  if (isFinite(serial) && serial > 30000 && serial < 70000) {
    const date = new Date((serial - 25569) * 86400000);
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function normalizeAssetType(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  // Map CoStar types to our standard types
  if (lower.includes("retail")) return "Retail";
  if (lower.includes("office")) return "Office";
  if (lower.includes("industrial")) return "Industrial";
  if (lower.includes("multifamily")) return "Multifamily";
  if (lower.includes("flex")) return "Flex";
  if (lower.includes("land")) return "Land";
  if (lower.includes("health") || lower.includes("medical")) return "Medical";
  if (lower.includes("hotel") || lower.includes("hospitality")) return "Hotel";
  if (lower.includes("sport") || lower.includes("entertainment")) return "Specialty";
  if (lower.includes("specialty")) return "Specialty";
  return raw.trim();
}

// ── Row Extraction ─────────────────────────────────────────

function extractCoStarRow(
  row: any[],
  cols: CoStarColumnMap,
  fileName: string,
): { comp: ParsedSaleComp; status: string } | null {
  const address = cleanString(row[cols.address]);
  const city = cleanString(row[cols.city]);
  if (!address || !city) return null;

  const status = cleanString(row[cols.saleStatus]) || "Unknown";
  const salePrice = cleanNumber(row[cols.salePrice]);
  const askingPrice = cleanNumber(row[cols.askingPrice]);
  const pricePsf = cleanNumber(row[cols.pricePsf]);
  const capRate = cleanNumber(row[cols.actualCapRate]) || cleanNumber(row[cols.proFormaCapRate]);
  const sqft = cleanNumber(row[cols.buildingSF]);

  // Build notes from useful CoStar fields
  const noteParts: string[] = [];
  const secondaryType = cleanString(row[cols.secondaryType]);
  const buildingClass = cleanString(row[cols.buildingClass]);
  const saleType = cleanString(row[cols.saleType]);
  const percentLeased = cleanNumber(row[cols.percentLeased]);
  const propertyName = cleanString(row[cols.propertyName]);
  const numberOfUnits = cleanNumber(row[cols.numberOfUnits]);

  if (propertyName) noteParts.push(`Name: ${propertyName}`);
  if (secondaryType) noteParts.push(`Subtype: ${secondaryType}`);
  if (buildingClass) noteParts.push(`Class ${buildingClass}`);
  if (saleType) noteParts.push(`Sale: ${saleType}`);
  if (percentLeased != null) noteParts.push(`${percentLeased}% leased`);
  if (numberOfUnits) noteParts.push(`${numberOfUnits} units`);
  if (status === "Active" && askingPrice) noteParts.push(`Asking: $${askingPrice.toLocaleString()}`);

  // Calculate price_per_sqft if missing but computable
  let computedPricePsf = pricePsf;
  if (!computedPricePsf && salePrice && sqft && sqft > 0) {
    computedPricePsf = Math.round((salePrice / sqft) * 100) / 100;
  }

  return {
    comp: {
      address,
      city,
      state: cleanString(row[cols.state]) || "IN",
      asset_type: normalizeAssetType(cleanString(row[cols.propertyType])),
      sale_date: excelDateToISO(row[cols.saleDate]),
      sale_price: salePrice || askingPrice, // Use asking price for active listings
      price_per_sqft: computedPricePsf,
      cap_rate: capRate ? capRate / 100 : null, // Store as decimal (0.075 not 7.5)
      sqft: sqft ? Math.round(sqft) : null,
      acreage: cleanNumber(row[cols.landAreaAC]),
      year_built: cleanNumber(row[cols.yearBuilt]),
      buyer: cleanString(row[cols.buyer]),
      seller: cleanString(row[cols.seller]),
      latitude: cleanNumber(row[cols.latitude]),
      longitude: cleanNumber(row[cols.longitude]),
      notes: noteParts.length > 0 ? noteParts.join(" | ") : null,
      data_source: `CoStar: ${fileName}`,
    },
    status,
  };
}

// ── Main Import Function ───────────────────────────────────

export async function importCoStarFile(
  rows: any[][],
  headers: string[],
  organizationId: string,
  supabase: SupabaseClient,
  options: {
    fileName?: string;
    dryRun?: boolean;
    includeActive?: boolean; // Import active listings too (default: true)
  } = {},
): Promise<ImportResult> {
  const cols = detectCoStarColumns(headers);
  const fileName = options.fileName || "unknown";
  const includeActive = options.includeActive !== false;

  const result: ImportResult = {
    totalRows: rows.length,
    inserted: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
    byCity: {},
    byType: {},
    byStatus: {},
  };

  const compsToInsert: (ParsedSaleComp & { organization_id: string })[] = [];
  const seenAddresses = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const extracted = extractCoStarRow(rows[i], cols, fileName);
    if (!extracted) {
      result.skipped++;
      continue;
    }

    const { comp, status } = extracted;

    // Track status counts
    result.byStatus[status] = (result.byStatus[status] || 0) + 1;

    // Skip active listings if not requested
    if (!includeActive && status !== "Sold") {
      result.skipped++;
      continue;
    }

    // Deduplicate by address within this file
    const dedupeKey = `${comp.address}|${comp.sale_date || "no-date"}|${comp.sale_price || "no-price"}`;
    if (seenAddresses.has(dedupeKey)) {
      result.duplicates++;
      continue;
    }
    seenAddresses.add(dedupeKey);

    // Track by city and type
    if (comp.city) result.byCity[comp.city] = (result.byCity[comp.city] || 0) + 1;
    if (comp.asset_type) result.byType[comp.asset_type] = (result.byType[comp.asset_type] || 0) + 1;

    compsToInsert.push({ ...comp, organization_id: organizationId });
  }

  if (options.dryRun) {
    result.inserted = compsToInsert.length;
    return result;
  }

  // Batch insert (chunks of 50)
  for (let i = 0; i < compsToInsert.length; i += 50) {
    const batch = compsToInsert.slice(i, i + 50);
    const { error } = await supabase.from("sale_comps").insert(batch);
    if (error) {
      result.errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
    } else {
      result.inserted += batch.length;
    }
  }

  return result;
}

// ── Bulk Import All Files ──────────────────────────────────

export async function importAllCoStarFiles(
  files: { name: string; rows: any[][]; headers: string[] }[],
  organizationId: string,
  supabase: SupabaseClient,
  options: { dryRun?: boolean; includeActive?: boolean } = {},
): Promise<{
  totalFiles: number;
  totalInserted: number;
  totalSkipped: number;
  totalDuplicates: number;
  errors: string[];
  fileResults: { fileName: string; result: ImportResult }[];
}> {
  const fileResults: { fileName: string; result: ImportResult }[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  const allErrors: string[] = [];

  for (const file of files) {
    const result = await importCoStarFile(file.rows, file.headers, organizationId, supabase, {
      fileName: file.name,
      dryRun: options.dryRun,
      includeActive: options.includeActive,
    });

    fileResults.push({ fileName: file.name, result });
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
    totalDuplicates += result.duplicates;
    allErrors.push(...result.errors.map((e) => `[${file.name}] ${e}`));
  }

  return {
    totalFiles: files.length,
    totalInserted,
    totalSkipped,
    totalDuplicates,
    errors: allErrors,
    fileResults,
  };
}
