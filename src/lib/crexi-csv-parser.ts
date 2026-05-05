/**
 * Parses a CREXi "Lead Report" XLSX/CSV export into structured rows.
 *
 * CREXi's standard format (validated against Liberty Square Retail Center
 * export, May 2026):
 *   Row 1: Property name
 *   Row 2: Property address
 *   Row 3: Property summary ("Retail | 8.69% CAP | 48,327 SqFt")
 *   Row 4: "Activity Summary" header
 *   Row 5: ["Page Views", "Visitors", "Opened OMs/Flyers", "Executed CAs",
 *          "Offers", "Info Requests"]
 *   Row 6: Numeric totals corresponding to row 5
 *   Row 7: (blank)
 *   Row 8: Lead-data column headers — First | Last | Level of Interest |
 *          Phone | Email | Crexi Lead Score | Last Action Date | Company |
 *          Industry Role | City | State | Attachments |
 *          Estimated Buying Power | Note 1 | Note 2 | Note 3
 *   Row 9+: Individual lead rows
 *
 * The parser is defensive: it pattern-matches the lead-data header row by
 * looking for "First" + "Last" + "Email" cells, so minor row shifts don't
 * break it. It also handles both XLSX (binary) and CSV (text) inputs.
 */

import * as XLSX from "xlsx";

export interface CrexiActivitySummary {
  page_views: number | null;
  visitors: number | null;
  opened_oms: number | null;
  executed_cas: number | null;
  offers: number | null;
  info_requests: number | null;
}

export interface CrexiLeadRow {
  first_name: string;
  last_name: string;          // includes credentials like ", CCIM"
  full_name_clean: string;    // "Brett McDermott" — credentials stripped
  level_of_interest: string | null;  // "Visited Page" / "Executed CA" / etc.
  phone: string | null;       // raw 10-digit "2198640200"
  email: string | null;       // lowercased, trimmed
  crexi_lead_score: number | null;
  last_action_date: string | null;   // ISO string (converted from Excel serial)
  company: string | null;
  industry_role: string | null;      // "Listing Rep, Landlord Rep"
  city: string | null;
  state: string | null;
  attachments: string | null;        // "Confidentiality Agreement" or null
  estimated_buying_power: string | null;
  notes: string | null;              // joined Note 1/2/3
  // Sentinel: did the lead execute a CA per the Attachments column?
  ca_executed: boolean;
}

export interface CrexiParseResult {
  property_name: string | null;
  property_address: string | null;
  property_summary: string | null;
  activity_summary: CrexiActivitySummary | null;
  leads: CrexiLeadRow[];
  warnings: string[];
}

// ── XLSX/CSV input ────────────────────────────────────────────────────────

export function parseCrexiReport(input: Buffer | ArrayBuffer | string): CrexiParseResult {
  let workbook: XLSX.WorkBook;

  if (typeof input === "string") {
    // CSV path
    workbook = XLSX.read(input, { type: "string" });
  } else {
    // XLSX path
    const buf = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    workbook = XLSX.read(buf, { type: "buffer" });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // header:1 returns array-of-arrays; cellDates: false keeps Excel serials
  // as numbers so we can convert ourselves (mixing Date objects + strings
  // gets messy).
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });

  const warnings: string[] = [];

  // ── Property metadata (rows 1-3, 0-indexed: 0-2) ────────────────────────
  const property_name = (rows[0]?.[0] ?? "").toString().trim() || null;
  const property_address = (rows[1]?.[0] ?? "").toString().trim() || null;
  const property_summary = (rows[2]?.[0] ?? "").toString().trim() || null;

  // ── Activity summary (look for the row containing "Page Views") ─────────
  let activity_summary: CrexiActivitySummary | null = null;
  for (let i = 3; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    if (row.some((c) => String(c).trim().toLowerCase() === "page views")) {
      const values = rows[i + 1] || [];
      activity_summary = {
        page_views: toInt(values[0]),
        visitors: toInt(values[1]),
        opened_oms: toInt(values[2]),
        executed_cas: toInt(values[3]),
        offers: toInt(values[4]),
        info_requests: toInt(values[5]),
      };
      break;
    }
  }

  // ── Lead-data header row (look for "First" + "Last" + "Email") ──────────
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] || []).map((c) => String(c).trim().toLowerCase());
    if (row.includes("first") && row.includes("last") && row.includes("email")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    warnings.push("Couldn't find the lead-data header row. Expected First/Last/Email columns.");
    return { property_name, property_address, property_summary, activity_summary, leads: [], warnings };
  }

  const header = (rows[headerIdx] || []).map((c) => String(c).trim().toLowerCase());

  // Build a column-name → index lookup
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    first: col("first"),
    last: col("last"),
    level_of_interest: col("level of interest"),
    phone: col("phone"),
    email: col("email"),
    crexi_lead_score: col("crexi lead score"),
    last_action_date: col("last action date"),
    company: col("company"),
    industry_role: col("industry role"),
    city: col("city"),
    state: col("state"),
    attachments: col("attachments"),
    estimated_buying_power: col("estimated buying power"),
    note1: col("note 1"),
    note2: col("note 2"),
    note3: col("note 3"),
  };

  // ── Lead rows (everything below the header) ─────────────────────────────
  const leads: CrexiLeadRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const first = String(row[idx.first] ?? "").trim();
    const last = String(row[idx.last] ?? "").trim();
    if (!first && !last) continue; // skip blank rows

    const phoneRaw = String(row[idx.phone] ?? "").trim();
    const phoneDigits = phoneRaw.replace(/\D/g, "");
    const phone = phoneDigits.length >= 7 ? phoneDigits : null;

    const emailRaw = String(row[idx.email] ?? "").trim().toLowerCase();
    const email = emailRaw && emailRaw.includes("@") ? emailRaw : null;

    const lastActionSerial =
      idx.last_action_date >= 0 ? row[idx.last_action_date] : null;
    const last_action_date = excelSerialToISO(lastActionSerial);

    const attachments = idx.attachments >= 0 ? String(row[idx.attachments] ?? "").trim() : "";
    const ca_executed = /confidentiality agreement|executed ca/i.test(attachments);

    const notesParts = [
      idx.note1 >= 0 ? String(row[idx.note1] ?? "").trim() : "",
      idx.note2 >= 0 ? String(row[idx.note2] ?? "").trim() : "",
      idx.note3 >= 0 ? String(row[idx.note3] ?? "").trim() : "",
    ].filter(Boolean);

    leads.push({
      first_name: first,
      last_name: last,
      full_name_clean: cleanFullName(first, last),
      level_of_interest:
        idx.level_of_interest >= 0
          ? String(row[idx.level_of_interest] ?? "").trim() || null
          : null,
      phone,
      email,
      crexi_lead_score:
        idx.crexi_lead_score >= 0
          ? toInt(row[idx.crexi_lead_score])
          : null,
      last_action_date,
      company:
        idx.company >= 0
          ? String(row[idx.company] ?? "").trim() || null
          : null,
      industry_role:
        idx.industry_role >= 0
          ? String(row[idx.industry_role] ?? "").trim() || null
          : null,
      city: idx.city >= 0 ? String(row[idx.city] ?? "").trim() || null : null,
      state: idx.state >= 0 ? String(row[idx.state] ?? "").trim() || null : null,
      attachments: attachments || null,
      estimated_buying_power:
        idx.estimated_buying_power >= 0
          ? String(row[idx.estimated_buying_power] ?? "").trim() || null
          : null,
      notes: notesParts.length > 0 ? notesParts.join(" · ") : null,
      ca_executed,
    });
  }

  return { property_name, property_address, property_summary, activity_summary, leads, warnings };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Convert an Excel date serial to an ISO string.
 * Excel epoch is 1900-01-01 with the 1900-leap-year-bug, so for serials
 * >= 60 we subtract 25569 (days from 1900-01-01 to 1970-01-01) and
 * multiply by 86400000 ms/day.
 *
 * Handles strings that already look like ISO dates by passing through.
 */
function excelSerialToISO(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    // Already a string — try parsing as date directly
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== "number") return null;
  if (value < 60 || value > 200000) return null; // sanity guard
  const ms = (value - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Strip credential suffixes from "McDermott, CCIM" → "McDermott", combine
 * with first name. Preserves multi-word last names like "Van Horn".
 */
function cleanFullName(first: string, last: string): string {
  const lastClean = last
    .replace(/,\s*(ccim|cls|sior|cpm|crs|gri|ms?|jr\.?|sr\.?|iii?|iv|esq\.?|md|phd)\b.*$/i, "")
    .trim();
  return `${first} ${lastClean}`.trim().replace(/\s+/g, " ");
}
