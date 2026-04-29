import { NextRequest, NextResponse } from "next/server";
import * as pdfParseModule from "pdf-parse";
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (ext !== "pdf") {
      return NextResponse.json({ error: "Only PDF files supported by this endpoint" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await pdfParse(buffer);

    return NextResponse.json({
      text: result.text,
      pages: result.numpages,
      info: result.info,
    });
  } catch (error: any) {
    console.error("PDF extraction error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to extract PDF text" },
      { status: 500 }
    );
  }
}
