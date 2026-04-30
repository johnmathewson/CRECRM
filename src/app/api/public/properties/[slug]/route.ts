import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://stewardshipcre.com",
  "https://www.stewardshipcre.com",
  "http://localhost:3000",
  "http://localhost:3001",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const origin = req.headers.get("origin");
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .eq("slug", params.slug)
      .eq("publish_to_website", true)
      .maybeSingle();

    if (error) {
      console.error("Public property detail error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders(origin) }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    // Strip internal-only fields before returning
    const {
      notes,
      organization_id,
      crexi_sync_status,
      crexi_listing_id,
      crexi_synced_at,
      source_import,
      ...publicData
    } = data;

    return NextResponse.json(
      { property: publicData },
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (err: any) {
    console.error("Public property detail GET error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch property" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
