import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { importCoStarFile } from "@/lib/comp-importer";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const dryRun = formData.get("dryRun") === "true";
    const includeActive = formData.get("includeActive") !== "false";

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const results = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (data.length < 2) {
        results.push({ fileName: file.name, error: "File has no data rows" });
        continue;
      }

      const headers = data[0].map((h: any) => String(h || "").trim());
      const rows = data.slice(1).filter((row) => row.some((cell: any) => cell != null && cell !== ""));

      const result = await importCoStarFile(rows, headers, ORG_ID, supabase, {
        fileName: file.name,
        dryRun,
        includeActive,
      });

      results.push({ fileName: file.name, ...result });
    }

    const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
    const totalSkipped = results.reduce((sum, r) => sum + (r.skipped || 0), 0);

    return NextResponse.json({
      success: true,
      dryRun,
      totalFiles: files.length,
      totalInserted,
      totalSkipped,
      fileResults: results,
    });
  } catch (error: any) {
    console.error("Comp import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500 });
  }
}
