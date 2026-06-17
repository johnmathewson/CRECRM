import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MODELS } from "@/lib/anthropic";

// This route connects to Claude with LIVE database context.
// Uses a SECURITY DEFINER Postgres function to pull all data in one call,
// bypassing RLS so the assistant always has full pipeline visibility.

const BASE_SYSTEM_PROMPT = `You are the AI executive assistant for John Mathewson at Stewardship Asset Group, a commercial real estate brokerage in Northwest Indiana. You have FULL access to the CRE Intelligence Platform database — the data below is LIVE from the system.

Your personality: direct, knowledgeable, proactive. You think like a senior CRE broker's chief of staff. You don't just answer questions — you identify what John should be doing next and suggest actions.

Capabilities you can offer:
- Analyze deals, run comp scenarios, calculate commission projections
- Draft emails, LOIs, follow-up messages
- Identify signals and opportunities in the pipeline
- Surface contacts who need attention
- Generate market insights based on the data

Rules:
- Be concise but thorough
- Always suggest next actions
- Format financial numbers clearly ($1,234,567 format)
- If John asks you to DO something (not just analyze), confirm what you'll do
- The only things you CANNOT do autonomously: wire money or send emails to clients without confirm`;

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "TBD";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Deal {
  id: string;
  deal_name: string;
  deal_type: string | null;
  price: number | null;
  commission_pct: number | null;
  estimated_commission: number | null;
  weighted_commission: number | null;
  probability_pct: number | null;
  expected_close: string | null;
  is_dead: boolean;
  notes: string | null;
}

interface DealStage {
  deal_id: string;
  stage: string;
  entered_at: string;
}

interface Property {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  asset_type: string | null;
  status: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  your_role: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  contact_type: string | null;
  warmth: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  last_conversation: string | null;
  next_follow_up: string | null;
}

interface Company {
  id: string;
  name: string;
  industry: string | null;
}

interface AssistantContext {
  deals: Deal[] | null;
  deal_stages: DealStage[] | null;
  properties: Property[] | null;
  contacts: Contact[] | null;
  companies: Company[] | null;
}

function buildContextString(ctx: AssistantContext): string {
  const sections: string[] = [];

  const deals = ctx.deals || [];
  const stageMap: Record<string, string> = {};
  if (ctx.deal_stages) {
    for (const s of ctx.deal_stages) {
      if (!stageMap[s.deal_id]) stageMap[s.deal_id] = s.stage;
    }
  }

  const active = deals.filter((d) => !d.is_dead);
  const dead = deals.filter((d) => d.is_dead);
  const closed = active.filter((d) => stageMap[d.id] === "Closed");
  const pipeline = active.filter((d) => stageMap[d.id] !== "Closed");

  const pipelineValue = pipeline.reduce((s, d) => s + (d.estimated_commission || 0), 0);
  const weightedValue = pipeline.reduce((s, d) => s + (d.weighted_commission || 0), 0);
  const earnedYTD = closed.reduce((s, d) => s + (d.estimated_commission || 0), 0);

  sections.push(`## Pipeline Summary
- Total deals: ${deals.length} (${pipeline.length} active pipeline, ${closed.length} closed, ${dead.length} dead)
- Pipeline commission: ${fmt(pipelineValue)}
- Weighted pipeline: ${fmt(weightedValue)}
- Earned YTD: ${fmt(earnedYTD)}
- 2026 Goal: $2,000,000`);

  if (pipeline.length > 0) {
    const lines = pipeline.map((d, i) => {
      const stage = stageMap[d.id] || "Unknown";
      return `${i + 1}. ${d.deal_name} — ${fmt(d.price)}, ${d.deal_type || "sale"}, ${d.commission_pct || 0}% commission, ${d.probability_pct || 0}% prob (${fmt(d.weighted_commission)} weighted) — ${stage}`;
    });
    sections.push(`## Active Pipeline (by weighted commission)\n${lines.join("\n")}`);
  }

  if (closed.length > 0) {
    const lines = closed.map((d) => `- ${d.deal_name} — ${fmt(d.estimated_commission)} earned`);
    sections.push(`## Closed Deals\n${lines.join("\n")}`);
  }

  const properties = ctx.properties || [];
  if (properties.length > 0) {
    const lines = properties.map(
      (p) => `- ${p.name || p.address}: ${p.asset_type || "Unknown"}, ${p.status || "Active"}, ${fmt(p.asking_price)}, ${p.sqft ? p.sqft.toLocaleString() + " SF" : "SF TBD"}, ${p.city || ""} ${p.state || ""}${p.your_role ? " (" + p.your_role + ")" : ""}`
    );
    sections.push(`## Properties (${properties.length} total)\n${lines.join("\n")}`);
  }

  const contacts = ctx.contacts || [];
  if (contacts.length > 0) {
    const hot = contacts.filter((c) => c.warmth === "hot");
    const warm = contacts.filter((c) => c.warmth === "warm");
    const cold = contacts.filter((c) => c.warmth === "cold" || !c.warmth);
    const now = new Date();
    const stale = contacts.filter((c) => {
      if (!c.last_conversation) return true;
      return now.getTime() - new Date(c.last_conversation).getTime() > 30 * 86400000;
    });

    const lines = contacts.slice(0, 25).map(
      (c) => `- ${c.full_name} (${c.contact_type || "unknown"}, ${c.warmth || "unset"})${c.city ? " — " + c.city + ", " + (c.state || "") : ""}`
    );
    sections.push(`## Contacts (${contacts.length} total)
- Hot: ${hot.length}, Warm: ${warm.length}, Cold/Unset: ${cold.length}
- Stale (30+ days no contact): ${stale.length}
\n${lines.join("\n")}`);
  }

  const companies = ctx.companies || [];
  if (companies.length > 0) {
    const lines = companies.map((c) => `- ${c.name} (${c.industry || "unknown"})`);
    sections.push(`## Companies (${companies.length})\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      return NextResponse.json({
        response: "API key not configured. Please set ANTHROPIC_API_KEY in your environment.",
        actions: ["Show details"],
      });
    }

    // Create a direct Supabase client (not cookie-based) to call our SECURITY DEFINER function
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Single RPC call returns all context — SECURITY DEFINER bypasses RLS
    const { data: ctx, error: rpcError } = await supabase.rpc("get_assistant_context");

    let liveContext = "";
    if (rpcError || !ctx) {
      liveContext = "(Database context unavailable — " + (rpcError?.message || "no data returned") + ")";
    } else {
      liveContext = buildContextString(ctx as AssistantContext);
    }

    const systemPrompt = `${BASE_SYSTEM_PROMPT}

--- LIVE DATABASE SNAPSHOT (${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}) ---

${liveContext}

--- END DATABASE SNAPSHOT ---

Use this data to answer John's questions accurately. Reference specific deal names, contact names, and numbers from the live data above.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.SONNET,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || "API error" },
        { status: response.status }
      );
    }

    const text =
      data.content?.[0]?.type === "text" ? data.content[0].text : "No response.";

    const actions = extractActions(text);

    return NextResponse.json({ response: text, actions });
  } catch (error) {
    console.error("Assistant error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

function extractActions(text: string): string[] {
  const actions: string[] = [];
  if (/email|draft|send|outreach/i.test(text)) actions.push("Draft emails");
  if (/schedul|task|follow.?up|remind/i.test(text)) actions.push("Schedule tasks");
  if (/tour|show|view|detail|look/i.test(text)) actions.push("Show details");
  if (/report|analy|comp/i.test(text)) actions.push("Generate report");
  if (/call|phone|contact/i.test(text)) actions.push("Log activity");
  if (actions.length === 0) actions.push("Show details");
  return actions.slice(0, 3);
}
