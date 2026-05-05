import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { IntakeUnit } from "@/components/intake-editable-table";

// ── Types ──────────────────────────────────────────────────
interface Comp {
  property_name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  tenant_name?: string | null;
  suite?: string | null;
  square_footage?: number | null;
  lease_rate?: number | null;
  lease_type?: string | null;
  lease_start?: string | null;
  lease_end?: string | null;
  monthly_rent?: number | null;
  annual_rent?: number | null;
}

interface ReportData {
  propertyName: string;
  propertyAddress?: string;
  propertyType?: string;
  totalSF?: number;
  units: IntakeUnit[];
  comps: Comp[];
  preparedDate?: string;
  // True when the comp basis is a single derived rent estimate (sale comps × cap rate),
  // not observed leases. Triggers a banner so the reader knows the rate is modeled.
  derivedRent?: boolean;
}

type ReportType = "sale-bov" | "rental-opinion" | "stabilized-valuation";

// ── Brand palette ──────────────────────────────────────────
// Mirrors @theme tokens in stewardshipcre/src/app/globals.css
type RGB = [number, number, number];
const C: Record<string, RGB> = {
  page:        [10, 22, 21],     // #0A1615 steward-base
  panelDeep:   [13, 31, 30],     // #0D1F1E steward-dark
  panel:       [20, 40, 39],     // #142827 steward-mid
  panelHi:     [26, 39, 38],     // #1A2726 steward-panel
  hairline:    [56, 56, 56],     // #383838 charcoal-700
  hairlineDim: [40, 40, 40],     // #282828 charcoal-800

  coral:       [224, 122, 95],   // #E07A5F coral-400 (primary)
  coralDim:    [165, 82, 54],    // #A55236 coral-600
  teal:        [78, 205, 196],   // #4ECDC4 teal-400 (secondary/data)
  tealDim:     [46, 154, 145],   // #2E9A91 teal-600

  cream:       [250, 248, 245],  // #FAF8F5 cream-100
  creamDim:    [212, 206, 196],  // #D4CEC4 cream-400
  muted:       [129, 129, 129],  // #818181 charcoal-400
  ghost:       [102, 102, 102],  // #666666 charcoal-500
};

// Page grid (US letter, 612×792 pt)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_Y = 30;
const FOOTER_Y = 754;

// ── Format helpers ─────────────────────────────────────────
const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtRate = (n: number) => "$" + n.toFixed(2);
const fmtSF = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const effectiveRate = (u: IntakeUnit): number => {
  if (u.lease_rate && u.lease_rate > 0) return u.lease_rate;
  const sf = Number(u.square_footage) || 0;
  if (sf > 0 && u.annual_rent && u.annual_rent > 0) return u.annual_rent / sf;
  if (sf > 0 && u.monthly_rent && u.monthly_rent > 0) return (u.monthly_rent * 12) / sf;
  return 0;
};

const effectiveAnnual = (u: IntakeUnit): number => {
  if (u.annual_rent && u.annual_rent > 0) return u.annual_rent;
  if (u.monthly_rent && u.monthly_rent > 0) return u.monthly_rent * 12;
  const sf = Number(u.square_footage) || 0;
  const rate = effectiveRate(u);
  if (sf > 0 && rate > 0) return sf * rate;
  return 0;
};

const trimComps = (list: Comp[]): Comp[] => {
  const withRate = list.filter((c) => c.lease_rate && c.lease_rate > 0);
  if (withRate.length <= 2) return withRate;
  const sorted = [...withRate].sort((a, b) => Number(a.lease_rate) - Number(b.lease_rate));
  return sorted.slice(1, -1);
};

// ── Type setters ───────────────────────────────────────────
// jsPDF built-ins map to brand intent: helvetica ≈ DM Sans/Inter, times ≈ Cinzel,
// courier ≈ JetBrains Mono. Embedding the actual brand fonts is a follow-up.
function setBody(doc: jsPDF, size = 9.5, color: RGB = C.cream) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}
function setBold(doc: jsPDF, size = 10, color: RGB = C.cream) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}
function setMono(doc: jsPDF, size = 8, color: RGB = C.creamDim) {
  doc.setFont("courier", "normal");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}
function setDisplay(doc: jsPDF, size = 28, color: RGB = C.cream, weight: "normal" | "bold" = "normal") {
  doc.setFont("times", weight);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}
function setEyebrow(doc: jsPDF, color: RGB = C.coral, size = 7) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
  (doc as any).setCharSpace(1.2);
}
function clearCharSpace(doc: jsPDF) {
  (doc as any).setCharSpace(0);
}

// ── Page primitives ────────────────────────────────────────
function addPageBg(doc: jsPDF) {
  doc.setFillColor(C.page[0], C.page[1], C.page[2]);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function hairline(doc: jsPDF, x1: number, y: number, x2: number, color: RGB = C.hairline, weight = 0.4) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(weight);
  doc.line(x1, y, x2, y);
}

function addHeader(doc: jsPDF, eyebrowText: string) {
  hairline(doc, MARGIN_X, HEADER_Y, PAGE_W - MARGIN_X, C.coral, 0.6);
  setEyebrow(doc, C.coral);
  doc.text(eyebrowText.toUpperCase(), MARGIN_X, HEADER_Y - 8);
  setEyebrow(doc, C.muted);
  doc.text("CONFIDENTIAL", PAGE_W - MARGIN_X, HEADER_Y - 8, { align: "right" });
  clearCharSpace(doc);
}

function addFooter(doc: jsPDF, pageNum: number, totalPages: number, date: string) {
  hairline(doc, MARGIN_X, FOOTER_Y, PAGE_W - MARGIN_X, C.hairline, 0.3);
  setMono(doc, 7, C.muted);
  doc.text(`PREPARED  ${date.toUpperCase()}`, MARGIN_X, FOOTER_Y + 14);
  doc.text(`${String(pageNum).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`,
    PAGE_W - MARGIN_X, FOOTER_Y + 14, { align: "right" });
}

function addSectionEyebrow(doc: jsPDF, num: number, title: string, y: number): number {
  setEyebrow(doc, C.coral);
  doc.text(`${String(num).padStart(2, "0")}   ${title.toUpperCase()}`, MARGIN_X, y);
  clearCharSpace(doc);
  hairline(doc, MARGIN_X, y + 8, PAGE_W - MARGIN_X, C.hairline, 0.4);
  return y + 26;
}

function addParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  opts: { size?: number; color?: RGB; leading?: number } = {},
): number {
  setBody(doc, opts.size ?? 9.5, opts.color ?? C.creamDim);
  const lines = doc.splitTextToSize(text, maxWidth);
  const leading = opts.leading ?? 13;
  doc.text(lines, x, y);
  return y + lines.length * leading;
}

function addValueTile(
  doc: jsPDF,
  x: number, y: number, w: number,
  label: string,
  value: string,
  caption: string,
  accent: RGB,
) {
  setEyebrow(doc, accent);
  doc.text(label.toUpperCase(), x, y);
  clearCharSpace(doc);
  setDisplay(doc, 22, C.cream);
  doc.text(value, x, y + 26);
  setMono(doc, 7, C.muted);
  doc.text(caption.toUpperCase(), x, y + 42);
  hairline(doc, x, y + 54, x + w, C.hairlineDim, 0.3);
}

function addDerivedBanner(doc: jsPDF, y: number): number {
  const h = 56;
  doc.setFillColor(C.panel[0], C.panel[1], C.panel[2]);
  doc.rect(MARGIN_X, y, CONTENT_W, h, "F");
  doc.setFillColor(C.coral[0], C.coral[1], C.coral[2]);
  doc.rect(MARGIN_X, y, 2.5, h, "F");

  setEyebrow(doc, C.coral);
  doc.text("MARKET RENT   ·   DERIVED ESTIMATE", MARGIN_X + 16, y + 16);
  clearCharSpace(doc);

  // ASCII-only body — jsPDF's helvetica is WinAnsi-encoded; chars like U+2248 and
  // U+2212 emit raw bytes that corrupt the line and break layout.
  setBody(doc, 8.5, C.cream);
  const txt =
    "Direct lease comparables were not available in this submarket. Market rent below is modeled from comparable sale prices and prevailing market cap rates -- not directly observed. Treat the resulting NOI and stabilized value with corresponding caution.";
  const lines = doc.splitTextToSize(txt, CONTENT_W - 32);
  doc.text(lines, MARGIN_X + 16, y + 30);

  return y + h + 18;
}

function newPage(doc: jsPDF, eyebrowText: string) {
  doc.addPage();
  addPageBg(doc);
  addHeader(doc, eyebrowText);
}

// Editorial table styling. Header row gets a small coral eyebrow + coral underline;
// body rows use natural padding only — no zebra stripes, no cell borders.
function tableStyles() {
  return {
    theme: "plain" as const,
    margin: { left: MARGIN_X, right: MARGIN_X },
    headStyles: {
      fontSize: 6.5,
      fontStyle: "bold" as const,
      textColor: C.coral as any,
      fillColor: C.page as any,
      cellPadding: { top: 4, bottom: 8, left: 4, right: 4 },
      halign: "left" as const,
    },
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: C.cream as any,
      fillColor: C.page as any,
      cellPadding: { top: 7, bottom: 7, left: 4, right: 4 },
    },
  };
}

// Draws a coral hairline below the header row and a faint hairline below each body row.
// Pass to autoTable's didDrawCell.
function rowDividers(doc: jsPDF) {
  return (data: any) => {
    if (data.column.index !== 0) return;
    const x1 = MARGIN_X;
    const x2 = PAGE_W - MARGIN_X;
    const y = data.cell.y + data.cell.height;
    if (data.section === "head") {
      hairline(doc, x1, y, x2, C.coral, 0.5);
    } else if (data.section === "body") {
      hairline(doc, x1, y, x2, C.hairlineDim, 0.25);
    }
  };
}

// ── Cover layout helper ────────────────────────────────────
// Renders the editorial cover masthead: stack of display words, accent line, property line.
function renderCover(
  doc: jsPDF,
  titleLines: string[],
  accent: RGB,
  propertyName: string,
  propertyAddress?: string,
  propertyType?: string,
): number {
  let y = 90;
  setMono(doc, 7, C.muted);
  doc.text(today().toUpperCase(), MARGIN_X, y);
  y += 38;

  setDisplay(doc, 38, C.cream, "normal");
  for (const line of titleLines) {
    doc.text(line.toUpperCase(), MARGIN_X, y);
    y += 42;
  }

  // Accent line under the title
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(1.0);
  doc.line(MARGIN_X, y - 24, MARGIN_X + 64, y - 24);
  y += 4;

  setEyebrow(doc, C.coral);
  doc.text("PROPERTY", MARGIN_X, y);
  clearCharSpace(doc);
  y += 14;

  setBold(doc, 13, C.cream);
  const nameLines = doc.splitTextToSize(propertyName, CONTENT_W);
  doc.text(nameLines, MARGIN_X, y);
  y += nameLines.length * 16;

  if (propertyAddress) {
    setMono(doc, 8.5, C.creamDim);
    doc.text(propertyAddress.toUpperCase(), MARGIN_X, y);
    y += 14;
  }
  if (propertyType) {
    setMono(doc, 8, C.muted);
    doc.text(propertyType.toUpperCase(), MARGIN_X, y);
    y += 14;
  }

  return y + 18;
}

// ── REPORT: Broker Opinion of Value (Sale) ─────────────────
function generateSaleBOV(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps, derivedRent } = data;
  const date = data.preparedDate || today();
  const eyebrow = "BROKER OPINION OF VALUE  ·  SALE";

  const occupiedUnits = units.filter((u) => !u.is_vacant);
  const totalSF = data.totalSF || units.reduce((s, u) => s + (Number(u.square_footage) || 0), 0);
  const compsWithRate = comps.filter((c) => c.lease_rate && c.lease_rate > 0);
  const trimmed = trimComps(compsWithRate);
  const compTotalSF = trimmed.reduce((s, c) => s + (Number(c.square_footage) || 0), 0);
  const compWeightedRate = compTotalSF > 0
    ? trimmed.reduce((s, c) => s + Number(c.lease_rate!) * (Number(c.square_footage) || 0), 0) / compTotalSF
    : 0;

  const totalAnnualRent = units.reduce((s, u) => s + effectiveAnnual(u), 0);
  const marketAnnualRent = compWeightedRate > 0
    ? occupiedUnits.reduce((s, u) => s + compWeightedRate * (Number(u.square_footage) || 0), 0)
    : 0;
  const capRates = { conservative: 0.085, market: 0.075, aggressive: 0.065 };
  const asIsValue = totalAnnualRent > 0 ? Math.round(totalAnnualRent / capRates.market) : 0;
  const stabilizedValue = marketAnnualRent > 0 ? Math.round(marketAnnualRent / capRates.market) : 0;

  // ── PAGE 1: Cover ──
  addPageBg(doc);
  addHeader(doc, eyebrow);

  let y = renderCover(doc, ["Broker Opinion", "of Value", "— Sale"], C.coral, propertyName, propertyAddress, data.propertyType);

  if (derivedRent) {
    y = addDerivedBanner(doc, y);
  }

  // Two value tiles
  addValueTile(doc, MARGIN_X, y, (CONTENT_W - 24) / 2,
    "As-Is Value · Current Income",
    asIsValue > 0 ? fmt(asIsValue) : "—",
    asIsValue > 0 ? `${fmtRate(asIsValue / (totalSF || 1))}/SF · ${(capRates.market * 100).toFixed(1)}% CAP` : "Insufficient data",
    C.coral);

  addValueTile(doc, MARGIN_X + (CONTENT_W - 24) / 2 + 24, y, (CONTENT_W - 24) / 2,
    "Stabilized Value · At Market Rates",
    stabilizedValue > 0 ? fmt(stabilizedValue) : "—",
    stabilizedValue > 0 ? `${fmtRate(stabilizedValue / (totalSF || 1))}/SF · ${(capRates.market * 100).toFixed(1)}% CAP` : "Insufficient data",
    C.teal);

  y += 86;

  // Property detail mini-table
  y = addSectionEyebrow(doc, 0, "Property detail", y);
  const details = [
    ["Property type", data.propertyType || "Commercial"],
    ["Total GBA", `${fmtSF(totalSF)} SF`],
    ["Occupied units", `${occupiedUnits.length} of ${units.length}`],
    ["Current annual revenue", fmt(totalAnnualRent)],
    ["Effective date", date],
  ];

  autoTable(doc, {
    startY: y,
    body: details,
    ...tableStyles(),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 200, textColor: C.muted as any },
      1: { textColor: C.cream as any },
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 1, 4, date);

  // ── PAGE 2: Lease Comparables ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 1, "Lease comparable analysis", y);

  y = addParagraph(doc,
    `The following comparable lease records were analyzed to establish the market rent basis for the income-approach valuation. The highest and lowest rate outliers are excluded from the weighted average to provide a more representative market indication.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const compRows = compsWithRate.slice(0, 15).map((c) => [
    c.property_name || "—",
    c.tenant_name || "—",
    c.city || "—",
    c.square_footage ? fmtSF(Number(c.square_footage)) : "—",
    c.lease_rate ? fmtRate(Number(c.lease_rate)) : "—",
    c.lease_type || "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Property", "Tenant", "City", "SF", "Rate / SF", "Type"]],
    body: compRows.length ? compRows : [["—", "—", "—", "—", "—", "—"]],
    ...tableStyles(),
    columnStyles: {
      3: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      4: { halign: "right", font: "courier", fontSize: 9, textColor: C.coral as any, fontStyle: "bold" },
      5: { font: "courier", fontSize: 8, textColor: C.muted as any },
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  // Weighted average call-out
  setEyebrow(doc, C.coral);
  doc.text("MARKET WEIGHTED AVERAGE RATE", MARGIN_X, y);
  clearCharSpace(doc);
  setDisplay(doc, 22, C.cream);
  doc.text(`${fmtRate(compWeightedRate)} / SF`, MARGIN_X, y + 26);
  setMono(doc, 7.5, C.muted);
  doc.text(`BASED ON ${trimmed.length} COMPS · OUTLIERS EXCLUDED · ${fmtSF(compTotalSF)} SF ANALYZED`, MARGIN_X, y + 42);

  addFooter(doc, 2, 4, date);

  // ── PAGE 3: Unit-by-Unit ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 2, "Unit-by-unit market comparison", y);

  y = addParagraph(doc,
    `Each occupied unit is compared against market comps matched by square footage range (±30%). The market rate column reflects the trimmed average of comparable leases for similarly-sized spaces.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const unitRows = occupiedUnits.map((u) => {
    const sf = Number(u.square_footage) || 0;
    const uRate = effectiveRate(u);
    const similar = trimComps(compsWithRate.filter((c) => {
      const csf = Number(c.square_footage) || 0;
      return csf > 0 && sf > 0 && Math.abs(csf - sf) / sf < 0.3;
    }));
    const avgCompRate = similar.length > 0
      ? similar.reduce((s, c) => s + Number(c.lease_rate!), 0) / similar.length
      : compWeightedRate;
    const delta = uRate > 0 && avgCompRate > 0 ? ((avgCompRate - uRate) / uRate) * 100 : 0;
    const gap = uRate > 0 ? (avgCompRate - uRate) * sf : 0;
    return [
      u.unit_number || u.suite || "—",
      u.tenant_name || "—",
      sf > 0 ? fmtSF(sf) : "—",
      uRate > 0 ? fmtRate(uRate) : "—",
      fmtRate(avgCompRate),
      uRate > 0 ? fmtPct(delta) : "—",
      uRate > 0 ? fmt(Math.round(gap)) : "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Unit", "Tenant", "SF", "In-place", "Market", "Δ", "Annual gap"]],
    body: unitRows.length ? unitRows : [["—", "—", "—", "—", "—", "—", "—"]],
    ...tableStyles(),
    columnStyles: {
      2: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      3: { halign: "right", font: "courier", fontSize: 9, textColor: C.coral as any },
      4: { halign: "right", font: "courier", fontSize: 9, textColor: C.teal as any, fontStyle: "bold" },
      5: { halign: "right", font: "courier", fontSize: 8.5 },
      6: { halign: "right", font: "courier", fontSize: 9, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        const raw = String(data.cell.raw);
        const val = parseFloat(raw.replace("+", ""));
        if (!isNaN(val)) {
          if (val > 0) data.cell.styles.textColor = C.teal as any;
          else if (val < 0) data.cell.styles.textColor = C.coral as any;
        }
      }
      if (data.section === "body" && data.column.index === 6) {
        const raw = String(data.cell.raw);
        if (raw.startsWith("$") && !raw.startsWith("$-") && raw !== "$0") {
          data.cell.styles.textColor = C.teal as any;
        } else if (raw.startsWith("$-")) {
          data.cell.styles.textColor = C.coral as any;
        }
      }
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 3, 4, date);

  // ── PAGE 4: Reconciliation ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 3, "Valuation reconciliation", y);

  // As-Is
  setEyebrow(doc, C.coral);
  doc.text("AS-IS  ·  CURRENT INCOME", MARGIN_X, y);
  clearCharSpace(doc);
  y += 14;

  const scenarios = [
    { label: "Conservative", cap: capRates.conservative },
    { label: "Market", cap: capRates.market },
    { label: "Aggressive", cap: capRates.aggressive },
  ];
  const asIsRows = scenarios.map((s) => {
    const val = totalAnnualRent > 0 ? Math.round(totalAnnualRent / s.cap) : 0;
    return [s.label, `${(s.cap * 100).toFixed(1)}%`, fmt(totalAnnualRent), fmt(val), fmtRate(val / (totalSF || 1))];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap rate", "NOI", "Indicated value", "$ / SF"]],
    body: asIsRows,
    ...tableStyles(),
    columnStyles: {
      1: { halign: "right", font: "courier", fontSize: 9 },
      2: { halign: "right", font: "courier", fontSize: 9 },
      3: { halign: "right", font: "courier", fontSize: 9.5, textColor: C.coral as any, fontStyle: "bold" },
      4: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  // Stabilized
  setEyebrow(doc, C.teal);
  doc.text("STABILIZED  ·  AT MARKET RATES", MARGIN_X, y);
  clearCharSpace(doc);
  y += 14;

  const stabRows = scenarios.map((s) => {
    const val = marketAnnualRent > 0 ? Math.round(marketAnnualRent / s.cap) : 0;
    return [s.label, `${(s.cap * 100).toFixed(1)}%`, fmt(Math.round(marketAnnualRent)), fmt(val), fmtRate(val / (totalSF || 1))];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap rate", "Market NOI", "Indicated value", "$ / SF"]],
    body: stabRows,
    ...tableStyles(),
    columnStyles: {
      1: { halign: "right", font: "courier", fontSize: 9 },
      2: { halign: "right", font: "courier", fontSize: 9 },
      3: { halign: "right", font: "courier", fontSize: 9.5, textColor: C.teal as any, fontStyle: "bold" },
      4: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 28;

  // Opinion of value summary
  const revDelta = marketAnnualRent - totalAnnualRent;
  setEyebrow(doc, C.coral);
  doc.text("OPINION OF VALUE  ·  SUMMARY", MARGIN_X, y);
  clearCharSpace(doc);
  y += 18;

  setBody(doc, 9.5, C.creamDim);
  doc.text(`As-Is value (current income at ${(capRates.market * 100).toFixed(1)}% cap)`, MARGIN_X, y);
  setMono(doc, 11, C.coral);
  doc.text(asIsValue > 0 ? fmt(asIsValue) : "—", PAGE_W - MARGIN_X, y, { align: "right" });
  y += 18;

  setBody(doc, 9.5, C.creamDim);
  doc.text(`Stabilized value (market rates at ${(capRates.market * 100).toFixed(1)}% cap)`, MARGIN_X, y);
  setMono(doc, 11, C.teal);
  doc.text(stabilizedValue > 0 ? fmt(stabilizedValue) : "—", PAGE_W - MARGIN_X, y, { align: "right" });
  y += 18;

  setBody(doc, 9.5, C.creamDim);
  doc.text("Annual revenue upside at market rates", MARGIN_X, y);
  setMono(doc, 11, revDelta > 0 ? C.teal : C.coral);
  doc.text(marketAnnualRent > 0 ? `${fmt(Math.abs(Math.round(revDelta)))} / yr` : "—",
    PAGE_W - MARGIN_X, y, { align: "right" });

  addFooter(doc, 4, 4, date);
  return doc;
}

// ── REPORT: Rental Opinion ─────────────────────────────────
function generateRentalOpinion(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps, derivedRent } = data;
  const date = data.preparedDate || today();
  const eyebrow = "RENTAL OPINION";

  const totalSF = data.totalSF || units.reduce((s, u) => s + (Number(u.square_footage) || 0), 0);
  const occupiedUnits = units.filter((u) => !u.is_vacant);
  const vacantUnits = units.filter((u) => u.is_vacant);
  const compsWithRate = comps.filter((c) => c.lease_rate && c.lease_rate > 0);
  const trimmed = trimComps(compsWithRate);
  const compTotalSF = trimmed.reduce((s, c) => s + (Number(c.square_footage) || 0), 0);
  const compWeightedRate = compTotalSF > 0
    ? trimmed.reduce((s, c) => s + Number(c.lease_rate!) * (Number(c.square_footage) || 0), 0) / compTotalSF
    : 0;
  const occupiedSF = occupiedUnits.reduce((s, u) => s + (Number(u.square_footage) || 0), 0);
  const intakeWeightedRate = occupiedSF > 0
    ? occupiedUnits.reduce((s, u) => s + effectiveRate(u) * (Number(u.square_footage) || 0), 0) / occupiedSF
    : 0;
  const totalAnnualRent = units.reduce((s, u) => s + effectiveAnnual(u), 0);
  const marketAnnualRent = occupiedUnits.reduce((s, u) => s + compWeightedRate * (Number(u.square_footage) || 0), 0);
  const occupancyRate = totalSF > 0 ? (occupiedSF / totalSF) * 100 : 0;

  // ── PAGE 1: Cover ──
  addPageBg(doc);
  addHeader(doc, eyebrow);

  let y = renderCover(doc, ["Rental", "Opinion"], C.teal, propertyName, propertyAddress, data.propertyType);

  if (derivedRent) {
    y = addDerivedBanner(doc, y);
  }

  // Three tiles
  const tileW = (CONTENT_W - 32) / 3;
  addValueTile(doc, MARGIN_X, y, tileW, "Current Avg Rate / SF",
    intakeWeightedRate > 0 ? fmtRate(intakeWeightedRate) : "—",
    `${fmtSF(occupiedSF)} SF OCCUPIED`, C.coral);
  addValueTile(doc, MARGIN_X + tileW + 16, y, tileW, "Market Avg Rate / SF",
    compWeightedRate > 0 ? fmtRate(compWeightedRate) : "—",
    `${trimmed.length} COMPS · TRIMMED`, C.teal);
  const gap = marketAnnualRent - totalAnnualRent;
  addValueTile(doc, MARGIN_X + (tileW + 16) * 2, y, tileW, "Annual Revenue Gap",
    marketAnnualRent > 0 ? fmt(Math.abs(Math.round(gap))) : "—",
    gap > 0 ? "UPSIDE POTENTIAL" : gap < 0 ? "ABOVE MARKET" : "—",
    gap > 0 ? C.teal : C.coral);

  y += 86;

  y = addSectionEyebrow(doc, 0, "Rent roll summary", y);
  const summary = [
    ["Total SF", fmtSF(totalSF)],
    ["Occupied units", `${occupiedUnits.length}  ·  ${occupancyRate.toFixed(1)}% occupancy`],
    ["Vacant units", `${vacantUnits.length}`],
    ["Current annual revenue", fmt(totalAnnualRent)],
    ["Current weighted avg rate", `${fmtRate(intakeWeightedRate)} / SF`],
    ["Market weighted avg rate", `${fmtRate(compWeightedRate)} / SF`],
    ["Market annual revenue", fmt(Math.round(marketAnnualRent))],
    ["Effective date", date],
  ];

  autoTable(doc, {
    startY: y,
    body: summary,
    ...tableStyles(),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 220, textColor: C.muted as any },
      1: { textColor: C.cream as any },
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 1, 3, date);

  // ── PAGE 2: Comp Analysis ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 1, "Comparable lease analysis", y);

  y = addParagraph(doc,
    `Comparable leases were analyzed across the subject submarket. Outliers (highest and lowest rates) are excluded from the weighted average to reduce distortion from non-representative transactions.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const compRows = compsWithRate.slice(0, 20).map((c) => [
    c.property_name || "—",
    c.tenant_name || "—",
    c.city || "—",
    c.square_footage ? fmtSF(Number(c.square_footage)) : "—",
    c.lease_rate ? fmtRate(Number(c.lease_rate)) : "—",
    c.lease_type || "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [["Property", "Tenant", "City", "SF", "Rate / SF", "Type"]],
    body: compRows.length ? compRows : [["—", "—", "—", "—", "—", "—"]],
    ...tableStyles(),
    columnStyles: {
      3: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      4: { halign: "right", font: "courier", fontSize: 9, textColor: C.teal as any, fontStyle: "bold" },
      5: { font: "courier", fontSize: 8, textColor: C.muted as any },
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 2, 3, date);

  // ── PAGE 3: Unit-by-Unit ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 2, "Unit-by-unit rental analysis", y);

  y = addParagraph(doc,
    `Each occupied unit's in-place rent is compared against the trimmed market average for similarly-sized space. Positive deltas indicate rent below market; negative deltas indicate rent above market.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const unitRows = occupiedUnits.map((u) => {
    const sf = Number(u.square_footage) || 0;
    const uRate = effectiveRate(u);
    const similar = trimComps(compsWithRate.filter((c) => {
      const csf = Number(c.square_footage) || 0;
      return csf > 0 && sf > 0 && Math.abs(csf - sf) / sf < 0.3;
    }));
    const avgCompRate = similar.length > 0
      ? similar.reduce((s, c) => s + Number(c.lease_rate!), 0) / similar.length
      : compWeightedRate;
    const delta = uRate > 0 && avgCompRate > 0 ? ((avgCompRate - uRate) / uRate) * 100 : 0;
    const gapV = uRate > 0 ? (avgCompRate - uRate) * sf : 0;
    return [
      u.unit_number || u.suite || "—",
      u.tenant_name || "—",
      sf > 0 ? fmtSF(sf) : "—",
      uRate > 0 ? fmtRate(uRate) : "—",
      fmtRate(avgCompRate),
      uRate > 0 ? fmtPct(delta) : "—",
      uRate > 0 ? fmt(Math.round(gapV)) : "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Unit", "Tenant", "SF", "In-place", "Market", "Δ", "Annual gap"]],
    body: unitRows.length ? unitRows : [["—", "—", "—", "—", "—", "—", "—"]],
    ...tableStyles(),
    columnStyles: {
      2: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      3: { halign: "right", font: "courier", fontSize: 9, textColor: C.coral as any },
      4: { halign: "right", font: "courier", fontSize: 9, textColor: C.teal as any, fontStyle: "bold" },
      5: { halign: "right", font: "courier", fontSize: 8.5 },
      6: { halign: "right", font: "courier", fontSize: 9, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        const raw = String(data.cell.raw);
        const val = parseFloat(raw.replace("+", ""));
        if (!isNaN(val)) {
          if (val > 0) data.cell.styles.textColor = C.teal as any;
          else if (val < 0) data.cell.styles.textColor = C.coral as any;
        }
      }
      if (data.section === "body" && data.column.index === 6) {
        const raw = String(data.cell.raw);
        if (raw.startsWith("$") && !raw.startsWith("$-") && raw !== "$0") {
          data.cell.styles.textColor = C.teal as any;
        } else if (raw.startsWith("$-")) {
          data.cell.styles.textColor = C.coral as any;
        }
      }
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 22;

  // Totals strip
  setEyebrow(doc, C.coral);
  doc.text(`${occupiedUnits.length} UNITS COMPARED`, MARGIN_X, y);
  clearCharSpace(doc);

  setMono(doc, 9, C.coral);
  doc.text(`CURRENT ${fmt(totalAnnualRent)}`, MARGIN_X + 200, y);
  setMono(doc, 9, C.teal);
  doc.text(`MARKET ${fmt(Math.round(marketAnnualRent))}`, MARGIN_X + 340, y);
  setMono(doc, 9, gap > 0 ? C.teal : C.coral);
  doc.text(`GAP ${fmt(Math.abs(Math.round(gap)))}`, PAGE_W - MARGIN_X, y, { align: "right" });

  addFooter(doc, 3, 3, date);
  return doc;
}

// ── REPORT: Stabilized Valuation ───────────────────────────
function generateStabilizedValuation(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps, derivedRent } = data;
  const date = data.preparedDate || today();
  const eyebrow = "STABILIZED VALUATION";

  const totalSF = data.totalSF || units.reduce((s, u) => s + (Number(u.square_footage) || 0), 0);
  const occupiedUnits = units.filter((u) => !u.is_vacant);
  const compsWithRate = comps.filter((c) => c.lease_rate && c.lease_rate > 0);
  const trimmed = trimComps(compsWithRate);
  const compTotalSF = trimmed.reduce((s, c) => s + (Number(c.square_footage) || 0), 0);
  const compWeightedRate = compTotalSF > 0
    ? trimmed.reduce((s, c) => s + Number(c.lease_rate!) * (Number(c.square_footage) || 0), 0) / compTotalSF
    : 0;

  const totalAnnualRent = units.reduce((s, u) => s + effectiveAnnual(u), 0);
  const marketAnnualRent = occupiedUnits.reduce((s, u) => s + compWeightedRate * (Number(u.square_footage) || 0), 0);

  const capRates = [
    { label: "Conservative", rate: 0.09,  desc: "Higher risk · older asset · secondary market" },
    { label: "Moderate",     rate: 0.08,  desc: "Average market conditions" },
    { label: "Market",       rate: 0.075, desc: "Current market cap rate" },
    { label: "Aggressive",   rate: 0.065, desc: "Strong market · stabilized · prime location" },
    { label: "Premium",      rate: 0.055, desc: "Trophy asset · long-term credit tenants" },
  ];

  // ── PAGE 1: Cover ──
  addPageBg(doc);
  addHeader(doc, eyebrow);

  let y = renderCover(doc, ["Stabilized", "Valuation"], C.coral, propertyName, propertyAddress, data.propertyType);

  if (derivedRent) {
    y = addDerivedBanner(doc, y);
  }

  // Three tiles: Conservative, Market, Aggressive
  const consVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.09) : 0;
  const marketVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.075) : 0;
  const aggVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.065) : 0;

  const tileW = (CONTENT_W - 32) / 3;
  addValueTile(doc, MARGIN_X, y, tileW, "Conservative · 9.0% Cap",
    consVal > 0 ? fmt(consVal) : "—",
    consVal > 0 ? `${fmtRate(consVal / (totalSF || 1))}/SF` : "Insufficient data", C.creamDim);
  addValueTile(doc, MARGIN_X + tileW + 16, y, tileW, "Market · 7.5% Cap",
    marketVal > 0 ? fmt(marketVal) : "—",
    marketVal > 0 ? `${fmtRate(marketVal / (totalSF || 1))}/SF` : "Insufficient data", C.coral);
  addValueTile(doc, MARGIN_X + (tileW + 16) * 2, y, tileW, "Aggressive · 6.5% Cap",
    aggVal > 0 ? fmt(aggVal) : "—",
    aggVal > 0 ? `${fmtRate(aggVal / (totalSF || 1))}/SF` : "Insufficient data", C.teal);

  y += 86;

  y = addSectionEyebrow(doc, 0, "Income summary", y);
  const incomeSummary = [
    ["Current annual revenue", fmt(totalAnnualRent)],
    ["Current weighted rate", `${fmtRate(totalSF > 0 ? totalAnnualRent / totalSF : 0)} / SF`],
    ["Market annual revenue", fmt(Math.round(marketAnnualRent))],
    ["Market weighted rate", `${fmtRate(compWeightedRate)} / SF`],
    ["Revenue gap", fmt(Math.abs(Math.round(marketAnnualRent - totalAnnualRent)))],
    ["Total SF", fmtSF(totalSF)],
    ["Occupied units", `${occupiedUnits.length} of ${units.length}`],
    ["Comps used", `${trimmed.length}  ·  outliers excluded from ${compsWithRate.length}`],
    ["Effective date", date],
  ];

  autoTable(doc, {
    startY: y,
    body: incomeSummary,
    ...tableStyles(),
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 220, textColor: C.muted as any },
      1: { textColor: C.cream as any },
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 1, 3, date);

  // ── PAGE 2: Cap Rate Scenarios ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 1, "Cap rate scenarios · current income", y);

  y = addParagraph(doc,
    `Valuation based on current in-place income. This represents the property's value to a buyer based on the existing rent roll without adjusting rents to market levels.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const asIsRows = capRates.map((s) => {
    const val = totalAnnualRent > 0 ? Math.round(totalAnnualRent / s.rate) : 0;
    return [s.label, `${(s.rate * 100).toFixed(1)}%`, fmt(totalAnnualRent), fmt(val), fmtRate(val / (totalSF || 1)), s.desc];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap rate", "NOI", "Value", "$ / SF", "Rationale"]],
    body: asIsRows,
    ...tableStyles(),
    columnStyles: {
      1: { halign: "right", font: "courier", fontSize: 9 },
      2: { halign: "right", font: "courier", fontSize: 9 },
      3: { halign: "right", font: "courier", fontSize: 9.5, textColor: C.coral as any, fontStyle: "bold" },
      4: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      5: { fontSize: 7.5, textColor: C.muted as any },
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 28;

  y = addSectionEyebrow(doc, 2, "Cap rate scenarios · stabilized (market rates)", y);

  y = addParagraph(doc,
    `Valuation based on market-rate income. This represents the property's value if all occupied units were leased at current market rates, reflecting the asset's full income potential.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const stabRows = capRates.map((s) => {
    const val = marketAnnualRent > 0 ? Math.round(marketAnnualRent / s.rate) : 0;
    return [s.label, `${(s.rate * 100).toFixed(1)}%`, fmt(Math.round(marketAnnualRent)), fmt(val), fmtRate(val / (totalSF || 1)), s.desc];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap rate", "Market NOI", "Value", "$ / SF", "Rationale"]],
    body: stabRows,
    ...tableStyles(),
    columnStyles: {
      1: { halign: "right", font: "courier", fontSize: 9 },
      2: { halign: "right", font: "courier", fontSize: 9 },
      3: { halign: "right", font: "courier", fontSize: 9.5, textColor: C.teal as any, fontStyle: "bold" },
      4: { halign: "right", font: "courier", fontSize: 8.5, textColor: C.creamDim as any },
      5: { fontSize: 7.5, textColor: C.muted as any },
    },
    didDrawCell: rowDividers(doc),
  });

  addFooter(doc, 2, 3, date);

  // ── PAGE 3: Range Summary + Disclosures ──
  newPage(doc, eyebrow);
  y = HEADER_Y + 38;
  y = addSectionEyebrow(doc, 3, "Value range summary", y);

  y = addParagraph(doc,
    `The table below summarizes indicated value across cap rate scenarios for both current income and stabilized (market rate) approaches.`,
    MARGIN_X, y, CONTENT_W);
  y += 12;

  const summaryRows = [
    ["As-Is · Conservative", fmt(Math.round(totalAnnualRent / 0.09)),  "Current income at 9.0% cap"],
    ["As-Is · Market",       fmt(Math.round(totalAnnualRent / 0.075)), "Current income at 7.5% cap"],
    ["As-Is · Aggressive",   fmt(Math.round(totalAnnualRent / 0.065)), "Current income at 6.5% cap"],
    ["Stabilized · Conservative", fmt(Math.round(marketAnnualRent / 0.09)),  "Market rates at 9.0% cap"],
    ["Stabilized · Market",       fmt(Math.round(marketAnnualRent / 0.075)), "Market rates at 7.5% cap"],
    ["Stabilized · Aggressive",   fmt(Math.round(marketAnnualRent / 0.065)), "Market rates at 6.5% cap"],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Indicated value", "Basis"]],
    body: summaryRows,
    ...tableStyles(),
    columnStyles: {
      0: { fontStyle: "bold" },
      1: { halign: "right", font: "courier", fontSize: 10, fontStyle: "bold" },
      2: { fontSize: 8, textColor: C.muted as any },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        data.cell.styles.textColor = (data.row.index < 3 ? C.coral : C.teal) as any;
      }
    },
    didDrawCell: rowDividers(doc),
  });

  y = (doc as any).lastAutoTable.finalY + 28;

  y = addSectionEyebrow(doc, 4, "Disclosures · limiting conditions", y);
  const disclosures = derivedRent
    ? `This Stabilized Valuation Analysis is prepared as a market study for internal strategy discussions. Direct lease comparables were not available in the subject submarket; the market rent basis reflects a modeled estimate derived from comparable sale prices and prevailing market capitalization rates rather than observed leases. The analysis is based on market data available at the time of preparation and the in-place rent roll as of the effective date. Cap rate scenarios are provided to illustrate value sensitivity. This analysis does not constitute a certified appraisal and is not intended for use in litigation, financing, or regulatory proceedings. Recipients should conduct independent due diligence before making investment decisions based on this analysis.`
    : `This Stabilized Valuation Analysis is prepared as a market study for internal strategy discussions. It is based on market comparable data and the in-place rent roll as of the effective date. Cap rate scenarios are provided to illustrate value sensitivity across market conditions. This analysis does not constitute a certified appraisal and is not intended for use in litigation, financing, or regulatory proceedings. Comparable lease data is sourced from proprietary databases and may not reflect all market transactions. Recipients should conduct independent due diligence before making investment decisions based on this analysis.`;
  addParagraph(doc, disclosures, MARGIN_X, y, CONTENT_W, { size: 8.5, color: C.creamDim, leading: 12 });

  addFooter(doc, 3, 3, date);
  return doc;
}

// ── Main Export ────────────────────────────────────────────
export function generateReport(type: ReportType, data: ReportData): void {
  let doc: jsPDF;
  let filename: string;
  const safeName = data.propertyName.replace(/[^a-zA-Z0-9]/g, "_");

  switch (type) {
    case "sale-bov":
      doc = generateSaleBOV(data);
      filename = `${safeName}_BOV_Sale.pdf`;
      break;
    case "rental-opinion":
      doc = generateRentalOpinion(data);
      filename = `${safeName}_Rental_Opinion.pdf`;
      break;
    case "stabilized-valuation":
      doc = generateStabilizedValuation(data);
      filename = `${safeName}_Stabilized_Valuation.pdf`;
      break;
  }

  doc.save(filename);
}

/**
 * Generate a report and return the PDF as a Uint8Array (for server-side / API use).
 * Does NOT trigger a download — returns raw bytes.
 */
export function generateReportBytes(type: ReportType, data: ReportData): Uint8Array {
  let doc: jsPDF;

  switch (type) {
    case "sale-bov":
      doc = generateSaleBOV(data);
      break;
    case "rental-opinion":
      doc = generateRentalOpinion(data);
      break;
    case "stabilized-valuation":
      doc = generateStabilizedValuation(data);
      break;
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

export type { ReportData, ReportType };
