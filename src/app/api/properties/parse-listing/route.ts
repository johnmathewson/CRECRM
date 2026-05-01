import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a commercial real estate listing data extraction specialist. You will receive text extracted from an Offering Memorandum (OM), property brochure, or listing document. Extract all property and listing details into structured JSON.

Extract these fields (use null if not found):
- name: string (property name or common name, e.g. "Liberty Square Shopping Center")
- headline: string (a punchy marketing-friendly title for the public listing page — different from internal name. Lead with the investment thesis or asset's strongest hook. Examples: "Anchored Retail Center — 6.5% Cap, NNN", "Class A Industrial Build — 100% Leased to FedEx", "Trophy Office Tower — Downtown Indianapolis". Max 70 characters. Numbers-forward, no broker fluff like "premier" or "elevate".)
- address: string (street address only)
- city: string
- state: string (2-letter abbreviation, e.g. "IN")
- zip: string
- asset_type: string — one of EXACTLY these values (case-sensitive): "retail", "office", "industrial", "hospitality", "multifamily", "land", "medical", "mixed_use", "other". Map: hotel/motel/inn → "hospitality"; restaurant → "retail" (or "other" if standalone pad); warehouse/flex/distribution → "industrial".
- transaction_type: string — one of: "sale", "lease", "sale_or_lease"
- status: string — one of: "listed", "pre_listing", "under_contract", "off_market" (default "listed")
- asking_price: number (in dollars, e.g. 5500000)
- lease_rate: number (annual $/SF, e.g. 14.50)
- sqft: number (total building square footage)
- acreage: number (lot/land acres, e.g. 2.4)
- year_built: number (4-digit year)
- parking_spaces: number
- parking_ratio: string (e.g. "4.5/1,000 SF")
- zoning: string (e.g. "C-2", "B-3 General Business")
- noi: number (Net Operating Income in dollars)
- cap_rate: number (as a percentage, e.g. 6.5 for 6.5%)
- price_per_sf: number (asking price / sqft)
- occupancy_pct: number (as a percentage, e.g. 92.0 for 92%)
- description: string (a clean, professional 2-4 sentence property description suitable for a listing)
- highlights: array of strings (key selling points, e.g. ["NNN Lease", "Corner lot", "High traffic count", "Recent renovation"])
- your_role: string — one of: "listing_broker", "buyer_rep", "dual_agent" (default "listing_broker")
- notes: string (any additional context or caveats from the document)

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no code fences.
2. Response format: { "property": {...}, "confidence": "high"|"medium"|"low", "extraction_notes": "string" }
3. For description: write a clean, professional listing description based on the extracted facts. Do NOT copy raw text verbatim.
4. For highlights: extract bullet-point style selling points (max 8).
5. If asking_price and sqft are both present, calculate price_per_sf.
6. If cap_rate is given as a decimal (e.g. 0.065), convert to percentage (6.5).
7. confidence = how complete and structured the source document was.
8. extraction_notes = any ambiguities, assumptions, or missing critical fields.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, isImage, imageData, pdfUrl, mediaType, sourceUrl } = body;

    if (!text && !imageData && !pdfUrl) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    let userContent: any;
    if (pdfUrl) {
      userContent = [
        {
          type: "document",
          source: { type: "url", url: pdfUrl },
        },
        {
          type: "text",
          text: `Extract all commercial real estate listing/property data from this Offering Memorandum / brochure PDF${sourceUrl ? ` (source: ${sourceUrl})` : ""}. Return structured JSON per the system instructions.`,
        },
      ];
    } else if (isImage && imageData) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
        {
          type: "text",
          text: `Extract all commercial real estate listing/property data from this document image${sourceUrl ? ` (source: ${sourceUrl})` : ""}. Return structured JSON per the system instructions.`,
        },
      ];
    } else {
      userContent = `Extract all commercial real estate listing/property data from the following document${sourceUrl ? ` (source: ${sourceUrl})` : ""}.\n\n---\n${text}\n---`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || "Claude API error" },
        { status: 502 }
      );
    }

    const responseText =
      data.content?.[0]?.type === "text" ? data.content[0].text : "";

    let parsed;
    try {
      parsed = JSON.parse(
        responseText
          .replace(/```json?\s*/g, "")
          .replace(/```\s*/g, "")
          .trim()
      );
    } catch {
      return NextResponse.json(
        {
          error: "Failed to parse AI response. Please try again.",
          rawResponse: responseText,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      property: parsed.property || {},
      confidence: parsed.confidence || "medium",
      extraction_notes: parsed.extraction_notes || "",
    });
  } catch (error: any) {
    console.error("Listing parse error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process document" },
      { status: 500 }
    );
  }
}
