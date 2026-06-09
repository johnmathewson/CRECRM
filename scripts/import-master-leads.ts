/**
 * scripts/import-master-leads.ts
 *
 * One-shot importer for a CREXi "Master Lead Report" CSV — the all-properties
 * combined export (vs. the per-property XLSX that arrives daily by email).
 *
 * Usage:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci... \
 *   npx tsx scripts/import-master-leads.ts /path/to/Master_Lead_Report.csv
 *
 * What it does (per row, deduplicated):
 *   1. Match CRM property by crexi_listing_id (CSV "Property ID" column)
 *   2. Find or create contact (email canonical, phone fallback)
 *   3. Upsert crexi_leads_state (peak-preserves level_of_interest)
 *   4. For hot leads (Executed CA / Requested Info / Opened OM / Submitted LOI /
 *      Downloaded Due Diligence / Opened Brochure): ensure a `leads` table row
 *      exists so they surface in Command "Do This Now"
 *
 * Dry-run mode (no writes):
 *   DRY_RUN=true npx tsx scripts/import-master-leads.ts /path/...
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";

// ── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const DRY_RUN = process.env.DRY_RUN === "true";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\n❌  Missing env vars. Export before running:\n" +
    "    SUPABASE_URL=https://xxxx.supabase.co\n" +
    "    SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...\n" +
    "\nFind both at: https://supabase.com/dashboard → your project → Settings → API\n"
  );
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-master-leads.ts /path/to/Master_Lead_Report.csv");
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`❌  File not found: ${csvPath}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── CSV row type ────────────────────────────────────────────────────────────

interface CsvRow {
  First: string;
  Last: string;
  Property: string;
  "Property Type": string;
  "Property ID": string;  // CREXi listing ID (numeric string)
  Address: string;
  Email: string;
  Phone: string;
  "Verification Method": string;
  "Level of Interest": string;
  "Crexi Lead Score": string;
  Source: string;
  "Last Action Date": string;
  Company: string;
  "Industry Role": string;
  City: string;
  State: string;
  Attachments: string;
  "Estimated Buying Power": string;
  "Note 1": string;
  "Note 2": string;
  "Note 3": string;
  Platform: string;
}

// ── CSV Parser ──────────────────────────────────────────────────────────────

async function parseCsv(filePath: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let headers: string[] = [];
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    // Parse CSV line respecting quoted fields
    const cols = parseCsvLine(line);
    if (lineNum === 1) {
      headers = cols;
      continue;
    }
    if (cols.length < headers.length || cols.every(c => !c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    rows.push(row as unknown as CsvRow);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      cols.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = e.trim().toLowerCase();
  return s && s.includes("@") ? s : null;
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

function inferContactType(role: string | null | undefined): string {
  const r = (role ?? "").toLowerCase();
  if (r.includes("broker") || r.includes("listing rep") || r.includes("buyer rep")) return "broker";
  if (r.includes("lender") || r.includes("loan")) return "lender";
  if (r.includes("attorney") || r.includes("legal")) return "attorney";
  if (r.includes("tenant rep") || r.includes("tenant")) return "tenant";
  return "investor";
}

function warmthFor(loi: string | null | undefined): "hot" | "warm" | "cold" {
  if (!loi) return "warm";
  const l = loi.toLowerCase();
  if (l.includes("ca") || l.includes("offer") || l.includes("info") || l.includes("loi") || l.includes("due diligence")) return "hot";
  if (l.includes("om") || l.includes("flyer") || l.includes("brochure") || l.includes("download") || l.includes("viewed space")) return "warm";
  return "cold";
}

const LOI_RANK: Record<string, number> = {
  "visited page": 1, "visitor": 1,
  "saved property": 1,
  "clicked email": 1, "clicked phone": 1,
  "printed page": 1,
  "opened flyer": 2, "opened brochure": 2,
  "opened om": 3, "viewed space": 3,
  "downloaded due diligence": 3,
  "requested info": 4,
  "submitted loi": 4,
  "executed ca": 4,
  "offer": 4,
};

function loiRank(loi: string | null | undefined): number {
  if (!loi) return 0;
  const lower = loi.trim().toLowerCase();
  for (const [pattern, rank] of Object.entries(LOI_RANK)) {
    if (lower.includes(pattern)) return rank;
  }
  return 1;
}

function isHotLead(loi: string | null | undefined): boolean {
  return loiRank(loi) >= 3;
}

// ── Property lookup cache ────────────────────────────────────────────────────

const propCache = new Map<string, { id: string; name: string } | null>();

async function resolveProperty(crexiId: string, propertyName: string, address: string): Promise<{ id: string; name: string } | null> {
  if (propCache.has(crexiId)) return propCache.get(crexiId)!;

  // Strategy 1: match by crexi_listing_id (most reliable)
  const { data: byId } = await supabase
    .from("properties")
    .select("id, name")
    .eq("organization_id", ORG_ID)
    .eq("crexi_listing_id", crexiId)
    .maybeSingle();
  if (byId) { propCache.set(crexiId, byId); return byId; }

  // Strategy 2: name match
  if (propertyName) {
    const { data: byName } = await supabase
      .from("properties")
      .select("id, name")
      .eq("organization_id", ORG_ID)
      .ilike("name", propertyName)
      .maybeSingle();
    if (byName) {
      // Back-fill crexi_listing_id while we're here
      if (!DRY_RUN) {
        await supabase
          .from("properties")
          .update({ crexi_listing_id: crexiId })
          .eq("id", byName.id);
      }
      propCache.set(crexiId, byName);
      return byName;
    }

    // Fuzzy: first significant word of name
    const firstWord = propertyName.split(/\s+/)[0];
    if (firstWord && firstWord.length > 3) {
      const { data: fuzzy } = await supabase
        .from("properties")
        .select("id, name")
        .eq("organization_id", ORG_ID)
        .ilike("name", `${firstWord}%`);
      if (fuzzy && fuzzy.length === 1) {
        if (!DRY_RUN) {
          await supabase
            .from("properties")
            .update({ crexi_listing_id: crexiId })
            .eq("id", fuzzy[0].id);
        }
        propCache.set(crexiId, fuzzy[0]);
        return fuzzy[0];
      }
    }
  }

  // Strategy 3: address match (street prefix)
  if (address) {
    const streetPart = address.split(",")[0]?.trim();
    if (streetPart) {
      const { data: byAddr } = await supabase
        .from("properties")
        .select("id, name, address")
        .eq("organization_id", ORG_ID)
        .ilike("address", `${streetPart}%`);
      if (byAddr && byAddr.length === 1) {
        if (!DRY_RUN) {
          await supabase
            .from("properties")
            .update({ crexi_listing_id: crexiId })
            .eq("id", byAddr[0].id);
        }
        const r = { id: byAddr[0].id, name: byAddr[0].name };
        propCache.set(crexiId, r);
        return r;
      }
    }
  }

  propCache.set(crexiId, null);
  console.warn(`  ⚠  No property match: CREXi ${crexiId} "${propertyName}"`);
  return null;
}

// ── Contact resolution ───────────────────────────────────────────────────────

async function findOrCreateContact(row: CsvRow): Promise<{ id: string; created: boolean } | null> {
  const email = normalizeEmail(row.Email);
  const phone = normalizePhone(row.Phone);
  const name = [row.First, row.Last].filter(Boolean).join(" ").trim() || "(unknown)";
  const loi = row["Level of Interest"] || null;

  if (!email && !phone) return null;

  // Try email first
  if (email) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, role")
      .eq("organization_id", ORG_ID)
      .ilike("email", email)
      .maybeSingle();
    if (data) {
      // Backfill missing phone/role
      const updates: Record<string, unknown> = {};
      if (!data.phone && phone) updates.phone = phone;
      if (!data.role && row["Industry Role"]) updates.role = row["Industry Role"];
      if (Object.keys(updates).length > 0 && !DRY_RUN) {
        await supabase.from("contacts").update(updates).eq("id", data.id);
      }
      return { id: data.id, created: false };
    }
  }

  // Try phone
  if (phone) {
    const { data: candidates } = await supabase
      .from("contacts")
      .select("id, phone")
      .eq("organization_id", ORG_ID)
      .not("phone", "is", null);
    if (candidates) {
      const found = candidates.find((c: { id: string; phone: string | null }) =>
        normalizePhone(c.phone) === phone
      );
      if (found) {
        if (email && !DRY_RUN) {
          const { data: existing } = await supabase
            .from("contacts")
            .select("email")
            .eq("id", found.id)
            .maybeSingle();
          if (existing && !existing.email) {
            await supabase.from("contacts").update({ email }).eq("id", found.id);
          }
        }
        return { id: found.id, created: false };
      }
    }
  }

  // Create new contact
  if (DRY_RUN) return { id: `dry-run-contact-${Math.random()}`, created: true };
  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: ORG_ID,
      full_name: name,
      role: row["Industry Role"] || null,
      phone: row.Phone || null,
      email,
      contact_type: inferContactType(row["Industry Role"]),
      relationship_type: "prospect",
      warmth: warmthFor(loi),
      city: row.City || null,
      state: row.State || null,
      notes: row.Company ? `CREXi: ${row.Company}` : null,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error(`  ❌  Contact create failed for ${name} (${email}):`, error?.message);
    return null;
  }
  return { id: created.id, created: true };
}

// ── crexi_leads_state upsert ─────────────────────────────────────────────────

async function upsertCrexiState(
  contactId: string,
  propertyId: string,
  row: CsvRow
): Promise<{ id: string; inserted: boolean } | null> {
  if (DRY_RUN) return { id: `dry-run-state-${Math.random()}`, inserted: true };

  const email = normalizeEmail(row.Email);
  const loi = row["Level of Interest"] || null;
  const name = [row.First, row.Last].filter(Boolean).join(" ").trim() || "(unknown)";

  // Find existing row
  let existing: { id: string; level_of_interest: string | null } | null = null;
  if (email) {
    const { data } = await supabase
      .from("crexi_leads_state")
      .select("id, level_of_interest")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .ilike("email", email)
      .maybeSingle();
    existing = data ?? null;
  }
  if (!existing) {
    const { data } = await supabase
      .from("crexi_leads_state")
      .select("id, level_of_interest")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .ilike("name", name)
      .maybeSingle();
    existing = data ?? null;
  }

  const basePayload = {
    organization_id: ORG_ID,
    property_id: propertyId,
    contact_id: contactId,
    name,
    email,
    phone: row.Phone || null,
    company: row.Company || null,
    role: row["Industry Role"] || null,
    last_activity_date: row["Last Action Date"] ? toIsoDate(row["Last Action Date"]) : null,
    last_seen_at: new Date().toISOString(),
    raw_panel: {
      csv_import: true,
      property_type: row["Property Type"],
      verification_method: row["Verification Method"],
      crexi_lead_score: row["Crexi Lead Score"] || null,
      platform: row.Platform,
      attachments: row.Attachments || null,
      buying_power: row["Estimated Buying Power"] || null,
      notes: [row["Note 1"], row["Note 2"], row["Note 3"]].filter(Boolean).join("\n") || null,
    },
  };

  if (existing) {
    // Peak-preserve LOI
    const effectiveLoi = loiRank(loi) >= loiRank(existing.level_of_interest) ? loi : existing.level_of_interest;
    const { error } = await supabase
      .from("crexi_leads_state")
      .update({ ...basePayload, level_of_interest: effectiveLoi, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) { console.error("  ❌  crexi_leads_state update failed:", error.message); return null; }
    return { id: existing.id, inserted: false };
  } else {
    const { data: newRow, error } = await supabase
      .from("crexi_leads_state")
      .insert({ ...basePayload, level_of_interest: loi, first_seen_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !newRow) { console.error("  ❌  crexi_leads_state insert failed:", error?.message); return null; }
    return { id: newRow.id, inserted: true };
  }
}

function toIsoDate(s: string): string | null {
  if (!s) return null;
  // MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// ── Hot lead row ─────────────────────────────────────────────────────────────

async function ensureHotLeadRow(
  contactId: string,
  propertyId: string,
  propertyName: string,
  row: CsvRow,
): Promise<void> {
  if (DRY_RUN) return;

  const email = normalizeEmail(row.Email);
  const loi = row["Level of Interest"] || "engaged";
  const name = [row.First, row.Last].filter(Boolean).join(" ").trim() || "(unknown)";

  // Skip if a non-archived lead already exists for this contact + property
  const { data: existing } = await supabase
    .from("leads")
    .select("id, sender_email")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .eq("property_id", propertyId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Heal missing email
    if (!existing.sender_email && email) {
      await supabase.from("leads").update({ sender_email: email }).eq("id", existing.id);
    }
    return;
  }

  // Skip if we've already replied to this contact (any property)
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .not("final_sent_at", "is", null);
  if ((count ?? 0) > 0) return;

  const urgency = loiRank(loi) >= 4 ? "hot" : "warm";
  const notes = [row["Note 1"], row["Note 2"], row["Note 3"]].filter(Boolean).join("\n") || null;

  const { error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: propertyId,
      source: "crexi",
      status: "new",
      sender_name: name,
      sender_email: email,
      sender_phone: row.Phone || null,
      property_label: propertyName,
      urgency,
      qualifier_summary:
        `CREXi: ${loi}` +
        (row.Company ? ` · ${row.Company}` : "") +
        (row["Industry Role"] ? ` · ${row["Industry Role"]}` : ""),
      raw_subject: null,
      raw_body: JSON.stringify({
        discovered_via: "crexi_master_csv_import",
        level_of_interest: loi,
        last_action_date: row["Last Action Date"] || null,
        company: row.Company || null,
        industry_role: row["Industry Role"] || null,
        city: row.City || null,
        state: row.State || null,
        buying_power: row["Estimated Buying Power"] || null,
        attachments: row.Attachments || null,
        notes,
        platform: row.Platform,
      }),
    });
  if (error) {
    console.error(`  ❌  leads row insert failed for ${name}:`, error.message);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${DRY_RUN ? "🔍  DRY RUN — no writes" : "🚀  Importing"} → ${path.basename(csvPath)}\n`);

  const rows = await parseCsv(csvPath);
  console.log(`Parsed ${rows.length} rows\n`);

  // Pre-load all CRM properties to show unmatched ones upfront
  const { data: allProps } = await supabase
    .from("properties")
    .select("id, name, crexi_listing_id")
    .eq("organization_id", ORG_ID);
  console.log(`CRM has ${allProps?.length ?? 0} properties\n`);

  const stats = {
    total: rows.length,
    propertyMatched: 0,
    propertyMissed: 0,
    contactCreated: 0,
    contactExisting: 0,
    stateInserted: 0,
    stateUpdated: 0,
    hotLeadsQueued: 0,
    skipped: 0,
    errors: 0,
  };

  // Track what we've processed to avoid redundant DB calls
  // Key: email|crexiPropertyId — process the HIGHEST LOI row per contact×property
  const contactPropKey = (email: string, phone: string, propId: string) =>
    `${email || phone}::${propId}`;
  const processed = new Map<string, { loi: string; rank: number }>();

  // Group + deduplicate: keep the highest-LOI row per contact × property
  const deduped = new Map<string, CsvRow>();
  for (const row of rows) {
    const email = normalizeEmail(row.Email) || "";
    const phone = normalizePhone(row.Phone) || "";
    const propId = row["Property ID"];
    if (!email && !phone) { stats.skipped++; continue; }
    const key = contactPropKey(email, phone, propId);
    const existing = deduped.get(key);
    if (!existing || loiRank(row["Level of Interest"]) > loiRank(existing["Level of Interest"])) {
      deduped.set(key, row);
    }
  }

  console.log(`After dedup (highest LOI per contact×property): ${deduped.size} unique rows\n`);

  let done = 0;
  const total = deduped.size;

  for (const row of Array.from(deduped.values())) {
    done++;
    if (done % 50 === 0) {
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%)  `);
    }

    const crexiPropId = row["Property ID"];
    const property = await resolveProperty(crexiPropId, row.Property, row.Address);

    if (!property) {
      stats.propertyMissed++;
      continue;
    }
    stats.propertyMatched++;

    // Contact
    const contactResult = await findOrCreateContact(row);
    if (!contactResult) { stats.errors++; continue; }
    const contactId = contactResult.id;
    if (contactResult.created) stats.contactCreated++;
    else stats.contactExisting++;

    // crexi_leads_state
    const stateResult = await upsertCrexiState(contactId, property.id, row);
    if (!stateResult) { stats.errors++; continue; }
    if (stateResult.inserted) stats.stateInserted++;
    else stats.stateUpdated++;

    // Hot lead row (LOI ≥ "Opened OM" / "Viewed Space" or better)
    if (isHotLead(row["Level of Interest"])) {
      if (!DRY_RUN) await ensureHotLeadRow(contactId, property.id, property.name, row);
      stats.hotLeadsQueued++;
    }
  }

  // Final newline after progress
  console.log("");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────");
  console.log(`✅  Import complete${DRY_RUN ? " (dry run)" : ""}`);
  console.log("──────────────────────────────────────────");
  console.log(`  Total CSV rows:          ${stats.total}`);
  console.log(`  Deduped (highest LOI):   ${deduped.size}`);
  console.log(`  Properties matched:      ${stats.propertyMatched}`);
  console.log(`  Properties unmatched:    ${stats.propertyMissed}`);
  console.log(`  Contacts created:        ${stats.contactCreated}`);
  console.log(`  Contacts existing:       ${stats.contactExisting}`);
  console.log(`  State rows inserted:     ${stats.stateInserted}`);
  console.log(`  State rows updated:      ${stats.stateUpdated}`);
  console.log(`  Hot lead rows queued:    ${stats.hotLeadsQueued} (LOI ≥ Opened OM)`);
  console.log(`  Skipped (no email/phone):${stats.skipped}`);
  console.log(`  Errors:                  ${stats.errors}`);
  console.log("──────────────────────────────────────────\n");

  if (stats.propertyMissed > 0) {
    console.log("⚠  Unmatched property IDs (need crexi_listing_id set in properties table):");
    for (const [key, row] of Array.from(deduped.entries())) {
      if (!propCache.get(row["Property ID"])) {
        console.log(`   • ${row["Property ID"]}  "${row.Property}"`);
      }
    }
    console.log("\n  Fix: In your CRM, open each listed property → edit → paste the CREXi ID.\n  Then re-run this script; it will skip already-imported contacts.\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
