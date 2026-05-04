/**
 * POST /api/properties/[id]/extract-from-om
 *
 * Accepts a PDF or DOCX file via multipart/form-data, extracts the text,
 * sends it to Claude Haiku for structured-JSON field extraction, and returns
 * a diff payload the front-end uses to render a Cross-Reference modal:
 *   { current: {...}, extracted: {...}, fields: [{ key, currentValue,
 *     extractedValue, match, confidence, source_quote? }] }
 *
 * No DB write happens here — the user reviews the diff and PATCHes the
 * property via /api/properties/[id] with the fields they accept.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
// 30s should be plenty for parse + a single Haiku roundtrip; bump if huge OMs.
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

// Fields we ask Claude to extract from an OM. Subset of the property schema —
// only fields that are commonly in OMs (skip private/internal fields like
// commission_pct, probability_pct, etc.).
const EXTRACTABLE_FIELDS = [
  "address", "city", "state", "zip",
  "asset_type",        // "retail" | "office" | "industrial" | "hospitality" | "multifamily" | "land" | "medical" | "mixed_use" | "other"
  "asking_price",
  "lease_rate",
  "sqft",
  "acreage",
  "year_built",
  "parking_spaces",
  "parking_ratio",
  "zoning",
  "noi",
  "cap_rate",
  "occupancy_pct",
  "description",
  "highlights",        // array of strings
] as const;

type ExtractableField = typeof EXTRACTABLE_FIELDS[number];

interface ExtractedPayload {
  values: Partial<Record<ExtractableField, unknown>>;
  confidence: Partial<Record<ExtractableField, "high" | "medium" | "low">>;
  source_quotes: Partial<Record<ExtractableField, string>>;
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// File → text
// ─────────────────────────────────────────────────────────────────────────────

async function pdfToText(buffer: Buffer): Promise<string> {
  // Use pdf-parse-fork — a maintained drop-in for pdf-parse without the
  // upstream's debug-mode test-file read that breaks Next.js builds.
  // Dynamic import keeps this heavy module out of routes that don't need it.
  const mod = await import("pdf-parse-fork");
  const pdfParse = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default
    ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
  const result = await pdfParse(buffer);
  return result.text || "";
}

async function docxToText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude extraction
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a commercial real estate data extractor. Given the raw text of an offering memorandum (OM), extract ONLY the fields listed below. Return STRICT JSON in this exact shape:

{
  "values": {
    "address": "string or null",
    "city": "string or null",
    "state": "2-letter US state code or null",
    "zip": "string or null",
    "asset_type": "retail|office|industrial|hospitality|multifamily|land|medical|mixed_use|other or null",
    "asking_price": "number or null (USD, no commas/dollar sign)",
    "lease_rate": "number or null (USD per year per SF)",
    "sqft": "number or null (gross building SF)",
    "acreage": "number or null",
    "year_built": "number or null (4-digit year)",
    "parking_spaces": "number or null",
    "parking_ratio": "string or null (e.g. '4.5/1000 SF')",
    "zoning": "string or null",
    "noi": "number or null (annual NOI in USD)",
    "cap_rate": "number or null (decimal — 6.5% → 0.065)",
    "occupancy_pct": "number or null (decimal — 95% → 0.95)",
    "description": "string or null (1-3 sentence asset summary)",
    "highlights": "array of short bullet strings or null"
  },
  "confidence": {
    "<field>": "high|medium|low"
  },
  "source_quotes": {
    "<field>": "the verbatim phrase from the OM you used to extract this field"
  }
}

Rules:
- Use null for any field NOT clearly stated in the OM. Do not guess.
- Numbers must be numbers (not strings). Strip currency symbols and commas.
- cap_rate and occupancy_pct must be decimals (0.065 not 6.5).
- Return ONLY the JSON object. No prose, no markdown fences.`;

async function callClaude(omText: string): Promise<ExtractedPayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Trim very long OMs to keep the call fast/cheap. 60K chars ≈ 15K tokens
  // which is well within Haiku's window and covers 95% of OMs.
  const trimmed = omText.length > 60_000 ? omText.slice(0, 60_000) : omText;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `OM TEXT:\n\n${trimmed}` }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.content?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("Unexpected Anthropic response shape");
  }

  // Tolerate stray code fences / leading prose before the JSON object.
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("Claude did not return JSON");
  }
  const jsonStr = content.slice(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(jsonStr) as ExtractedPayload;
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse Claude JSON: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff helper
// ─────────────────────────────────────────────────────────────────────────────

interface DiffField {
  key: ExtractableField;
  currentValue: unknown;
  extractedValue: unknown;
  match: "match" | "differs" | "missing-current" | "missing-extracted";
  confidence: "high" | "medium" | "low" | null;
  source_quote: string | null;
}

function computeDiff(current: Record<string, unknown>, extracted: ExtractedPayload): DiffField[] {
  return EXTRACTABLE_FIELDS.map((key) => {
    const currentValue = current[key] ?? null;
    const extractedValue = extracted.values?.[key] ?? null;
    let match: DiffField["match"];
    if (extractedValue == null && currentValue == null) match = "match";
    else if (extractedValue == null) match = "missing-extracted";
    else if (currentValue == null) match = "missing-current";
    else if (JSON.stringify(currentValue) === JSON.stringify(extractedValue)) match = "match";
    else match = "differs";
    return {
      key,
      currentValue,
      extractedValue,
      match,
      confidence: extracted.confidence?.[key] ?? null,
      source_quote: extracted.source_quotes?.[key] ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const propertyId = params.id;
  if (!propertyId) {
    return NextResponse.json({ error: "Missing property id" }, { status: 400 });
  }

  // Read multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  // Size guard: 25 MB cap. PDFs above that are usually image-heavy and need
  // OCR — out of scope for this MVP.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max 25MB).` }, { status: 413 });
  }

  // Load the property record so we have something to diff against
  const supabase = svc();
  const { data: property, error: fetchErr } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // File → text
  const buffer = Buffer.from(await file.arrayBuffer());
  const lowerName = (file.name || "").toLowerCase();
  let text: string;
  try {
    if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
      text = await pdfToText(buffer);
    } else if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx")
    ) {
      text = await docxToText(buffer);
    } else {
      return NextResponse.json({ error: "Only PDF or DOCX supported" }, { status: 415 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to extract text: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  if (!text || text.trim().length < 50) {
    return NextResponse.json(
      { error: "Could not extract usable text from the file (probably scanned/image-only PDF)." },
      { status: 422 }
    );
  }

  // Claude extraction
  let extracted: ExtractedPayload;
  try {
    extracted = await callClaude(text);
  } catch (err) {
    return NextResponse.json(
      { error: `Extraction failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const diff = computeDiff(property as Record<string, unknown>, extracted);

  return NextResponse.json({
    property_id: propertyId,
    file: { name: file.name, size: file.size, type: file.type },
    text_length: text.length,
    extracted: extracted.values,
    confidence: extracted.confidence,
    source_quotes: extracted.source_quotes,
    diff,
  });
}
