/**
 * CoStar bulk-import endpoint.
 *
 * Accepts an XLSX/XLS/CSV file from CoStar's Property Search export. Upserts
 * each row as a property at status='prospect' so they land in the Prospector
 * cold inventory. Match key is APN+state when available; falls back to
 * normalized address.
 *
 * Performance: bulk-fetches existing matches in one query per file, then
 * splits incoming rows into a single batch insert + parallel updates. A
 * 500-row file finishes in well under the function timeout. Re-imports
 * are idempotent — same APN updates the existing row.
 *
 * Warm properties (status != 'prospect') are protected — never overwritten
 * by an import, even if the APN matches.
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
const UPDATE_BATCH_SIZE = 25;

interface PreparedRow {
  /** Source row index for error reporting (1-based, matches user's spreadsheet) */
  spreadsheetRow: number;
  /** Bare key fields used for matching */
  apn: string | null;
  state: string;
  address: string | null;
  /** Full payload to insert/update */
  payload: Record<string, unknown>;
}

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

    let jobId: string | null = null;
    let jobInsertWarning: string | null = null;
    if (!dryRun) {
      const { data: job, error: jobErr } = await supabase
        .from("import_jobs")
        .insert({
          organization_id: ORG_ID,
          source: "costar",
          source_detail: files.map((f) => f.name).join(", "),
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (jobErr) jobInsertWarning = `import_jobs insert: ${jobErr.message}`;
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

      // ── Phase 1: parse all rows into a normalized prepared list ────────
      const prepared: PreparedRow[] = [];
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

          if (!apn && !address) continue; // unprocessable row, silently skip

          let yearsOwned: number | null = null;
          if (lastSaleDate) {
            const yrs = (Date.now() - new Date(lastSaleDate).getTime()) / (1000 * 3600 * 24 * 365.25);
            if (Number.isFinite(yrs) && yrs >= 0) yearsOwned = Math.floor(yrs);
          }

          const ownerType = inferOwnerType(ownerName);

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

          prepared.push({
            spreadsheetRow: idx + 2, // +2 because user-facing row 1 is the header
            apn,
            state,
            address,
            payload,
          });
        } catch (err) {
          errors.push(`Row ${idx + 2}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Phase 2: bulk-fetch existing rows ──────────────────────────────
      // We do TWO bulk lookups: by APN (the primary match key) and by
      // ilike-prefix of address (for rows with no APN). Both are filtered
      // server-side to the org.
      const apnList = Array.from(new Set(prepared.map((p) => p.apn).filter((s): s is string => !!s)));
      type ExistingRow = { id: string; status: string | null; apn: string | null; state: string | null; address: string | null };
      const byApn = new Map<string, ExistingRow>();

      if (apnList.length > 0) {
        const { data: rowsByApn, error: apnErr } = await supabase
          .from("properties")
          .select("id, status, apn, state, address")
          .eq("organization_id", ORG_ID)
          .in("apn", apnList);
        if (apnErr) {
          fileResults.push({
            fileName: file.name,
            parsed: rows.length,
            inserted: 0,
            updated: 0,
            skipped: prepared.length,
            errors: [`Bulk APN lookup failed: ${apnErr.message}`],
          });
          continue;
        }
        for (const r of (rowsByApn ?? []) as ExistingRow[]) {
          if (r.apn) byApn.set(`${r.apn}::${r.state ?? ""}`, r);
        }
      }

      // Address-fallback for rows with no APN (or no APN match yet)
      const addressLookups = prepared
        .filter((p) => !p.apn || !byApn.get(`${p.apn}::${p.state}`))
        .filter((p) => !!p.address)
        .map((p) => ({ row: p, normAddr: normalizeAddress(p.address) }))
        .filter((x) => x.normAddr);

      const byNormAddr = new Map<string, ExistingRow>();
      if (addressLookups.length > 0) {
        // Group by state so we can do one IN-list per state
        const byState = new Map<string, string[]>();
        for (const x of addressLookups) {
          const list = byState.get(x.row.state) ?? [];
          list.push(x.row.address!);
          byState.set(x.row.state, list);
        }
        // For each state, pull all properties whose address starts with any of
        // the prefixes we care about. Keeps it to one query per state.
        const stateBuckets = Array.from(byState.entries());
        for (const [state, addrs] of stateBuckets) {
          // Use first 30 chars of each address as ilike prefix
          const orClause = addrs
            .slice(0, 200) // safety cap on URL length
            .map((a) => `address.ilike.${a.slice(0, 30).replace(/[,()]/g, "")}%`)
            .join(",");
          if (!orClause) continue;
          const { data: rowsByAddr, error: addrErr } = await supabase
            .from("properties")
            .select("id, status, apn, state, address")
            .eq("organization_id", ORG_ID)
            .eq("state", state)
            .or(orClause);
          if (addrErr) {
            errors.push(`Bulk address lookup failed for state ${state}: ${addrErr.message}`);
            continue;
          }
          for (const r of (rowsByAddr ?? []) as ExistingRow[]) {
            if (r.address) byNormAddr.set(`${normalizeAddress(r.address)}::${state}`, r);
          }
        }
      }

      // ── Phase 3: classify each prepared row → insert / update / skip ───
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: string; payload: Record<string, unknown> }[] = [];
      let skipped = 0;

      for (const p of prepared) {
        let existing: ExistingRow | undefined;
        if (p.apn) existing = byApn.get(`${p.apn}::${p.state}`);
        if (!existing && p.address) existing = byNormAddr.get(`${normalizeAddress(p.address)}::${p.state}`);

        if (existing && existing.status && existing.status !== "prospect") {
          // Warm property — protect from overwrite
          skipped++;
          continue;
        }

        if (existing) {
          updates.push({ id: existing.id, payload: { ...p.payload, updated_at: new Date().toISOString() } });
        } else {
          inserts.push({
            ...p.payload,
            slug: makeSlug(p.payload.name as string | null, p.address ?? p.apn ?? "prop"),
            status: "prospect",
          });
        }
      }

      let inserted = 0;
      let updated = 0;

      if (!dryRun) {
        // ── Phase 4a: bulk insert with row-by-row fallback ──────────────
        // Postgres rolls back the entire chunk on any constraint violation.
        // If the chunk fails, retry rows individually so one bad row can't
        // kill 199 good ones. The retry is parallel-batched.
        if (inserts.length > 0) {
          for (let i = 0; i < inserts.length; i += 200) {
            const chunk = inserts.slice(i, i + 200);
            const { error: insErr } = await supabase.from("properties").insert(chunk);
            if (!insErr) {
              inserted += chunk.length;
              continue;
            }
            // Chunk failed — retry one row at a time, in parallel batches
            errors.push(
              `Chunk ${i}-${i + chunk.length} bulk insert failed (${insErr.message}); retrying row-by-row`
            );
            for (let j = 0; j < chunk.length; j += 25) {
              const rowBatch = chunk.slice(j, j + 25);
              const results = await Promise.all(
                rowBatch.map((row) =>
                  supabase.from("properties").insert(row).then((r) => ({ row, error: r.error }))
                )
              );
              for (const r of results) {
                if (r.error) {
                  const apn = (r.row as Record<string, unknown>).apn;
                  const addr = (r.row as Record<string, unknown>).address;
                  errors.push(`Row [APN=${apn ?? "—"} addr=${addr ?? "—"}]: ${r.error.message}`);
                } else {
                  inserted++;
                }
              }
            }
          }
        }

        // ── Phase 4b: parallel updates (chunked) ────────────────────────
        if (updates.length > 0) {
          for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
            const chunk = updates.slice(i, i + UPDATE_BATCH_SIZE);
            const results = await Promise.all(
              chunk.map((u) =>
                supabase
                  .from("properties")
                  .update(u.payload)
                  .eq("id", u.id)
                  .then((r) => ({ id: u.id, error: r.error }))
              )
            );
            for (const r of results) {
              if (r.error) {
                errors.push(`Update ${r.id.slice(0, 8)}…: ${r.error.message}`);
              } else {
                updated++;
              }
            }
          }
        }
      } else {
        inserted = inserts.length;
        updated = updates.length;
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
          status: "completed",
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
      ...(jobInsertWarning ? { warning: jobInsertWarning } : {}),
    });
  } catch (err) {
    console.error("CoStar import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
