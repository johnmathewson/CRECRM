/**
 * Parcel map color system.
 *
 * Not the Stewardship brand palette on purpose: a parcel map is a reading
 * instrument, and the planning convention (yellow residential, red/orange
 * commercial, purple industrial, blue institutional, green open space) is
 * what developers, contractors and investors already know how to read.
 * Hues are muted so the map stays calm at scale; one action blue for UI.
 */

export const UI = {
  accent: "#2563EB", // action blue (buttons, selection)
  accentSoft: "#DBEAFE",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#E2E8F0",
  panel: "#FFFFFF",
  canvas: "#F1F5F9",
};

export type Swatch = { fill: string; label: string; group: "Residential" | "Commercial" | "Industrial" | "Mixed" | "Overlay" };

/** Zoning districts as published by the City of Hobart zoning layer. */
export const ZONING: Record<string, Swatch> = {
  R1: { fill: "#FFF3B0", label: "Single Family · Large Lot", group: "Residential" },
  R2: { fill: "#FFE07A", label: "Single Family · Small Lot", group: "Residential" },
  R3: { fill: "#F9C74F", label: "Single to Four Family", group: "Residential" },
  R4: { fill: "#E9A23B", label: "Multiple Family", group: "Residential" },
  B1: { fill: "#F4A3A3", label: "Neighborhood Business", group: "Commercial" },
  B2: { fill: "#E5484D", label: "Central Business", group: "Commercial" },
  B3: { fill: "#C1272D", label: "Highway Business", group: "Commercial" },
  OS1: { fill: "#F6B5C9", label: "Office Services", group: "Commercial" },
  OS2: { fill: "#F6B5C9", label: "Office Services", group: "Commercial" },
  PBP: { fill: "#B388EB", label: "Planned Business Park", group: "Industrial" },
  M1: { fill: "#8E6BC6", label: "Light Manufacturing", group: "Industrial" },
  PUD: { fill: "#C9B79C", label: "Planned Unit Development", group: "Mixed" },
  A1: { fill: "#D9EAD3", label: "Agriculture", group: "Mixed" },
  FP: { fill: "#B5DDF2", label: "Flood Plain", group: "Overlay" },
  FP1: { fill: "#B5DDF2", label: "Flood Plain 1", group: "Overlay" },
  FP2: { fill: "#9CCBEA", label: "Flood Plain 2", group: "Overlay" },
};
export const ZONING_FALLBACK = "#E2E8F0";

/** Future land use as published by the city's comprehensive-plan layer. */
export const LAND_USE: Record<string, { fill: string; label: string }> = {
  "Single Family": { fill: "#FFE07A", label: "Single Family" },
  "Multi Family - moderate density": { fill: "#E9A23B", label: "Multi Family · Moderate" },
  "Multi Family - Moderate Density": { fill: "#E9A23B", label: "Multi Family · Moderate" },
  "Multi Family - High Density": { fill: "#D1812A", label: "Multi Family · High" },
  "Central Business": { fill: "#E5484D", label: "Central Business" },
  "General Business": { fill: "#F08C8C", label: "General Business" },
  "Office/Service": { fill: "#F6B5C9", label: "Office / Service" },
  "Industrial": { fill: "#8E6BC6", label: "Industrial" },
  "Institutional": { fill: "#7FB3E6", label: "Institutional" },
  "Park": { fill: "#9ED39A", label: "Park / Open Space" },
};

/** Building height ramp (feet → color), sequential blue so it reads as data. */
export const HEIGHT_STOPS: [number, string][] = [
  [8, "#DCE7F3"],
  [15, "#A9C4E4"],
  [25, "#6B97CF"],
  [40, "#3B66B5"],
  [70, "#1E3A8A"],
];
export const HEIGHT_LEGEND = [
  { label: "One story", sub: "< 15 ft", fill: "#DCE7F3" },
  { label: "Two story", sub: "15–25 ft", fill: "#A9C4E4" },
  { label: "Three story", sub: "25–40 ft", fill: "#6B97CF" },
  { label: "Four plus", sub: "40 ft +", fill: "#3B66B5" },
];

export const BUILDING_NEUTRAL = "#CBD5E1";
export const PARCEL_LINE = "#475569";
export const SELECTION = UI.accent;
export const OWNER_MATCH = "#F59E0B";

/** Maplibre `match` expression for a lookup table. */
export function matchExpr(getter: any[], table: Record<string, { fill: string }>, fallback: string): any[] {
  const e: any[] = ["match", getter];
  for (const [k, v] of Object.entries(table)) e.push(k, v.fill);
  e.push(fallback);
  return e;
}

export function heightExpr(): any[] {
  const e: any[] = ["interpolate", ["linear"], ["coalesce", ["get", "h"], 10]];
  for (const [h, c] of HEIGHT_STOPS) e.push(h, c);
  return e;
}

/** On-market overlay. Deliberately outside the zoning hue families. */
export const LISTING = {
  sale: { fill: "#16A34A", line: "#14532D", label: "For sale" },
  lease: { fill: "#0891B2", line: "#164E63", label: "For lease" },
  both: { fill: "#16A34A", line: "#164E63", label: "Sale or lease" },
};

/** Occupancy overlay (parcels with at least one operating business). Indigo:
 *  clear of the zoning families, the listing green/cyan and the owner amber. */
export const BUSINESS_FILL = "#4F46E5";
