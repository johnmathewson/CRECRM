/**
 * Offering Memorandum PDF generator.
 *
 * Multi-page (5-7 pages typically) letter-format PDF that wraps the
 * marketing-engine output into a deliverable John can email or hand to
 * a buyer post-CA. Same brand palette as the buyer-fit PDF — dark
 * editorial, cream text, coral + teal accents.
 *
 * Sections (in order):
 *   1. Cover — property name, address, headline, asking price, broker
 *   2. Executive summary — investment highlights + description
 *   3. Property overview — key facts grid + property highlights
 *   4. Financial summary — asking price, $/SF, NOI/cap (when present)
 *   5. Location — submarket paragraph, county, corridor access
 *   6. Disclaimer / broker contact
 *
 * Future versions: comp tables (sale + lease), photo grid, location
 * map embed. All depend on data + assets that may not exist yet for
 * every property; skipped in first ship.
 *
 * Output is a Uint8Array of PDF bytes — caller streams as
 * application/pdf OR uploads to Supabase Storage and returns a URL.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { MarketingPropertyContext } from "./property-context";

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
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const fmtMoney = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};
const fmtSF = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number, places = 1) => (n * 100).toFixed(places) + "%";

function setFill(doc: jsPDF, rgb: RGB) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setText(doc: jsPDF, rgb: RGB) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function setDraw(doc: jsPDF, rgb: RGB) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

/**
 * Paint the page background. Called at the top of every page so the
 * dark editorial canvas extends edge-to-edge regardless of section.
 */
function paintBackground(doc: jsPDF) {
  setFill(doc, C.page);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

/**
 * Footer with page number + brand stripe. Bottom-aligned, repeats on
 * every page except the cover (which has its own treatment).
 */
function drawFooter(doc: jsPDF, pageNum: number, totalPages: number, propertyName: string) {
  // Coral hairline
  setDraw(doc, C.coral);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, PAGE_H - MARGIN_BOTTOM + 12, MARGIN_X + 32, PAGE_H - MARGIN_BOTTOM + 12);

  setText(doc, C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`STEWARDSHIP CRE  ·  ${propertyName.toUpperCase()}`, MARGIN_X, PAGE_H - MARGIN_BOTTOM + 26);
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W - MARGIN_X, PAGE_H - MARGIN_BOTTOM + 26, { align: "right" });
}

/** Draw a small uppercase eyebrow label above a section title. */
function drawEyebrow(doc: jsPDF, text: string, x: number, y: number, color: RGB = C.coral) {
  setText(doc, color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(text.toUpperCase(), x, y, { charSpace: 1.1 });
}

/** Section title — large editorial-display style. */
function drawSectionTitle(doc: jsPDF, text: string, x: number, y: number) {
  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(22);
  doc.text(text, x, y);
}

/** Body paragraph — wraps to CONTENT_W. Returns the y-cursor after the block. */
function drawParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options: { size?: number; color?: RGB; lineHeight?: number; maxWidth?: number } = {}
): number {
  const size = options.size ?? 10;
  const color = options.color ?? C.creamDim;
  const lineHeight = options.lineHeight ?? size * 1.45;
  const width = options.maxWidth ?? CONTENT_W;
  setText(doc, color);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  const lines: string[] = doc.splitTextToSize(text, width);
  let cy = y;
  for (const ln of lines) {
    doc.text(ln, x, cy);
    cy += lineHeight;
  }
  return cy;
}

/** Bulleted list. Returns y-cursor after the block. */
function drawBullets(
  doc: jsPDF,
  bullets: string[],
  x: number,
  y: number,
  options: { size?: number; color?: RGB; bulletColor?: RGB; lineHeight?: number; maxWidth?: number } = {}
): number {
  const size = options.size ?? 10;
  const color = options.color ?? C.creamDim;
  const bulletColor = options.bulletColor ?? C.coral;
  const lineHeight = options.lineHeight ?? size * 1.55;
  const indent = 12;
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

// ── COVER ────────────────────────────────────────────────────────────────

function drawCover(doc: jsPDF, ctx: MarketingPropertyContext) {
  paintBackground(doc);

  const p = ctx.property;

  // Coral stripe down the left edge
  setFill(doc, C.coral);
  doc.rect(0, 0, 4, PAGE_H, "F");

  // Eyebrow
  drawEyebrow(doc, "Offering Memorandum  ·  Stewardship CRE", MARGIN_X, 96);

  // Property name — large display
  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(40);
  const nameLines: string[] = doc.splitTextToSize(p.name ?? "Property", CONTENT_W);
  let cy = 140;
  for (const ln of nameLines) {
    doc.text(ln, MARGIN_X, cy);
    cy += 44;
  }

  // Address
  const addressParts = [p.address, [p.city, p.state, p.zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("  ·  ");
  if (addressParts) {
    setText(doc, C.creamDim);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.text(addressParts, MARGIN_X, cy + 4);
    cy += 28;
  }

  // Headline (if it exists)
  if (p.headline) {
    setText(doc, C.teal);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const hlLines: string[] = doc.splitTextToSize(p.headline, CONTENT_W);
    for (const ln of hlLines) {
      doc.text(ln, MARGIN_X, cy);
      cy += 16;
    }
  }

  // Big key stats grid at midpage — three columns
  cy = PAGE_H / 2 + 20;
  const stats: Array<[string, string]> = [];
  if (p.asking_price) stats.push(["Asking Price", fmtMoney(Number(p.asking_price))]);
  if (p.sqft) stats.push(["Building Size", fmtSF(p.sqft) + " SF"]);
  if (p.acreage) stats.push(["Lot Size", Number(p.acreage).toFixed(2) + " AC"]);
  if (p.asset_type) {
    const at = p.sub_type
      ? `${capitalize(p.asset_type)} · ${capitalize(p.sub_type)}`
      : capitalize(p.asset_type);
    stats.push(["Asset Type", at]);
  }
  if (p.zoning) stats.push(["Zoning", String(p.zoning)]);
  if (p.year_built) stats.push(["Built", String(p.year_built)]);
  if (ctx.computed.pricePerSf) stats.push(["$ / SF", "$" + ctx.computed.pricePerSf.toFixed(2)]);

  const colW = CONTENT_W / 3;
  for (let i = 0; i < stats.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const sx = MARGIN_X + col * colW;
    const sy = cy + row * 64;
    setText(doc, C.muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(stats[i][0].toUpperCase(), sx, sy, { charSpace: 1.1 });
    setText(doc, C.cream);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(18);
    doc.text(stats[i][1], sx, sy + 22);
  }

  // Bottom: broker contact strip
  const bottomY = PAGE_H - 96;
  setDraw(doc, C.hairline);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, bottomY, PAGE_W - MARGIN_X, bottomY);

  const bio = ctx.voiceProfile?.bio ?? "";
  drawEyebrow(doc, "Presented by", MARGIN_X, bottomY + 20, C.muted);
  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text("John Mathewson  ·  Stewardship CRE", MARGIN_X, bottomY + 38);
  if (bio) {
    const bioShort = bio.length > 140 ? bio.slice(0, 137) + "…" : bio;
    drawParagraph(doc, bioShort, MARGIN_X, bottomY + 54, {
      size: 8.5,
      color: C.creamDim,
      maxWidth: CONTENT_W,
    });
  }
}

// ── EXECUTIVE SUMMARY ────────────────────────────────────────────────────

function drawExecutiveSummary(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintBackground(doc);
  const p = ctx.property;

  drawEyebrow(doc, "Section 01", MARGIN_X, MARGIN_TOP);
  drawSectionTitle(doc, "Executive Summary", MARGIN_X, MARGIN_TOP + 30);

  let cy = MARGIN_TOP + 64;

  // Description first — sets the narrative
  if (p.description) {
    cy = drawParagraph(doc, p.description, MARGIN_X, cy, {
      size: 10.5,
      color: C.cream,
      lineHeight: 16,
    });
    cy += 16;
  }

  // Investment highlights
  const ih: string[] = Array.isArray(p.investment_highlights) ? p.investment_highlights : [];
  if (ih.length > 0) {
    drawEyebrow(doc, "Investment Highlights", MARGIN_X, cy, C.teal);
    cy += 18;
    cy = drawBullets(doc, ih, MARGIN_X, cy, {
      size: 10,
      color: C.cream,
      bulletColor: C.teal,
      lineHeight: 16,
    });
  }
}

// ── PROPERTY OVERVIEW ────────────────────────────────────────────────────

function drawPropertyOverview(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintBackground(doc);
  const p = ctx.property;

  drawEyebrow(doc, "Section 02", MARGIN_X, MARGIN_TOP);
  drawSectionTitle(doc, "Property Overview", MARGIN_X, MARGIN_TOP + 30);

  let cy = MARGIN_TOP + 64;

  // Key facts grid — two columns
  const facts: Array<[string, string]> = [];
  facts.push(["Asset type", capitalize(p.asset_type ?? "—") + (p.sub_type ? " · " + capitalize(p.sub_type) : "")]);
  if (p.transaction_type) facts.push(["Transaction", capitalize(p.transaction_type)]);
  if (p.your_role) facts.push(["Role", capitalize(p.your_role.replace(/_/g, " "))]);
  if (p.sqft) facts.push(["Building SF", fmtSF(p.sqft)]);
  if (p.acreage) facts.push(["Lot acreage", Number(p.acreage).toFixed(2) + " AC"]);
  if (p.year_built) facts.push(["Year built", String(p.year_built)]);
  if (p.zoning) facts.push(["Zoning", String(p.zoning)]);
  if (p.number_of_stories) facts.push(["Stories", String(p.number_of_stories)]);
  if (p.parking_spaces) facts.push(["Parking", fmtSF(p.parking_spaces) + " spaces"]);
  if (p.occupancy_pct !== null && p.occupancy_pct !== undefined) facts.push(["Occupancy", fmtPct(Number(p.occupancy_pct), 0)]);
  if (p.county) facts.push(["County", p.county]);
  if (p.market_name) facts.push(["Market", p.market_name]);

  autoTable(doc, {
    startY: cy,
    body: facts,
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: { top: 6, right: 12, bottom: 6, left: 0 },
      textColor: C.creamDim,
    },
    columnStyles: {
      0: {
        cellWidth: 130,
        textColor: C.muted,
        fontStyle: "bold",
        fontSize: 8,
      },
      1: { textColor: C.cream, fontStyle: "normal" },
    },
    margin: { left: MARGIN_X, right: MARGIN_X },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterTable = ((doc as any).lastAutoTable?.finalY ?? cy) as number;
  cy = afterTable + 24;

  // Property highlights
  const highlights: string[] = Array.isArray(p.highlights) ? p.highlights : [];
  if (highlights.length > 0) {
    drawEyebrow(doc, "Property Highlights", MARGIN_X, cy, C.coral);
    cy += 18;
    cy = drawBullets(doc, highlights, MARGIN_X, cy, {
      size: 10,
      color: C.cream,
      bulletColor: C.coral,
      lineHeight: 16,
    });
  }
}

// ── FINANCIAL SUMMARY ────────────────────────────────────────────────────

function drawFinancialSummary(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintBackground(doc);
  const p = ctx.property;
  const computed = ctx.computed;

  drawEyebrow(doc, "Section 03", MARGIN_X, MARGIN_TOP);
  drawSectionTitle(doc, "Financial Summary", MARGIN_X, MARGIN_TOP + 30);

  let cy = MARGIN_TOP + 64;

  const rows: Array<[string, string]> = [];
  if (p.asking_price) rows.push(["Asking price", fmtMoney(Number(p.asking_price))]);
  if (computed.pricePerSf) rows.push(["Price per SF", "$" + computed.pricePerSf.toFixed(2)]);
  if (p.noi) rows.push(["NOI (in-place)", fmtMoney(Number(p.noi))]);
  if (p.cap_rate) rows.push(["Cap rate (in-place)", fmtPct(Number(p.cap_rate), 2)]);
  if (p.occupancy_pct !== null && p.occupancy_pct !== undefined) {
    rows.push(["Occupancy", fmtPct(Number(p.occupancy_pct), 0)]);
  }
  if (p.tax_total) rows.push(["Tax (annual)", fmtMoney(Number(p.tax_total))]);

  if (rows.length > 0) {
    autoTable(doc, {
      startY: cy,
      body: rows,
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 11,
        cellPadding: { top: 9, right: 12, bottom: 9, left: 0 },
        textColor: C.cream,
      },
      columnStyles: {
        0: { cellWidth: 200, textColor: C.muted, fontStyle: "bold", fontSize: 9 },
        1: { textColor: C.cream, fontStyle: "normal" },
      },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy = (((doc as any).lastAutoTable?.finalY ?? cy) as number) + 24;
  }

  // Narrative paragraph for vacant / income-producing flag
  const isVacant = !p.noi || (p.occupancy_pct !== null && Number(p.occupancy_pct) === 0);
  if (isVacant) {
    drawParagraph(
      doc,
      "The property is offered vacant. Buyers are encouraged to underwrite based on either an owner-user occupancy scenario or a stabilized lease-up scenario. No in-place income is represented.",
      MARGIN_X,
      cy,
      { size: 10, color: C.creamDim, lineHeight: 15 }
    );
  } else {
    drawParagraph(
      doc,
      "Pro-forma assumptions and full rent roll detail are available upon request.",
      MARGIN_X,
      cy,
      { size: 10, color: C.creamDim, lineHeight: 15 }
    );
  }
}

// ── LOCATION ─────────────────────────────────────────────────────────────

function drawLocation(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintBackground(doc);
  const p = ctx.property;

  drawEyebrow(doc, "Section 04", MARGIN_X, MARGIN_TOP);
  drawSectionTitle(doc, "Location & Market", MARGIN_X, MARGIN_TOP + 30);

  let cy = MARGIN_TOP + 64;

  const locParts: string[] = [];
  if (p.city && p.state) locParts.push(`${p.city}, ${p.state}${p.zip ? " " + p.zip : ""}`);
  if (p.county) locParts.push(`${p.county} County`);
  if (p.market_name) locParts.push(`${p.market_name} market`);
  if (p.submarket) locParts.push(`${p.submarket} submarket`);
  if (locParts.length > 0) {
    setText(doc, C.cream);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(locParts.join("  ·  "), MARGIN_X, cy);
    cy += 20;
  }

  // Use the description's location-sentence(s) if we have them — for now
  // we fall back to a generic paragraph since the location story is
  // already inside p.description. This page is a placeholder for future
  // map embed + curated location narrative.
  const fallback =
    "This property is positioned within an established submarket with regional connectivity to surrounding industrial and commercial activity. Buyer-side site tours and market context briefings are available upon request.";
  drawParagraph(doc, fallback, MARGIN_X, cy, {
    size: 10.5,
    color: C.creamDim,
    lineHeight: 16,
  });
}

// ── DISCLAIMER / CONTACT ─────────────────────────────────────────────────

function drawDisclaimer(doc: jsPDF, ctx: MarketingPropertyContext) {
  doc.addPage();
  paintBackground(doc);

  drawEyebrow(doc, "Section 05", MARGIN_X, MARGIN_TOP);
  drawSectionTitle(doc, "Contact & Disclaimer", MARGIN_X, MARGIN_TOP + 30);

  let cy = MARGIN_TOP + 80;

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.text("John Mathewson", MARGIN_X, cy);
  cy += 22;

  setText(doc, C.teal);
  doc.setFontSize(10);
  doc.text("Stewardship Commercial Real Estate", MARGIN_X, cy);
  cy += 16;

  setText(doc, C.creamDim);
  doc.setFontSize(9.5);
  doc.text("john@stewardshipcre.com  ·  stewardshipcre.com", MARGIN_X, cy);
  cy += 14;
  doc.text("320 N Meridian St Ste 823 #125, Indianapolis, IN 46204", MARGIN_X, cy);
  cy += 40;

  drawEyebrow(doc, "Disclaimer", MARGIN_X, cy, C.muted);
  cy += 18;

  const disclaimer =
    "All information contained herein has been obtained from sources believed to be reliable, however, Stewardship Commercial Real Estate has not verified the accuracy of any such information and makes no representations or warranties, express or implied, as to its accuracy. " +
    "Any projections, opinions, assumptions or estimates are illustrative only and do not represent the current or future performance of the property. The property is being offered subject to prior sale, change in price, terms, or withdrawal without notice. " +
    "Buyers are responsible for conducting their own independent verification of all material facts.";
  drawParagraph(doc, disclaimer, MARGIN_X, cy, {
    size: 8.5,
    color: C.creamDim,
    lineHeight: 13,
  });
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────

export interface GenerateOmResult {
  pdfBytes: Uint8Array;
  filename: string;
  pageCount: number;
}

export function generateOm(ctx: MarketingPropertyContext): GenerateOmResult {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  drawCover(doc, ctx);
  drawExecutiveSummary(doc, ctx);
  drawPropertyOverview(doc, ctx);
  drawFinancialSummary(doc, ctx);
  drawLocation(doc, ctx);
  drawDisclaimer(doc, ctx);

  // Footers on pages 2..N (cover page gets no footer)
  // jsPDF's typed surface doesn't expose getNumberOfPages directly —
  // go through .internal which always has it across versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageCount: number = (doc as any).internal.getNumberOfPages();
  const propertyName = ctx.property.name ?? "Offering";
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    drawFooter(doc, i, pageCount, propertyName);
  }
  doc.setPage(1); // Leave first page active for downstream chaining

  const pdfBytes = doc.output("arraybuffer") as ArrayBuffer;
  const safeName = (ctx.property.name ?? "property").replace(/[^A-Za-z0-9_-]+/g, "_");
  return {
    pdfBytes: new Uint8Array(pdfBytes),
    filename: `${safeName}_OM.pdf`,
    pageCount,
  };
}

// ── Utilities ────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}
