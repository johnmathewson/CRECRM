import { NextRequest, NextResponse } from "next/server";
import { MODELS } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a commercial real estate comparable lease data extraction specialist. You will receive text or data from documents containing lease comparables (comps). Extract ALL comparable lease/tenant records into structured JSON.

For each comp, extract these fields (use null if not found):
- property_name: string (the property or building name)
- address: string
- city: string
- state: string (2-letter abbreviation)
- submarket: string (neighborhood or submarket area, or null)
- asset_type: string ("Retail", "Office", "Industrial", "Mixed-Use", "Multifamily", or null)
- tenant_name: string
- suite: string
- square_footage: number (rentable SF)
- lease_rate: number (annual rate per SF — convert if given monthly by multiplying by 12)
- lease_type: string ("NNN", "Gross", "Modified Gross", or null)
- lease_start: string (YYYY-MM-DD or null)
- lease_end: string (YYYY-MM-DD or null)
- monthly_rent: number
- annual_rent: number

RULES:
1. Return ONLY valid JSON. No markdown, no code fences.
2. Format: { "comps": [...], "confidence": "high"|"medium"|"low", "notes": "string" }
3. Calculate missing values when possible (annual = monthly * 12, rate = annual / SF).
4. If rates are monthly per SF, convert to annual.
5. Preserve document order.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, isImage, imageData, mediaType } = body;

    if (!text && !imageData) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    let userContent: any;
    if (isImage && imageData) {
      userContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
        { type: "text", text: "Extract all comparable lease data from this image." },
      ];
    } else {
      userContent = `Extract all comparable lease data from the following document.\n\n---\n${text}\n---`;
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
    if (!response.ok) return NextResponse.json({ error: data.error?.message || "API error" }, { status: 502 });

    const responseText = data.content?.[0]?.type === "text" ? data.content[0].text : "";
    let parsed;
    try {
      parsed = JSON.parse(responseText.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim());
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", rawResponse: responseText }, { status: 422 });
    }

    return NextResponse.json({
      comps: parsed.comps || [],
      confidence: parsed.confidence || "medium",
      notes: parsed.notes || "",
    });
  } catch (error: any) {
    console.error("Comps parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to process file" }, { status: 500 });
  }
}
