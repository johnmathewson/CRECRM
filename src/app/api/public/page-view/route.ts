/**
 * POST /api/public/page-view
 *
 * Marketing site fires this on every /properties/[slug] view. Stores an
 * anonymized record (IP hashed, UA reduced to "Browser/OS"). No cookies,
 * no fingerprinting — just shape-of-traffic.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, hashIp, summarizeUA } from "@/lib/owner-dashboard";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

interface Body {
  slug: string;
  path?: string;
  referer?: string;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  let body: Body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (!body.slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400, headers: corsHeaders(origin) });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("slug", body.slug)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent");

  await supabase.from("page_views").insert({
    organization_id: ORG_ID,
    property_id: property?.id || null,
    slug: body.slug,
    path: body.path || null,
    referer: body.referer || null,
    ip_hash: hashIp(ip),
    ua_summary: summarizeUA(ua),
  });

  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) });
}
