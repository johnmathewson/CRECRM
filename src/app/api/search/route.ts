/**
 * GET /api/search?q=… — the ⌘K palette. Session-authed.
 *
 * One query across the three nouns a broker types: people (name / email /
 * phone), properties (name / address / city), leads (sender). Five of
 * each, newest first. Returns hrefs so the palette just navigates.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface SearchHit {
  kind: "person" | "property" | "lead";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export async function GET(req: NextRequest) {
  const { data: { user } } = await createServerSupabase().auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // PostgREST .or() breaks on commas/parens/percent; a search term never
  // needs them anyway.
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/[,()%\\]/g, " ").slice(0, 80);
  if (q.length < 2) return NextResponse.json({ hits: [] as SearchHit[] });
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const [people, properties, leads] = await Promise.all([
    sb
      .from("contacts")
      .select("id, full_name, email, phone, role")
      .eq("organization_id", ORG_ID)
      .or(
        [`full_name.ilike.${like}`, `email.ilike.${like}`, ...(digits.length >= 4 ? [`phone.ilike.%${digits}%`] : [])].join(",")
      )
      .order("updated_at", { ascending: false })
      .limit(5),
    sb
      .from("properties")
      .select("id, name, slug, address, city, state, status")
      .eq("organization_id", ORG_ID)
      .or(`name.ilike.${like},address.ilike.${like},city.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(5),
    sb
      .from("leads")
      .select("id, sender_name, sender_email, property_label, status, created_at")
      .eq("organization_id", ORG_ID)
      .not("status", "in", '("spam","archived")')
      .or(`sender_name.ilike.${like},sender_email.ilike.${like},property_label.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const hits: SearchHit[] = [
    ...((people.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null; role: string | null }>).map((c) => ({
      kind: "person" as const,
      id: c.id,
      title: c.full_name || c.email || c.phone || "Unnamed",
      subtitle: [c.role, c.email, c.phone].filter(Boolean).join(" · ") || null,
      href: `/cre-os/relationships/${c.id}`,
    })),
    ...((properties.data ?? []) as Array<{ id: string; name: string | null; slug: string | null; address: string | null; city: string | null; state: string | null; status: string | null }>).map((p) => ({
      kind: "property" as const,
      id: p.id,
      title: p.name || p.address || "Unnamed property",
      subtitle: [p.address, [p.city, p.state].filter(Boolean).join(", "), p.status].filter(Boolean).join(" · ") || null,
      href: p.slug ? `/cre-os/properties/${p.slug}` : `/cre-os/properties`,
    })),
    ...((leads.data ?? []) as Array<{ id: string; sender_name: string | null; sender_email: string | null; property_label: string | null; status: string | null }>).map((l) => ({
      kind: "lead" as const,
      id: l.id,
      title: l.sender_name || l.sender_email || "Lead",
      subtitle: [l.property_label, l.status].filter(Boolean).join(" · ") || null,
      href: `/cre-os/inbox/${l.id}`,
    })),
  ];

  return NextResponse.json({ hits });
}
