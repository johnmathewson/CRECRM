import { NextRequest, NextResponse } from "next/server";
import { runValuation, ValuationRequest } from "@/lib/valuation-engine";
import { generateReportBytes } from "@/lib/report-generator";
import type { ReportData, ReportType } from "@/lib/report-generator";
import type { ValuationResult, NearbyComp } from "@/lib/valuation-engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/valuate
 *
 * Run a full property valuation: geocode → pull comps → analyze → generate PDF reports.
 *
 * Body: ValuationRequest
 * Query params:
 *   ?format=json  — return analysis JSON only (default)
 *   ?format=pdf   — return the BOV Sale PDF directly
 *   ?format=all   — return JSON with base64-encoded PDFs for all report types
 */
export async function POST(req: NextRequest) {
  try {
    const body: ValuationRequest = await req.json();

    // Either an address OR a lat/lng pin is required. lat/lng is
    // preferred (more accurate, skips geocoding) — broker drops a pin
    // for vacant land / unaddressed parcels.
    const hasPin =
      typeof body.latitude === "number" &&
      typeof body.longitude === "number" &&
      Number.isFinite(body.latitude) &&
      Number.isFinite(body.longitude);
    if (!body.address && !hasPin) {
      return NextResponse.json(
        { error: "Either an address or a map pin (latitude+longitude) is required" },
        { status: 400 }
      );
    }

    // Run the valuation engine
    const result = await runValuation(body);

    const format = req.nextUrl.searchParams.get("format") || "json";

    if (format === "json") {
      return NextResponse.json({
        success: true,
        valuation: sanitizeResult(result),
      });
    }

    // Build report data from valuation result
    const reportData = buildReportData(result, body);

    if (format === "pdf") {
      // Return single BOV Sale PDF
      const pdfBytes = generateReportBytes("sale-bov", reportData);
      return new NextResponse(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeName(body.address ?? result.subject.geocoded.formattedAddress ?? "subject")}_BOV.pdf"`,
        },
      });
    }

    if (format === "all") {
      // Return JSON with all three PDFs as base64
      const reports: Record<string, string> = {};
      const reportTypes: ReportType[] = ["sale-bov", "rental-opinion", "stabilized-valuation"];

      for (const type of reportTypes) {
        try {
          const bytes = generateReportBytes(type, reportData);
          reports[type] = Buffer.from(bytes).toString("base64");
        } catch (err) {
          // Some report types may fail if data is insufficient — skip them
          console.warn(`Report ${type} generation failed:`, err);
        }
      }

      return NextResponse.json({
        success: true,
        valuation: sanitizeResult(result),
        reports,
      });
    }

    return NextResponse.json({ error: "Invalid format. Use json, pdf, or all." }, { status: 400 });
  } catch (error: any) {
    console.error("Valuation error:", error);
    return NextResponse.json(
      { error: error.message || "Valuation failed" },
      { status: 500 },
    );
  }
}

// ── Helpers ────────────────────────────────────────────────

function safeName(address: string): string {
  return address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
}

/**
 * Convert valuation result comps into the format expected by report-generator.ts
 */
function buildReportData(result: ValuationResult, request: ValuationRequest): ReportData {
  // Build units from request data or create a single-unit placeholder.
  // Preserve per-unit vacancy + actual lease data when the frontend supplies them
  // (rent-roll upload path). Fall back to market-rent estimates only for fields the
  // frontend doesn't have.
  const units = request.units
    ? request.units.map((u, i) => {
        const isVacant = !!u.isVacant;
        const marketRent = result.incomeApproach?.estimatedMarketRent || null;
        return {
          unit_number: u.name || `Unit ${i + 1}`,
          tenant_name: isVacant ? "VACANT" : (u.tenant || null),
          suite: null,
          square_footage: u.sqft,
          // Vacant units have no in-place rent; occupied units use actual rate if
          // provided, else fall back to the market estimate.
          lease_rate: isVacant ? null : (u.leaseRate ?? marketRent),
          lease_type: null,
          lease_start: null,
          lease_end: null,
          monthly_rent: isVacant
            ? null
            : (u.monthlyRent ?? (marketRent ? (marketRent * u.sqft) / 12 : null)),
          annual_rent: isVacant
            ? null
            : (u.annualRent ?? (marketRent ? marketRent * u.sqft : null)),
          escalation_pct: null,
          is_vacant: isVacant,
          notes: isVacant
            ? "Vacant"
            : (u.leaseRate || u.annualRent || u.monthlyRent ? "In-place rent" : "Market rent estimate"),
        };
      })
    : request.sqft
      ? [
          {
            unit_number: "1",
            tenant_name: null,
            suite: null,
            square_footage: request.sqft,
            lease_rate: result.incomeApproach?.estimatedMarketRent || null,
            lease_type: null,
            lease_start: null,
            lease_end: null,
            monthly_rent: null,
            annual_rent: result.incomeApproach?.estimatedNOI || null,
            escalation_pct: null,
            is_vacant: false,
            notes: "Estimated from market data",
          },
        ]
      : [];

  // Honor user override: if request.annualIncome was entered manually and differs from
  // the per-unit sum (which can be wrong if Haiku confused monthly vs annual), scale
  // per-unit annual_rent proportionally and DERIVE monthly_rent + lease_rate from the
  // scaled annual + sqft so everything stays internally consistent.
  if (request.annualIncome && request.annualIncome > 0) {
    const occupied = units.filter((u) => !u.is_vacant);
    const sumAnnual = occupied.reduce((s, u) => s + (Number(u.annual_rent) || 0), 0);
    if (sumAnnual > 0 && Math.abs(sumAnnual - request.annualIncome) / request.annualIncome > 0.01) {
      const scale = request.annualIncome / sumAnnual;
      for (const u of units) {
        if (u.is_vacant) continue;
        const sqft = Number(u.square_footage) || 0;
        if (u.annual_rent) {
          const newAnnual = Math.round(Number(u.annual_rent) * scale);
          u.annual_rent = newAnnual;
          u.monthly_rent = Math.round((newAnnual / 12) * 100) / 100;
          // Always re-derive lease_rate from the scaled annual + sqft. Never just
          // multiply lease_rate by scale — that would compound any per-SF error.
          if (sqft > 0) u.lease_rate = Math.round((newAnnual / sqft) * 100) / 100;
        }
        u.notes = "In-place rent (calibrated to user-entered annual income)";
      }
    }
  }

  // FINAL CONSISTENCY PASS — defense in depth. No matter how lease_rate, monthly_rent,
  // and annual_rent got set upstream (parser, reconcile, scaling, fallback), force them
  // to be internally consistent: lease_rate = annual_rent / sqft, monthly_rent = annual / 12.
  // The cover's "Current Annual Revenue" is summed from annual_rent, so anchoring rate
  // to annual guarantees the cover and per-unit table tell the same story.
  for (const u of units) {
    if (u.is_vacant) continue;
    const sqft = Number(u.square_footage) || 0;
    const annual = Number(u.annual_rent) || 0;
    if (sqft > 0 && annual > 0) {
      u.lease_rate = Math.round((annual / sqft) * 100) / 100;
      u.monthly_rent = Math.round((annual / 12) * 100) / 100;
    }
    // SF typo guard: a commercial unit < 100 SF is almost certainly a rent-roll typo
    // (e.g., 13.79 instead of 1379). Suppress the bogus $/SF so it doesn't pollute
    // weighted averages.
    if (sqft > 0 && sqft < 100) {
      u.lease_rate = null;
      u.notes = (u.notes ? u.notes + " · " : "") + "Suspect SF (likely rent-roll typo) — rate suppressed";
    }
  }

  // Convert LEASE comps to report format. The report's compWeightedRate is a $/SF rent
  // rate (feeds rental opinion + stabilized value via NOI ÷ cap). Sale comps belong in
  // the sales-comparison view, not the rate analysis — mixing them inflates the rate by ~10×.
  let comps = result.comps.leaseComps.slice(0, 15).map(compToReportFormat);

  // Fallback: if no lease comps were found but the engine derived a market rent from
  // sale comps via cap rate (John's documented methodology), surface that as a single
  // synthetic comp so the rental opinion / stabilized value have a usable basis instead
  // of reporting $0. Clearly labeled so the reader knows it's derived, not observed.
  let derivedRent = false;
  if (comps.length === 0 && result.incomeApproach?.estimatedMarketRent) {
    derivedRent = true;
    comps = [
      {
        property_name: "Market estimate (derived from sale comps via market cap rate)",
        address: "",
        city: "",
        state: "",
        tenant_name: null,
        suite: null,
        square_footage: request.sqft ?? null,
        lease_rate: result.incomeApproach.estimatedMarketRent,
        lease_type: "Derived",
        lease_start: null,
        lease_end: null,
        monthly_rent: null,
        annual_rent: null,
      },
    ];
  }

  return {
    propertyName: request.address ?? result.subject.geocoded.formattedAddress,
    propertyAddress: result.subject.geocoded.formattedAddress,
    propertyType: result.subject.assetType,
    totalSF: request.sqft,
    units,
    comps,
    derivedRent,
    annualExpenses: request.annualExpenses,
    preparedDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

function compToReportFormat(comp: NearbyComp) {
  return {
    property_name: comp.address,
    address: comp.address,
    city: comp.city,
    state: comp.state,
    tenant_name: comp.tenant_name,
    suite: null,
    square_footage: comp.sqft,
    lease_rate: comp.rent_per_sqft ?? null,
    lease_type: comp.lease_type,
    lease_start: comp.sale_date || comp.lease_date,
    lease_end: null,
    monthly_rent: null,
    annual_rent: null,
  };
}

/**
 * Strip large/internal fields from the result for JSON response
 */
function sanitizeResult(result: ValuationResult) {
  return {
    subject: result.subject,
    comps: {
      saleComps: result.comps.saleComps.slice(0, 20).map((c) => ({
        address: c.address,
        city: c.city,
        assetType: c.asset_type,
        distanceMiles: c.distance_miles,
        salePrice: c.sale_price,
        pricePsf: c.price_per_sqft,
        capRate: c.cap_rate,
        sqft: c.sqft,
        yearBuilt: c.year_built,
        saleDate: c.sale_date,
      })),
      leaseComps: result.comps.leaseComps.slice(0, 10).map((c) => ({
        address: c.address,
        city: c.city,
        assetType: c.asset_type,
        distanceMiles: c.distance_miles,
        rentPsf: c.rent_per_sqft,
        sqft: c.sqft,
        leaseType: c.lease_type,
        leaseDate: c.lease_date,
      })),
      radiusMiles: result.comps.radiusMiles,
      totalFound: result.comps.totalFound,
    },
    methodology: result.methodology,
    incomeApproach: result.incomeApproach,
    salesComparison: result.salesComparison,
    reconciledValue: result.reconciledValue,
    narrative: result.narrative,
    disclaimers: result.disclaimers,
    leadId: result.leadId,
  };
}

