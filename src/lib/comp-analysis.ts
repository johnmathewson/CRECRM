export type AnalysisMode = "lease" | "sale" | "mixed";

export interface SubjectSnapshot {
  propertyName: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  assetType?: string | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  occupancyPercent?: number | null;
  askingPrice?: number | null;
  leaseRate?: number | null;
  extractedRentRollText?: string;
}

export interface ParsedRentRollRow {
  unit: string;
  tenant?: string;
  sqft?: number;
  annualRent?: number;
  rentPsf?: number;
  status?: string;
}

export interface CompRecord {
  id: string;
  name: string;
  compType: "lease" | "sale";
  propertyType?: string;
  city?: string;
  submarket?: string;
  sqft?: number;
  yearBuilt?: number;
  distanceMiles?: number;
  leaseRate?: number;
  salePrice?: number;
  pricePsf?: number;
  capRate?: number;
  occupancyPercent?: number;
  notes?: string;
}

export interface RankedComp extends CompRecord {
  relevanceScore: number;
  adjustments: {
    sizeAdjustmentPct: number;
    ageAdjustmentPct: number;
    distanceAdjustmentPct: number;
    occupancyAdjustmentPct: number;
  };
  adjustedLeaseRate?: number;
  adjustedPricePsf?: number;
  adjustedCapRate?: number;
  reasoning: string[];
}

export interface CompAnalysisResult {
  mode: AnalysisMode;
  subject: SubjectSnapshot & {
    weightedRentPsf: number | null;
    occupiedSqft: number;
    annualizedRent: number;
  };
  rankedComps: RankedComp[];
  narrative: string;
  ranges: {
    rentPsf?: { low: number; mid: number; high: number };
    pricePsf?: { low: number; mid: number; high: number };
    capRate?: { low: number; mid: number; high: number };
  };
}

function round(n: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function toNumber(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = value.replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function asRange(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: round(sorted[0]),
    mid: round(median(sorted) ?? sorted[0]),
    high: round(sorted[sorted.length - 1]),
  };
}

export function parseRentRoll(text: string): ParsedRentRollRow[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rows.length) return [];

  const delimiter = rows.some((line) => line.includes("\t")) ? "\t" : ",";
  const [headerLine, ...body] = rows;
  const headers = headerLine.split(delimiter).map((h) => h.trim().toLowerCase());

  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

  const unitIdx = idx(["unit", "suite", "space"]);
  const tenantIdx = idx(["tenant"]);
  const sqftIdx = idx(["sqft", "sf", "size"]);
  const annualRentIdx = idx(["annual rent", "annual"]);
  const rentPsfIdx = idx(["rent psf", "rate", "$/sf"]);
  const statusIdx = idx(["status", "occupied", "vacant"]);

  return body
    .map((line, i) => {
      const cols = line.split(delimiter).map((c) => c.trim());
      return {
        unit: cols[unitIdx] || `Line ${i + 1}`,
        tenant: tenantIdx >= 0 ? cols[tenantIdx] : undefined,
        sqft: sqftIdx >= 0 ? toNumber(cols[sqftIdx]) : undefined,
        annualRent: annualRentIdx >= 0 ? toNumber(cols[annualRentIdx]) : undefined,
        rentPsf: rentPsfIdx >= 0 ? toNumber(cols[rentPsfIdx]) : undefined,
        status: statusIdx >= 0 ? cols[statusIdx] : undefined,
      };
    })
    .filter((row) => row.unit || row.tenant || row.sqft || row.annualRent || row.rentPsf);
}

export function parseCompText(text: string): CompRecord[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rows.length) return [];

  const delimiter = rows.some((line) => line.includes("\t")) ? "\t" : ",";
  const [headerLine, ...body] = rows;
  const headers = headerLine.split(delimiter).map((h) => h.trim().toLowerCase());

  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

  const nameIdx = idx(["name", "property", "address"]);
  const typeIdx = idx(["comp type", "type", "sale/lease"]);
  const propertyTypeIdx = idx(["property type", "asset type", "asset"]);
  const cityIdx = idx(["city"]);
  const submarketIdx = idx(["submarket"]);
  const sqftIdx = idx(["sqft", "sf", "size"]);
  const yearBuiltIdx = idx(["year built"]);
  const distanceIdx = idx(["distance"]);
  const leaseRateIdx = idx(["lease rate", "rent psf", "asking rent", "achieved rent"]);
  const salePriceIdx = idx(["sale price", "price"]);
  const pricePsfIdx = idx(["price psf", "price/sf", "price per sf"]);
  const capRateIdx = idx(["cap rate"]);
  const occupancyIdx = idx(["occupancy"]);
  const notesIdx = idx(["notes"]);

  return body.map((line, i) => {
    const cols = line.split(delimiter).map((c) => c.trim());
    const rawType = (typeIdx >= 0 ? cols[typeIdx] : "").toLowerCase();
    const compType: "lease" | "sale" =
      rawType.includes("sale") || pricePsfIdx >= 0 || salePriceIdx >= 0 ? "sale" : "lease";

    return {
      id: `comp-${i + 1}`,
      name: cols[nameIdx] || `Comp ${i + 1}`,
      compType,
      propertyType: propertyTypeIdx >= 0 ? cols[propertyTypeIdx] : undefined,
      city: cityIdx >= 0 ? cols[cityIdx] : undefined,
      submarket: submarketIdx >= 0 ? cols[submarketIdx] : undefined,
      sqft: sqftIdx >= 0 ? toNumber(cols[sqftIdx]) : undefined,
      yearBuilt: yearBuiltIdx >= 0 ? toNumber(cols[yearBuiltIdx]) : undefined,
      distanceMiles: distanceIdx >= 0 ? toNumber(cols[distanceIdx]) : undefined,
      leaseRate: leaseRateIdx >= 0 ? toNumber(cols[leaseRateIdx]) : undefined,
      salePrice: salePriceIdx >= 0 ? toNumber(cols[salePriceIdx]) : undefined,
      pricePsf: pricePsfIdx >= 0 ? toNumber(cols[pricePsfIdx]) : undefined,
      capRate: capRateIdx >= 0 ? toNumber(cols[capRateIdx]) : undefined,
      occupancyPercent: occupancyIdx >= 0 ? toNumber(cols[occupancyIdx]) : undefined,
      notes: notesIdx >= 0 ? cols[notesIdx] : undefined,
    };
  });
}

function buildSubjectRollup(subject: SubjectSnapshot) {
  const rows = subject.extractedRentRollText ? parseRentRoll(subject.extractedRentRollText) : [];
  let occupiedSqft = 0;
  let annualizedRent = 0;

  for (const row of rows) {
    const isVacant = (row.status || "").toLowerCase().includes("vacant");
    if (isVacant) continue;

    const sf = row.sqft ?? 0;
    const annualRent = row.annualRent ?? ((row.rentPsf ?? 0) * sf);

    occupiedSqft += sf;
    annualizedRent += annualRent;
  }

  const weightedRentPsf = occupiedSqft > 0 ? round(annualizedRent / occupiedSqft) : subject.leaseRate ?? null;
  return { weightedRentPsf, occupiedSqft, annualizedRent };
}

function scoreDistance(distanceMiles?: number) {
  if (distanceMiles == null) return 0.5;
  if (distanceMiles <= 1) return 1;
  if (distanceMiles <= 3) return 0.85;
  if (distanceMiles <= 5) return 0.65;
  return 0.35;
}

function scoreSize(subjectSqft?: number | null, compSqft?: number) {
  if (!subjectSqft || !compSqft) return 0.55;
  const ratio = Math.min(subjectSqft, compSqft) / Math.max(subjectSqft, compSqft);
  return round(ratio, 3);
}

function scoreAge(subjectYear?: number | null, compYear?: number) {
  if (!subjectYear || !compYear) return 0.55;
  const diff = Math.abs(subjectYear - compYear);
  if (diff <= 5) return 1;
  if (diff <= 10) return 0.8;
  if (diff <= 20) return 0.6;
  return 0.35;
}

function scorePropertyType(subjectType?: string | null, compType?: string) {
  if (!subjectType || !compType) return 0.5;
  return subjectType.toLowerCase() === compType.toLowerCase() ? 1 : 0.45;
}

function buildAdjustments(subject: SubjectSnapshot, comp: CompRecord) {
  const subjectSqft = subject.sqft ?? undefined;
  const sizeAdjustmentPct =
    subjectSqft && comp.sqft ? round(((subjectSqft - comp.sqft) / comp.sqft) * 0.05, 4) : 0;
  const ageAdjustmentPct =
    subject.yearBuilt && comp.yearBuilt ? round(((subject.yearBuilt - comp.yearBuilt) * 0.002), 4) : 0;
  const distanceAdjustmentPct =
    comp.distanceMiles == null ? 0 : comp.distanceMiles <= 1 ? 0 : comp.distanceMiles <= 3 ? -0.01 : -0.025;
  const occupancyAdjustmentPct =
    subject.occupancyPercent != null && comp.occupancyPercent != null
      ? round((((subject.occupancyPercent - comp.occupancyPercent) / 100) * 0.04), 4)
      : 0;

  return {
    sizeAdjustmentPct,
    ageAdjustmentPct,
    distanceAdjustmentPct,
    occupancyAdjustmentPct,
  };
}

export function runCompAnalysis(
  subject: SubjectSnapshot,
  compText: string,
  mode: AnalysisMode,
): CompAnalysisResult {
  const subjectRollup = buildSubjectRollup(subject);
  const comps = parseCompText(compText).filter((comp) => mode === "mixed" || comp.compType === mode);

  const rankedComps: RankedComp[] = comps
    .map((comp) => {
      const typeScore = scorePropertyType(subject.assetType, comp.propertyType);
      const sizeScore = scoreSize(subject.sqft, comp.sqft);
      const ageScore = scoreAge(subject.yearBuilt, comp.yearBuilt);
      const distanceScore = scoreDistance(comp.distanceMiles);

      const relevanceScore = round(
        typeScore * 0.35 + sizeScore * 0.25 + ageScore * 0.2 + distanceScore * 0.2,
        4,
      );

      const adjustments = buildAdjustments(subject, comp);
      const totalAdjustment =
        adjustments.sizeAdjustmentPct +
        adjustments.ageAdjustmentPct +
        adjustments.distanceAdjustmentPct +
        adjustments.occupancyAdjustmentPct;

      const adjustedLeaseRate =
        comp.compType === "lease" && comp.leaseRate != null ? round(comp.leaseRate * (1 + totalAdjustment)) : undefined;
      const adjustedPricePsf =
        comp.compType === "sale" && comp.pricePsf != null ? round(comp.pricePsf * (1 + totalAdjustment)) : undefined;
      const adjustedCapRate =
        comp.compType === "sale" && comp.capRate != null ? round(comp.capRate - totalAdjustment, 4) : undefined;

      const reasoning: string[] = [];
      if (typeScore >= 1) reasoning.push("Exact asset-type match");
      if (distanceScore >= 0.85) reasoning.push("Close geographic comp");
      if (sizeScore >= 0.8) reasoning.push("Comparable size profile");
      if (ageScore >= 0.8) reasoning.push("Similar vintage");

      return {
        ...comp,
        relevanceScore,
        adjustments,
        adjustedLeaseRate,
        adjustedPricePsf,
        adjustedCapRate,
        reasoning,
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const leaseValues = rankedComps
    .filter((comp) => comp.adjustedLeaseRate != null)
    .map((comp) => comp.adjustedLeaseRate!) ;
  const priceValues = rankedComps
    .filter((comp) => comp.adjustedPricePsf != null)
    .map((comp) => comp.adjustedPricePsf!) ;
  const capValues = rankedComps
    .filter((comp) => comp.adjustedCapRate != null)
    .map((comp) => comp.adjustedCapRate!) ;

  const rentRange = asRange(leaseValues);
  const priceRange = asRange(priceValues);
  const capRange = asRange(capValues);

  const narrativeBits: string[] = [];

  if (rentRange) {
    narrativeBits.push(
      `Adjusted lease comps indicate market rent in a range of ${rentRange.low.toFixed(2)} to ${rentRange.high.toFixed(2)} PSF, with a midpoint around ${rentRange.mid.toFixed(2)} PSF.`,
    );
  }
  if (priceRange) {
    narrativeBits.push(
      `Adjusted sale comps indicate value between ${priceRange.low.toFixed(2)} and ${priceRange.high.toFixed(2)} per SF, centering near ${priceRange.mid.toFixed(2)} per SF.`,
    );
  }
  if (capRange) {
    narrativeBits.push(
      `Comparable cap rates cluster between ${(capRange.low * 100).toFixed(2)}% and ${(capRange.high * 100).toFixed(2)}%, with a midpoint near ${(capRange.mid * 100).toFixed(2)}%.`,
    );
  }
  if (subjectRollup.weightedRentPsf != null && rentRange) {
    if (subjectRollup.weightedRentPsf < rentRange.low) {
      narrativeBits.push("The subject's in-place rent appears below the indicated comp range, suggesting upside if tenancy and market depth support it.");
    } else if (subjectRollup.weightedRentPsf > rentRange.high) {
      narrativeBits.push("The subject's in-place rent appears above the adjusted comp range, so lease durability and tenant quality should be scrutinized closely.");
    } else {
      narrativeBits.push("The subject's in-place rent falls inside the adjusted market range, which supports current pricing assumptions.");
    }
  }

  return {
    mode,
    subject: {
      ...subject,
      weightedRentPsf: subjectRollup.weightedRentPsf,
      occupiedSqft: subjectRollup.occupiedSqft,
      annualizedRent: subjectRollup.annualizedRent,
    },
    rankedComps,
    narrative: narrativeBits.join(" "),
    ranges: {
      rentPsf: rentRange,
      pricePsf: priceRange,
      capRate: capRange,
    },
  };
}
