/**
 * POST /api/map/businesses/enrich?limit=60
 *
 * Classifies businesses that have no AI enrichment yet: Haiku turns
 * name + raw category + website + address into a clean type label and a
 * one-line "what they do," so the parcel card can say "Precision machine
 * shop · CNC and tool-and-die work for regional manufacturers" instead of
 * "automotive_repair". Idempotent; runs daily after the listings sync and
 * on demand. Auth: x-cron-secret or a logged-in CRM session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You classify small businesses for a commercial real estate map of Hobart, Indiana.
For each business you receive a name, a raw category slug (may be missing), an address, a website and a phone.
Return ONLY a JSON array, one object per input in the same order:
[{"id": "...", "type": "<2-4 word plain-English business type, Title Case, e.g. 'Auto Repair Shop', 'Dental Office', 'Church', 'Industrial Supplier'>",
  "description": "<one sentence, max 18 words, concrete: what they sell or do and for whom. No marketing language. If genuinely unknown say 'Unverified; name suggests …'>",
  "sector": "<one of: retail, food_beverage, auto, medical, professional, personal_services, industrial, logistics, construction_trades, lodging, religious_civic, education, residential, government, recreation, other>"}]
Infer from the name when the category is missing (e.g. 'Precision Tool & Die' → Industrial Manufacturer). Never invent facts beyond what the name plainly implies.`;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
  });
  const { data } = await sb.auth.getUser();
  return !!data.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.MAP_DATA_KEY;
  if (!key) return NextResponse.json({ error: "MAP_DATA_KEY is not configured" }, { status: 500 });
  const limit = Math.min(120, Math.max(5, Number(req.nextUrl.searchParams.get("limit") ?? 60)));
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: (u, o) => fetch(u, { ...o, cache: "no-store" }) },
  });

  const { data, error } = await sb.rpc("map_businesses_active", { p_key: key, p_city: "Hobart" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const pending = ((data ?? []) as any[]).filter((b) => !b.description).slice(0, limit);
  if (!pending.length) return NextResponse.json({ ok: true, enriched: 0, remaining: 0 });

  let enriched = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20).map((b) => ({
      id: b.id, name: b.name, brand: b.brand ?? undefined, category: b.category ?? undefined,
      address: b.address ?? undefined, website: b.website ?? undefined, phone: b.phone ?? undefined,
    }));
    try {
      const res = await callAnthropic({
        model: MODELS.HAIKU, system: SYSTEM, maxTokens: 2500, temperature: 0.1,
        messages: [{ role: "user", content: JSON.stringify(batch) }],
      });
      const out = parseJsonResponse<Array<{ id: string; type: string; description: string; sector?: string }>>(res.text) ?? [];
      for (const o of out) {
        if (!o?.id || !o.type) continue;
        const desc = [o.description, o.sector ? `[${o.sector}]` : null].filter(Boolean).join(" ");
        const { error: e2 } = await sb.rpc("map_business_enrich", { p_key: key, p_id: o.id, p_type: o.type.slice(0, 60), p_desc: desc.slice(0, 300) });
        if (!e2) enriched++;
      }
    } catch (err: any) {
      console.error("[map/businesses/enrich] batch failed", err?.message ?? err);
    }
  }
  const remaining = ((data ?? []) as any[]).filter((b) => !b.description).length - enriched;
  return NextResponse.json({ ok: true, enriched, remaining });
}
