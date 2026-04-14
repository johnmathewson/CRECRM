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

    if (!body.address) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 });
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
      return new NextResponse(pdfBytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeName(body.address)}_BOV.pdf"`,
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
  // Build units from request data or create a single-unit placeholder
  const units = request.units
    ? request.units.map((u, i) => ({
        unit_number: u.name || `Unit ${i + 1}`,
        tenant_name: null,
        suite: null,
        square_footage: u.sqft,
        lease_rate: result.incomeApproach?.estimatedMarketRent || null,
        lease_type: null,
        lease_start: null,
        lease_end: null,
        monthly_rent: result.incomeApproach?.estimatedMarketRent
          ? (result.incomeApproach.estimatedMarketRent * u.sqft) / 12
          : null,
        annual_rent: result.incomeApproach?.estimatedMarketRent
          ? result.incomeApproach.estimatedMarketRent * u.sqft
          : null,
        escalation_pct: null,
        is_vacant: false,
        notes: "Market rent estimate",
      }))
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

  // Convert sale comps to report format
  const comps = result.comps.saleComps.slice(0, 15).map(compToReportFormat);

  return {
    propertyName: request.address,
    propertyAddress: result.subject.geocoded.formattedAddress,
    propertyType: result.subject.assetType,
    totalSF: request.sqft,
    units,
    comps,
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
    lease_rate: comp.rent_per_sqft || (comp.price_per_sqft ? comp.price_per_sqft : null),
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

