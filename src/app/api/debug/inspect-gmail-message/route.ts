/**
 * GET /api/debug/inspect-gmail-message?id=<gmail_message_id>
 *
 * One-shot diagnostic endpoint. Pulls a Gmail message via the active OAuth
 * token, lists every part + attachment, and returns a JSON dump suitable
 * for figuring out how a third-party report is structured before building
 * a real parser.
 *
 * Used to figure out the shape of CREXi / LoopNet daily lead reports
 * (they come as email attachments). Once we know the format, we delete
 * this endpoint and build the production parser.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PartInfo {
  path: string;
  mimeType: string | null;
  filename: string | null;
  size: number | null;
  hasInlineData: boolean;
  hasAttachmentId: boolean;
  attachmentId: string | null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const token = await getActiveGmailToken(supabase);
  if (!token) return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });

  // Fetch the message
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token.accessToken}` } }
  );
  if (!msgRes.ok) {
    return NextResponse.json(
      { error: "Gmail fetch failed", status: msgRes.status, body: await msgRes.text() },
      { status: 502 }
    );
  }
  const msg = await msgRes.json();

  // Pluck headers we care about
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers || []) {
    if (["Subject", "From", "Date", "To"].includes(h.name)) {
      headers[h.name] = h.value;
    }
  }

  // Walk parts and collect attachment IDs
  const parts: PartInfo[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(part: any, path: string) {
    parts.push({
      path: path || "root",
      mimeType: part.mimeType ?? null,
      filename: part.filename || null,
      size: part.body?.size ?? null,
      hasInlineData: !!part.body?.data,
      hasAttachmentId: !!part.body?.attachmentId,
      attachmentId: part.body?.attachmentId ?? null,
    });
    if (part.parts) {
      part.parts.forEach((p: unknown, i: number) => walk(p, `${path}.${i}`));
    }
  }
  walk(msg.payload, "");

  // Fetch each attachment that has an attachmentId — return first 2000
  // chars of decoded content (for text formats) or just metadata for binary.
  const attachments: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    preview: string | null;
    isText: boolean;
    firstBytesHex: string;
  }> = [];

  for (const p of parts) {
    if (!p.attachmentId || !p.filename) continue;
    const attRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${p.attachmentId}`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (!attRes.ok) continue;
    const att = await attRes.json();
    const data: string = att.data || "";
    const buf = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const mime = p.mimeType ?? "application/octet-stream";
    const isText =
      mime.startsWith("text/") ||
      p.filename.endsWith(".csv") ||
      p.filename.endsWith(".tsv") ||
      p.filename.endsWith(".txt");
    attachments.push({
      filename: p.filename,
      mimeType: mime,
      sizeBytes: buf.length,
      preview: isText ? buf.toString("utf8").slice(0, 2000) : null,
      isText,
      firstBytesHex: buf.slice(0, 16).toString("hex"),
    });
  }

  return NextResponse.json({
    messageId: id,
    headers,
    parts,
    attachments,
    snippet: msg.snippet,
  });
}
