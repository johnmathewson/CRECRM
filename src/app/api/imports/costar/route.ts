/**
 * CoStar bulk-import endpoint.
 *
 * Accepts an XLSX/XLS/CSV file from CoStar's Property Search export. Upserts
 * each row as a property at status='prospect' so they land in the Prospector
 * cold inventory. Match key is APN+state when available; falls back to
 * normalized address.
 *
 * Idempotent: re-uploading the same file updates existing rows rather than
 * duplicating them. We never overwrite warm properties (status != 'prospect')
 * to protect rows that have been promoted into the active pipeline.
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
  normalizeAssetType,
  inferOwnerType,
  normalizeAddress,
  makeSlug,
  COSTAR_ALIASES,
} from "@/lib/cre-os/import-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const dryRun = formData.get("dryRun") === "true";

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Open import_jobs row for audit trail
    let jobId: string | null = null;
    if (!dryRun) {
      const { data: job } = await supabase
        .from("import_jobs")
        .insert({
          organization_id: ORG_ID,
          source: "costar",
          source_detail: files.map((f) => f.name).join(", "),
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      jobId = job?.id ?? null;
    }

    let totalParsed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const fileResults: Array<{
      fileName: string;
      parsed: number;
      inserted: number;
      updated: number;
      skipped: number;
      errors: string[];
    }> = [];

    for (const file of files) {
      const errors: string[] = [];
      const { headers, rows } = await parseSpreadsheet(file);
      totalParsed += rows.length;

      // Resolve canonical columns once per file
      const A = COSTAR_ALIASES;
      const apnCol = pickColumn(headers, A.apn);
      const addrCol = pickColumn(headers, A.address);

      if (!apnCol && !addrCol) {
        fileResults.push({
          fileName: file.name,
          parsed: rows.length,
          inserted: 0,
          updated: 0,
          skipped: rows.length,
          errors: [
            "Could not locate either APN or Address columns. Expected one of: " +
              [...A.apn, ...A.address].join(", "),
          ],
        });
        continue;
      }

      let inserted = 0;
      let updated = 0;
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
          const name = asString(getCell(row, headers, A.name)) ?? address ?? `Parcel ${apn ?? idx + 1}`;
          const assetType = normalizeAssetType(getCell(row, headers, A.assetType));
          const subType = asString(getCell(row, headers, A.subType));
          const sqft = asInteger(getCell(row, headers, A.sqft));
          const acreage = asNumber(getCell(row, headers, A.acreage));
          const yearBuilt = asInteger(getCell(row, headers, A.yearBuilt));
          const units = asInteger(getCell(row, headers, A.units));
          const ownerName = asString(getCell(row, headers, A.ownerName));
          const ownerAddress = asString(getCell(row, headers, A.ownerAddress));
          const ownerCity = asString(getCell(row, headers, A.ownerCity));
          const ownerState = asString(getCell(row, headers, A.ownerState));
          const ownerZip = asString(getCell(row, headers, A.ownerZip));
          const lastSaleDate = asDate(getCell(row, headers, A.lastSaleDate));
          const lastSalePrice = asNumber(getCell(row, headers, A.lastSalePrice));
          const estimatedValue = asNumber(getCell(row, headers, A.estimatedValue));
          const loanLender = asString(getCell(row, headers, A.loanLender));
          const loanOrigDate = asDate(getCell(row, headers, A.loanOriginationDate));
          const loanMatDate = asDate(getCell(row, headers, A.loanMaturityDate));
          const loanAmount = asNumber(getCell(row, headers, A.loanAmount));

          if (!apn && !address) {
            skipped++;
            continue;
          }

          // Years owned derived from last sale date
          let yearsOwned: number | null = null;
          if (lastSaleDate) {
            const yrs = (Date.now() - new Date(lastSaleDate).getTime()) / (1000 * 3600 * 24 * 365.25);
            if (Number.isFinite(yrs) && yrs >= 0) yearsOwned = Math.floor(yrs);
          }

          // Match: APN+state first, else normalized address+state
          const ownerType = inferOwnerType(ownerName);
          let existing: { id: string; status: string | null } | null = null;
          if (apn) {
            const r = await supabase
              .from("properties")
              .select("id, status")
              .eq("organization_id", ORG_ID)
              .eq("apn", apn)
              .eq("state", state)
              .maybeSingle();
            existing = (r.data as { id: string; status: string | null } | null) ?? null;
          }
          if (!existing && address) {
            const normAddr = normalizeAddress(address);
            const r = await supabase
              .from("properties")
              .select("id, status, address")
              .eq("organization_id", ORG_ID)
              .eq("state", state)
              .ilike("address", `${address}%`);
            for (const row of ((r.data ?? []) as Array<{ id: string; status: string | null; address: string | null }>)) {
              if (normalizeAddress(row.address) === normAddr) {
                existing = { id: row.id, status: row.status };
                break;
              }
            }
          }

          // Don't trample warm properties
          if (existing && existing.status && existing.status !== "prospect") {
            skipped++;
            continue;
          }

          const payload: Record<string, unknown> = {
            organization_id: ORG_ID,
            apn: apn ?? null,
            name,
            address: address ?? null,
            city: city ?? null,
            state,
            zip: zip ?? null,
            county: county ?? null,
            asset_type: assetType,
            sub_type: subType,
            sqft,
            acreage,
            year_built: yearBuilt,
            units,
            owner_name_raw: ownerName,
            owner_type: ownerType,
            owner_state: ownerState,
            owner_mailing_address: ownerAddress,
            owner_mailing_city: ownerCity,
            owner_mailing_state: ownerState,
            owner_mailing_zip: ownerZip,
            last_sale_date: lastSaleDate,
            last_sale_price: lastSalePrice,
            years_owned: yearsOwned,
            estimated_value: estimatedValue,
            mortgage_lender: loanLender,
            mortgage_origination_date: loanOrigDate,
            mortgage_maturity_date: loanMatDate,
            mortgage_balance: loanAmount,
            data_source: "costar",
            source_import: "costar_bulk",
          };

          if (dryRun) {
            if (existing) updated++;
            else inserted++;
            continue;
          }

          if (existing) {
            const { error } = await supabase
              .from("properties")
              .update({ ...payload, updated_at: new Date().toISOString() })
              .eq("id", existing.id);
            if (error) {
              errors.push(`Row ${idx + 2}: ${error.message}`);
              skipped++;
            } else {
              updated++;
            }
          } else {
            const slug = makeSlug(name, address ?? apn ?? "prop");
            const { error } = await supabase.from("properties").insert({
              ...payload,
              slug,
              status: "prospect",
            });
            if (error) {
              errors.push(`Row ${idx + 2}: ${error.message}`);
              skipped++;
            } else {
              inserted++;
            }
          }
        } catch (err) {
          errors.push(`Row ${idx + 2}: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
      }

      totalInserted += inserted;
      totalUpdated += updated;
      totalSkipped += skipped;
      fileResults.push({
        fileName: file.name,
        parsed: rows.length,
        inserted,
        updated,
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
          processed_records: totalInserted + totalUpdated,
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
      totalInserted,
      totalUpdated,
      totalSkipped,
      fileResults,
    });
  } catch (err) {
    console.error("CoStar import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
