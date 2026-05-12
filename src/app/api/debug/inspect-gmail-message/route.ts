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
import * as XLSX from "xlsx";

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

  // Fetch each attachment that has an attachmentId. For XLSX files, parse
  // and return the sheet structure + first rows so we can see what CREXi /
  // LoopNet is actually sending.
  const attachments: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    preview: string | null;
    isText: boolean;
    firstBytesHex: string;
    excel: null | {
      sheetNames: string[];
      sheets: Record<string, {
        headers: string[];
        rowCount: number;
        sampleRows: Record<string, unknown>[];
      }>;
    };
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

    // Parse XLSX if applicable
    let excel: null | {
      sheetNames: string[];
      sheets: Record<string, { headers: string[]; rowCount: number; sampleRows: Record<string, unknown>[] }>;
    } = null;
    if (p.filename.endsWith(".xlsx") || p.filename.endsWith(".xls")) {
      try {
        const wb = XLSX.read(buf, { type: "buffer" });
        excel = { sheetNames: wb.SheetNames, sheets: {} };
        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: null,
            blankrows: false,
          });
          const headers = (matrix[0] ?? []).map((h: unknown) => String(h ?? "").trim());
          const rows: Record<string, unknown>[] = [];
          for (let i = 1; i < Math.min(matrix.length, 6); i++) {
            const r = matrix[i];
            if (!r) continue;
            const obj: Record<string, unknown> = {};
            for (let j = 0; j < headers.length; j++) obj[headers[j] || `col${j}`] = r[j];
            rows.push(obj);
          }
          excel.sheets[name] = {
            headers,
            rowCount: matrix.length - 1,
            sampleRows: rows,
          };
        }
      } catch (err) {
        excel = null;
        // record failure separately if needed
        console.error("XLSX parse failed:", err);
      }
    }

    attachments.push({
      filename: p.filename,
      mimeType: mime,
      sizeBytes: buf.length,
      preview: isText ? buf.toString("utf8").slice(0, 2000) : null,
      isText,
      firstBytesHex: buf.slice(0, 16).toString("hex"),
      excel,
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
