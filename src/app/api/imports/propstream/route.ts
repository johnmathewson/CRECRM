/**
 * PropStream bulk-import endpoint.
 *
 * Reads a PropStream saved-search export (XLSX/CSV), bulk-matches each row
 * to an existing property by APN+state (or normalized address+state),
 * stamps signal flags, refreshes mortgage / sale / value data, and creates
 * a `signals` audit row per derived flag.
 *
 * Performance: bulk-fetches existing matches per file, splits into batched
 * inserts + parallel updates. Re-imports merge signal flags rather than
 * overwriting. Warm properties (status != 'prospect') keep their status
 * but still get fresh signal flags + live data.
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
  normalizeState,
  inferOwnerType,
  normalizeAddress,
  makeSlug,
  deriveSignalFlags,
  PROPSTREAM_ALIASES,
} from "@/lib/cre-os/import-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const UPDATE_BATCH_SIZE = 25;

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

interface PreparedRow {
  spreadsheetRow: number;
  apn: string | null;
  state: string;
  address: string | null;
  newFlags: string[];
  freshData: Record<string, unknown>;
  rawRow: Record<string, unknown>;
  // Insert payload, only used if no existing match found
  insertPayload: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const dryRun = formData.get("dryRun") === "true";
    const laneTag = (formData.get("laneTag") as string) || null;

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
          status: "processing",
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

      // ── Phase 1: parse + classify ───────────────────────────────────────
      const prepared: PreparedRow[] = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        try {
          const apn = asString(getCell(row, headers, A.apn));
          const address = asString(getCell(row, headers, A.address));
          const city = asString(getCell(row, headers, A.city));
          const state = normalizeState(getCell(row, headers, A.state)) ?? "IN";
          const zip = asString(getCell(row, headers, A.zip));
          const county = asString(getCell(row, headers, A.county));
          const ownerName = asString(getCell(row, headers, A.ownerName));
          if (!apn && !address) continue;

          const newFlags = deriveSignalFlags(row, headers);

          const freshData: Record<string, unknown> = {};
          const estVal = asNumber(getCell(row, headers, A.estimatedValue));
          if (estVal != null) freshData.estimated_value = estVal;
          const lsd = asDate(getCell(row, headers, A.lastSaleDate));
          if (lsd) freshData.last_sale_date = lsd;
          const lsp = asNumber(getCell(row, headers, A.lastSalePrice));
          if (lsp != null) freshData.last_sale_price = lsp;
          const mortAmt = asNumber(getCell(row, headers, A.mortgageAmount));
          if (mortAmt != null) freshData.mortgage_balance = mortAmt;
          const mortDate = asDate(getCell(row, headers, A.mortgageDate));
          if (mortDate) freshData.mortgage_origination_date = mortDate;
          const mortMat = asDate(getCell(row, headers, A.mortgageMaturityDate));
          if (mortMat) freshData.mortgage_maturity_date = mortMat;
          const mortLen = asString(getCell(row, headers, A.mortgageLender));
          if (mortLen) freshData.mortgage_lender = mortLen;
          const yrsOwned = asInteger(getCell(row, headers, A.yearsOwned));
          if (yrsOwned != null) freshData.years_owned = yrsOwned;
          const fcScore = asNumber(getCell(row, headers, A.foreclosureFactor));
          if (fcScore != null) freshData.prospector_score = fcScore;

          // Pre-build the insert payload for unmatched rows
          const assetType = normalizeAssetType(getCell(row, headers, A.assetType));
          const subType = asString(getCell(row, headers, A.subType));
          const sqft = asInteger(getCell(row, headers, A.sqft));
          const yearBuilt = asInteger(getCell(row, headers, A.yearBuilt));
          const units = asInteger(getCell(row, headers, A.units));
          const ownerType = inferOwnerType(ownerName);
          const ownerAddress = asString(getCell(row, headers, A.ownerAddress));
          const ownerCity = asString(getCell(row, headers, A.ownerCity));
          const ownerState = normalizeState(getCell(row, headers, A.ownerState));
          const ownerZip = asString(getCell(row, headers, A.ownerZip));
          const name = address ?? `Parcel ${apn ?? idx + 1}`;
          const slug = makeSlug(name, apn ?? "prop");

          const insertPayload: Record<string, unknown> = {
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
            ...freshData,
          };

          prepared.push({
            spreadsheetRow: idx + 2,
            apn,
            state,
            address,
            newFlags,
            freshData,
            rawRow: row,
            insertPayload,
          });
        } catch (err) {
          errors.push(`Row ${idx + 2}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Phase 1.5: within-file dedupe by (apn, state) ─────────────────
      // Last-row-wins on duplicate APN+state in the same export. Rare
      // but defensive — prevents two rows for the same parcel becoming
      // two separate inserts. Signal flags merge naturally because the
      // last row's flags supersede.
      const dedupeMap = new Map<string, PreparedRow>();
      const dedupedNoKey: PreparedRow[] = [];
      for (const p of prepared) {
        if (p.apn) dedupeMap.set(`${p.apn}::${p.state}`, p);
        else dedupedNoKey.push(p);
      }
      const dedupedPrepared = [...Array.from(dedupeMap.values()), ...dedupedNoKey];
      const droppedDupes = prepared.length - dedupedPrepared.length;
      if (droppedDupes > 0) {
        errors.push(`Dropped ${droppedDupes} within-file duplicate APN+state row${droppedDupes === 1 ? "" : "s"}`);
      }

      // ── Phase 2: bulk-fetch existing properties ────────────────────────
      type ExistingRow = {
        id: string;
        status: string | null;
        apn: string | null;
        state: string | null;
        address: string | null;
        prospector_signal_flags: string[] | null;
      };
      const apnList = Array.from(new Set(dedupedPrepared.map((p) => p.apn).filter((s): s is string => !!s)));
      const byApn = new Map<string, ExistingRow>();

      if (apnList.length > 0) {
        const { data, error: apnErr } = await supabase
          .from("properties")
          .select("id, status, apn, state, address, prospector_signal_flags")
          .eq("organization_id", ORG_ID)
          .in("apn", apnList);
        if (apnErr) {
          fileResults.push({
            fileName: file.name,
            parsed: rows.length,
            matched: 0,
            created: 0,
            signals: 0,
            skipped: dedupedPrepared.length,
            errors: [`Bulk APN lookup failed: ${apnErr.message}`],
          });
          continue;
        }
        for (const r of (data ?? []) as ExistingRow[]) {
          if (r.apn) byApn.set(`${r.apn}::${r.state ?? ""}`, r);
        }
      }

      const addressLookups = dedupedPrepared
        .filter((p) => !p.apn || !byApn.get(`${p.apn}::${p.state}`))
        .filter((p) => !!p.address);
      const byNormAddr = new Map<string, ExistingRow>();

      if (addressLookups.length > 0) {
        const byState = new Map<string, string[]>();
        for (const x of addressLookups) {
          const list = byState.get(x.state) ?? [];
          list.push(x.address!);
          byState.set(x.state, list);
        }
        for (const [state, addrs] of Array.from(byState.entries())) {
          const orClause = addrs
            .slice(0, 200)
            .map((a) => `address.ilike.${a.slice(0, 30).replace(/[,()]/g, "")}%`)
            .join(",");
          if (!orClause) continue;
          const { data, error: addrErr } = await supabase
            .from("properties")
            .select("id, status, apn, state, address, prospector_signal_flags")
            .eq("organization_id", ORG_ID)
            .eq("state", state)
            .or(orClause);
          if (addrErr) {
            errors.push(`Bulk address lookup (${state}): ${addrErr.message}`);
            continue;
          }
          for (const r of (data ?? []) as ExistingRow[]) {
            if (r.address) byNormAddr.set(`${normalizeAddress(r.address)}::${state}`, r);
          }
        }
      }

      // ── Phase 3: classify ───────────────────────────────────────────────
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: string; payload: Record<string, unknown> }[] = [];
      const signalRows: Record<string, unknown>[] = [];
      let matched = 0;
      let created = 0;
      let skipped = 0;

      for (const p of dedupedPrepared) {
        let existing: ExistingRow | undefined;
        if (p.apn) existing = byApn.get(`${p.apn}::${p.state}`);
        if (!existing && p.address) existing = byNormAddr.get(`${normalizeAddress(p.address)}::${p.state}`);

        let propertyId: string;
        if (existing) {
          // Merge signal flags; refresh fresh data; leave status alone (warm
          // properties keep their status, cold get richer data + flags).
          const mergedFlags = Array.from(new Set([...(existing.prospector_signal_flags ?? []), ...p.newFlags]));
          updates.push({
            id: existing.id,
            payload: {
              ...p.freshData,
              prospector_signal_flags: mergedFlags,
              updated_at: new Date().toISOString(),
            },
          });
          propertyId = existing.id;
          matched++;
        } else {
          // Will be inserted in batch — we can't link signals until insert
          // returns IDs. Track inserts with their flags so we can stitch
          // signals to the new IDs after.
          inserts.push({ ...p.insertPayload, __new_flags__: p.newFlags, __raw_row__: p.rawRow });
          propertyId = "__pending__";
        }

        // For matched rows, queue signal entries now (we have an ID).
        if (propertyId !== "__pending__") {
          for (const flag of p.newFlags) {
            signalRows.push({
              organization_id: ORG_ID,
              signal_type: flag,
              title: humanizeFlag(flag),
              severity: FLAG_SEVERITY[flag] ?? "medium",
              property_id: propertyId,
              status: "new",
              data_source: "propstream",
              source_detail: laneTag ?? file.name,
              raw_data: p.rawRow,
            });
          }
        }
      }

      let signalCount = 0;

      if (!dryRun) {
        // ── Phase 4a: bulk insert new properties (with row-by-row fallback) ──
        if (inserts.length > 0) {
          for (let i = 0; i < inserts.length; i += 100) {
            const chunk = inserts.slice(i, i + 100);
            const cleanChunk = chunk.map((c) => {
              const { __new_flags__, __raw_row__, ...rest } = c as Record<string, unknown>;
              void __new_flags__; void __raw_row__;
              return rest;
            });

            const tryStitch = (insertedRows: Array<{ id: string }>, originals: Record<string, unknown>[]) => {
              for (let j = 0; j < originals.length; j++) {
                const original = originals[j];
                const flags = (original.__new_flags__ as string[]) ?? [];
                const rawRow = (original.__raw_row__ as Record<string, unknown>) ?? {};
                const insertedId = insertedRows[j]?.id;
                if (!insertedId || flags.length === 0) continue;
                for (const flag of flags) {
                  signalRows.push({
                    organization_id: ORG_ID,
                    signal_type: flag,
                    title: humanizeFlag(flag),
                    severity: FLAG_SEVERITY[flag] ?? "medium",
                    property_id: insertedId,
                    status: "new",
                    data_source: "propstream",
                    source_detail: laneTag ?? file.name,
                    raw_data: rawRow,
                  });
                }
              }
            };

            const { data: insData, error: insErr } = await supabase
              .from("properties")
              .insert(cleanChunk)
              .select("id");
            if (!insErr) {
              created += chunk.length;
              tryStitch((insData ?? []) as Array<{ id: string }>, chunk);
              continue;
            }
            errors.push(
              `Chunk ${i}-${i + chunk.length} bulk insert failed (${insErr.message}); retrying row-by-row`
            );
            for (let j = 0; j < chunk.length; j += 25) {
              const rowBatchOrig = chunk.slice(j, j + 25);
              const rowBatchClean = cleanChunk.slice(j, j + 25);
              const results = await Promise.all(
                rowBatchClean.map((row, k) =>
                  supabase
                    .from("properties")
                    .insert(row)
                    .select("id")
                    .single()
                    .then((r) => ({ original: rowBatchOrig[k], data: r.data, error: r.error }))
                )
              );
              for (const r of results) {
                if (r.error || !r.data) {
                  const apn = (r.original as Record<string, unknown>).apn;
                  const addr = (r.original as Record<string, unknown>).address;
                  errors.push(`Row [APN=${apn ?? "—"} addr=${addr ?? "—"}]: ${r.error?.message ?? "insert returned no row"}`);
                } else {
                  created++;
                  tryStitch([{ id: r.data.id as string }], [r.original]);
                }
              }
            }
          }
        }

        // ── Phase 4b: parallel updates ──────────────────────────────────
        if (updates.length > 0) {
          for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
            const chunk = updates.slice(i, i + UPDATE_BATCH_SIZE);
            const results = await Promise.all(
              chunk.map((u) =>
                supabase
                  .from("properties")
                  .update(u.payload)
                  .eq("id", u.id)
                  .then((r) => ({ error: r.error }))
              )
            );
            for (const r of results) {
              if (r.error) errors.push(`Update: ${r.error.message}`);
            }
          }
        }

        // ── Phase 4c: bulk insert signals rows ──────────────────────────
        if (signalRows.length > 0) {
          for (let i = 0; i < signalRows.length; i += 200) {
            const chunk = signalRows.slice(i, i + 200);
            const { error: sigErr } = await supabase.from("signals").insert(chunk);
            if (sigErr) {
              errors.push(`Signals insert chunk ${i}-${i + chunk.length}: ${sigErr.message}`);
            } else {
              signalCount += chunk.length;
            }
          }
        }
      } else {
        matched = updates.length;
        created = inserts.length;
        signalCount = signalRows.length + inserts.reduce((s, i) => s + ((i.__new_flags__ as string[])?.length ?? 0), 0);
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
          status: "completed",
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
  return flag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
