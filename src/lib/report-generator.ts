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
}

type ReportType = "sale-bov" | "rental-opinion" | "stabilized-valuation";

// ── Colors ─────────────────────────────────────────────────
const COLORS = {
  dark: [18, 22, 28] as [number, number, number],
  darkPanel: [24, 30, 38] as [number, number, number],
  headerBar: [30, 38, 48] as [number, number, number],
  coral: [224, 122, 95] as [number, number, number],
  teal: [78, 205, 196] as [number, number, number],
  green: [107, 203, 119] as [number, number, number],
  amber: [242, 201, 76] as [number, number, number],
  cream: [240, 237, 228] as [number, number, number],
  creamMuted: [180, 176, 168] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  tableRow: [28, 35, 44] as [number, number, number],
  tableRowAlt: [22, 28, 36] as [number, number, number],
};

// ── Helpers ────────────────────────────────────────────────
const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtD = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRate = (n: number) => "$" + n.toFixed(2);
const fmtSF = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

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

const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ── PDF Page Helpers ───────────────────────────────────────
function addPageBg(doc: jsPDF) {
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, 612, 792, "F");
}

function addHeader(doc: jsPDF, title: string, subtitle: string) {
  // Header bar
  doc.setFillColor(...COLORS.headerBar);
  doc.rect(0, 0, 612, 36, "F");
  // Coral accent line
  doc.setFillColor(...COLORS.coral);
  doc.rect(0, 36, 612, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.cream);
  doc.text(title, 36, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(subtitle, 36, 28);

  doc.setFontSize(7.5);
  doc.text("CONFIDENTIAL", 576, 16, { align: "right" });
}

function addFooter(doc: jsPDF, pageNum: number, totalPages: number, date: string) {
  doc.setFillColor(...COLORS.headerBar);
  doc.rect(0, 752, 612, 40, "F");
  doc.setFillColor(...COLORS.coral);
  doc.rect(0, 750, 612, 2, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(`Prepared ${date} | Stewardship Asset Group`, 36, 770);
  doc.text(`Page ${pageNum} of ${totalPages}`, 576, 770, { align: "right" });
}

function addSectionTitle(doc: jsPDF, num: number, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.cream);
  doc.text(`${num}. ${title}`, 36, y);

  // Underline
  doc.setDrawColor(...COLORS.coral);
  doc.setLineWidth(0.75);
  doc.line(36, y + 4, 576, y + 4);

  return y + 16;
}

function addValueBox(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, sublabel: string, color: [number, number, number]) {
  doc.setFillColor(...COLORS.darkPanel);
  doc.roundedRect(x, y, w, h, 4, 4, "F");

  // Color accent on left
  doc.setFillColor(...color);
  doc.rect(x, y + 4, 3, h - 8, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(label.toUpperCase(), x + 14, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...color);
  doc.text(value, x + 14, y + 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(sublabel, x + 14, y + 54);
}

function addParagraph(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.cream);
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * 12;
}

function newPage(doc: jsPDF, title: string, subtitle: string) {
  doc.addPage();
  addPageBg(doc);
  addHeader(doc, title, subtitle);
}

// ── REPORT: Broker Price Opinion (Sale) ────────────────────
function generateSaleBOV(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps } = data;
  const date = data.preparedDate || today();
  const headerTitle = "BROKER OPINION OF VALUE — SALE";
  const headerSub = `${propertyName}${propertyAddress ? " | " + propertyAddress : ""} | CONFIDENTIAL`;

  const occupiedUnits = units.filter((u) => !u.is_vacant);
  const totalSF = data.totalSF || units.reduce((s, u) => s + (Number(u.square_footage) || 0), 0);
  const compsWithRate = comps.filter((c) => c.lease_rate && c.lease_rate > 0);
  const trimmed = trimComps(compsWithRate);
  const compTotalSF = trimmed.reduce((s, c) => s + (Number(c.square_footage) || 0), 0);
  const compWeightedRate = compTotalSF > 0
    ? trimmed.reduce((s, c) => s + Number(c.lease_rate!) * (Number(c.square_footage) || 0), 0) / compTotalSF
    : 0;

  // Estimate property value using income approach
  const totalAnnualRent = units.reduce((s, u) => s + effectiveAnnual(u), 0);
  const marketAnnualRent = compWeightedRate > 0
    ? occupiedUnits.reduce((s, u) => s + compWeightedRate * (Number(u.square_footage) || 0), 0)
    : 0;
  const capRates = { conservative: 0.085, market: 0.075, aggressive: 0.065 };
  const asIsValue = totalAnnualRent > 0 ? Math.round(totalAnnualRent / capRates.market) : 0;
  const stabilizedValue = marketAnnualRent > 0 ? Math.round(marketAnnualRent / capRates.market) : 0;

  // ── PAGE 1: Cover ──
  addPageBg(doc);
  addHeader(doc, headerTitle, headerSub);

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.cream);
  doc.text("BROKER OPINION OF VALUE — SALE", 36, 80);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.coral);
  doc.text(propertyName, 36, 104);

  if (propertyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.creamMuted);
    doc.text(propertyAddress, 36, 120);
  }

  // Value boxes
  addValueBox(doc, 36, 148, 254, 68, "As-Is Value — Current Income", fmt(asIsValue),
    `${fmtRate(asIsValue / (totalSF || 1))}/SF | Based on ${capRates.market * 100}% cap`, COLORS.coral);

  addValueBox(doc, 310, 148, 266, 68, "Stabilized Value — At Market Rates", fmt(stabilizedValue),
    `${fmtRate(stabilizedValue / (totalSF || 1))}/SF | At market rents`, COLORS.teal);

  // Property details table
  let y = 240;
  y = addSectionTitle(doc, 0, "Property Detail Information", y);
  const details = [
    ["Property", propertyName],
    ["Address", propertyAddress || "—"],
    ["Property Type", data.propertyType || "Commercial"],
    ["Total GBA", `~${fmtSF(totalSF)} SF`],
    ["Occupied Units", `${occupiedUnits.length} of ${units.length}`],
    ["Current Annual Revenue", fmt(totalAnnualRent)],
    ["Effective Date", date],
  ];

  autoTable(doc, {
    startY: y,
    head: [],
    body: details,
    theme: "plain",
    margin: { left: 36, right: 36 },
    styles: {
      fontSize: 9,
      textColor: COLORS.cream,
      cellPadding: { top: 4, bottom: 4, left: 8, right: 8 },
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 160, textColor: COLORS.creamMuted },
      1: { cellWidth: "auto" },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
    },
  });

  addFooter(doc, 1, 4, date);

  // ── PAGE 2: Comparable Analysis ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 1, "Sales Comparable Analysis", y);

  y = addParagraph(doc,
    `The following comparable lease/sale records were analyzed for ${propertyName}. Comps are filtered to relevant property types and size ranges. The highest and lowest rate outliers have been excluded from the weighted analysis to provide a more accurate market indication.`,
    36, y, 540);

  y += 8;

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
    head: [["Property", "Tenant", "City", "SF", "Rate/SF", "Type"]],
    body: compRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: {
      fontSize: 7.5,
      fontStyle: "bold",
      textColor: COLORS.creamMuted,
      fillColor: COLORS.headerBar,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
    },
    styles: {
      fontSize: 8.5,
      textColor: COLORS.cream,
      cellPadding: { top: 3.5, bottom: 3.5, left: 6, right: 6 },
    },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right", fontStyle: "bold", textColor: COLORS.teal },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
    },
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  // Summary box
  doc.setFillColor(...COLORS.darkPanel);
  doc.roundedRect(36, y, 540, 50, 4, 4, "F");
  doc.setFillColor(...COLORS.teal);
  doc.rect(36, y + 4, 3, 42, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.cream);
  doc.text(`Market Weighted Average Rate: ${fmtRate(compWeightedRate)}/SF`, 50, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(`Based on ${trimmed.length} comps (outliers excluded) | Total comp SF analyzed: ${fmtSF(compTotalSF)}`, 50, y + 34);

  addFooter(doc, 2, 4, date);

  // ── PAGE 3: Market Comparison ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 2, "Unit-by-Unit Market Comparison", y);

  y = addParagraph(doc,
    `Each unit in the subject property is compared against market comps matched by square footage range (±30%). The market rate column reflects the trimmed average of comparable leases for similarly-sized spaces.`,
    36, y, 540);
  y += 8;

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
      fmtPct(delta),
      fmt(Math.round(gap)),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Unit", "Tenant", "SF", "Your Rate", "Market Rate", "Delta", "Annual Gap"]],
    body: unitRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: {
      fontSize: 7.5,
      fontStyle: "bold",
      textColor: COLORS.creamMuted,
      fillColor: COLORS.headerBar,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
    },
    styles: {
      fontSize: 8.5,
      textColor: COLORS.cream,
      cellPadding: { top: 3, bottom: 3, left: 6, right: 6 },
    },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right", textColor: COLORS.coral },
      4: { halign: "right", textColor: COLORS.teal, fontStyle: "bold" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
      // Color the delta column
      if (data.section === "body" && data.column.index === 5) {
        const val = parseFloat(String(data.cell.raw).replace("+", ""));
        if (val > 0) data.cell.styles.textColor = COLORS.green;
        else if (val < -2) data.cell.styles.textColor = COLORS.coral;
        else data.cell.styles.textColor = COLORS.amber;
      }
      if (data.section === "body" && data.column.index === 6) {
        const val = String(data.cell.raw);
        if (val.startsWith("$") && !val.startsWith("$-") && val !== "$0") data.cell.styles.textColor = COLORS.green;
        else data.cell.styles.textColor = COLORS.coral;
      }
    },
  });

  addFooter(doc, 3, 4, date);

  // ── PAGE 4: Valuation Reconciliation ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 3, "Valuation Reconciliation", y);

  // Three scenario boxes
  const scenarios = [
    { label: "Conservative", cap: capRates.conservative, color: COLORS.amber },
    { label: "Market", cap: capRates.market, color: COLORS.teal },
    { label: "Aggressive", cap: capRates.aggressive, color: COLORS.green },
  ];

  // As-Is valuation
  y = addParagraph(doc, "As-Is Valuation — Based on Current Income", 36, y, 540);
  doc.setFont("helvetica", "bold");
  y += 4;

  const asIsRows = scenarios.map((s) => {
    const val = totalAnnualRent > 0 ? Math.round(totalAnnualRent / s.cap) : 0;
    return [s.label, `${(s.cap * 100).toFixed(1)}%`, fmt(totalAnnualRent), fmt(val), fmtRate(val / (totalSF || 1))];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap Rate", "NOI", "Indicated Value", "$/SF"]],
    body: asIsRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: {
      fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted,
      fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
    },
    styles: {
      fontSize: 9, textColor: COLORS.cream,
      cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold", textColor: COLORS.coral },
      4: { halign: "right" },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
    },
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  // Stabilized valuation
  y = addParagraph(doc, "Stabilized Valuation — At Market Rates", 36, y, 540);
  doc.setFont("helvetica", "bold");
  y += 4;

  const stabRows = scenarios.map((s) => {
    const val = marketAnnualRent > 0 ? Math.round(marketAnnualRent / s.cap) : 0;
    return [s.label, `${(s.cap * 100).toFixed(1)}%`, fmt(Math.round(marketAnnualRent)), fmt(val), fmtRate(val / (totalSF || 1))];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap Rate", "Market NOI", "Indicated Value", "$/SF"]],
    body: stabRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: {
      fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted,
      fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
    },
    styles: {
      fontSize: 9, textColor: COLORS.cream,
      cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold", textColor: COLORS.teal },
      4: { halign: "right" },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
    },
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  // Value summary box
  const revDelta = marketAnnualRent - totalAnnualRent;
  doc.setFillColor(...COLORS.darkPanel);
  doc.roundedRect(36, y, 540, 80, 4, 4, "F");
  doc.setFillColor(...(revDelta > 0 ? COLORS.green : COLORS.coral));
  doc.rect(36, y + 4, 3, 72, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.cream);
  doc.text("OPINION OF VALUE SUMMARY", 50, y + 18);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(`As-Is Value (current income at ${(capRates.market * 100).toFixed(1)}% cap):`, 50, y + 36);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.coral);
  doc.text(fmt(asIsValue), 340, y + 36);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(`Stabilized Value (market rates at ${(capRates.market * 100).toFixed(1)}% cap):`, 50, y + 52);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.teal);
  doc.text(fmt(stabilizedValue), 340, y + 52);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.creamMuted);
  doc.text(`Revenue upside at market rates:`, 50, y + 68);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...(revDelta > 0 ? COLORS.green : COLORS.coral));
  doc.text(`${fmt(Math.abs(Math.round(revDelta)))}/yr`, 340, y + 68);

  addFooter(doc, 4, 4, date);

  return doc;
}

// ── REPORT: Rental Opinion ─────────────────────────────────
function generateRentalOpinion(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps } = data;
  const date = data.preparedDate || today();
  const headerTitle = "RENTAL OPINION";
  const headerSub = `${propertyName}${propertyAddress ? " | " + propertyAddress : ""} | CONFIDENTIAL`;

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
  addHeader(doc, headerTitle, headerSub);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.cream);
  doc.text("RENTAL OPINION", 36, 80);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.teal);
  doc.text(propertyName, 36, 104);

  if (propertyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.creamMuted);
    doc.text(propertyAddress, 36, 120);
  }

  // Value boxes
  addValueBox(doc, 36, 148, 166, 68, "Current Avg Rate/SF", fmtRate(intakeWeightedRate),
    `${fmtSF(occupiedSF)} SF occupied`, COLORS.coral);
  addValueBox(doc, 214, 148, 166, 68, "Market Avg Rate/SF", fmtRate(compWeightedRate),
    `${trimmed.length} comps (trimmed)`, COLORS.teal);
  addValueBox(doc, 392, 148, 184, 68, "Annual Revenue Gap",
    fmt(Math.abs(Math.round(marketAnnualRent - totalAnnualRent))),
    marketAnnualRent > totalAnnualRent ? "Upside potential" : "Above market",
    marketAnnualRent > totalAnnualRent ? COLORS.green : COLORS.amber);

  // Property summary
  let y = 240;
  y = addSectionTitle(doc, 0, "Rent Roll Summary", y);

  const summary = [
    ["Property", propertyName],
    ["Total SF", fmtSF(totalSF)],
    ["Occupied Units", `${occupiedUnits.length} (${occupancyRate.toFixed(1)}% occupancy)`],
    ["Vacant Units", `${vacantUnits.length}`],
    ["Current Annual Revenue", fmt(totalAnnualRent)],
    ["Current Weighted Avg Rate", `${fmtRate(intakeWeightedRate)}/SF`],
    ["Market Weighted Avg Rate", `${fmtRate(compWeightedRate)}/SF`],
    ["Market Annual Revenue", fmt(Math.round(marketAnnualRent))],
    ["Effective Date", date],
  ];

  autoTable(doc, {
    startY: y,
    head: [],
    body: summary,
    theme: "plain",
    margin: { left: 36, right: 36 },
    styles: { fontSize: 9, textColor: COLORS.cream, cellPadding: { top: 4, bottom: 4, left: 8, right: 8 } },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 180, textColor: COLORS.creamMuted } },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => { if (data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt; },
  });

  addFooter(doc, 1, 3, date);

  // ── PAGE 2: Comp Analysis ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 1, "Comparable Lease Analysis", y);

  y = addParagraph(doc,
    `The following comparable leases were analyzed. Outliers (highest and lowest rates) are excluded from the weighted average to reduce distortion from non-representative transactions.`,
    36, y, 540);
  y += 8;

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
    head: [["Property", "Tenant", "City", "SF", "Rate/SF", "Type"]],
    body: compRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted, fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    styles: { fontSize: 8.5, textColor: COLORS.cream, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 } },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold", textColor: COLORS.teal } },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => { if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt; },
  });

  addFooter(doc, 2, 3, date);

  // ── PAGE 3: Unit-by-Unit ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 2, "Unit-by-Unit Rental Analysis", y);

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
      fmtPct(delta),
      fmt(Math.round(gap)),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Unit", "Tenant", "SF", "Current Rate", "Market Rate", "Delta", "Annual Gap"]],
    body: unitRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted, fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    styles: { fontSize: 8.5, textColor: COLORS.cream, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 } },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right", textColor: COLORS.coral },
      4: { halign: "right", textColor: COLORS.teal, fontStyle: "bold" },
      5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
      if (data.section === "body" && data.column.index === 5) {
        const val = parseFloat(String(data.cell.raw).replace("+", ""));
        if (val > 0) data.cell.styles.textColor = COLORS.green;
        else if (val < -2) data.cell.styles.textColor = COLORS.coral;
        else data.cell.styles.textColor = COLORS.amber;
      }
      if (data.section === "body" && data.column.index === 6) {
        const val = String(data.cell.raw);
        if (!val.startsWith("$-") && val !== "$0") data.cell.styles.textColor = COLORS.green;
        else data.cell.styles.textColor = COLORS.coral;
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  // Totals
  doc.setFillColor(...COLORS.darkPanel);
  doc.roundedRect(36, y, 540, 36, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.cream);
  doc.text(`${occupiedUnits.length} units compared`, 50, y + 14);
  doc.setTextColor(...COLORS.coral);
  doc.text(`Current: ${fmt(totalAnnualRent)}`, 250, y + 14);
  doc.setTextColor(...COLORS.teal);
  doc.text(`Market: ${fmt(Math.round(marketAnnualRent))}`, 380, y + 14);
  const gap = marketAnnualRent - totalAnnualRent;
  doc.setTextColor(...(gap > 0 ? COLORS.green : COLORS.coral));
  doc.text(`Gap: ${fmt(Math.abs(Math.round(gap)))}`, 490, y + 14);

  addFooter(doc, 3, 3, date);
  return doc;
}

// ── REPORT: Stabilized Valuation ───────────────────────────
function generateStabilizedValuation(data: ReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { propertyName, propertyAddress, units, comps } = data;
  const date = data.preparedDate || today();
  const headerTitle = "STABILIZED VALUATION ANALYSIS";
  const headerSub = `${propertyName}${propertyAddress ? " | " + propertyAddress : ""} | CONFIDENTIAL`;

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
    { label: "Conservative", rate: 0.09, desc: "Higher risk / older asset / secondary market" },
    { label: "Moderate", rate: 0.08, desc: "Average market conditions" },
    { label: "Market", rate: 0.075, desc: "Current market cap rate" },
    { label: "Aggressive", rate: 0.065, desc: "Strong market / stabilized asset / prime location" },
    { label: "Premium", rate: 0.055, desc: "Trophy asset / long-term credit tenants" },
  ];

  // ── PAGE 1: Cover ──
  addPageBg(doc);
  addHeader(doc, headerTitle, headerSub);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.cream);
  doc.text("STABILIZED VALUATION ANALYSIS", 36, 80);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.green);
  doc.text(propertyName, 36, 104);

  if (propertyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.creamMuted);
    doc.text(propertyAddress, 36, 120);
  }

  // Three value boxes
  const marketVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.075) : 0;
  const consVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.09) : 0;
  const aggVal = marketAnnualRent > 0 ? Math.round(marketAnnualRent / 0.065) : 0;

  addValueBox(doc, 36, 148, 166, 68, "Conservative (9.0% Cap)", fmt(consVal),
    `${fmtRate(consVal / (totalSF || 1))}/SF`, COLORS.amber);
  addValueBox(doc, 214, 148, 166, 68, "Market (7.5% Cap)", fmt(marketVal),
    `${fmtRate(marketVal / (totalSF || 1))}/SF`, COLORS.teal);
  addValueBox(doc, 392, 148, 184, 68, "Aggressive (6.5% Cap)", fmt(aggVal),
    `${fmtRate(aggVal / (totalSF || 1))}/SF`, COLORS.green);

  let y = 240;
  y = addSectionTitle(doc, 0, "Income Summary", y);

  const incomeSummary = [
    ["Current Annual Revenue", fmt(totalAnnualRent)],
    ["Current Weighted Rate", `${fmtRate(totalSF > 0 ? totalAnnualRent / totalSF : 0)}/SF`],
    ["Market Annual Revenue", fmt(Math.round(marketAnnualRent))],
    ["Market Weighted Rate", `${fmtRate(compWeightedRate)}/SF`],
    ["Revenue Gap", fmt(Math.abs(Math.round(marketAnnualRent - totalAnnualRent)))],
    ["Total SF", fmtSF(totalSF)],
    ["Occupied Units", `${occupiedUnits.length} of ${units.length}`],
    ["Comps Used", `${trimmed.length} (outliers excluded from ${compsWithRate.length})`],
    ["Effective Date", date],
  ];

  autoTable(doc, {
    startY: y,
    body: incomeSummary,
    theme: "plain",
    margin: { left: 36, right: 36 },
    styles: { fontSize: 9, textColor: COLORS.cream, cellPadding: { top: 4, bottom: 4, left: 8, right: 8 } },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 200, textColor: COLORS.creamMuted } },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => { if (data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt; },
  });

  addFooter(doc, 1, 3, date);

  // ── PAGE 2: Cap Rate Scenarios ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 1, "Cap Rate Valuation Scenarios — Current Income", y);

  y = addParagraph(doc,
    `Valuation based on current in-place income. This represents the property's value to a buyer based on the existing rent roll without adjusting rents to market levels.`,
    36, y, 540);
  y += 8;

  const asIsRows = capRates.map((s) => {
    const val = totalAnnualRent > 0 ? Math.round(totalAnnualRent / s.rate) : 0;
    return [s.label, `${(s.rate * 100).toFixed(1)}%`, fmt(totalAnnualRent), fmt(val), fmtRate(val / (totalSF || 1)), s.desc];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap Rate", "NOI", "Value", "$/SF", "Rationale"]],
    body: asIsRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted, fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    styles: { fontSize: 8.5, textColor: COLORS.cream, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold", textColor: COLORS.coral },
      4: { halign: "right" },
      5: { fontSize: 7, textColor: COLORS.creamMuted },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => { if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt; },
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  y = addSectionTitle(doc, 2, "Cap Rate Valuation Scenarios — Stabilized (Market Rates)", y);

  y = addParagraph(doc,
    `Valuation based on market-rate income. This represents the property's value if all occupied units were leased at current market rates, reflecting the asset's full income potential.`,
    36, y, 540);
  y += 8;

  const stabRows = capRates.map((s) => {
    const val = marketAnnualRent > 0 ? Math.round(marketAnnualRent / s.rate) : 0;
    return [s.label, `${(s.rate * 100).toFixed(1)}%`, fmt(Math.round(marketAnnualRent)), fmt(val), fmtRate(val / (totalSF || 1)), s.desc];
  });

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Cap Rate", "Market NOI", "Value", "$/SF", "Rationale"]],
    body: stabRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted, fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    styles: { fontSize: 8.5, textColor: COLORS.cream, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold", textColor: COLORS.teal },
      4: { halign: "right" },
      5: { fontSize: 7, textColor: COLORS.creamMuted },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => { if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt; },
  });

  addFooter(doc, 2, 3, date);

  // ── PAGE 3: Summary ──
  newPage(doc, headerTitle, headerSub);
  y = 56;
  y = addSectionTitle(doc, 3, "Valuation Summary & Value Range", y);

  y = addParagraph(doc,
    `The following table summarizes the indicated value range across all cap rate scenarios for both current income and stabilized (market rate) income approaches.`,
    36, y, 540);
  y += 8;

  const summaryRows = [
    ["As-Is — Conservative", `${fmt(Math.round(totalAnnualRent / 0.09))}`, "Current income at 9.0% cap"],
    ["As-Is — Market", `${fmt(Math.round(totalAnnualRent / 0.075))}`, "Current income at 7.5% cap"],
    ["As-Is — Aggressive", `${fmt(Math.round(totalAnnualRent / 0.065))}`, "Current income at 6.5% cap"],
    ["", "", ""],
    ["Stabilized — Conservative", `${fmt(Math.round(marketAnnualRent / 0.09))}`, "Market rates at 9.0% cap"],
    ["Stabilized — Market", `${fmt(Math.round(marketAnnualRent / 0.075))}`, "Market rates at 7.5% cap"],
    ["Stabilized — Aggressive", `${fmt(Math.round(marketAnnualRent / 0.065))}`, "Market rates at 6.5% cap"],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Scenario", "Indicated Value", "Basis"]],
    body: summaryRows,
    theme: "plain",
    margin: { left: 36, right: 36 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: COLORS.creamMuted, fillColor: COLORS.headerBar, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 } },
    styles: { fontSize: 9, textColor: COLORS.cream, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 } },
    columnStyles: {
      0: { fontStyle: "bold" },
      1: { halign: "right", fontStyle: "bold" },
      2: { textColor: COLORS.creamMuted, fontSize: 8 },
    },
    alternateRowStyles: { fillColor: COLORS.tableRow },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index % 2 === 0) data.cell.styles.fillColor = COLORS.tableRowAlt;
      if (data.section === "body" && data.column.index === 1) {
        if (data.row.index < 3) data.cell.styles.textColor = COLORS.coral;
        else if (data.row.index > 3) data.cell.styles.textColor = COLORS.teal;
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 20;

  // Disclosures
  y = addSectionTitle(doc, 4, "Disclosures & Limiting Conditions", y);
  addParagraph(doc,
    `This Stabilized Valuation Analysis is prepared by Stewardship Asset Group for internal strategy discussions. It is based on market comparable data and the in-place rent roll as of the effective date. Cap rate scenarios are provided to illustrate value sensitivity across market conditions. This analysis does not constitute a certified MAI appraisal and is not intended for use in litigation, financing, or regulatory proceedings. Comparable lease data is sourced from proprietary databases and may not reflect all market transactions. Recipients should conduct independent due diligence before making investment decisions based on this analysis.`,
    36, y, 540);

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
