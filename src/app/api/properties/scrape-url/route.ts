import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate it's a CREXi URL
    if (!url.includes("crexi.com")) {
      return NextResponse.json({ error: "Only CREXi URLs are supported" }, { status: 400 });
    }

    // Fetch the page with a realistic browser user-agent
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const html = await response.text();

    // Check if Cloudflare blocked us
    if (html.includes("Just a moment") || html.includes("cf-browser-verification")) {
      // Return the URL itself so Claude can use the URL as context
      // along with any meta tags we can extract
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
      const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
      const ogDescMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);

      const fallbackText = [
        `CREXi Listing URL: ${url}`,
        titleMatch ? `Title: ${titleMatch[1]}` : "",
        ogTitleMatch ? `OG Title: ${ogTitleMatch[1]}` : "",
        descMatch ? `Description: ${descMatch[1]}` : "",
        ogDescMatch ? `OG Description: ${ogDescMatch[1]}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return NextResponse.json({
        text: fallbackText,
        partial: true,
        note: "CREXi blocked full page access. Extracted available meta information only.",
      });
    }

    // Strip HTML tags and extract meaningful text
    const text = html
      // Remove script and style blocks
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      // Remove HTML tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();

    // Limit to 15,000 chars to stay within Claude's context
    return NextResponse.json({
      text: text.slice(0, 15000),
      sourceUrl: url,
    });
  } catch (error: any) {
    console.error("URL scrape error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch URL" },
      { status: 500 }
    );
  }
}
