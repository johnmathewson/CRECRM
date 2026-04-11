import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const maxDuration = 60;
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

function parseSpreadsheet(buf: Buffer, fileName: string): string {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheets: string[] = [];
  for (const sn of wb.SheetNames) {
    sheets.push(`--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`);
  }
  return sheets.join("\n\n");
}

function parseImage(buf: Buffer, fileName: string): { base64: string; mediaType: string } {
  return {
    base64: buf.toString("base64"),
    mediaType: fileName.endsWith(".png") ? "image/png" : "image/jpeg",
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "File too large" }, { status: 413 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    let userContent: any;

    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      const text = parseSpreadsheet(buf, name);
      userContent = `Extract all comparable lease data from the following document.\n\n---\n${text}\n---`;
    } else if (name.match(/\.(jpg|jpeg|png|webp)$/)) {
      const { base64, mediaType } = parseImage(buf, name);
      userContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "Extract all comparable lease data from this image." },
      ];
    } else if (name.endsWith(".pdf")) {
      const pdfModule = await import("pdf-parse");
      const pdfParse = (pdfModule as any).default || pdfModule;
      const result = await pdfParse(buf);
      userContent = `Extract all comparable lease data from the following document.\n\n---\n${result.text}\n---`;
    } else if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      userContent = `Extract all comparable lease data from the following document.\n\n---\n${result.value}\n---`;
    } else {
      return NextResponse.json({ error: `Unsupported file type: ${name}` }, { status: 400 });
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
