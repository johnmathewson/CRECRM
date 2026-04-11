import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
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

async function parseFile(file: File): Promise<{ text: string; isImage: boolean }> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const pdfModule = await import("pdf-parse");
    const pdfParse = (pdfModule as any).default || pdfModule;
    const result = await pdfParse(buf);
    return { text: result.text, isImage: false };
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value, isImage: false };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheets: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
    return { text: sheets.join("\n\n"), isImage: false };
  }

  if (name.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
    const base64 = buf.toString("base64");
    const mimeType = name.endsWith(".png") ? "image/png" : "image/jpeg";
    return { text: `data:${mimeType};base64,${base64}`, isImage: true };
  }

  throw new Error(`Unsupported file type: ${name}`);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const propertyName = formData.get("propertyName") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!propertyName?.trim()) {
      return NextResponse.json({ error: "Property name required" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const { text: extractedContent, isImage } = await parseFile(file);

    // Build Claude message content
    let userContent: any;
    if (isImage) {
      const [header, base64Data] = extractedContent.split(",");
      const mediaType = header.replace("data:", "").replace(";base64", "");
      userContent = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64Data },
        },
        {
          type: "text",
          text: `Extract all rent roll / tenant data from this image for the property: "${propertyName}". Return structured JSON per the system instructions.`,
        },
      ];
    } else {
      userContent = `Extract all rent roll / tenant data from the following document for the property: "${propertyName}".\n\n---\n${extractedContent}\n---`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Claude API error:", data);
      return NextResponse.json(
        { error: data.error?.message || "Claude API error" },
        { status: 502 }
      );
    }

    const responseText =
      data.content?.[0]?.type === "text" ? data.content[0].text : "";

    // Parse JSON from Claude's response
    let parsed;
    try {
      // Strip any markdown code fences if present
      const cleaned = responseText.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Claude response:", responseText);
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again.", rawResponse: responseText },
        { status: 422 }
      );
    }

    return NextResponse.json({
      units: parsed.units || [],
      confidence: parsed.confidence || "medium",
      notes: parsed.notes || "",
      rawText: isImage ? "(image upload)" : extractedContent.slice(0, 5000),
    });
  } catch (error: any) {
    console.error("Intake parse error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process file" },
      { status: 500 }
    );
  }
}
