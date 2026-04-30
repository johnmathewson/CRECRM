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

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase
      .from("properties")
      .select(`
        id, slug, name, headline,
        address, city, state, zip,
        asset_type, transaction_type, status,
        asking_price, lease_rate, sqft, acreage,
        cap_rate, price_per_sf, occupancy_pct,
        description, highlights, images,
        updated_at, created_at
      `)
      .eq("publish_to_website", true)
      .not("slug", "is", null)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Public properties list error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders(origin) }
      );
    }

    // Lean payload for cards: keep only the first image to reduce response size.
    const properties = (data || []).map((p: any) => ({
      ...p,
      images: Array.isArray(p.images) && p.images.length > 0 ? [p.images[0]] : [],
    }));

    return NextResponse.json(
      { properties, count: properties.length },
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (err: any) {
    console.error("Public properties GET error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch properties" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
