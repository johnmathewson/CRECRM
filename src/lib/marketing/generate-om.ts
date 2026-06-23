/**
 * Offering Memorandum PDF generator.
 *
 * Matches the Liberty Square / Super 8 template extracted from John's
 * existing OMs (May 2026). Letter portrait, white page background,
 * dark teal #2D3B3A + bronze/gold #A67C52 accents, Helvetica.
 *
 * Section layout (section-aware — empty/N/A sections are skipped):
 *   1. Cover — stacked big-letter property name + tagline + brand
 *   2. Disclaimer + Exclusively Listed By (broker contact card)
 *   3. Table of Contents — numbered with live page refs
 *   4. Executive Summary — Property Overview sidebar + narrative
 *   5. Investment Highlights — big callouts + bulleted highlights +
 *      demographics + traffic counts (when data is available)
 *   6. Rent Roll — full tenant table (SKIPPED for vacant properties)
 *   7. Financial Summary — Income/Expense + Returns + Value-Add +
 *      Stabilized projection (or pro-forma for vacant)
 *   8. Comparable Sales — comp table + subject row + market range +
 *      analysis paragraph
 *   9. Property Overview — Parcel table + Building/Roof/HVAC/Site
 *      narrative
 *   10. Market Overview — Submarket narrative + Area Highlights +
 *       Proximity table
 *   11. Back Cover — Big broker contact card on dark teal background
 *
 * The previous generator was dark editorial; this one is light + teal/
 * bronze to match the existing template. Don't merge the two — the
 * brand is the brand.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { MarketingPropertyContext } from "./property-context";

type RGB = [number, number, number];

// Brand palette — extracted from Liberty Square OM (May 2026 ship).
const C: Record<string, RGB> = {
  white: [255, 255, 255],
  page: [255, 255, 255],
  teal: [45, 59, 58],          // #2D3B3A — primary dark teal
  tealDim: [70, 86, 84],       // softer teal for body emphasis
  bronze: [166, 124, 82],      // #A67C52 — bronze/gold accent
  bronzeDim: [200, 168, 134],  // lighter bronze
  cream: [247, 245, 240],      // #F7F5F0 — soft fill
  creamHi: [240, 237, 228],    // #F0EDE4 — alt rows
  ink: [58, 58, 58],           // #3A3A3A — body text
  inkSoft: [110, 110, 110],    // muted text
  hairline: [220, 218, 212],   // light borders
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// ── Formatting helpers ───────────────────────────────────────────────────

const fmtMoney = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  if (num <= 0) return "—";
  if (num >= 1_000_000) return "$" + (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return "$" + Math.round(num / 1_000) + "K";
  return "$" + num.toLocaleString();
};
const fmtMoneyExact = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const fmtSF = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
};
const fmtPct = (n: number | null | undefined, places = 2) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return (Number(n) * 100).toFixed(places) + "%";
};

function setFill(doc: jsPDF, rgb: RGB) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setText(doc: jsPDF, rgb: RGB) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc: jsPDF, rgb: RGB) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function paintWhitePage(doc: jsPDF) {
  setFill(doc, C.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

/** Wrap text and return the post-block y cursor. */
function drawParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options: { size?: number; color?: RGB; lineHeight?: number; maxWidth?: number; bold?: boolean } = {}
): number {
  const size = options.size ?? 8.5;
  const color = options.color ?? C.ink;
  const lineHeight = options.lineHeight ?? size * 1.45;
  const width = options.maxWidth ?? CONTENT_W;
  setText(doc, color);
  doc.setFont("helvetica", options.bold ? "bold" : "normal");
  doc.setFontSize(size);
  const lines: string[] = doc.splitTextToSize(text, width);
  let cy = y;
  for (const ln of lines) {
    doc.text(ln, x, cy);
    cy += lineHeight;
  }
  return cy;
}

function drawSectionTitle(doc: jsPDF, text: string, x: number, y: number, color: RGB = C.teal) {
  setText(doc, color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(text.toUpperCase(), x, y);
}

function drawSubhead(doc: jsPDF, text: string, x: number, y: number, color: RGB = C.bronze) {
  setText(doc, color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(text.toUpperCase(), x, y, { charSpace: 0.6 });
}

function drawLabel(doc: jsPDF, text: string, x: number, y: number, color: RGB = C.inkSoft) {
  setText(doc, color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(text.toUpperCase(), x, y, { charSpace: 0.9 });
}

/** Bulleted list. */
function drawBullets(
  doc: jsPDF,
  bullets: string[],
  x: number,
  y: number,
  options: { size?: number; color?: RGB; bulletColor?: RGB; lineHeight?: number; maxWidth?: number } = {}
): number {
  const size = options.size ?? 8.5;
  const color = options.color ?? C.ink;
  const bulletColor = options.bulletColor ?? C.bronze;
  const lineHeight = options.lineHeight ?? size * 1.5;
  const indent = 10;
  const maxWidth = (options.maxWidth ?? CONTENT_W) - indent;
  let cy = y;
  for (const b of bullets) {
    setText(doc, bulletColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text("•", x, cy);
    setText(doc, color);
    doc.setFont("helvetica", "normal");
    const lines: string[] = doc.splitTextToSize(b, maxWidth);
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i], x + indent, cy + i * lineHeight);
    }
    cy += Math.max(lineHeight, lines.length * lineHeight);
  }
  return cy;
}

// ── PAGE 1: COVER ────────────────────────────────────────────────────────

function drawCover(doc: jsPDF, ctx: MarketingPropertyContext) {
  paintWhitePage(doc);
  const p = ctx.property;

  // Top bronze hairline
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, 64, 48, 2, "F");

  // Brand mark
  setText(doc, C.teal);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("eXp COMMERCIAL  ·  NORTHWEST INDIANA", MARGIN_X, 56, { charSpace: 1.2 });

  // Stacked big-letter property name — split into words, each line big
  setText(doc, C.teal);
  doc.setFont("helvetica", "bold");
  const propertyName = (p.name ?? "Property").toUpperCase();
  // Hero size: big and confident. Wrap if too wide.
  doc.setFontSize(56);
  const heroLines: string[] = doc.splitTextToSize(propertyName, CONTENT_W);
  let cy = 180;
  for (const ln of heroLines) {
    doc.text(ln, MARGIN_X, cy);
    cy += 60;
  }

  // Tagline / asset descriptor
  if (p.headline) {
    setText(doc, C.tealDim);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const taglineLines: string[] = doc.splitTextToSize(
      p.headline.toUpperCase(),
      CONTENT_W
    );
    for (const ln of taglineLines) {
      doc.text(ln, MARGIN_X, cy + 12);
      cy += 16;
    }
  }

  // Address
  cy += 14;
  setText(doc, C.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const addressBits = [p.address, [p.city, p.state, p.zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("  |  ");
  if (addressBits) {
    doc.text(addressBits.toUpperCase(), MARGIN_X, cy, { charSpace: 0.5 });
  }

  // Bottom: brand strip
  const bottomY = PAGE_H - 96;
  setFill(doc, C.teal);
  doc.rect(0, bottomY, PAGE_W, PAGE_H - bottomY, "F");

  setText(doc, C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("eXp", MARGIN_X, bottomY + 36, { charSpace: 0.5 });

  setText(doc, C.bronze);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("COMMERCIAL", MARGIN_X, bottomY + 54, { charSpace: 1.5 });

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("OFFERING MEMORANDUM", PAGE_W - MARGIN_X, bottomY + 32, {
    align: "right",
    charSpace: 1.5,
  });
}

// ── PAGE 2: DISCLAIMER + LISTED BY ───────────────────────────────────────

function drawDisclaimerPage(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);

  let cy = MARGIN_TOP + 20;

  drawSubhead(doc, "Confidentiality & Disclaimer", MARGIN_X, cy, C.teal);
  cy += 22;

  const disclaimer =
    "eXp Commercial has been engaged by the owner of the property to market it for sale. " +
    "Information concerning the property described herein has been obtained from sources other than the Owner, " +
    "and neither Owner nor eXp Commercial makes any representations or warranties, express " +
    "or implied, as to the accuracy or completeness of such information. Any and all reference to age, square " +
    "footage, income, expenses and any other property specific information are approximate. Prospective purchasers " +
    "should conduct their own independent investigation and rely on those results. The Property may be withdrawn " +
    "without notice.";

  cy = drawParagraph(doc, disclaimer, MARGIN_X, cy, {
    size: 8,
    color: C.ink,
    lineHeight: 12.5,
  });

  // Exclusively listed by — full-bleed teal panel mid-page
  const panelY = cy + 36;
  const panelH = 140;
  setFill(doc, C.teal);
  doc.rect(MARGIN_X, panelY, CONTENT_W, panelH, "F");

  // Bronze hairline divider top of panel
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X + 24, panelY + 20, 32, 1.5, "F");

  setText(doc, C.bronze);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("EXCLUSIVELY LISTED BY", MARGIN_X + 24, panelY + 38, { charSpace: 1.2 });

  setText(doc, C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("JOHN MATHEWSON", MARGIN_X + 24, panelY + 68);

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Commercial Real Estate Broker", MARGIN_X + 24, panelY + 84);
  doc.text("eXp Commercial", MARGIN_X + 24, panelY + 98);
  doc.text("john@johnmathewson.co", MARGIN_X + 24, panelY + 114);
}

// ── PAGE 3: TABLE OF CONTENTS ────────────────────────────────────────────

interface TocEntry {
  title: string;
  pageNumber: number;
}

function drawToc(doc: jsPDF, entries: TocEntry[]) {
  doc.addPage();
  paintWhitePage(doc);

  let cy = MARGIN_TOP + 20;
  drawSectionTitle(doc, "Table of Contents", MARGIN_X, cy + 32);
  cy += 92;

  // Bronze hairline
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, cy - 24, 48, 1.5, "F");

  // Two-column grid: 2-3 entries per row
  const colW = CONTENT_W / 3;
  const rowH = 96;
  for (let i = 0; i < entries.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const ex = MARGIN_X + col * colW;
    const ey = cy + row * rowH;

    setText(doc, C.bronze);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    doc.text(String(entries[i].pageNumber).padStart(2, "0"), ex, ey);

    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const titleLines: string[] = doc.splitTextToSize(
      entries[i].title.toUpperCase(),
      colW - 16
    );
    let ty = ey + 22;
    for (const ln of titleLines) {
      doc.text(ln, ex, ty, { charSpace: 0.8 });
      ty += 12;
    }
  }
}

// ── PAGE 4: EXECUTIVE SUMMARY ────────────────────────────────────────────

function drawExecutiveSummary(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);
  const p = ctx.property;

  // Bronze hairline + section title at top
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Property Overview", MARGIN_X, MARGIN_TOP + 6);

  const headerBottom = MARGIN_TOP + 40;

  // Left sidebar: facts grid (~36% of width)
  const sidebarW = CONTENT_W * 0.34;
  const sidebarX = MARGIN_X;
  const sidebarY = headerBottom + 20;

  // Sidebar background: cream
  setFill(doc, C.cream);
  doc.rect(sidebarX, sidebarY, sidebarW, PAGE_H - sidebarY - MARGIN_BOTTOM - 20, "F");

  const sidebarInner = sidebarX + 14;
  let sy = sidebarY + 26;

  // LOCATION sub-section
  drawSubhead(doc, "Location", sidebarInner, sy, C.teal);
  sy += 16;
  setDraw(doc, C.bronze);
  doc.setLineWidth(0.8);
  doc.line(sidebarInner, sy - 8, sidebarInner + 24, sy - 8);

  const locationFacts: Array<[string, string]> = [];
  if (p.address) locationFacts.push(["Address", p.address]);
  if (p.city || p.state) {
    locationFacts.push([
      "City, State",
      [p.city, p.state, p.zip].filter(Boolean).join(", "),
    ]);
  }
  if (p.market_name) locationFacts.push(["Metro Area", p.market_name]);
  else if (p.county) locationFacts.push(["County", `${p.county} County`]);

  for (const [k, v] of locationFacts) {
    drawLabel(doc, k, sidebarInner, sy, C.inkSoft);
    sy += 11;
    setText(doc, C.ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const vlines: string[] = doc.splitTextToSize(v, sidebarW - 28);
    for (const ln of vlines) {
      doc.text(ln, sidebarInner, sy);
      sy += 10;
    }
    sy += 8;
  }

  sy += 8;

  // PROPERTY sub-section
  drawSubhead(doc, "Property", sidebarInner, sy, C.teal);
  sy += 16;
  doc.line(sidebarInner, sy - 8, sidebarInner + 24, sy - 8);

  const propertyFacts: Array<[string, string]> = [];
  if (p.year_built) propertyFacts.push(["Year Built", String(p.year_built)]);
  if (p.occupancy_pct !== null && p.occupancy_pct !== undefined) {
    propertyFacts.push(["Occupancy", fmtPct(Number(p.occupancy_pct), 1)]);
  }
  if (p.sqft) propertyFacts.push(["Square Feet", fmtSF(p.sqft)]);
  if (p.acreage) propertyFacts.push(["Acres", Number(p.acreage).toFixed(2)]);
  if (p.number_of_stories) propertyFacts.push(["Stories", String(p.number_of_stories)]);
  if (p.total_buildings) propertyFacts.push(["Buildings", String(p.total_buildings)]);
  if (p.zoning) propertyFacts.push(["Zoning", String(p.zoning)]);
  if (p.parking_spaces) propertyFacts.push(["Parking", fmtSF(p.parking_spaces) + " spaces"]);
  if (p.noi) propertyFacts.push(["In-Place NOI", fmtMoneyExact(Number(p.noi))]);
  if (p.cap_rate) propertyFacts.push(["Cap Rate", fmtPct(Number(p.cap_rate), 2)]);
  if (p.asking_price) propertyFacts.push(["Asking Price", fmtMoney(Number(p.asking_price))]);

  for (const [k, v] of propertyFacts) {
    drawLabel(doc, k, sidebarInner, sy, C.inkSoft);
    sy += 11;
    setText(doc, C.ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(v, sidebarInner, sy);
    sy += 16;
  }

  // Right column: Executive Summary narrative (~62% of width)
  const narX = sidebarX + sidebarW + 22;
  const narW = CONTENT_W - sidebarW - 22;
  let ny = sidebarY + 26;

  drawSubhead(doc, "Executive Summary", narX, ny, C.bronze);
  ny += 22;

  if (p.description) {
    ny = drawParagraph(doc, p.description, narX, ny, {
      size: 9,
      color: C.ink,
      lineHeight: 13.5,
      maxWidth: narW,
    });
    ny += 14;
  }

  // Embed top investment highlights as supporting bullets
  const ih: string[] = Array.isArray(p.investment_highlights) ? p.investment_highlights : [];
  if (ih.length > 0) {
    drawLabel(doc, "Key Points", narX, ny, C.teal);
    ny += 14;
    drawBullets(doc, ih.slice(0, 4), narX, ny, {
      size: 8.5,
      color: C.ink,
      bulletColor: C.bronze,
      lineHeight: 13,
      maxWidth: narW,
    });
  }
}

// ── PAGE 5: INVESTMENT HIGHLIGHTS ────────────────────────────────────────

function drawInvestmentHighlights(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);
  const p = ctx.property;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const px = p as any;
  const isLease = px.transaction_type === "lease";

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, isLease ? "Lease Highlights" : "Investment Highlights", MARGIN_X, MARGIN_TOP + 6);

  let cy = MARGIN_TOP + 56;

  // Big number callout strip — different anchors per mode.
  // Sale: asking price + cap rate. Lease: lease rate + available SF.
  const calloutY = cy;

  if (isLease) {
    const rateValue = p.lease_rate ? "$" + Number(p.lease_rate).toFixed(2) + "/SF" : "—";
    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(34);
    doc.text(rateValue, MARGIN_X, calloutY);

    if (px.available_sf) {
      setText(doc, C.bronze);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      doc.text(fmtSF(px.available_sf) + " SF", MARGIN_X + 220, calloutY);
      setText(doc, C.inkSoft);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("AVAILABLE", MARGIN_X + 220, calloutY + 14, { charSpace: 1 });
    }

    setText(doc, C.inkSoft);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(
      px.lease_type ? `LEASE RATE · ${String(px.lease_type).toUpperCase().replace(/_/g, " ")}` : "LEASE RATE",
      MARGIN_X,
      calloutY + 14,
      { charSpace: 1 }
    );
  } else {
    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(34);
    doc.text(fmtMoney(p.asking_price ? Number(p.asking_price) : null), MARGIN_X, calloutY);

    if (p.cap_rate) {
      setText(doc, C.bronze);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      doc.text(fmtPct(Number(p.cap_rate), 2), MARGIN_X + 220, calloutY);
      setText(doc, C.inkSoft);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("IN-PLACE CAP RATE", MARGIN_X + 220, calloutY + 14, { charSpace: 1 });
    }

    setText(doc, C.inkSoft);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("ASKING PRICE", MARGIN_X, calloutY + 14, { charSpace: 1 });
  }

  cy = calloutY + 44;
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, cy, 48, 1.5, "F");
  cy += 24;

  // Bulleted investment highlights — two-column layout
  const ih: string[] = Array.isArray(p.investment_highlights) ? p.investment_highlights : [];
  const colW = (CONTENT_W - 24) / 2;
  if (ih.length > 0) {
    const leftBullets = ih.slice(0, Math.ceil(ih.length / 2));
    const rightBullets = ih.slice(Math.ceil(ih.length / 2));

    const startY = cy;
    let leftY = startY;
    let rightY = startY;
    for (const b of leftBullets) {
      // Each bullet: bronze title-style first line, then short body
      setText(doc, C.bronze);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const firstLine: string[] = doc.splitTextToSize(b, colW);
      doc.text(firstLine[0], MARGIN_X, leftY);
      leftY += 14;
      if (firstLine.length > 1) {
        setText(doc, C.ink);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        for (let i = 1; i < firstLine.length; i++) {
          doc.text(firstLine[i], MARGIN_X, leftY);
          leftY += 11;
        }
      }
      leftY += 8;
    }
    for (const b of rightBullets) {
      setText(doc, C.bronze);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const firstLine: string[] = doc.splitTextToSize(b, colW);
      doc.text(firstLine[0], MARGIN_X + colW + 24, rightY);
      rightY += 14;
      if (firstLine.length > 1) {
        setText(doc, C.ink);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        for (let i = 1; i < firstLine.length; i++) {
          doc.text(firstLine[i], MARGIN_X + colW + 24, rightY);
          rightY += 11;
        }
      }
      rightY += 8;
    }
  }
}

// ── PAGE 6: RENT ROLL (only if tenants exist) ────────────────────────────

interface RentRollRow {
  unit: string;
  tenant: string;
  sf: string;
  basePerSf: string;
  camPerSf: string;
  totalPerSf: string;
  baseMo: string;
  totalMo: string;
  expiration: string;
  type: string;
}

function drawRentRoll(doc: jsPDF, rows: RentRollRow[]) {
  if (rows.length === 0) return;
  doc.addPage();
  paintWhitePage(doc);

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Rent Roll", MARGIN_X, MARGIN_TOP + 6);

  autoTable(doc, {
    startY: MARGIN_TOP + 36,
    head: [["UNIT", "TENANT", "SF", "BASE/SF", "CAM/SF", "TOT/SF", "BASE/MO", "TOTAL/MO", "EXP.", "TYPE"]],
    body: rows.map((r) => [
      r.unit, r.tenant, r.sf, r.basePerSf, r.camPerSf, r.totalPerSf,
      r.baseMo, r.totalMo, r.expiration, r.type,
    ]),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 7, cellPadding: { top: 4, right: 4, bottom: 4, left: 4 }, textColor: C.ink },
    headStyles: { font: "helvetica", fontStyle: "bold", fontSize: 6.5, textColor: C.white, fillColor: C.teal, halign: "left" },
    alternateRowStyles: { fillColor: C.cream },
    margin: { left: MARGIN_X, right: MARGIN_X },
  });
}

// ── PAGE 7: FINANCIAL SUMMARY ────────────────────────────────────────────

function drawFinancialSummary(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);
  const p = ctx.property;
  const computed = ctx.computed;

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Financial Summary", MARGIN_X, MARGIN_TOP + 6);

  let cy = MARGIN_TOP + 52;
  const isVacant = !p.noi || (p.occupancy_pct !== null && Number(p.occupancy_pct) === 0);

  if (isVacant) {
    // Pro-forma layout for vacant / owner-user properties
    drawSubhead(doc, "Asking Price", MARGIN_X, cy, C.teal);
    cy += 18;
    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(34);
    doc.text(fmtMoney(p.asking_price ? Number(p.asking_price) : null), MARGIN_X, cy);

    if (computed.pricePerSf) {
      setText(doc, C.inkSoft);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`$${computed.pricePerSf.toFixed(2)}/SF on ${fmtSF(p.sqft)} SF`, MARGIN_X + 260, cy - 6);
    }

    cy += 36;

    drawSubhead(doc, "Pro-Forma Assumptions", MARGIN_X, cy, C.teal);
    cy += 22;

    const assumptions = [
      "The property is offered vacant. The pricing reflects an owner-user or value-add buyer who will underwrite occupancy from zero.",
      "No in-place rental income is represented. Buyers should construct their own pro-forma based on intended use (owner-occupy vs. multi-tenant lease-up).",
      "Acreage, zoning, and physical specifications are provided in the Property Overview section. Buyers are encouraged to confirm condition and capital-needs estimates through their own inspections.",
      "Annual property taxes, insurance, and operating expenses will be furnished upon request once a Confidentiality Agreement is executed.",
    ];
    for (const a of assumptions) {
      cy = drawParagraph(doc, a, MARGIN_X, cy, {
        size: 9,
        color: C.ink,
        lineHeight: 13.5,
      });
      cy += 10;
    }
  } else {
    // Income-property layout: Income / OpEx / Returns
    // Left column: Income + OpEx, Right column: Returns + Value-Add
    const colW = (CONTENT_W - 32) / 2;

    // INCOME (left)
    drawSubhead(doc, "Income", MARGIN_X, cy, C.teal);
    let leftY = cy + 18;
    const incomeRows: Array<[string, string]> = [];
    if (p.noi) incomeRows.push(["NOI (in-place)", fmtMoneyExact(Number(p.noi))]);
    leftY = renderTwoColTable(doc, incomeRows, MARGIN_X, leftY, colW);

    // OpEx is unknown right now — show placeholder
    leftY += 16;
    drawSubhead(doc, "Operating Expenses", MARGIN_X, leftY, C.teal);
    leftY += 18;
    setText(doc, C.inkSoft);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Full OpEx breakdown furnished upon request", MARGIN_X, leftY);

    // RETURNS (right)
    let rightY = cy + 18;
    const rightX = MARGIN_X + colW + 32;
    drawSubhead(doc, "Returns at Offering Price", rightX, cy, C.teal);
    const returnRows: Array<[string, string]> = [];
    if (p.asking_price) returnRows.push(["Offering Price", fmtMoneyExact(Number(p.asking_price))]);
    if (p.noi) returnRows.push(["NOI", fmtMoneyExact(Number(p.noi))]);
    if (p.cap_rate) returnRows.push(["Cap Rate", fmtPct(Number(p.cap_rate), 2)]);
    if (computed.pricePerSf) returnRows.push(["Price per SF", "$" + computed.pricePerSf.toFixed(2)]);
    rightY = renderTwoColTable(doc, returnRows, rightX, rightY, colW);
  }
}

function renderTwoColTable(
  doc: jsPDF,
  rows: Array<[string, string]>,
  x: number,
  y: number,
  totalW: number
): number {
  let cy = y;
  for (const [label, value] of rows) {
    setText(doc, C.ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(label, x, cy);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + totalW, cy, { align: "right" });
    cy += 14;
    setDraw(doc, C.hairline);
    doc.setLineWidth(0.4);
    doc.line(x, cy - 6, x + totalW, cy - 6);
  }
  return cy;
}

// ── PAGE 8: COMPARABLE SALES ─────────────────────────────────────────────

function drawComparableSales(doc: jsPDF, ctx: MarketingPropertyContext) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saleComps: any[] = (ctx as any).saleComps ?? [];
  const p = ctx.property;
  if (saleComps.length === 0) return;

  doc.addPage();
  paintWhitePage(doc);

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Comparable Sales", MARGIN_X, MARGIN_TOP + 6);

  const rows = saleComps.slice(0, 8).map((c, i) => {
    const ref = `C${i + 1}`;
    const addr = c.address ?? "—";
    const city = c.city ?? "—";
    const sf = c.sqft ? fmtSF(c.sqft) : "—";
    const price = c.sale_price ? fmtMoneyExact(c.sale_price) : "—";
    const ppsf = c.price_per_sqft ? "$" + Number(c.price_per_sqft).toFixed(2) : "—";
    const cap = c.cap_rate ? fmtPct(Number(c.cap_rate), 2) : "—";
    const date = c.sale_date
      ? new Date(c.sale_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "—";
    return [ref, addr, city, sf, price, ppsf, cap, date];
  });

  // Subject row appended at bottom
  rows.push([
    "SUBJECT",
    p.address ?? p.name ?? "—",
    p.city ?? "—",
    p.sqft ? fmtSF(p.sqft) : "—",
    p.asking_price ? fmtMoneyExact(Number(p.asking_price)) : "—",
    ctx.computed.pricePerSf ? "$" + ctx.computed.pricePerSf.toFixed(2) : "—",
    p.cap_rate ? fmtPct(Number(p.cap_rate), 2) : "—",
    "Current",
  ]);

  autoTable(doc, {
    startY: MARGIN_TOP + 36,
    head: [["REF", "ADDRESS", "CITY", "SF", "PRICE", "$/SF", "CAP", "DATE"]],
    body: rows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: { top: 5, right: 4, bottom: 5, left: 4 }, textColor: C.ink },
    headStyles: { font: "helvetica", fontStyle: "bold", fontSize: 7, textColor: C.white, fillColor: C.teal, halign: "left" },
    alternateRowStyles: { fillColor: C.cream },
    didParseCell: (data) => {
      // Highlight the subject row
      if (data.row.index === rows.length - 1 && data.section === "body") {
        data.cell.styles.fillColor = C.creamHi;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = C.teal;
      }
    },
    margin: { left: MARGIN_X, right: MARGIN_X },
  });
}

// ── PAGE 9: PROPERTY OVERVIEW ────────────────────────────────────────────

function drawPropertyOverview(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);
  const p = ctx.property;

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Property Overview", MARGIN_X, MARGIN_TOP + 6);

  let cy = MARGIN_TOP + 52;

  if (p.apn || p.total_buildings) {
    drawSubhead(doc, "Parcel Overview", MARGIN_X, cy, C.teal);
    cy += 18;

    const parcelRows: string[][] = [];
    parcelRows.push([
      p.apn ?? "—",
      p.name ?? "—",
      p.sqft ? fmtSF(p.sqft) : "—",
      p.acreage ? Number(p.acreage).toFixed(2) : "—",
      p.year_built ? String(p.year_built) : "—",
    ]);
    autoTable(doc, {
      startY: cy,
      head: [["PARCEL #", "BUILDING / NOTES", "SF", "ACREAGE", "YEAR BUILT"]],
      body: parcelRows,
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 5, right: 4, bottom: 5, left: 4 }, textColor: C.ink },
      headStyles: { font: "helvetica", fontStyle: "bold", fontSize: 7, textColor: C.white, fillColor: C.teal, halign: "left" },
      alternateRowStyles: { fillColor: C.cream },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy = (((doc as any).lastAutoTable?.finalY ?? cy) as number) + 24;
  }

  drawSubhead(doc, "Property Details", MARGIN_X, cy, C.teal);
  cy += 20;

  const sections: Array<[string, string]> = [];
  if (p.sqft || p.year_built) {
    const struct: string[] = [];
    if (p.total_buildings) struct.push(`${p.total_buildings} building${p.total_buildings === 1 ? "" : "s"}`);
    if (p.number_of_stories) struct.push(`${p.number_of_stories} stor${p.number_of_stories === 1 ? "y" : "ies"}`);
    if (p.year_built) struct.push(`built ${p.year_built}`);
    if (p.sqft) struct.push(`${fmtSF(p.sqft)} SF`);
    if (struct.length > 0) sections.push(["Building Structure", struct.join(", ") + "."]);
  }
  if (p.zoning) {
    sections.push(["Zoning", `${p.zoning}. Permits a range of uses consistent with current tenancy and intended buyer profile.`]);
  }
  if (p.acreage) {
    sections.push(["Site & Acreage", `${Number(p.acreage).toFixed(2)} acres. Parking, yard, and outdoor storage potential to be confirmed.`]);
  }
  if (p.parking_spaces) {
    sections.push(["Parking", `${fmtSF(p.parking_spaces)} parking spaces${p.parking_ratio ? ` (${p.parking_ratio} ratio)` : ""}.`]);
  }
  sections.push([
    "Utilities & Systems",
    "All public utilities understood to be available. Buyers are encouraged to confirm condition and capacity of roof, HVAC, and mechanical systems through their own inspections.",
  ]);

  for (const [label, body] of sections) {
    setText(doc, C.bronze);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, MARGIN_X, cy);
    cy += 12;
    cy = drawParagraph(doc, body, MARGIN_X, cy, {
      size: 8.5,
      color: C.ink,
      lineHeight: 13,
    });
    cy += 8;
  }
}

// ── PAGE 10: MARKET OVERVIEW ─────────────────────────────────────────────

function drawMarketOverview(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintWhitePage(doc);
  const p = ctx.property;

  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, MARGIN_TOP - 16, 48, 1.5, "F");
  drawSectionTitle(doc, "Market Overview", MARGIN_X, MARGIN_TOP + 6);

  let cy = MARGIN_TOP + 52;
  const market = [p.city, p.state].filter(Boolean).join(", ");
  if (market) {
    setText(doc, C.teal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(market.toUpperCase(), MARGIN_X, cy, { charSpace: 1.2 });
    cy += 16;
  }

  // Generic market paragraph — the description usually carries this
  // narrative already; show a brief summary here.
  const marketIntro = [
    `${p.city ?? "The market"}${p.county ? ` in ${p.county} County` : ""} serves a regional commercial base.`,
    p.market_name ? `It is part of the ${p.market_name} market area.` : "",
    "Buyers and tenants are encouraged to evaluate proximity to interstate corridors, employment centers, and adjacent demand drivers when underwriting.",
  ]
    .filter(Boolean)
    .join(" ");
  cy = drawParagraph(doc, marketIntro, MARGIN_X, cy, {
    size: 9,
    color: C.ink,
    lineHeight: 14,
  });
  cy += 18;

  // Area highlights placeholder — pulled from observations or property highlights
  const highlights: string[] = Array.isArray(p.highlights) ? p.highlights : [];
  if (highlights.length > 0) {
    drawSubhead(doc, "Area Highlights", MARGIN_X, cy, C.teal);
    cy += 16;
    drawBullets(doc, highlights.slice(0, 6), MARGIN_X, cy, {
      size: 8.5,
      color: C.ink,
      bulletColor: C.bronze,
      lineHeight: 13,
    });
  }
}

// ── PAGE 11: BACK COVER ──────────────────────────────────────────────────

function drawBackCover(doc: jsPDF) {
  doc.addPage();
  // Full-bleed dark teal
  setFill(doc, C.teal);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // Bronze hairline
  setFill(doc, C.bronze);
  doc.rect(MARGIN_X, 96, 48, 2, "F");

  setText(doc, C.bronze);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("EXCLUSIVELY LISTED BY", MARGIN_X, 124, { charSpace: 1.5 });

  setText(doc, C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.text("JOHN MATHEWSON", MARGIN_X, 168);

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Commercial Real Estate Broker", MARGIN_X, 192);
  doc.text("eXp Commercial", MARGIN_X, 210);

  setText(doc, C.bronze);
  doc.setFontSize(10);
  doc.text("john@johnmathewson.co", MARGIN_X, 248);

  // Bottom brand mark
  setText(doc, C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("eXp", MARGIN_X, PAGE_H - 92, { charSpace: 0.5 });

  setText(doc, C.bronze);
  doc.setFontSize(9);
  doc.text("COMMERCIAL", MARGIN_X, PAGE_H - 74, { charSpace: 2 });

  setText(doc, C.cream);
  doc.setFontSize(7.5);
  doc.text("All property showings by appointment only.", MARGIN_X, PAGE_H - 56);
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────

export interface GenerateOmResult {
  pdfBytes: Uint8Array;
  filename: string;
  pageCount: number;
}

export function generateOm(ctx: MarketingPropertyContext): GenerateOmResult {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const p = ctx.property;
  const isVacant = !p.noi || (p.occupancy_pct !== null && Number(p.occupancy_pct) === 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasSaleComps = Array.isArray((ctx as any).saleComps) && (ctx as any).saleComps.length > 0;

  // Section-render decisions. The rule: if we don't have enough data
  // for a section to be USEFUL (not just "fillable"), skip it rather
  // than pad with placeholders. A skipped section keeps the OM short
  // and honest.
  const hasExecSummary = !!p.description;
  const hasInvestmentHighlights = Array.isArray(p.investment_highlights) && p.investment_highlights.length > 0;
  const hasRentRoll = false; // No rent-roll loader yet — always skip for now
  const hasFinancialDetail = !!(p.asking_price || p.noi || p.cap_rate);
  const hasParcelDetail = !!(p.apn || p.acreage || p.zoning || p.year_built || p.parking_spaces);
  // Market Overview needs a real submarket / market_name beyond just
  // city/state to add value. Otherwise it's a generic filler page.
  const hasMarketContext = !!(p.market_name || p.submarket || p.submarket_cluster);

  // Build TOC entries based on which sections will actually render.
  const tocEntries: TocEntry[] = [];
  let pageCursor = 4; // pages 1=cover, 2=disclaimer, 3=TOC, content begins p4
  if (hasExecSummary) { tocEntries.push({ title: "Executive Summary", pageNumber: pageCursor }); pageCursor++; }
  if (hasInvestmentHighlights) { tocEntries.push({ title: "Investment Highlights", pageNumber: pageCursor }); pageCursor++; }
  if (hasRentRoll) { tocEntries.push({ title: "Rent Roll", pageNumber: pageCursor }); pageCursor++; }
  if (hasFinancialDetail) { tocEntries.push({ title: "Financial Summary", pageNumber: pageCursor }); pageCursor++; }
  if (hasSaleComps) { tocEntries.push({ title: "Comparable Sales", pageNumber: pageCursor }); pageCursor++; }
  if (hasParcelDetail) { tocEntries.push({ title: "Property Overview", pageNumber: pageCursor }); pageCursor++; }
  if (hasMarketContext) { tocEntries.push({ title: "Market Overview", pageNumber: pageCursor }); pageCursor++; }

  // Render in section order. Conditional sections are skipped entirely
  // — no blank pages, no "N/A" placeholders.
  drawCover(doc, ctx);
  drawDisclaimerPage(doc, ctx);
  // Only render the TOC if we have 4+ content sections — for short
  // OMs the TOC is more friction than help.
  if (tocEntries.length >= 4) drawToc(doc, tocEntries);
  if (hasExecSummary) drawExecutiveSummary(doc, ctx);
  if (hasInvestmentHighlights) drawInvestmentHighlights(doc, ctx);
  // Rent roll body skipped — see hasRentRoll above
  if (hasFinancialDetail) drawFinancialSummary(doc, ctx);
  if (hasSaleComps) drawComparableSales(doc, ctx);
  if (hasParcelDetail) drawPropertyOverview(doc, ctx);
  if (hasMarketContext) drawMarketOverview(doc, ctx);
  drawBackCover(doc);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageCount: number = (doc as any).internal.getNumberOfPages();
  doc.setPage(1);

  const pdfBytes = doc.output("arraybuffer") as ArrayBuffer;
  const safeName = (p.name ?? "property").replace(/[^A-Za-z0-9_-]+/g, "_");
  return {
    pdfBytes: new Uint8Array(pdfBytes),
    filename: `${safeName}_OM.pdf`,
    pageCount,
  };
}
