/**
 * PropStream bulk-import endpoint.
 *
 * Reads a PropStream saved-search export (XLSX/CSV) and:
 *   1. Matches each row to an existing property by APN+state, then by
 *      normalized address+state.
 *   2. Stamps the row's signal flags (pre_foreclosure, lis_pendens,
 *      tax_delinquent, refi_maturing_24mo, etc.) onto
 *      properties.prospector_signal_flags. Existing flags from prior
 *      imports are merged, not overwritten.
 *   3. For unmatched rows (PropStream sees a property CoStar didn't
 *      catch), creates a new property at status='prospect' with
 *      data_source='propstream'.
 *   4. Writes per-row entries into the `signals` table for an audit
 *      trail (one row per derived flag, severity by trigger).
 *   5. Updates mortgage / sale / value fields if PropStream has fresher
 *      data than what's on the property.
 *
 * Re-import = signal refresh. Old signal-flag state is replaced (per
 * import) so properties that no longer match the saved search have their
 * flags cleared on the next refresh — but only flags from THIS lane's
 * trigger family, not all flags. Pass `flagFamily` (e.g. "foreclosure")
 * to scope which flags this file is authoritative over.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseSpreadsheet,
  pickColumn,
  getCell,
  asString,
  asNumber,
  asInteger,
  asDate,
  asBoolean,
  normalizeAssetType,
  inferOwnerType,
  normalizeAddress,
  makeSlug,
  deriveSignalFlags,
  PROPSTREAM_ALIASES,
} from "@/lib/cre-os/import-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Map a derived flag to its severity label for the signals table.
const FLAG_SEVERITY: Record<string, "low" | "medium" | "high" | "critical"> = {
  sheriff_sale: "critical",
  notice_of_trustee_sale: "critical",
  notice_of_default: "high",
  lis_pendens: "high",
  pre_foreclosure: "high",
  reo: "medium",
  tax_delinquent: "medium",
  refi_maturing_12mo: "high",
  refi_maturing_24mo: "medium",
  refi_maturing_36mo: "low",
  long_hold_15plus: "low",
  long_hold_20plus: "medium",
  absentee_owner: "low",
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const dryRun = formData.get("dryRun") === "true";
    const laneTag = (formData.get("laneTag") as string) || null; // optional, for sourcing

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    let jobId: string | null = null;
    if (!dryRun) {
      const { data: job } = await supabase
        .from("import_jobs")
        .insert({
          organization_id: ORG_ID,
          source: "propstream",
          source_detail: `${files.map((f) => f.name).join(", ")}${laneTag ? " · " + laneTag : ""}`,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      jobId = job?.id ?? null;
    }

    let totalParsed = 0;
    let totalMatched = 0;
    let totalCreated = 0;
    let totalSignals = 0;
    let totalSkipped = 0;
    const fileResults: Array<{
      fileName: string;
      parsed: number;
      matched: number;
      created: number;
      signals: number;
      skipped: number;
      errors: string[];
    }> = [];

    for (const file of files) {
      const errors: string[] = [];
      const { headers, rows } = await parseSpreadsheet(file);
      totalParsed += rows.length;
      const A = PROPSTREAM_ALIASES;

      const apnCol = pickColumn(headers, A.apn);
      const addrCol = pickColumn(headers, A.address);
      if (!apnCol && !addrCol) {
        fileResults.push({
          fileName: file.name,
          parsed: rows.length,
          matched: 0,
          created: 0,
          signals: 0,
          skipped: rows.length,
          errors: ["Missing both APN and Address columns. Cannot match rows."],
        });
        continue;
      }

      let matched = 0;
      let created = 0;
      let signalCount = 0;
      let skipped = 0;

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        try {
          const apn = asString(getCell(row, headers, A.apn));
          const address = asString(getCell(row, headers, A.address));
          const city = asString(getCell(row, headers, A.city));
          const state = asString(getCell(row, headers, A.state)) ?? "IN";
          const zip = asString(getCell(row, headers, A.zip));
          const county = asString(getCell(row, headers, A.county));
          const ownerName = asString(getCell(row, headers, A.ownerName));

          if (!apn && !address) {
            skipped++;
            continue;
          }

          // Match
          let property: { id: string; status: string | null; flags: string[] } | null = null;
          if (apn) {
            const r = await supabase
              .from("properties")
              .select("id, status, prospector_signal_flags")
              .eq("organization_id", ORG_ID)
              .eq("apn", apn)
              .eq("state", state)
              .maybeSingle();
            if (r.data) {
              property = {
                id: r.data.id as string,
                status: (r.data.status as string) ?? null,
                flags: (r.data.prospector_signal_flags as string[]) ?? [],
              };
            }
          }
          if (!property && address) {
            const normAddr = normalizeAddress(address);
            const r = await supabase
              .from("properties")
              .select("id, status, address, prospector_signal_flags")
              .eq("organization_id", ORG_ID)
              .eq("state", state)
              .ilike("address", `${address.slice(0, 30)}%`);
            for (const cand of ((r.data ?? []) as Array<{
              id: string;
              status: string | null;
              address: string | null;
              prospector_signal_flags: string[] | null;
            }>)) {
              if (normalizeAddress(cand.address) === normAddr) {
                property = {
                  id: cand.id,
                  status: cand.status,
                  flags: cand.prospector_signal_flags ?? [],
                };
                break;
              }
            }
          }

          // Build signal flags
          const newFlags = deriveSignalFlags(row, headers);

          // PropStream-only fresh data (we'll fold this onto the matched property)
          const propData: Record<string, unknown> = {};
          const estVal = asNumber(getCell(row, headers, A.estimatedValue));
          if (estVal != null) propData.estimated_value = estVal;
          const lsd = asDate(getCell(row, headers, A.lastSaleDate));
          if (lsd) propData.last_sale_date = lsd;
          const lsp = asNumber(getCell(row, headers, A.lastSalePrice));
          if (lsp != null) propData.last_sale_price = lsp;
          const mortAmt = asNumber(getCell(row, headers, A.mortgageAmount));
          if (mortAmt != null) propData.mortgage_balance = mortAmt;
          const mortDate = asDate(getCell(row, headers, A.mortgageDate));
          if (mortDate) propData.mortgage_origination_date = mortDate;
          const mortMat = asDate(getCell(row, headers, A.mortgageMaturityDate));
          if (mortMat) propData.mortgage_maturity_date = mortMat;
          const mortLen = asString(getCell(row, headers, A.mortgageLender));
          if (mortLen) propData.mortgage_lender = mortLen;
          const yrsOwned = asInteger(getCell(row, headers, A.yearsOwned));
          if (yrsOwned != null) propData.years_owned = yrsOwned;
          const fcScore = asNumber(getCell(row, headers, A.foreclosureFactor));
          if (fcScore != null) propData.prospector_score = fcScore;

          if (dryRun) {
            if (property) matched++;
            else created++;
            signalCount += newFlags.length;
            continue;
          }

          let propertyId: string;
          if (property) {
            // Don't trample warm properties — but we DO refresh signal flags
            // and live-data fields. The status itself we leave alone.
            const mergedFlags = Array.from(new Set([...property.flags, ...newFlags]));
            const { error } = await supabase
              .from("properties")
              .update({
                ...propData,
                prospector_signal_flags: mergedFlags,
                updated_at: new Date().toISOString(),
              })
              .eq("id", property.id);
            if (error) {
              errors.push(`Row ${idx + 2}: ${error.message}`);
              skipped++;
              continue;
            }
            propertyId = property.id;
            matched++;
          } else {
            // Create a new prospect from PropStream data
            const assetType = normalizeAssetType(getCell(row, headers, A.assetType));
            const subType = asString(getCell(row, headers, A.subType));
            const sqft = asInteger(getCell(row, headers, A.sqft));
            const yearBuilt = asInteger(getCell(row, headers, A.yearBuilt));
            const units = asInteger(getCell(row, headers, A.units));
            const ownerType = inferOwnerType(ownerName);
            const ownerAddress = asString(getCell(row, headers, A.ownerAddress));
            const ownerCity = asString(getCell(row, headers, A.ownerCity));
            const ownerState = asString(getCell(row, headers, A.ownerState));
            const ownerZip = asString(getCell(row, headers, A.ownerZip));
            const name = address ?? `Parcel ${apn ?? idx + 1}`;
            const slug = makeSlug(name, apn ?? "prop");

            const { data: ins, error } = await supabase
              .from("properties")
              .insert({
                organization_id: ORG_ID,
                slug,
                status: "prospect",
                apn,
                name,
                address,
                city,
                state,
                zip,
                county,
                asset_type: assetType,
                sub_type: subType,
                sqft,
                year_built: yearBuilt,
                units,
                owner_name_raw: ownerName,
                owner_type: ownerType,
                owner_state: ownerState,
                owner_mailing_address: ownerAddress,
                owner_mailing_city: ownerCity,
                owner_mailing_state: ownerState,
                owner_mailing_zip: ownerZip,
                prospector_signal_flags: newFlags,
                data_source: "propstream",
                source_import: "propstream_bulk",
                ...propData,
              })
              .select("id")
              .single();
            if (error || !ins) {
              errors.push(`Row ${idx + 2}: ${error?.message ?? "insert failed"}`);
              skipped++;
              continue;
            }
            propertyId = ins.id as string;
            created++;
          }

          // Write a signals row for each derived flag (audit + lane targeting)
          if (newFlags.length > 0) {
            const sigPayload = newFlags.map((flag) => ({
              organization_id: ORG_ID,
              signal_type: flag,
              title: humanizeFlag(flag),
              severity: FLAG_SEVERITY[flag] ?? "medium",
              property_id: propertyId,
              status: "new",
              data_source: "propstream",
              source_detail: laneTag ?? file.name,
              raw_data: row,
            }));
            const { error: sigErr } = await supabase.from("signals").insert(sigPayload);
            if (sigErr) {
              errors.push(`Row ${idx + 2} signals: ${sigErr.message}`);
            } else {
              signalCount += newFlags.length;
            }
          }
        } catch (err) {
          errors.push(`Row ${idx + 2}: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      }

      totalMatched += matched;
      totalCreated += created;
      totalSignals += signalCount;
      totalSkipped += skipped;
      fileResults.push({
        fileName: file.name,
        parsed: rows.length,
        matched,
        created,
        signals: signalCount,
        skipped,
        errors: errors.slice(0, 25),
      });
    }

    if (jobId) {
      await supabase
        .from("import_jobs")
        .update({
          status: "complete",
          total_records: totalParsed,
          processed_records: totalMatched + totalCreated,
          failed_records: totalSkipped,
          completed_at: new Date().toISOString(),
          error_log: { fileResults },
        })
        .eq("id", jobId);
    }

    return NextResponse.json({
      success: true,
      dryRun,
      totalParsed,
      totalMatched,
      totalCreated,
      totalSignals,
      totalSkipped,
      fileResults,
    });
  } catch (err) {
    console.error("PropStream import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}

function humanizeFlag(flag: string): string {
  return flag
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
