/**
 * Generate a signed-NDA PDF server-side using jspdf. Stored to the
 * nda-pdfs Supabase Storage bucket so the audit trail has both the
 * structured row (nda_signatures) and a human-readable artifact.
 *
 * Markdown rendering is intentionally minimal — we honor `**bold**`,
 * paragraph breaks, and that's about it. The legal text is plain prose.
 */

import { jsPDF } from "jspdf";

interface PdfInput {
  title: string;
  bodyMd: string;
  property: { name: string; address?: string | null; city?: string | null; state?: string | null };
  signer: { typed_name: string; typed_email: string };
  signedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  textHash: string;
}

export function buildNdaPdf(input: PdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 54; // 0.75"
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(needed: number) {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function writeLine(text: string, opts: { size?: number; bold?: boolean; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const gap = opts.gap ?? 4;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines as string[]) {
      ensureSpace(size + gap);
      doc.text(line, margin, y);
      y += size + gap;
    }
  }

  function writeParagraph(text: string) {
    // Recognize **...** bold markers within a single paragraph by splitting
    // around them and concatenating with appropriate font weights.
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(p => p.length > 0);
    if (parts.length === 1) {
      writeLine(text, { size: 10, gap: 4 });
    } else {
      // For simplicity, render the entire paragraph in normal weight, but
      // keep the asterisks visible as visual emphasis. Lightweight; if we
      // need real bold-mid-line later, switch to a token-by-token writer.
      const cleaned = text.replace(/\*\*/g, "");
      writeLine(cleaned, { size: 10, gap: 4 });
    }
    y += 4;
  }

  // ── Header ─────────────────────────────────────────────────────────────
  writeLine("Stewardship CRE / Stewardship Asset Group", { size: 9, gap: 2 });
  writeLine(`Confidentiality Agreement — signed ${input.signedAt.toUTCString()}`, { size: 9, gap: 2 });
  y += 8;
  writeLine(input.title, { size: 14, bold: true, gap: 6 });

  // Property identity
  const propLine = [input.property.name, input.property.address, input.property.city, input.property.state]
    .filter(Boolean)
    .join(", ");
  writeLine(`Property: ${propLine}`, { size: 10, bold: true, gap: 8 });
  y += 6;

  // ── Body — split on blank lines into paragraphs ────────────────────────
  const paragraphs = input.bodyMd
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map(p => p.replace(/\n/g, " ").trim())
    .filter(p => p.length > 0);

  for (const para of paragraphs) {
    writeParagraph(para);
  }

  // ── Signature block ────────────────────────────────────────────────────
  y += 10;
  ensureSpace(80);
  doc.setDrawColor(0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;
  writeLine("Electronically signed", { size: 9, bold: true, gap: 4 });
  writeLine(`Name (typed): ${input.signer.typed_name}`, { size: 10, gap: 3 });
  writeLine(`Email: ${input.signer.typed_email}`, { size: 10, gap: 3 });
  writeLine(`Signed at: ${input.signedAt.toUTCString()}`, { size: 10, gap: 3 });
  if (input.ipAddress) writeLine(`IP: ${input.ipAddress}`, { size: 10, gap: 3 });
  if (input.userAgent) writeLine(`User-Agent: ${input.userAgent.slice(0, 200)}`, { size: 9, gap: 3 });
  writeLine(`Text hash (SHA-256): ${input.textHash}`, { size: 8, gap: 3 });

  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}
