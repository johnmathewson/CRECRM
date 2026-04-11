import { NextRequest, NextResponse } from "next/server";

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
- monthly_rent: number
- annual_rent: number
- escalation_pct: number (annual escalation %, or null)
- is_vacant: boolean

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no code fences.
2. Response format: { "units": [...], "confidence": "high"|"medium"|"low", "notes": "string" }
3. If a value can be calculated (annual_rent = monthly_rent * 12, or annual_rent = sf * rate), calculate it.
4. If rates are given as monthly per SF, convert to annual per SF.
5. Vacant units: is_vacant = true, tenant_name = "VACANT".
6. Preserve the original document order.
7. "confidence" = how structured the source data was.
8. "notes" = any ambiguities or assumptions you made.`;

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
        model: "claude-haiku-4-5-20251001",
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
      units: parsed.units || [],
      confidence: parsed.confidence || "medium",
      notes: parsed.notes || "",
      rawText: (text || "(image upload)").slice(0, 5000),
    });
  } catch (error: any) {
    console.error("Intake parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to process file" }, { status: 500 });
  }
}
