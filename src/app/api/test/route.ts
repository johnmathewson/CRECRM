import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      keyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0, 10) || "NOT SET",
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const textLength = body.text?.length || 0;

    // Try calling Claude with a tiny request
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key", ok: false });
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
        max_tokens: 50,
        messages: [{ role: "user", content: "Reply with just the word OK" }],
      }),
    });

    const data = await response.json();
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      textLength,
      claudeResponse: data,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, stack: error.stack });
  }
}
