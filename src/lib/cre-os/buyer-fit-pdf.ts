/**
 * Buyer-fit assessment PDF generator.
 *
 * One letter-page deliverable that maps a property against a specific
 * buyer's criteria. Heavy emphasis on the lease-up + mark-to-market
 * financial model (stabilized NOI, value upside) since that's what
 * value-add buyers actually underwrite on.
 *
 * Brand-consistent: uses the same color palette + type system as the
 * existing report-generator.ts.
 *
 * Input is a property snapshot (from properties table) plus buyer criteria
 * the broker enters. Output is a Uint8Array of PDF bytes ready to stream
 * back as application/pdf.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type RGB = [number, number, number];

const C: Record<string, RGB> = {
  page: [10, 22, 21],
  panel: [20, 40, 39],
  panelHi: [26, 39, 38],
  hairline: [56, 56, 56],
  coral: [224, 122, 95],
  teal: [78, 205, 196],
  cream: [250, 248, 245],
  creamDim: [212, 206, 196],
  muted: [129, 129, 129],
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 36;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const fmt = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtSF = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => n.toFixed(1) + "%";

export interface BuyerCriteria {
  /** Buyer name or label, e.g. "John Smith @ ABC Capital" */
  buyerLabel?: string;
  assetTypes?: string[]; // e.g. ["Retail", "Industrial"]
  minSqft?: number;
  maxSqft?: number;
  maxPrice?: number;
  /** Free-text descriptions, e.g. "value add through lease-up, below-market rents, adaptable use" */
  thesesText?: string;
}

export interface PropertySnapshot {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  assetType: string | null;
  subType?: string | null;
  yearBuilt: number | null;
  sqft: number | null;
  askingPrice: number | null;
  noi: number | null;
  capRate: number | null; // stored as decimal (0.086 = 8.6%)
  occupancyPct: number | null; // decimal
  description: string | null;
  /** Optional broker overrides for the model assumptions */
  marketRentPerSf?: number;
  markToMarketLiftPerSf?: number;
}

interface AssessmentInputs {
  property: PropertySnapshot;
  criteria: BuyerCriteria;
  /** Default market rent/SF NNN assumed for lease-up modeling.
   *  For Merrillville inline retail, $14-18 is reasonable. */
  defaultMarketRentPerSf?: number;
  /** Default mark-to-market lift per SF on rollover */
  defaultMarkToMarketLiftPerSf?: number;
  /** Stabilized cap-rate used to compute value (decimal, e.g. 0.08) */
  exitCapRate?: number;
}

interface RentUpsideModel {
  totalSf: number;
  occupiedSf: number;
  vacantSf: number;
  occupancyPct: number;
  inPlaceNoi: number;
  noiPerSf: number;
  marketRentPerSf: number;
  markToMarketLiftPerSf: number;
  stabilizedOccPct: number;
  stabilizedNoi: number;
  combinedNoi: number;
  yieldOnCost: { inPlace: number; stabilized: number; combined: number };
  exitCapRate: number;
  exitValueInPlace: number;
  exitValueStabilized: number;
  exitValueCombined: number;
  upsideAbsolute: number;
  upsidePct: number;
}

function buildRentUpsideModel(
  property: PropertySnapshot,
  inputs: AssessmentInputs
): RentUpsideModel | null {
  const totalSf = property.sqft ?? 0;
  if (totalSf <= 0) return null;
  const occupancyPct = property.occupancyPct ?? 0.87;
  const occupiedSf = Math.round(totalSf * occupancyPct);
  const vacantSf = totalSf - occupiedSf;

  const inPlaceNoi = property.noi ?? 0;
  const noiPerSf = occupiedSf > 0 ? inPlaceNoi / occupiedSf : 0;

  const marketRentPerSf =
    property.marketRentPerSf ?? inputs.defaultMarketRentPerSf ?? 14;
  const markToMarketLiftPerSf =
    property.markToMarketLiftPerSf ?? inputs.defaultMarkToMarketLiftPerSf ?? 3;

  // Stabilization: assume the broker can lease vacancy to 95% at market rent
  const stabilizedOccPct = 0.95;
  const newLeaseSf = Math.max(0, Math.round(totalSf * stabilizedOccPct) - occupiedSf);
  // Net incremental NOI from new leases — approximating that market rent
  // less reasonable strip-center expense load (~25%) ≈ net to NOI line.
  const newLeaseIncrementalNoi = newLeaseSf * marketRentPerSf * 0.75;
  const stabilizedNoi = inPlaceNoi + newLeaseIncrementalNoi;

  // Mark-to-market on roll: assume ~60% of in-place roster rolls in 3 yrs
  // and resets by the lift amount.
  const rolloverSf = Math.round(occupiedSf * 0.6);
  const markToMarketLift = rolloverSf * markToMarketLiftPerSf;
  const combinedNoi = stabilizedNoi + markToMarketLift;

  const exitCapRate = inputs.exitCapRate ?? 0.08;
  const price = property.askingPrice ?? 0;
  const exitValueInPlace = price; // baseline
  const exitValueStabilized = stabilizedNoi / exitCapRate;
  const exitValueCombined = combinedNoi / exitCapRate;
  const upsideAbsolute = exitValueCombined - price;
  const upsidePct = price > 0 ? (upsideAbsolute / price) * 100 : 0;

  return {
    totalSf,
    occupiedSf,
    vacantSf,
    occupancyPct,
    inPlaceNoi,
    noiPerSf,
    marketRentPerSf,
    markToMarketLiftPerSf,
    stabilizedOccPct,
    stabilizedNoi,
    combinedNoi,
    yieldOnCost: {
      inPlace: price > 0 ? (inPlaceNoi / price) * 100 : 0,
      stabilized: price > 0 ? (stabilizedNoi / price) * 100 : 0,
      combined: price > 0 ? (combinedNoi / price) * 100 : 0,
    },
    exitCapRate,
    exitValueInPlace,
    exitValueStabilized,
    exitValueCombined,
    upsideAbsolute,
    upsidePct,
  };
}

// ── Page primitives ────────────────────────────────────────
function setFill(doc: jsPDF, color: RGB) {
  doc.setFillColor(color[0], color[1], color[2]);
}
function setText(doc: jsPDF, color: RGB) {
  doc.setTextColor(color[0], color[1], color[2]);
}
function setDraw(doc: jsPDF, color: RGB) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function rule(doc: jsPDF, y: number) {
  setDraw(doc, C.hairline);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
}

function eyebrow(doc: jsPDF, text: string, y: number, color: RGB = C.coral) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setText(doc, color);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).setCharSpace(1.4);
  doc.text(text.toUpperCase(), MARGIN_X, y);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).setCharSpace(0);
}

function bodyText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options: { size?: number; color?: RGB; bold?: boolean; lineHeight?: number } = {}
): number {
  const size = options.size ?? 9;
  const lineHeight = options.lineHeight ?? size * 1.35;
  doc.setFont("helvetica", options.bold ? "bold" : "normal");
  doc.setFontSize(size);
  setText(doc, options.color ?? C.cream);
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

export function generateBuyerFitPdf(inputs: AssessmentInputs): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { property, criteria } = inputs;
  const model = buildRentUpsideModel(property, inputs);

  // Page background
  setFill(doc, C.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // ── Header ───────────────────────────────────────────────
  let y = 50;
  eyebrow(doc, "Stewardship CRE · Buyer-Fit Assessment", y);
  y += 10;
  doc.setFont("times", "normal");
  doc.setFontSize(22);
  setText(doc, C.cream);
  doc.text(property.name, MARGIN_X, y + 12);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, C.creamDim);
  const addressLine = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(" · ");
  doc.text(addressLine, MARGIN_X, y + 10);
  y += 18;

  if (criteria.buyerLabel) {
    doc.setFontSize(8);
    setText(doc, C.muted);
    doc.text(`Prepared for ${criteria.buyerLabel}`, MARGIN_X, y);
    y += 12;
  }
  rule(doc, y);
  y += 14;

  // ── Asset snapshot ───────────────────────────────────────
  eyebrow(doc, "Asset Snapshot", y);
  y += 10;
  const snapshotRows: [string, string][] = [
    ["Asset class", `${property.assetType ?? "—"}${property.subType ? " · " + property.subType : ""}`],
    ["Size", property.sqft ? `${fmtSF(property.sqft)} SF` : "—"],
    ["Year built", property.yearBuilt ? String(property.yearBuilt) : "—"],
    ["Asking price", property.askingPrice ? fmt(property.askingPrice) : "—"],
    ["In-place NOI", property.noi ? fmt(property.noi) : "—"],
    ["Cap rate (in-place)", property.capRate ? fmtPct(property.capRate * 100) : "—"],
    ["Occupancy", property.occupancyPct ? fmtPct(property.occupancyPct * 100) : "—"],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [],
    body: snapshotRows,
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 2, right: 4, bottom: 2, left: 0 },
      textColor: [C.cream[0], C.cream[1], C.cream[2]],
      lineColor: [C.hairline[0], C.hairline[1], C.hairline[2]],
      lineWidth: 0.25,
    },
    columnStyles: {
      0: {
        cellWidth: 130,
        fontStyle: "normal",
        textColor: [C.muted[0], C.muted[1], C.muted[2]],
      },
      1: { cellWidth: CONTENT_W - 130, fontStyle: "bold" },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 12;

  // ── Rent upside model (the meat) ─────────────────────────
  if (model) {
    eyebrow(doc, "Rent upside model — stabilization + mark to market", y);
    y += 10;

    const modelRows: string[][] = [
      ["", "SF", "NOI", "Yield on price", "Value at exit cap"],
      [
        "Current (in-place)",
        fmtSF(model.occupiedSf),
        fmt(model.inPlaceNoi),
        fmtPct(model.yieldOnCost.inPlace),
        fmt(model.exitValueInPlace),
      ],
      [
        `Stabilized (${(model.stabilizedOccPct * 100).toFixed(0)}% leased @ ${fmt(model.marketRentPerSf)}/SF NNN)`,
        fmtSF(Math.round(model.totalSf * model.stabilizedOccPct)),
        fmt(model.stabilizedNoi),
        fmtPct(model.yieldOnCost.stabilized),
        fmt(model.exitValueStabilized),
      ],
      [
        `+ Mark to market on roll (avg +${fmt(model.markToMarketLiftPerSf)}/SF on ~60% of roster)`,
        fmtSF(Math.round(model.totalSf * model.stabilizedOccPct)),
        fmt(model.combinedNoi),
        fmtPct(model.yieldOnCost.combined),
        fmt(model.exitValueCombined),
      ],
    ];
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_X, right: MARGIN_X },
      head: [modelRows[0]],
      body: modelRows.slice(1),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 4,
        textColor: [C.cream[0], C.cream[1], C.cream[2]],
        lineColor: [C.hairline[0], C.hairline[1], C.hairline[2]],
        lineWidth: 0.4,
      },
      headStyles: {
        fillColor: [C.panel[0], C.panel[1], C.panel[2]],
        textColor: [C.creamDim[0], C.creamDim[1], C.creamDim[2]],
        fontStyle: "bold",
        fontSize: 7.5,
      },
      bodyStyles: { fillColor: [C.page[0], C.page[1], C.page[2]] },
      alternateRowStyles: { fillColor: [C.panelHi[0], C.panelHi[1], C.panelHi[2]] },
      didParseCell: (data) => {
        // Bold the third "combined" row to highlight peak value
        if (data.section === "body" && data.row.index === 2) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = [C.teal[0], C.teal[1], C.teal[2]];
        }
      },
      columnStyles: {
        0: { cellWidth: 240, halign: "left" },
        1: { cellWidth: 60, halign: "right" },
        2: { cellWidth: 80, halign: "right" },
        3: { cellWidth: 70, halign: "right" },
        4: { cellWidth: 80, halign: "right" },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;

    // Upside callout
    setFill(doc, C.panel);
    doc.rect(MARGIN_X, y, CONTENT_W, 26, "F");
    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      `Combined upside: +${fmt(model.upsideAbsolute)} (${fmtPct(model.upsidePct)}) over ~3-yr execution at ${fmtPct(model.exitCapRate * 100)} exit cap`,
      MARGIN_X + 10,
      y + 17
    );
    y += 36;
  }

  // ── Underperforming tenants (rent roll review) ───────────
  eyebrow(doc, "Underperforming tenants — confirm via rent roll", y);
  y += 10;
  const tenantPlaceholder =
    "Pre-DD signals from the property data suggest these candidates are likely below market. Specific identification + dollar quantification requires rent roll review:";
  y = bodyText(doc, tenantPlaceholder, MARGIN_X, y, CONTENT_W, { size: 8.5, color: C.creamDim });
  y += 4;
  const bullets = [
    "Original tenants from initial lease-up (vintage 1987-1995 leases) — typically 30-50% below current market on a strip-center reset.",
    "Quick-service food at sub-$15/SF NNN — Merrillville comps support $20-26/SF for QSR.",
    "Service tenants (beauty, salons) at sub-$12/SF — submarket clears $14-18/SF.",
    "Any tenant with sub-3% annual escalators — material reset opportunity at renewal.",
  ];
  for (const b of bullets) {
    setText(doc, C.coral);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("•", MARGIN_X + 2, y);
    y = bodyText(doc, b, MARGIN_X + 12, y, CONTENT_W - 12, { size: 8.5, color: C.cream });
    y += 2;
  }
  y += 8;

  // ── Buyer criteria match ─────────────────────────────────
  eyebrow(doc, "Match against your criteria", y);
  y += 10;
  const matchRows = buildCriteriaMatch(property, criteria);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Your filter", "Liberty Square", "Fit"]],
    body: matchRows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3.5,
      textColor: [C.cream[0], C.cream[1], C.cream[2]],
      lineColor: [C.hairline[0], C.hairline[1], C.hairline[2]],
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: [C.panel[0], C.panel[1], C.panel[2]],
      textColor: [C.creamDim[0], C.creamDim[1], C.creamDim[2]],
      fontStyle: "bold",
      fontSize: 7.5,
    },
    bodyStyles: { fillColor: [C.page[0], C.page[1], C.page[2]] },
    alternateRowStyles: { fillColor: [C.panelHi[0], C.panelHi[1], C.panelHi[2]] },
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 290 },
      2: { cellWidth: 60, halign: "center", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2) {
        const v = String(data.cell.raw ?? "");
        if (v.startsWith("✓")) data.cell.styles.textColor = [C.teal[0], C.teal[1], C.teal[2]];
      }
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 12;

  // ── Footer ──────────────────────────────────────────────
  rule(doc, y);
  y += 12;
  setText(doc, C.muted);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Stewardship CRE · John Mathewson · (219) 781-9547 · inquiries@stewardshipcre.com",
    MARGIN_X,
    y
  );
  doc.text(
    `Prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    PAGE_W - MARGIN_X,
    y,
    { align: "right" }
  );

  return new Uint8Array(doc.output("arraybuffer"));
}

function buildCriteriaMatch(
  property: PropertySnapshot,
  criteria: BuyerCriteria
): string[][] {
  const rows: string[][] = [];

  if (criteria.assetTypes && criteria.assetTypes.length > 0) {
    const ours = (property.assetType ?? "").toLowerCase();
    const match = criteria.assetTypes.some((t) => t.toLowerCase().includes(ours) || ours.includes(t.toLowerCase()));
    rows.push([
      `Asset class: ${criteria.assetTypes.join(" / ")}`,
      `${property.assetType ?? "—"}${property.subType ? " · " + property.subType : ""}`,
      match ? "✓" : "—",
    ]);
  }

  if (criteria.minSqft != null || criteria.maxSqft != null) {
    const min = criteria.minSqft ?? 0;
    const max = criteria.maxSqft ?? Infinity;
    const sqft = property.sqft ?? 0;
    const fit = sqft >= min && sqft <= max;
    const filter = `${criteria.minSqft != null ? fmtSF(criteria.minSqft) : "0"}–${criteria.maxSqft != null ? fmtSF(criteria.maxSqft) : "∞"} SF`;
    rows.push([
      `Size: ${filter}`,
      property.sqft ? `${fmtSF(property.sqft)} SF` : "—",
      fit ? "✓" : "—",
    ]);
  }

  if (criteria.maxPrice != null) {
    const ours = property.askingPrice ?? 0;
    const fit = ours > 0 && ours <= criteria.maxPrice;
    const headroom = criteria.maxPrice - ours;
    rows.push([
      `Price ceiling: ${fmt(criteria.maxPrice)}`,
      property.askingPrice ? `${fmt(property.askingPrice)} (${fmt(headroom)} headroom)` : "—",
      fit ? "✓" : "—",
    ]);
  }

  if (criteria.thesesText) {
    // Tokenize thesesText to look for specific value-add signals
    const text = criteria.thesesText.toLowerCase();
    const occ = property.occupancyPct ?? 1;
    const vacantSf = (property.sqft ?? 0) * (1 - occ);
    if (text.includes("lease") && text.includes("up")) {
      rows.push([
        "Value-add: lease-up upside",
        `${fmtPct((1 - occ) * 100)} vacancy · ~${fmtSF(vacantSf)} SF available`,
        occ < 0.95 ? "✓" : "—",
      ]);
    }
    if (text.includes("below") && text.includes("rent")) {
      rows.push([
        "Below-market rents",
        "Multi-vintage roster on 1987 build — mark-to-market opportunity confirmable via rent roll",
        "✓",
      ]);
    }
    if (text.includes("adapt") || text.includes("flex")) {
      rows.push([
        "Adaptable use",
        "Suite-by-suite reuse across medical / F&B / fitness / service on 35K VPD corridor near Southlake Mall",
        "✓",
      ]);
    }
  }

  return rows;
}
