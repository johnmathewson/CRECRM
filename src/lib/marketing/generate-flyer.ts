/**
 * 1-page property flyer PDF generator.
 *
 * Matches the Liberty Square Flyer template (May 2026, extracted from
 * Liberty_Square_Flyer.pdf). Letter portrait, single page, dense.
 * Same brand palette + typography as the OM generator.
 *
 * Layout (top → bottom):
 *   1. Full-bleed hero image (612 × 216 pt)
 *   2. Brand mark + property name + tagline + address
 *   3. Three-column big-number stats strip (PRICE / KEY METRIC / SIZE)
 *   4. Two-column body:
 *        Left  — INVESTMENT HIGHLIGHTS bullets w/ bronze headers
 *        Right — PROPERTY FACTS key-value table + DEMOGRAPHICS (opt)
 *   5. Footer — broker contact + disclaimer
 *
 * Sections honor the "skip if no data" rule:
 *   - Hero image skipped if properties.images is empty (no placeholder)
 *   - Cap rate column in stats strip becomes acreage for vacant
 *   - DEMOGRAPHICS skipped if no data
 *   - Investment Highlights skipped if array is empty
 */

import jsPDF from "jspdf";
import type { MarketingPropertyContext } from "./property-context";

type RGB = [number, number, number];

// Stewardship brand palette — matches stewardshipcre.com:
//   bg #0D0D0D (page) · surface #1A1A1A (raised) · surfaceHi #282828
//   coral #E07A5F (accent) · coralDim #EA9A82 (softer)
//   cream #F0EDE4 (text) · cream-alpha for muted / hairlines
// Different from generate-om.ts (which used eXp Commercial's
// teal/bronze on white per the actual OM template). The flyer
// adopts Stewardship's visual identity even though we name eXp
// Commercial as the brokerage in the contact strip.
const C: Record<string, RGB> = {
  bg: [13, 13, 13],
  surface: [26, 26, 26],
  surfaceHi: [40, 40, 40],
  coral: [224, 122, 95],
  coralDim: [234, 154, 130],
  coralDeep: [198, 102, 72],
  cream: [240, 237, 228],
  creamMuted: [180, 175, 165],
  creamSubtle: [130, 126, 118],
  hairline: [60, 58, 54],
  black: [0, 0, 0],
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 36;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const HERO_H = 216;

const fmtMoney = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  if (num <= 0) return "—";
  if (num >= 1_000_000) return "$" + (num / 1_000_000).toFixed(num >= 10_000_000 ? 1 : 2) + "M";
  if (num >= 1_000) return "$" + Math.round(num / 1_000) + "K";
  return "$" + num.toLocaleString();
};
const fmtSF = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number | null | undefined, places = 2) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : (Number(n) * 100).toFixed(places) + "%";

function setFill(doc: jsPDF, rgb: RGB) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc: jsPDF, rgb: RGB) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc: jsPDF, rgb: RGB) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }

// ── Image fetch helper ───────────────────────────────────────────────────

/**
 * Fetch an image URL and return its raw bytes + format (JPEG / PNG) so
 * jsPDF.addImage can embed it. Returns null on any fetch error so the
 * caller can fall back to a no-image layout gracefully.
 */
async function fetchImageBytes(
  url: string
): Promise<{ data: Uint8Array; format: "JPEG" | "PNG" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const data = new Uint8Array(buf);
    // Sniff format: JPEG starts FF D8, PNG starts 89 50 4E 47
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
      return { data, format: "JPEG" };
    }
    if (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    ) {
      return { data, format: "PNG" };
    }
    // Default to JPEG — jsPDF will throw if mismatch but most CDN
    // images without a magic header are JPEG.
    return { data, format: "JPEG" };
  } catch {
    return null;
  }
}

// ── Section: Hero image strip ────────────────────────────────────────────

function drawHero(
  doc: jsPDF,
  heroImage: { data: Uint8Array; format: "JPEG" | "PNG" } | null
) {
  if (heroImage) {
    try {
      // Aspect-ratio-preserving "cover" fit: scale so the image fills
      // the 612×216 hero box on the shorter dimension and overflows
      // the longer one. NEVER stretch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props: any = (doc as any).getImageProperties(heroImage.data);
      const imgW = Number(props.width);
      const imgH = Number(props.height);
      if (Number.isFinite(imgW) && Number.isFinite(imgH) && imgW > 0 && imgH > 0) {
        const imgAspect = imgW / imgH;
        const boxAspect = PAGE_W / HERO_H;
        let drawW: number, drawH: number, offsetX: number, offsetY: number;
        if (imgAspect > boxAspect) {
          // Image is wider than box — match height, center-crop horizontally
          drawH = HERO_H;
          drawW = HERO_H * imgAspect;
          offsetX = -(drawW - PAGE_W) / 2;
          offsetY = 0;
        } else {
          // Image is taller than box — match width, center-crop vertically
          drawW = PAGE_W;
          drawH = PAGE_W / imgAspect;
          offsetX = 0;
          offsetY = -(drawH - HERO_H) / 2;
        }
        doc.addImage(heroImage.data, heroImage.format, offsetX, offsetY, drawW, drawH);
        // Belt-and-suspenders: jsPDF clip() doesn't always interact
        // cleanly with addImage. We explicitly mask the overflow
        // below the hero band with a white rectangle so nothing
        // bleeds into the content area below.
        setFill(doc, C.bg);
        doc.rect(0, HERO_H, PAGE_W, PAGE_H - HERO_H, "F");
        return;
      }
      // Dimension-read failed: still don't stretch — draw at a sane
      // landscape aspect and mask the overflow.
      doc.addImage(heroImage.data, heroImage.format, 0, 0, PAGE_W, PAGE_W / 1.78);
      setFill(doc, C.bg);
      doc.rect(0, HERO_H, PAGE_W, PAGE_H - HERO_H, "F");
      return;
    } catch (err) {
      console.error("[flyer] hero render failed:", err);
    }
  }
  // No-image fallback: solid teal band so the layout still has a top
  // anchor and brand color block.
  setFill(doc, C.surface);
  doc.rect(0, 0, PAGE_W, HERO_H, "F");
  setFill(doc, C.coral);
  doc.rect(MARGIN_X, HERO_H - 32, 48, 2, "F");
  setText(doc, C.cream);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("PROPERTY FOR SALE", MARGIN_X, HERO_H - 12, { charSpace: 1.5 });
}

// ── Section: Brand + property identity ───────────────────────────────────

function drawIdentity(doc: jsPDF, ctx: MarketingPropertyContext): number {
  const p = ctx.property;
  let cy = HERO_H + 30;

  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("eXp COMMERCIAL", MARGIN_X, cy, { charSpace: 1.5 });
  cy += 22;

  // Property name — split into two lines if multi-word
  const name = (p.name ?? "Property").toUpperCase();
  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  const nameLines: string[] = doc.splitTextToSize(name, CONTENT_W);
  for (const ln of nameLines.slice(0, 2)) {
    doc.text(ln, MARGIN_X, cy);
    cy += 28;
  }

  // Tagline — use headline if present, otherwise build from facts
  const tagline = (() => {
    if (p.headline) return p.headline;
    const parts: string[] = [];
    if (p.sqft) parts.push(`${fmtSF(p.sqft)} SF`);
    if (p.asset_type) {
      const sub = p.sub_type ? `${p.sub_type} ${p.asset_type}` : p.asset_type;
      parts.push(sub.charAt(0).toUpperCase() + sub.slice(1));
    }
    return parts.join(" · ");
  })();
  if (tagline) {
    setText(doc, C.cream);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(tagline.toUpperCase(), MARGIN_X, cy, { charSpace: 0.5 });
    cy += 14;
  }

  // Address line
  const addressBits = [p.address, [p.city, p.state, p.zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" | ");
  if (addressBits) {
    setText(doc, C.cream);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(addressBits.toUpperCase(), MARGIN_X, cy, { charSpace: 0.5 });
    cy += 14;
  }

  return cy + 8;
}

// ── Section: Three-column big stats strip ────────────────────────────────

function drawStatsStrip(doc: jsPDF, ctx: MarketingPropertyContext, y: number): number {
  const p = ctx.property;
  const isVacant = !p.noi || (p.occupancy_pct !== null && Number(p.occupancy_pct) === 0);

  // Build the three slots intelligently based on what we have.
  // Slot 1: ALWAYS asking price (the headline number)
  // Slot 2: For income — cap rate. For vacant — acreage. For lease — rent/SF
  // Slot 3: ALWAYS square footage (or land size)
  type Slot = { label: string; value: string };
  const slots: Slot[] = [];

  if (p.asking_price) {
    slots.push({ label: "OFFERING PRICE", value: fmtMoney(Number(p.asking_price)) });
  } else if (p.lease_rate) {
    slots.push({ label: "LEASE RATE", value: "$" + Number(p.lease_rate).toFixed(2) + "/SF" });
  }

  if (!isVacant && p.cap_rate) {
    slots.push({ label: "IN-PLACE CAP RATE", value: fmtPct(Number(p.cap_rate)) });
  } else if (p.acreage) {
    slots.push({ label: "LOT SIZE", value: Number(p.acreage).toFixed(2) + " AC" });
  } else if (ctx.computed.pricePerSf) {
    slots.push({ label: "PRICE PER SF", value: "$" + ctx.computed.pricePerSf.toFixed(2) });
  }

  if (p.sqft) {
    slots.push({ label: "BUILDING SIZE", value: fmtSF(p.sqft) + " SF" });
  } else if (p.acreage && slots[1]?.label !== "LOT SIZE") {
    slots.push({ label: "LAND SIZE", value: Number(p.acreage).toFixed(2) + " AC" });
  }

  if (slots.length === 0) return y;

  // Cream band behind the strip. Tighter vertical rhythm: label sits
  // on a fixed top-padding, value baseline lands at a fixed offset
  // below — gives a consistent visual line across all three columns
  // regardless of label or value length.
  const stripH = 60;
  setFill(doc, C.surface);
  doc.rect(MARGIN_X, y, CONTENT_W, stripH, "F");

  // Thin bronze separators between columns
  setFill(doc, C.coral);
  const colW = CONTENT_W / slots.length;
  for (let i = 1; i < slots.length; i++) {
    doc.rect(MARGIN_X + i * colW, y + 14, 0.6, stripH - 28, "F");
  }

  for (let i = 0; i < slots.length; i++) {
    const sx = MARGIN_X + i * colW + 14;
    // Label: 7pt bold uppercase, baseline at y+22 (top of text ~y+15)
    setText(doc, C.creamMuted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(slots[i].label, sx, y + 22, { charSpace: 1.1 });
    // Value: 20pt bold, baseline at y+50 (top of text ~y+30)
    setText(doc, C.coral);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(slots[i].value, sx, y + 50);
  }

  return y + stripH + 22;
}

// ── Section: Property description paragraph ─────────────────────────────

/**
 * Property description block that fills the space between the two-
 * column body and the footer. Rendered AFTER the body so the body
 * takes its natural height first and the description sizes itself
 * to fit the remaining vertical room.
 *
 * Pulls properties.description, fits to the available height by
 * dropping paragraphs from the end if needed (cleanest truncation —
 * we never truncate mid-sentence).
 */
function drawDescription(doc: jsPDF, ctx: MarketingPropertyContext, y: number): void {
  const desc = ctx.property.description;
  if (!desc) return;

  // Footer is the bottom 88pt. Need ~16pt breathing room above footer.
  const footerTop = PAGE_H - 88;
  const headerH = 28; // label hairline + uppercase title
  const bottomPad = 16;
  const available = footerTop - bottomPad - (y + headerH);
  if (available < 24) return; // no room — skip rather than crowd

  // Bronze hairline + label
  setFill(doc, C.coral);
  doc.rect(MARGIN_X, y, 32, 1.5, "F");
  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PROPERTY DESCRIPTION", MARGIN_X, y + 14, { charSpace: 1.2 });

  // Drop paragraphs from the end until the remaining text fits.
  const paragraphs: string[] = desc.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
  const LH = 12;
  const FONT_SIZE = 9;
  const PARA_GAP = 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_SIZE);

  function measureLines(text: string): number {
    const lines: string[] = doc.splitTextToSize(text, CONTENT_W);
    return lines.length;
  }
  function totalHeight(paras: string[]): number {
    let h = 0;
    for (const p of paras) h += measureLines(p) * LH + PARA_GAP;
    return h - PARA_GAP; // no trailing gap
  }

  let kept = paragraphs.slice();
  while (kept.length > 1 && totalHeight(kept) > available) {
    kept.pop();
  }
  // If even one paragraph doesn't fit, soft-truncate that single
  // paragraph by sentence boundary.
  if (kept.length === 1 && totalHeight(kept) > available) {
    const sentences = kept[0].split(/(?<=[.!?])\s+/);
    while (sentences.length > 1 && totalHeight([sentences.join(" ")]) > available) {
      sentences.pop();
    }
    kept = [sentences.join(" ")];
  }

  // Render
  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_SIZE);
  let cy = y + headerH;
  for (const p of kept) {
    const lines: string[] = doc.splitTextToSize(p, CONTENT_W);
    for (const ln of lines) {
      doc.text(ln, MARGIN_X, cy);
      cy += LH;
    }
    cy += PARA_GAP;
  }
}

// ── Section: Two-column body (Investment Highlights | Property Facts) ────

function drawBody(doc: jsPDF, ctx: MarketingPropertyContext, y: number): number {
  const p = ctx.property;
  const gap = 20;
  const leftW = (CONTENT_W - gap) * 0.58;   // bullets get a bit more space
  const rightW = CONTENT_W - leftW - gap;
  const leftX = MARGIN_X;
  const rightX = MARGIN_X + leftW + gap;

  // ── LEFT: Investment Highlights ─────────
  let leftY = y;
  const ih: string[] = Array.isArray(p.investment_highlights) ? p.investment_highlights : [];
  if (ih.length > 0) {
    setText(doc, C.coral);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("INVESTMENT", leftX, leftY, { charSpace: 0.6 });
    leftY += 14;
    doc.text("HIGHLIGHTS", leftX, leftY, { charSpace: 0.6 });
    leftY += 8;
    setFill(doc, C.coral);
    doc.rect(leftX, leftY, 32, 1.5, "F");
    leftY += 16;

    // Each bullet: bronze ALLCAPS header (first ~6 words) + ink body
    // (remaining text). Matches Liberty Square pattern. Fixed line-
    // heights so the rhythm is consistent across bullets regardless
    // of header/body length.
    const HEADER_LH = 12;
    const BODY_LH = 11;
    const BULLET_GAP = 10;
    for (const b of ih.slice(0, 6)) {
      const words = b.split(/\s+/);
      const headerCount = Math.min(words.length, 7);
      const header = words.slice(0, headerCount).join(" ").toUpperCase();
      const body = words.slice(headerCount).join(" ");

      setText(doc, C.coral);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      const headerLines: string[] = doc.splitTextToSize(header, leftW);
      for (const ln of headerLines) {
        doc.text(ln, leftX, leftY, { charSpace: 0.4 });
        leftY += HEADER_LH;
      }
      if (body) {
        setText(doc, C.cream);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const bodyLines: string[] = doc.splitTextToSize(body, leftW);
        // Tiny gap between header and body line
        leftY += 2;
        for (const ln of bodyLines) {
          doc.text(ln, leftX, leftY);
          leftY += BODY_LH;
        }
      }
      leftY += BULLET_GAP;
    }
  }

  // ── RIGHT: Property Facts ─────────
  let rightY = y;
  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("PROPERTY FACTS", rightX, rightY, { charSpace: 0.6 });
  rightY += 8;
  setFill(doc, C.coral);
  doc.rect(rightX, rightY, 32, 1.5, "F");
  rightY += 14;

  const facts: Array<[string, string]> = [];
  if (p.address) facts.push(["Address", p.address]);
  if (p.city || p.state) {
    facts.push(["City, State", [p.city, p.state].filter(Boolean).join(", ")]);
  }
  if (p.year_built) facts.push(["Year Built", String(p.year_built)]);
  if (p.sqft) facts.push(["Square Feet", fmtSF(p.sqft) + " SF"]);
  if (p.acreage) facts.push(["Acres", Number(p.acreage).toFixed(2)]);
  if (p.total_buildings) facts.push(["Buildings", String(p.total_buildings)]);
  if (p.number_of_stories) facts.push(["Stories", String(p.number_of_stories)]);
  if (p.zoning) facts.push(["Zoning", String(p.zoning)]);
  if (p.parking_spaces) facts.push(["Parking", fmtSF(p.parking_spaces) + " spaces"]);
  if (p.occupancy_pct !== null && p.occupancy_pct !== undefined) {
    const pct = Number(p.occupancy_pct);
    facts.push(["Occupancy", pct === 0 ? "Vacant — owner-user delivery" : fmtPct(pct, 1)]);
  }
  if (p.noi) facts.push(["In-Place NOI", fmtMoney(Number(p.noi))]);
  if (p.cap_rate) facts.push(["Cap Rate", fmtPct(Number(p.cap_rate))]);
  if (p.asset_type) {
    const at = p.sub_type
      ? `${p.sub_type.charAt(0).toUpperCase() + p.sub_type.slice(1)} ${p.asset_type}`
      : p.asset_type;
    facts.push(["Asset Type", at.charAt(0).toUpperCase() + at.slice(1)]);
  }

  // Fixed-rhythm fact rows. Each row: label baseline at +8, value
  // baseline at +20, hairline at +25, row height = 28 (or +12 per
  // wrapped line for multi-line values). Keeps the right column
  // visually aligned regardless of which facts render.
  const ROW_H = 28;
  const LABEL_DY = 8;
  const VALUE_DY = 20;
  const HAIRLINE_DY = 25;
  const WRAP_DY = 12;

  for (const [k, v] of facts) {
    // Label
    setText(doc, C.creamMuted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(k.toUpperCase(), rightX, rightY + LABEL_DY, { charSpace: 0.7 });
    // Value (may wrap)
    setText(doc, C.cream);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const lines: string[] = doc.splitTextToSize(v, rightW);
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i], rightX, rightY + VALUE_DY + i * WRAP_DY);
    }
    const extraWrap = Math.max(0, lines.length - 1) * WRAP_DY;
    // Hairline UNDER the row, consistent gap from value baseline
    setDraw(doc, C.hairline);
    doc.setLineWidth(0.3);
    doc.line(
      rightX,
      rightY + HAIRLINE_DY + extraWrap,
      rightX + rightW,
      rightY + HAIRLINE_DY + extraWrap
    );
    rightY += ROW_H + extraWrap;
  }

  return Math.max(leftY, rightY) + 8;
}

// ── Section: Footer (broker contact + disclaimer) ────────────────────────

function drawFooter(doc: jsPDF) {
  // Reserve bottom 88pt for the footer
  const footerY = PAGE_H - 88;

  // Teal background band
  setFill(doc, C.surface);
  doc.rect(0, footerY, PAGE_W, PAGE_H - footerY, "F");

  // Bronze accent
  setFill(doc, C.coral);
  doc.rect(MARGIN_X, footerY + 14, 32, 1.5, "F");

  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("EXCLUSIVELY LISTED BY", MARGIN_X, footerY + 28, { charSpace: 1.2 });

  setText(doc, C.cream);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("JOHN MATHEWSON", MARGIN_X, footerY + 46);

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Commercial Real Estate Broker", MARGIN_X, footerY + 58);

  // Right-aligned brokerage info
  setText(doc, C.coral);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("eXp COMMERCIAL", PAGE_W - MARGIN_X, footerY + 30, { align: "right", charSpace: 1.2 });

  setText(doc, C.cream);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Northwest Indiana", PAGE_W - MARGIN_X, footerY + 44, { align: "right" });
  doc.text("john@johnmathewson.co", PAGE_W - MARGIN_X, footerY + 56, { align: "right" });

  // Disclaimer
  setText(doc, [180, 180, 175]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(
    "All property information deemed reliable but not guaranteed. Showings by appointment only.",
    PAGE_W / 2,
    PAGE_H - 12,
    { align: "center" }
  );
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────

export interface GenerateFlyerResult {
  pdfBytes: Uint8Array;
  filename: string;
}

export async function generateFlyer(ctx: MarketingPropertyContext): Promise<GenerateFlyerResult> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const p = ctx.property;

  // Hero image — pull the first image from properties.images, fetch
  // its bytes, embed. If anything fails, we fall back to the no-image
  // teal band so the flyer still renders.
  const images = Array.isArray(p.images) ? p.images : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heroUrl: string | null = images.length > 0 ? (images[0] as any).url ?? null : null;
  const heroImage = heroUrl ? await fetchImageBytes(heroUrl) : null;

  // Paint the entire page dark first. jsPDF defaults to no background
  // (white). Without this, any area not explicitly filled later would
  // render white — wrong for the Stewardship dark theme.
  setFill(doc, C.bg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  drawHero(doc, heroImage);
  let cy = drawIdentity(doc, ctx);
  cy = drawStatsStrip(doc, ctx, cy);
  const bodyEndY = drawBody(doc, ctx, cy);
  // Description fills the blank between the body and the footer.
  // Sizes itself to fit whatever vertical space is left.
  drawDescription(doc, ctx, bodyEndY);
  drawFooter(doc);

  const pdfBytes = doc.output("arraybuffer") as ArrayBuffer;
  const safeName = (p.name ?? "property").replace(/[^A-Za-z0-9_-]+/g, "_");
  return {
    pdfBytes: new Uint8Array(pdfBytes),
    filename: `${safeName}_Flyer.pdf`,
  };
}
