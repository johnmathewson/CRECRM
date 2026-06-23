/**
 * Tenant LOI PDF generator.
 *
 * Matches John Mathewson's Liberty Square LOI template (May 2026,
 * extracted from Liberty_Square_4151W_LOI_Draft.pdf). 3-page business
 * letter format, black on white, Helvetica body / Helvetica-Bold
 * headers. Designed to be edited downstream in Word — the structure
 * is rigid, the prose is conservative.
 *
 * Document structure:
 *   1. Header: "LETTER OF INTENT TO LEASE" + property subtitle + date
 *   2. To: block (Landlord + Listing Broker)
 *   3. From: block (Tenant)
 *   4. Intro disclaimer (verbatim boilerplate)
 *   5. Sixteen numbered sections (§1–§16):
 *        §1  Premises
 *        §2  Landlord
 *        §3  Tenant
 *        §4  Permitted Use
 *        §5  Initial Term
 *        §6  Renewal Options
 *        §7  Base Rent (year-by-year escalation table)
 *        §8  Lease Type & Operating Expenses
 *        §9  Free Rent / Rent Abatement
 *        §10 Tenant Improvement Allowance
 *        §11 Security Deposit
 *        §12 Personal Guarantee
 *        §13 Brokerage
 *        §14 Contingencies
 *        §15 Confidentiality (verbatim)
 *        §16 Non-Binding Effect (verbatim)
 *   6. Signature blocks: Tenant + Landlord
 *   7. Per-page footer: "Letter of Intent — [Property] — Page X of N"
 *
 * Rent schedule math (matches the template's rounding behavior):
 *   - Per-SF rate compounds annually at the escalation rate,
 *     rounded to 2 decimals each year (so Year 3 escalates off
 *     the rounded Year 2 rate, not the exact value).
 *   - Annual rent = round(perSfRate × RSF) to whole dollars
 *   - Monthly rent = annual / 12 to 2 decimals
 */

import jsPDF from "jspdf";

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Stepped/discounted rent during Year 1. After the last ramp ends,
 *  Year 1 fills in at baseRentPerSf, then Year 2+ escalates off the
 *  full base — NOT off the ramp rate. */
export interface RampPeriod {
  label: string;            // "Months 1-6"
  monthsStart: number;      // 1
  monthsEnd: number;        // 6
  baseRentPerSf: number;    // 9.50
}

export interface LOIInput {
  // Property / premises
  propertyName: string;             // "Liberty Square Shopping Center"
  premisesUnitLabel: string;        // "Unit 41-51 W 78th Place"
  premisesAddress: string;          // "7880-7896 Broadway, Merrillville, IN 46410"
  premisesRSF: number;

  // Landlord (defaults from property.true_owner_name or owner_name_raw)
  landlordEntity: string;

  // Tenant
  tenantEntity: string;             // "M'Bodied Mvmt LLC"
  tenantSigningName: string;        // "Marisa Winslow"
  tenantSigningTitle: string;       // "Founder, M'Bodied Mvmt"
  tenantAddress: string;            // "1320 Brandywine Rd"
  tenantCity: string;
  tenantState: string;
  tenantZip: string;

  // Listing broker (org-level constants)
  brokerName: string;               // "John Mathewson"
  brokerage: string;                // "eXp Commercial"
  brokerEmail: string;
  brokerPhone: string;

  // Tenant broker (§13 — null/empty if unrepresented)
  tenantBrokerName?: string | null;
  tenantBrokerage?: string | null;

  // Document date + economic terms
  documentDate: Date;
  permittedUse: string;             // §4
  termYears: number;                // §5
  commencementDate: Date;           // §5
  renewalOptionsCount: number;      // §6 — e.g. 2
  renewalTermYears: number;         // §6 — e.g. 3
  renewalNoticeDays: number;        // §6 — e.g. 90
  baseRentPerSf: number;            // §7 Year 1 "full" rate
  annualEscalationPct: number;      // §7 — e.g. 3.5 (percent, not decimal)
  /** Optional stepped/discount periods for Year 1. */
  rampPeriods?: RampPeriod[];
  /** Optional NNN/CAM/Tax pass-through ($/SF/yr). When present, §7
   *  renders an NNN column + all-in monthly. Flat across the term. */
  nnnPerSf?: number | null;
  leaseType: "NNN" | "Modified Gross" | "Gross" | "Industrial Gross" | "Full Service" | "Absolute Net";
  freeRentMonths: number;           // §9
  tiDescription: string;            // §10 — freeform
  securityDepositMonths: number;    // §11 — usually 1
  personalGuarantee: boolean;       // §12
  contingencies: string;            // §14 — "None" or freeform
}

// ── Formatting helpers ─────────────────────────────────────────────────────
const fmtMoney0 = (n: number): string =>
  "$" + Math.round(n).toLocaleString("en-US");
const fmtMoney2 = (n: number): string =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPerSf = (n: number): string =>
  "$" + n.toFixed(2);
const fmtDate = (d: Date): string =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const fmtRSF = (n: number): string => n.toLocaleString("en-US");

// Number → "Five (5)" style spelled cardinal used throughout the
// template. Falls back to plain digits past 12 (rare in LOIs).
const SPELLED: Record<number, string> = {
  0: "Zero", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
  6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten",
  11: "Eleven", 12: "Twelve",
};
const spellNum = (n: number): string =>
  SPELLED[n] ? `${SPELLED[n]} (${n})` : `${n}`;

// ── Rent schedule ──────────────────────────────────────────────────────────

/** A single row in the §7 rent schedule. Covers an arbitrary
 *  consecutive month-range (ramp rows are sub-year; year rows
 *  span 12 months). */
interface RentScheduleRow {
  label: string;          // "Months 1-6" / "Year 1 (Months 7-12)" / "Year 2"
  baseMonthly: number;    // base rent for one month at this rate
  basePerSf: number;      // base $/SF/yr
  nnnMonthly: number;     // NNN/CAM/Tax monthly (0 if no NNN line)
  nnnPerSf: number;       // NNN $/SF/yr (0 if no NNN line)
  allInMonthly: number;   // baseMonthly + nnnMonthly
}

/** Round per-SF to 2 decimals each year so compounding works on the
 *  rounded value — matches how broker templates do the math. */
function compoundYearly(start: number, escalationPct: number, years: number): number[] {
  const out: number[] = [];
  let perSf = start;
  const factor = 1 + escalationPct / 100;
  for (let y = 0; y < years; y += 1) {
    const rounded = Math.round(perSf * 100) / 100;
    out.push(rounded);
    perSf = rounded * factor;
  }
  return out;
}

function buildRentSchedule(input: LOIInput): RentScheduleRow[] {
  const { baseRentPerSf, annualEscalationPct, termYears, premisesRSF } = input;
  const rsf = premisesRSF;
  const nnnPerSf = input.nnnPerSf && input.nnnPerSf > 0 ? input.nnnPerSf : 0;
  const nnnMonthly =
    nnnPerSf > 0 ? Math.round(((nnnPerSf * rsf) / 12) * 100) / 100 : 0;

  const rows: RentScheduleRow[] = [];

  // Per-SF rate for each year (Year 1 is baseRentPerSf, Year 2+ compounds)
  const yearRates = compoundYearly(baseRentPerSf, annualEscalationPct, termYears);

  // ── Ramp periods (sub-Year-1 stepped/discount rows) ─────────────────────
  const ramps = (input.rampPeriods ?? [])
    .slice()
    .filter((r) => r.monthsStart >= 1 && r.monthsEnd >= r.monthsStart && r.monthsEnd <= 12)
    .sort((a, b) => a.monthsStart - b.monthsStart);

  let lastCoveredMonth = 0;
  for (const ramp of ramps) {
    const baseMonthly = Math.round(((ramp.baseRentPerSf * rsf) / 12) * 100) / 100;
    rows.push({
      label: ramp.label || `Months ${ramp.monthsStart}-${ramp.monthsEnd}`,
      baseMonthly,
      basePerSf: ramp.baseRentPerSf,
      nnnMonthly,
      nnnPerSf,
      allInMonthly: Math.round((baseMonthly + nnnMonthly) * 100) / 100,
    });
    lastCoveredMonth = Math.max(lastCoveredMonth, ramp.monthsEnd);
  }

  // Year-1 fill: if ramps don't cover months 1–12, the remainder runs
  // at the full Year 1 rate.
  if (lastCoveredMonth < 12) {
    const fillStart = lastCoveredMonth + 1;
    const fullPerSf = yearRates[0];
    const fullMonthly = Math.round(((fullPerSf * rsf) / 12) * 100) / 100;
    rows.push({
      label:
        ramps.length === 0
          ? "Year 1"
          : `Months ${fillStart}-12`,
      baseMonthly: fullMonthly,
      basePerSf: fullPerSf,
      nnnMonthly,
      nnnPerSf,
      allInMonthly: Math.round((fullMonthly + nnnMonthly) * 100) / 100,
    });
  }

  // ── Year 2 through Year N ───────────────────────────────────────────────
  for (let y = 2; y <= termYears; y += 1) {
    const perSf = yearRates[y - 1];
    const monthly = Math.round(((perSf * rsf) / 12) * 100) / 100;
    rows.push({
      label: `Year ${y}`,
      baseMonthly: monthly,
      basePerSf: perSf,
      nnnMonthly,
      nnnPerSf,
      allInMonthly: Math.round((monthly + nnnMonthly) * 100) / 100,
    });
  }

  return rows;
}

// ── Page layout ────────────────────────────────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 90;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// ── Renderer ───────────────────────────────────────────────────────────────
export function generateLOI(input: LOIInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // We render the body sequentially, tracking the running y-coordinate.
  // When a section would overflow the page, we addPage() and reset y.
  // Footers are painted at the end (one per page) so the page numbers
  // are accurate.
  let y = MARGIN_TOP;

  const rentSchedule = buildRentSchedule(input);
  // Security deposit is calibrated to the FULL Year 1 base rent — not
  // a discounted ramp. So we find the row that represents Year 1 at
  // full rate (basePerSf === input.baseRentPerSf) and use its monthly.
  const year1FullRow = rentSchedule.find(
    (r) => Math.abs(r.basePerSf - input.baseRentPerSf) < 0.005
  );
  const year1Monthly = year1FullRow?.baseMonthly ?? rentSchedule[0]?.baseMonthly ?? 0;
  const hasNNNColumn = (input.nnnPerSf ?? 0) > 0;

  function ensureSpace(needed: number): void {
    if (y + needed > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
  }

  function setBody(): void {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(0, 0, 0);
  }
  function setBold(): void {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(0, 0, 0);
  }

  function drawWrapped(text: string, x: number, startY: number, width: number, lineHeight = 13): number {
    const lines = doc.splitTextToSize(text, width) as string[];
    for (const line of lines) {
      doc.text(line, x, startY);
      startY += lineHeight;
    }
    return startY;
  }

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text("LETTER OF INTENT TO LEASE", PAGE_W / 2, y, { align: "center" });
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(
    `${input.propertyName} — ${input.premisesUnitLabel}`,
    PAGE_W / 2,
    y,
    { align: "center" },
  );
  y += 22;

  // Date line — left-aligned, underline-style placeholder if blank
  setBody();
  doc.text(`Date: ${fmtDate(input.documentDate)}`, MARGIN_X, y);
  y += 22;

  // ── To: block ────────────────────────────────────────────────────────────
  setBody();
  doc.text("To:", MARGIN_X, y);
  y += 14;
  doc.text(`${input.landlordEntity} ("Landlord")`, MARGIN_X, y);
  y += 13;
  doc.text(
    `c/o ${input.brokerName}, ${input.brokerage} — Listing Broker`,
    MARGIN_X,
    y,
  );
  y += 13;
  doc.text(`${input.brokerEmail} | ${input.brokerPhone}`, MARGIN_X, y);
  y += 20;

  // ── From: block ──────────────────────────────────────────────────────────
  doc.text("From:", MARGIN_X, y);
  y += 14;
  doc.text(`Tenant Name: ${input.tenantEntity}`, MARGIN_X, y);
  y += 13;
  doc.text(`Tenant Address: ${input.tenantAddress}`, MARGIN_X, y);
  y += 13;
  doc.text(
    `${input.tenantCity}, ${input.tenantState} ${input.tenantZip}`,
    MARGIN_X,
    y,
  );
  y += 22;

  // ── Intro disclaimer (verbatim) ──────────────────────────────────────────
  const intro =
    `This Letter of Intent ("LOI") sets forth the principal terms upon ` +
    `which the undersigned Tenant proposes to lease space at ${input.propertyName}. ` +
    `This LOI is intended only as a framework for further negotiation. Except ` +
    `for the obligations of confidentiality set forth herein, no party shall ` +
    `be bound by these terms unless and until a definitive lease agreement has ` +
    `been fully executed and delivered by both Landlord and Tenant.`;
  setBody();
  y = drawWrapped(intro, MARGIN_X, y, CONTENT_W, 13);
  y += 14;

  // ── Section renderer ─────────────────────────────────────────────────────
  function section(num: number, title: string, body: string): void {
    ensureSpace(40);
    setBold();
    doc.text(`${num}. ${title}`, MARGIN_X, y);
    y += 14;
    setBody();
    y = drawWrapped(body, MARGIN_X, y, CONTENT_W, 13);
    y += 10;
  }

  // §1 Premises
  section(
    1,
    "Premises",
    `Approximately ${fmtRSF(input.premisesRSF)} rentable square feet ("RSF") located at ${input.premisesUnitLabel}, within ${input.propertyName}, ${input.premisesAddress} (the "Premises").`,
  );

  // §2 Landlord
  section(2, "Landlord", `${input.landlordEntity}.`);

  // §3 Tenant
  section(3, "Tenant", input.tenantEntity);

  // §4 Permitted Use
  section(4, "Permitted Use", input.permittedUse);

  // §5 Initial Term
  section(
    5,
    "Initial Term",
    `${spellNum(input.termYears)} years, commencing on or about ${fmtDate(input.commencementDate)} (the "Commencement Date"), subject to delivery of the Premises by Landlord in the agreed-upon condition.`,
  );

  // §6 Renewal Options
  if (input.renewalOptionsCount > 0) {
    section(
      6,
      "Renewal Options",
      `${spellNum(input.renewalOptionsCount)} options to renew, each for a term of ${spellNum(input.renewalTermYears)} years, exercisable by Tenant upon not less than ${spellNum(input.renewalNoticeDays)} days' prior written notice to Landlord. Base Rent during each renewal term shall continue at the same ${input.annualEscalationPct.toFixed(1)}% annual escalation rate established in the initial Term.`,
    );
  } else {
    section(6, "Renewal Options", "None.");
  }

  // §7 Base Rent — multi-column table. Columns differ based on whether
  // NNN is broken out: when NNN is set we show Base + NNN + All-In;
  // otherwise just the base columns.
  const tableHeaderH = 16;
  const tableRowH = 13;
  ensureSpace(40 + tableHeaderH + rentSchedule.length * tableRowH);
  setBold();
  doc.text("7. Base Rent", MARGIN_X, y);
  y += 14;

  // Column layout (x offsets within content area). Tuned for letter-
  // portrait at 72pt margins. The "with NNN" variant is denser but
  // still readable; if you change the page margins, retune these.
  type Col = { x: number; w: number; align: "left" | "right"; label: string };
  const colsWithNNN: Col[] = [
    { x: MARGIN_X,        w: 110, align: "left",  label: "Period" },
    { x: MARGIN_X + 110,  w:  68, align: "right", label: "Base $/SF" },
    { x: MARGIN_X + 178,  w:  80, align: "right", label: "Base Monthly" },
    { x: MARGIN_X + 258,  w:  62, align: "right", label: "NNN $/SF" },
    { x: MARGIN_X + 320,  w:  72, align: "right", label: "NNN Monthly" },
    { x: MARGIN_X + 392,  w:  76, align: "right", label: "All-In Monthly" },
  ];
  const colsNoNNN: Col[] = [
    { x: MARGIN_X,        w: 150, align: "left",  label: "Period" },
    { x: MARGIN_X + 150,  w:  90, align: "right", label: "Base $/SF" },
    { x: MARGIN_X + 240,  w: 110, align: "right", label: "Annual" },
    { x: MARGIN_X + 350,  w: 118, align: "right", label: "Monthly" },
  ];
  const cols = hasNNNColumn ? colsWithNNN : colsNoNNN;

  // Header row
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  for (const c of cols) {
    const xText = c.align === "right" ? c.x + c.w : c.x;
    doc.text(c.label.toUpperCase(), xText, y, { align: c.align, charSpace: 0.6 });
  }
  y += 4;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 10;

  // Data rows
  setBody();
  doc.setFontSize(10);
  for (const row of rentSchedule) {
    if (hasNNNColumn) {
      const annualBase = Math.round(row.basePerSf * input.premisesRSF);
      const cells = [
        row.label,
        fmtPerSf(row.basePerSf),
        fmtMoney2(row.baseMonthly),
        fmtPerSf(row.nnnPerSf),
        fmtMoney2(row.nnnMonthly),
        fmtMoney2(row.allInMonthly),
      ];
      // Suppress unused — kept so a future "Annual" column could plug in
      void annualBase;
      cells.forEach((val, idx) => {
        const c = cols[idx];
        const xText = c.align === "right" ? c.x + c.w : c.x;
        doc.text(val, xText, y, { align: c.align });
      });
    } else {
      const annual = Math.round(row.basePerSf * input.premisesRSF);
      const cells = [
        row.label,
        fmtPerSf(row.basePerSf),
        fmtMoney0(annual),
        fmtMoney2(row.baseMonthly),
      ];
      cells.forEach((val, idx) => {
        const c = cols[idx];
        const xText = c.align === "right" ? c.x + c.w : c.x;
        doc.text(val, xText, y, { align: c.align });
      });
    }
    y += tableRowH;
  }
  y += 10;

  // §8 Lease Type & Operating Expenses
  let leaseTypeText = "";
  if (input.leaseType === "NNN") {
    const nnnEstimate = (input.nnnPerSf ?? 0) > 0
      ? ` Landlord's current estimate of Operating Expenses is approximately ${fmtPerSf(input.nnnPerSf!)} per RSF per year, reflected as the NNN line in the rent schedule above; actual amounts will be reconciled annually.`
      : "";
    leaseTypeText = `Triple Net (NNN). In addition to Base Rent, Tenant shall pay its pro-rata share of Common Area Maintenance, Real Estate Taxes, and Insurance (collectively, "Operating Expenses").${nnnEstimate}`;
  } else if (input.leaseType === "Modified Gross") {
    leaseTypeText = `Modified Gross. Base Rent is inclusive of Landlord's portion of Real Estate Taxes, Insurance, and exterior Common Area Maintenance. Tenant is responsible for utilities, janitorial services, interior maintenance, and any increases in Operating Expenses above the base year.`;
  } else if (input.leaseType === "Gross") {
    leaseTypeText = `Gross. Base Rent is inclusive of Real Estate Taxes, Insurance, and Common Area Maintenance. Tenant is responsible for utilities and janitorial services only.`;
  } else if (input.leaseType === "Industrial Gross") {
    leaseTypeText = `Industrial Gross. Base Rent is inclusive of Real Estate Taxes and Insurance for the base year. Tenant pays utilities, janitorial, and its pro-rata share of increases in Operating Expenses above the base year.`;
  } else if (input.leaseType === "Full Service") {
    leaseTypeText = `Full Service. Base Rent is inclusive of all Operating Expenses including Real Estate Taxes, Insurance, Common Area Maintenance, utilities, and janitorial. Tenant pays its pro-rata share of increases above the base year.`;
  } else {
    leaseTypeText = `Absolute Net. Tenant shall pay all Operating Expenses including Real Estate Taxes, Insurance, Common Area Maintenance, utilities, structural repairs, and capital expenditures, with Landlord receiving Base Rent free of any deduction.`;
  }
  section(8, "Lease Type & Operating Expenses", leaseTypeText);

  // §9 Free Rent / Rent Abatement
  section(
    9,
    "Free Rent / Rent Abatement",
    input.freeRentMonths > 0
      ? `${spellNum(input.freeRentMonths)} month${input.freeRentMonths === 1 ? "" : "s"} of Base Rent abated, commencing on the Commencement Date. Operating Expenses (where applicable) shall remain payable during the abatement period.`
      : "None.",
  );

  // §10 Tenant Improvement Allowance
  section(10, "Tenant Improvement Allowance", input.tiDescription);

  // §11 Security Deposit
  const sdAmount = year1Monthly * input.securityDepositMonths;
  section(
    11,
    "Security Deposit",
    `${spellNum(input.securityDepositMonths)} month${input.securityDepositMonths === 1 ? "" : "s"} of Year 1 Base Rent (${fmtMoney2(sdAmount)}), payable upon mutual execution of the definitive lease agreement.`,
  );

  // §12 Personal Guarantee
  section(
    12,
    "Personal Guarantee",
    input.personalGuarantee
      ? "Tenant principal(s) shall provide a personal guarantee of the lease obligations in form and substance reasonably acceptable to Landlord."
      : "None required.",
  );

  // §13 Brokerage
  section(
    13,
    "Brokerage",
    input.tenantBrokerName
      ? `Tenant's Broker: ${input.tenantBrokerName}${input.tenantBrokerage ? `, ${input.tenantBrokerage}` : ""}.`
      : "Tenant is unrepresented.",
  );

  // §14 Contingencies
  section(14, "Contingencies", input.contingencies || "None.");

  // §15 Confidentiality (verbatim boilerplate)
  section(
    15,
    "Confidentiality",
    "The parties agree to keep the contents of this LOI and any subsequent negotiations confidential, except as required by law or to advisors with a legitimate need to know.",
  );

  // §16 Non-Binding Effect (verbatim boilerplate)
  section(
    16,
    "Non-Binding Effect",
    "This LOI is non-binding and is intended solely to outline the principal economic terms of a possible lease transaction. Neither party shall be obligated to proceed with the proposed lease unless and until a definitive lease agreement is fully executed and delivered. Either party may terminate negotiations at any time without liability.",
  );

  // ── Signature blocks ─────────────────────────────────────────────────────
  ensureSpace(180);
  y += 8;
  setBold();
  doc.text("SUBMITTED BY TENANT:", MARGIN_X, y);
  y += 28;

  setBody();
  // Signature line
  doc.line(MARGIN_X, y, MARGIN_X + 320, y);
  y += 14;
  doc.text(`Name (printed): ${input.tenantSigningName}`, MARGIN_X, y);
  y += 16;
  doc.text(`Title: ${input.tenantSigningTitle}`, MARGIN_X, y);
  y += 16;
  doc.text("Date: ____________________", MARGIN_X, y);
  y += 28;

  ensureSpace(120);
  setBold();
  doc.text("ACKNOWLEDGED BY LANDLORD:", MARGIN_X, y);
  y += 28;
  setBody();
  doc.line(MARGIN_X, y, MARGIN_X + 320, y);
  y += 14;
  doc.text(`${input.landlordEntity}`, MARGIN_X, y);
  y += 16;
  doc.text("Name (printed): ____________________", MARGIN_X, y);
  y += 16;
  doc.text("Title: ____________________", MARGIN_X, y);
  y += 16;
  doc.text("Date: ____________________", MARGIN_X, y);

  // ── Footer (per page) ────────────────────────────────────────────────────
  // Drawn last so the page count is accurate. jsPDF's
  // internal.getNumberOfPages is the authoritative count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPages = (doc.internal as any).getNumberOfPages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (doc.internal as any).getNumberOfPages()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (doc.internal as any).pages.length - 1;

  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    const footer = `Letter of Intent — ${input.propertyName}, ${input.premisesUnitLabel} — Page ${p} of ${totalPages}`;
    doc.text(footer, PAGE_W / 2, PAGE_H - 36, { align: "center" });
  }

  return doc;
}
