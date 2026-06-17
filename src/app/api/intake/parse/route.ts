import { NextRequest, NextResponse } from "next/server";
import { MODELS } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a commercial real estate rent roll data extraction specialist. You will receive text or data extracted from a rent roll document. Your job: extract ALL tenant/unit information into structured JSON.

For each unit/tenant, extract these fields (use null if not found):
- unit_number: string (unit or space number)
- tenant_name: string
- suite: string (suite number if separate from unit)
- square_footage: number (rentable SF)
- lease_rate: number (annual rate per SF — convert if given monthly by multiplying by 12)
- lease_type: string ("NNN", "Gross", "Modified Gross", or null)
- lease_start: string (YYYY-MM-DD format, or null)
- lease_end: string (YYYY-MM-DD format, or null)
- monthly_rent: number (REQUIRED if rent is known)
- annual_rent: number (REQUIRED if rent is known — calculate from monthly if needed)
- escalation_pct: number (annual escalation %, or null)
- is_vacant: boolean (REQUIRED on every unit, never omit)

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no code fences.
2. Response format: { "units": [...], "confidence": "high"|"medium"|"low", "notes": "string" }
3. If a value can be calculated (annual_rent = monthly_rent * 12, or annual_rent = sf * rate), calculate it.
4. If rates are given as monthly per SF, convert to annual per SF.
5. VACANCY DETECTION (critical, do not skip):
   - Set is_vacant=true if the tenant cell is any of: "VACANT", "Vacant", "VAC", "Available", "AVAIL", "TBD", "Empty", a single dash "-", an em-dash "—", null, blank, or empty string.
   - Set is_vacant=true if the unit has a square footage but no tenant AND no rent / lease dates.
   - When is_vacant=true, also set tenant_name="VACANT" for consistency, and leave lease_start, lease_end, monthly_rent, annual_rent, lease_rate as null.
   - Set is_vacant=false on every occupied unit. NEVER omit the field.
6. MONTHLY vs. ANNUAL RENT — critical for downstream calculations:
   - If a column header contains "Monthly" or "MTM" → those values are MONTHLY. Populate monthly_rent.
   - If a column header contains "Annual", "Yearly", "Annualized", or "/Yr" → those values are ANNUAL. Populate annual_rent.
   - If a column is just labeled "Rent", "Current Rent", "Base Rent", "Charges", or unlabeled — DEFAULT TO MONTHLY. Property-management software (Buildium, AppFolio, Yardi, Rent Manager, etc.) and most rent rolls report monthly figures by convention. Do NOT assume annual just because the field name doesn't say "monthly".
   - ALWAYS populate BOTH monthly_rent AND annual_rent. Calculate the missing one: annual_rent = monthly_rent × 12.
   - SANITY CHECK before returning: compute (annual_rent ÷ square_footage). For commercial real estate this should fall roughly between $5/SF and $60/SF per year. Outside that range almost always means monthly was mislabeled as annual or vice versa — re-check and correct.
   - Examples of misclassification to catch: a "Rent" column showing $28,873 for a 15,212 SF retail unit yields $1.90/SF/yr if treated as annual — that's nonsensical for retail; it must be monthly ($22.78/SF/yr).
7. SUMMARY ROWS — do NOT extract: rows that say "Total", "X Units", "Subtotal", "Grand Total", or aggregate sums across units are document totals, not units. Skip them.
8. Preserve the original document order.
9. "confidence" = how structured the source data was.
10. "notes" = any ambiguities or assumptions you made (especially monthly vs. annual decisions).`;

// Server-side safety net: even if Claude misses vacancy detection, force is_vacant=true
// when the tenant name matches any common vacant marker. Mirrors prompt rule 5.
const VACANT_PATTERN = /^(\s*|vacant|vac|available|avail|tbd|empty|-+|—+|n\/?a)\s*$/i;

// Reasonable commercial rent bounds in $/SF/year. Outside these almost always means
// monthly-vs-annual got crossed somewhere upstream — we re-derive based on $/SF sanity.
const MIN_PSF_ANNUAL = 3;   // industrial low end ~$4; below $3 → almost certainly monthly mis-labeled as annual
const MAX_PSF_ANNUAL = 80;  // even prime retail caps around $60-70/SF; above $80 → mis-labeled

function reconcileRent(u: any): { monthly_rent: number | null; annual_rent: number | null; lease_rate: number | null } {
  const sqft = Number(u.square_footage) || 0;
  let monthly = Number(u.monthly_rent) || null;
  let annual = Number(u.annual_rent) || null;
  let rate = Number(u.lease_rate) || null;

  if (sqft > 0) {
    // Case A: annual is set but yields impossibly low $/SF → it's actually a monthly figure.
    if (annual && !monthly && annual / sqft < MIN_PSF_ANNUAL) {
      monthly = annual;
      annual = monthly * 12;
    }
    // Case B: monthly is set but yields impossibly high $/SF → it's actually an annual figure.
    if (monthly && !annual && monthly / sqft > MAX_PSF_ANNUAL / 12) {
      annual = monthly;
      monthly = +(annual / 12).toFixed(2);
    }
    // Case C: both set but inconsistent. Trust the one that yields a sane $/SF.
    if (monthly && annual && Math.abs(monthly * 12 - annual) > 1) {
      const annualPsf = annual / sqft;
      const monthlyAsAnnualPsf = (monthly * 12) / sqft;
      // Prefer whichever lands in the sane band
      if (annualPsf >= MIN_PSF_ANNUAL && annualPsf <= MAX_PSF_ANNUAL) {
        monthly = +(annual / 12).toFixed(2);
      } else if (monthlyAsAnnualPsf >= MIN_PSF_ANNUAL && monthlyAsAnnualPsf <= MAX_PSF_ANNUAL) {
        annual = monthly * 12;
      } else {
        // Both look weird — default to monthly being authoritative (rent-roll convention)
        annual = monthly * 12;
      }
    }
  }

  // Always populate both whenever we have one
  if (monthly && !annual) annual = monthly * 12;
  if (annual && !monthly) monthly = +(annual / 12).toFixed(2);

  // Recompute lease_rate (annual $/SF) if missing, sanity-check if present
  if (sqft > 0 && annual) {
    const computedRate = annual / sqft;
    if (!rate || (rate / computedRate < 0.5 || rate / computedRate > 2)) {
      rate = +computedRate.toFixed(2);
    }
  }

  return { monthly_rent: monthly, annual_rent: annual, lease_rate: rate };
}

function normalizeUnits(units: any[]): any[] {
  return units.map((u) => {
    const tenant = (u.tenant_name ?? "").toString().trim();
    const isVacantMarker = !tenant || VACANT_PATTERN.test(tenant);
    const noLeaseEvidence = !u.monthly_rent && !u.annual_rent && !u.lease_start && !u.lease_end;
    const isVacant = !!u.is_vacant || (isVacantMarker && noLeaseEvidence);

    const reconciled = isVacant
      ? { monthly_rent: null, annual_rent: null, lease_rate: null }
      : reconcileRent(u);

    return {
      ...u,
      is_vacant: isVacant,
      tenant_name: isVacant ? "VACANT" : (tenant || null),
      lease_rate: reconciled.lease_rate,
      monthly_rent: reconciled.monthly_rent,
      annual_rent: reconciled.annual_rent,
      lease_start: isVacant ? null : u.lease_start,
      lease_end: isVacant ? null : u.lease_end,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, propertyName, isImage, imageData, mediaType } = body;

    if (!text && !imageData) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 });
    }
    if (!propertyName?.trim()) {
      return NextResponse.json({ error: "Property name required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    let userContent: any;
    if (isImage && imageData) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
        { type: "text", text: `Extract all rent roll / tenant data from this image for the property: "${propertyName}". Return structured JSON per the system instructions.` },
      ];
    } else {
      userContent = `Extract all rent roll / tenant data from the following document for the property: "${propertyName}".\n\n---\n${text}\n---`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.HAIKU,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: data.error?.message || "Claude API error" }, { status: 502 });
    }

    const responseText = data.content?.[0]?.type === "text" ? data.content[0].text : "";
    let parsed;
    try {
      parsed = JSON.parse(responseText.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim());
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response. Please try again.", rawResponse: responseText }, { status: 422 });
    }

    return NextResponse.json({
      units: normalizeUnits(parsed.units || []),
      confidence: parsed.confidence || "medium",
      notes: parsed.notes || "",
      rawText: (text || "(image upload)").slice(0, 5000),
    });
  } catch (error: any) {
    console.error("Intake parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to process file" }, { status: 500 });
  }
}
