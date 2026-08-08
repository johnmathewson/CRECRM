/**
 * Property Enrichment Agent — DB-only v1 (architecture agreed 2026-07-29).
 *
 * Job: every day, dig into what we ALREADY HAVE — no web, no logins — and
 * make each property record deeper. Sources: the properties table's own
 * CoStar/PropStream columns, sale_comps (1,853), contacts.
 *
 * The three laws (non-negotiable):
 *   1. Human data always wins. The agent fills BLANK columns only; a
 *      disagreement becomes a status='conflict' fact, never an overwrite.
 *   2. Every finding carries provenance: property_facts rows with
 *      source / confidence / verified_at.
 *   3. Every run writes a visible diff: enrichment_runs.summary.
 *
 * Passes (deterministic first, Haiku only for fuzzy adjudication):
 *   A. Owner canonicalization — best owner name/phone across the three
 *      tiers (true_ > recorded_ > raw), entity detection (LLC/trust/corp).
 *   B. Sale-comp cross-match — normalized address match fills
 *      last_sale_date/price blanks; buyer≈owner corroboration; ambiguous
 *      matches adjudicated by Haiku (capped per run).
 *   C. Portfolio detection — same owner across multiple properties.
 *   D. Contact linking — owner phone/name found in contacts → link
 *      owner_contact_id when blank (phone match = high confidence).
 *   E. Completeness score — scorecard so progress is measurable.
 *
 * Batch selection: open enrichment_requests first (the shared work queue),
 * then the working set (John's real properties), then cold inventory —
 * skipping anything scanned in the last 14 days (the '_scanned' fact is
 * the cursor).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { toE164 } from "@/lib/twilio";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const SCAN_COOLDOWN_DAYS = 14;
const HAIKU_CAP_PER_RUN = 15;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PropRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompRow = Record<string, any>;

const ENTITY_RE = /\b(llc|l\.l\.c|inc|corp|corporation|trust|lp|llp|ltd|holdings|properties|partners|group|company|co\b|enterprises|investments|realty)\b/i;

/** Scorecard: the fields that make a property record actionable. */
const SCORECARD: Array<(p: PropRow, facts: Map<string, string>) => boolean> = [
  (p, f) => !!(p.true_owner_name || p.recorded_owner_name || p.owner_name_raw || f.get("owner_best_name")),
  (p, f) => !!(p.true_owner_phone || p.recorded_owner_phone || p.owner_phone || f.get("owner_best_phone")),
  (p) => !!(p.true_owner_address || p.owner_mailing_address),
  (p, f) => !!(p.last_sale_date || f.get("last_sale_date")),
  (p, f) => !!(p.last_sale_price || f.get("last_sale_price")),
  (p) => !!p.sqft,
  (p) => !!p.year_built,
  (p) => !!p.asset_type,
  (p) => !!p.mortgage_maturity_date,
  (p) => !!(p.owner_contact_id),
];

function normalizeStreet(addr: string | null | undefined): { num: string; token: string } | null {
  if (!addr) return null;
  const cleaned = String(addr).toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(\d+)[\s-]*(?:\d+\s+)?([a-z]+)/);
  if (!m) return null;
  return { num: m[1], token: m[2] };
}

function normOwner(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export interface EnricherResult {
  runId: string | null;
  scanned: number;
  factsWritten: number;
  fieldsFilled: number;
  conflicts: number;
  haikuCalls: number;
  summary: string;
}

export async function runPropertyEnricher(opts?: { batchSize?: number }): Promise<EnricherResult> {
  const batchSize = Math.min(Math.max(opts?.batchSize ?? 40, 1), 150);
  const sb: SB = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: run } = await sb
    .from("enrichment_runs")
    .insert({ organization_id: ORG_ID, agent: "property_enricher" })
    .select("id")
    .single();
  const runId = (run?.id as string) ?? null;

  const counters = { facts: 0, filled: 0, conflicts: 0, haiku: 0 };
  const highlights: string[] = [];

  // ── Select the batch ────────────────────────────────────────────────────
  const targets = await selectBatch(sb, batchSize);
  if (targets.length === 0) {
    const summary = "Nothing to scan — all properties enriched within the cooldown window.";
    if (runId) await sb.from("enrichment_runs").update({ finished_at: new Date().toISOString(), summary }).eq("id", runId);
    return { runId, scanned: 0, factsWritten: 0, fieldsFilled: 0, conflicts: 0, haikuCalls: 0, summary };
  }

  // Bulk-fetch sale comps for the batch's cities once.
  const cities = Array.from(new Set(targets.map((p) => String(p.city ?? "").toLowerCase()).filter(Boolean)));
  const { data: compsRaw } = await sb
    .from("sale_comps")
    .select("id, address, city, state, sale_date, sale_price, price_per_sqft, cap_rate, sqft, year_built, buyer, seller")
    .eq("organization_id", ORG_ID)
    .not("address", "is", null);
  const comps = ((compsRaw ?? []) as CompRow[]).filter((c) =>
    cities.includes(String(c.city ?? "").toLowerCase())
  );

  const writeFact = async (
    propertyId: string,
    field: string,
    value: string | null,
    source: string,
    confidence: "high" | "medium" | "low",
    extra?: { valueJson?: unknown; sourceRef?: string; note?: string; status?: "active" | "conflict" }
  ) => {
    const { error } = await sb.from("property_facts").upsert(
      {
        organization_id: ORG_ID,
        property_id: propertyId,
        field,
        value,
        value_json: extra?.valueJson ?? null,
        source,
        source_ref: extra?.sourceRef ?? null,
        confidence,
        status: extra?.status ?? "active",
        note: extra?.note ?? null,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "property_id,field,source" }
    );
    if (error) console.error(`[enricher] fact write failed (${field}):`, error.message);
    else {
      counters.facts += 1;
      if (extra?.status === "conflict") counters.conflicts += 1;
    }
  };

  /** Law #1: fill blanks on properties, never overwrite. */
  const fillBlank = async (propertyId: string, updates: Record<string, unknown>, current: PropRow) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v != null && (current[k] == null || current[k] === "")) safe[k] = v;
    }
    if (Object.keys(safe).length === 0) return;
    const { error } = await sb.from("properties").update(safe).eq("id", propertyId);
    if (error) console.error("[enricher] fill-blank failed:", error.message);
    else counters.filled += Object.keys(safe).length;
  };

  // ── Per-property passes ────────────────────────────────────────────────
  for (const p of targets) {
    const facts = new Map<string, string>();
    try {
      // A. Owner canonicalization
      const bestName = p.true_owner_name || p.recorded_owner_name || p.owner_name_raw || null;
      const bestPhoneRaw = p.true_owner_phone || p.recorded_owner_phone || p.owner_phone || null;
      const bestPhone = bestPhoneRaw ? (toE164(String(bestPhoneRaw)) ?? String(bestPhoneRaw)) : null;
      if (bestName) {
        const tier = p.true_owner_name ? "true_owner" : p.recorded_owner_name ? "recorded_owner" : "raw";
        await writeFact(p.id, "owner_best_name", String(bestName), "derived", tier === "raw" ? "medium" : "high", {
          note: `from ${tier}`,
        });
        facts.set("owner_best_name", String(bestName));
        await writeFact(p.id, "owner_is_entity", ENTITY_RE.test(String(bestName)) ? "true" : "false", "derived", "high");
      }
      if (bestPhone) {
        await writeFact(p.id, "owner_best_phone", bestPhone, "derived", p.true_owner_phone ? "high" : "medium");
        facts.set("owner_best_phone", bestPhone);
      }

      // B. Sale-comp cross-match
      const key = normalizeStreet(p.address);
      if (key) {
        const city = String(p.city ?? "").toLowerCase();
        const strong: CompRow[] = [];
        const fuzzy: CompRow[] = [];
        for (const c of comps) {
          if (String(c.city ?? "").toLowerCase() !== city) continue;
          const ck = normalizeStreet(c.address);
          if (!ck) continue;
          if (ck.num === key.num && ck.token === key.token) strong.push(c);
          else if (ck.token === key.token && Math.abs(Number(ck.num) - Number(key.num)) <= 8) fuzzy.push(c);
        }
        let match: CompRow | null = strong[0] ?? null;
        if (!match && fuzzy.length > 0 && counters.haiku < HAIKU_CAP_PER_RUN) {
          counters.haiku += 1;
          match = await adjudicateWithHaiku(p, fuzzy);
        }
        if (match) {
          await writeFact(p.id, "last_sale_date", match.sale_date ?? null, "sale_comps", strong[0] ? "high" : "medium", {
            sourceRef: match.id,
            valueJson: { sale_price: match.sale_price, buyer: match.buyer, seller: match.seller, cap_rate: match.cap_rate },
          });
          // Conflict check before fill: property has a DIFFERENT sale date on file
          if (p.last_sale_date && match.sale_date && String(p.last_sale_date) !== String(match.sale_date)) {
            await writeFact(p.id, "last_sale_date_comp_conflict", String(match.sale_date), "sale_comps", "medium", {
              sourceRef: match.id,
              status: "conflict",
              note: `property says ${p.last_sale_date}, comp says ${match.sale_date}`,
            });
          } else {
            await fillBlank(p.id, { last_sale_date: match.sale_date, last_sale_price: match.sale_price, year_built: match.year_built, sqft: match.sqft }, p);
          }
          // Buyer ≈ owner corroboration
          if (match.buyer && bestName && normOwner(match.buyer) && normOwner(bestName).includes(normOwner(match.buyer).slice(0, 12))) {
            await writeFact(p.id, "owner_corroborated_by_comp", "true", "sale_comps", "high", { sourceRef: match.id });
          }
        }
      }

      // C. Portfolio detection (same canonical owner elsewhere)
      if (bestName && ENTITY_RE.test(String(bestName)) === false || bestName) {
        const { data: siblings } = await sb
          .from("properties")
          .select("id, name, address, city")
          .eq("organization_id", ORG_ID)
          .neq("id", p.id)
          .or(
            [
              p.true_owner_name ? `true_owner_name.ilike.${escapeIlike(p.true_owner_name)}` : null,
              p.owner_name_raw ? `owner_name_raw.ilike.${escapeIlike(p.owner_name_raw)}` : null,
            ]
              .filter(Boolean)
              .join(",") || "id.eq.00000000-0000-0000-0000-000000000000"
          )
          .limit(20);
        if (siblings && siblings.length > 0) {
          await writeFact(p.id, "portfolio_size", String(siblings.length + 1), "derived", "medium", {
            valueJson: { sibling_ids: siblings.map((s: PropRow) => s.id), sample: siblings.slice(0, 5).map((s: PropRow) => s.address ?? s.name) },
          });
          highlights.push(`${p.name ?? p.address}: owner holds ${siblings.length + 1} properties in the database`);
        }
      }

      // D. Contact linking
      if (bestPhone || p.true_owner_contact_name) {
        let contactId: string | null = null;
        let how = "";
        if (bestPhone) {
          const { data: byPhone } = await sb
            .from("contacts").select("id, full_name").eq("organization_id", ORG_ID).eq("phone", bestPhone).limit(1).maybeSingle();
          if (byPhone) { contactId = byPhone.id; how = `phone match (${byPhone.full_name})`; }
        }
        if (!contactId && p.true_owner_contact_name) {
          const { data: byName } = await sb
            .from("contacts").select("id, full_name").eq("organization_id", ORG_ID)
            .ilike("full_name", String(p.true_owner_contact_name).trim()).limit(1).maybeSingle();
          if (byName) { contactId = byName.id; how = `name match (${byName.full_name})`; }
        }
        if (contactId) {
          await writeFact(p.id, "owner_contact_match", contactId, "contacts", how.startsWith("phone") ? "high" : "medium", { note: how });
          if (how.startsWith("phone")) await fillBlank(p.id, { owner_contact_id: contactId }, p);
          highlights.push(`${p.name ?? p.address}: owner is already in contacts (${how})`);
        }
      }

      // E. Completeness score + scan cursor
      const score = SCORECARD.reduce((s, check) => s + (check(p, facts) ? 1 : 0), 0);
      await writeFact(p.id, "completeness_score", String(score * 10), "agent", "high", {
        note: `${score}/${SCORECARD.length} scorecard fields present`,
      });
      await writeFact(p.id, "_scanned", new Date().toISOString(), "agent", "high");
    } catch (err) {
      console.error(`[enricher] property ${p.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Mark any consumed queue requests done.
  const targetIds = targets.map((t) => t.id);
  await sb
    .from("enrichment_requests")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("entity_type", "property")
    .eq("status", "open")
    .in("entity_id", targetIds);

  const summary =
    `Scanned ${targets.length} properties: ${counters.facts} facts written, ` +
    `${counters.filled} blank fields filled, ${counters.conflicts} conflicts flagged, ` +
    `${counters.haiku} fuzzy matches adjudicated.` +
    (highlights.length ? `\nHighlights:\n- ${highlights.slice(0, 8).join("\n- ")}` : "");

  if (runId) {
    await sb.from("enrichment_runs").update({
      finished_at: new Date().toISOString(),
      scanned: targets.length,
      facts_written: counters.facts,
      fields_filled: counters.filled,
      conflicts: counters.conflicts,
      summary,
      details: { highlights, haiku_calls: counters.haiku },
    }).eq("id", runId);
  }

  return {
    runId,
    scanned: targets.length,
    factsWritten: counters.facts,
    fieldsFilled: counters.filled,
    conflicts: counters.conflicts,
    haikuCalls: counters.haiku,
    summary,
  };
}

/** Queue first, working set second, cold inventory last — skip recently scanned. */
async function selectBatch(sb: SB, batchSize: number): Promise<PropRow[]> {
  const cutoff = new Date(Date.now() - SCAN_COOLDOWN_DAYS * 86_400_000).toISOString();
  // PAGE THIS QUERY. PostgREST silently caps un-ranged selects at 1,000
  // rows — once >1,000 properties were inside the cooldown, the set
  // truncated and ~90% of every batch re-scanned already-done rows
  // (Aug 2026 bulk sweep: 19,950 scans for 1,932 new properties).
  const recentlyScanned = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("property_facts")
      .select("property_id")
      .eq("field", "_scanned")
      .gte("verified_at", cutoff)
      .range(from, from + 999);
    const rows = (data ?? []) as PropRow[];
    for (const r of rows) recentlyScanned.add(r.property_id as string);
    if (rows.length < 1000) break;
  }

  const picked: PropRow[] = [];
  const pickedIds = new Set<string>();
  const SELECT = "id, name, address, city, state, asset_type, sqft, year_built, status, your_role, owner_contact_id, owner_name_raw, owner_phone, owner_type, recorded_owner_name, recorded_owner_phone, true_owner_name, true_owner_phone, true_owner_contact_name, true_owner_address, owner_mailing_address, last_sale_date, last_sale_price, years_owned, mortgage_maturity_date";

  // 1. The shared work queue
  const { data: requests } = await sb
    .from("enrichment_requests")
    .select("entity_id")
    .eq("entity_type", "property")
    .eq("status", "open")
    .order("priority", { ascending: true })
    .limit(batchSize);
  const requestIds = ((requests ?? []) as PropRow[]).map((r) => r.entity_id as string).filter((id) => !recentlyScanned.has(id));
  if (requestIds.length > 0) {
    const { data } = await sb.from("properties").select(SELECT).eq("organization_id", ORG_ID).in("id", requestIds.slice(0, batchSize));
    for (const p of (data ?? []) as PropRow[]) { if (!pickedIds.has(p.id)) { picked.push(p); pickedIds.add(p.id); } }
  }

  // Page through an ordered candidate list until the batch is full.
  //
  // WHY PAGING IS LOAD-BEARING: scanning writes a _scanned fact but never
  // touches properties.updated_at (on purpose — updated_at carries UI
  // meaning). So a single fixed-window fetch returns the SAME oldest rows
  // every run; once they're all inside the cooldown the filter empties the
  // window and the agent declares 15k properties "done" (Aug 3–7 2026:
  // five consecutive no-op runs at 172/15,130 scanned). Paging keeps
  // walking past the cooled-down rows until it finds fresh work.
  const PAGE = 200;
  const MAX_PAGES = 100; // 20k rows — comfortably past the full inventory
  const fillFrom = async (
    fetchPage: (from: number, to: number) => Promise<PropRow[]>,
  ): Promise<void> => {
    for (let page = 0; page < MAX_PAGES && picked.length < batchSize; page++) {
      const rows = await fetchPage(page * PAGE, page * PAGE + PAGE - 1);
      for (const p of rows) {
        if (picked.length >= batchSize) break;
        if (!pickedIds.has(p.id) && !recentlyScanned.has(p.id)) { picked.push(p); pickedIds.add(p.id); }
      }
      if (rows.length < PAGE) break; // ran out of candidates
    }
  };

  // 2. Working set: anything with a real status or role (John's actual book)
  if (picked.length < batchSize) {
    await fillFrom(async (from, to) => {
      const { data } = await sb
        .from("properties").select(SELECT).eq("organization_id", ORG_ID)
        .in("status", ["listed", "for_lease", "under_contract", "pitched", "prospecting", "owned"])
        .order("updated_at", { ascending: true })
        .range(from, to);
      return (data ?? []) as PropRow[];
    });
  }

  // 3. Cold inventory rotation — oldest-updated first so the 15k grinds evenly
  if (picked.length < batchSize) {
    await fillFrom(async (from, to) => {
      const { data } = await sb
        .from("properties").select(SELECT).eq("organization_id", ORG_ID)
        .order("updated_at", { ascending: true })
        .range(from, to);
      return (data ?? []) as PropRow[];
    });
  }

  return picked;
}

function escapeIlike(s: string): string {
  return String(s).replace(/[%_,()]/g, " ").trim();
}

/** Haiku adjudicates fuzzy address matches — capped per run. */
async function adjudicateWithHaiku(p: PropRow, candidates: CompRow[]): Promise<CompRow | null> {
  try {
    const result = await callAnthropic({
      model: MODELS.HAIKU,
      system:
        "You match commercial property records. Given a subject property and candidate sale comps, decide if any candidate is THE SAME physical property (not just nearby). Ranges like '7880-7896 Broadway' cover the numbers inside them. Reply with JSON only: {\"match_index\": <0-based index or null>, \"confidence\": \"high\"|\"medium\"|\"low\"}",
      messages: [{
        role: "user",
        content: `Subject: ${p.address}, ${p.city}, ${p.state} (${p.name ?? "no name"}, ${p.sqft ?? "?"} SF, built ${p.year_built ?? "?"})\n\nCandidates:\n${candidates
          .slice(0, 5)
          .map((c, i) => `${i}. ${c.address}, ${c.city} — sold ${c.sale_date ?? "?"} for $${c.sale_price ?? "?"} (${c.sqft ?? "?"} SF, built ${c.year_built ?? "?"})`)
          .join("\n")}`,
      }],
      maxTokens: 100,
      temperature: 0,
    });
    const parsed = parseJsonResponse<{ match_index: number | null; confidence: string }>(result.text);
    if (parsed && parsed.match_index != null && parsed.confidence !== "low") {
      return candidates[parsed.match_index] ?? null;
    }
    return null;
  } catch (err) {
    console.error("[enricher] haiku adjudication failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
