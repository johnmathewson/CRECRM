/**
 * Find-or-create a contact from a CREXi lead row. Returns the contact_id
 * (always non-null on success). Email is the canonical key; phone is a
 * fallback. New contacts get warmth + relationship_type set sensibly
 * based on the engagement signal.
 *
 * Architecture commitment (2026-05-15, see CLAUDE.md):
 *   Every CREXi-sourced lead MUST end up as a row in `contacts`. A
 *   crexi_leads_state row without contact_id is a data leak. Use this
 *   helper from every CREXi ingestion path (XLSX upload + browser
 *   extension scrape).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface CrexiLeadForResolution {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  company?: string | null;
  levelOfInterest?: string | null;
}

export interface ResolveResult {
  contactId: string;
  created: boolean;
  matched: "email" | "phone" | null;
}

function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = String(e).trim().toLowerCase();
  return s && s.includes("@") ? s : null;
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

// CREXi interest-level → warmth mapping. Anything CA-level or stronger is hot.
function warmthFor(level: string | null | undefined): "hot" | "warm" | "cold" {
  if (!level) return "warm";
  const l = level.toLowerCase();
  if (l.includes("ca") || l.includes("offer") || l.includes("info")) return "hot";
  if (l.includes("om") || l.includes("flyer") || l.includes("download")) return "warm";
  return "cold";
}

// Conservative contact_type inference — when in doubt, "investor"
function inferContactType(role: string | null | undefined): string {
  const r = (role ?? "").toLowerCase();
  if (r.includes("broker") || r.includes("listing rep") || r.includes("buyer rep")) return "broker";
  if (r.includes("lender") || r.includes("loan")) return "lender";
  if (r.includes("attorney") || r.includes("legal")) return "attorney";
  if (r.includes("service") || r.includes("vendor") || r.includes("consultant")) return "vendor";
  return "investor";
}

// CREXi column headers + obvious junk that the browser extension sometimes
// captures as a person's name when it mis-parses the lead list page. Any row
// whose name matches one of these is a scrape artifact, NOT a real person.
// Reject at the API layer so no contact + no crexi_leads_state row gets
// created from a bad scrape.
const JUNK_NAMES = new Set([
  "name", "first", "last", "email", "phone", "company", "role",
  "crexi score", "crexi lead score", "industry role", "level of interest",
  "no. visits", "date", "verification method",
  "(unknown)", "(no name)", "",
]);

function isJunkName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim().toLowerCase();
  return JUNK_NAMES.has(trimmed);
}

export async function findOrCreateContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  lead: CrexiLeadForResolution
): Promise<ResolveResult | { error: string }> {
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);
  const name = (lead.name ?? "").trim();

  // Reject scrape artifacts (column headers captured as a person's name).
  // If there's no email AND the name is junk, refuse — better to skip than
  // pollute the contacts table with a phantom that will catch other people
  // by phone-fallback.
  if (!email && isJunkName(name)) {
    return { error: `Rejected scrape artifact: name="${name}" with no email — likely a header row` };
  }

  if (!email && !phone && !name) {
    return { error: "No email, phone, or name — cannot resolve contact" };
  }

  // ── 1. Try email (canonical) ─────────────────────────────────────────
  if (email) {
    const { data: byEmail } = await sb
      .from("contacts")
      .select("id")
      .eq("organization_id", ORG_ID)
      .ilike("email", email)
      .maybeSingle();
    if (byEmail) {
      // Backfill anything missing on the existing contact
      const updates: Record<string, unknown> = {};
      const { data: existing } = await sb
        .from("contacts")
        .select("email, phone, full_name, company, role")
        .eq("id", byEmail.id)
        .maybeSingle();
      if (existing) {
        if (!existing.full_name && name) updates.full_name = name;
        if (!existing.phone && lead.phone) updates.phone = lead.phone;
        if (!existing.role && lead.role) updates.role = lead.role;
        // contacts.company doesn't exist on every schema variant — only set
        // it via the notes field via COALESCE to be safe.
      }
      if (Object.keys(updates).length > 0) {
        await sb.from("contacts").update(updates).eq("id", byEmail.id);
      }
      return { contactId: byEmail.id as string, created: false, matched: "email" };
    }
  }

  // ── 2. Try phone (compare normalized digits) ─────────────────────────
  if (phone) {
    const { data: candidates } = await sb
      .from("contacts")
      .select("id, phone")
      .eq("organization_id", ORG_ID)
      .not("phone", "is", null);
    if (candidates) {
      const found = candidates.find(
        (c: { id: string; phone: string | null }) => normalizePhone(c.phone) === phone
      );
      if (found) {
        // Backfill email if we have one
        if (email) {
          const { data: existing } = await sb
            .from("contacts").select("email").eq("id", found.id).maybeSingle();
          if (existing && !existing.email) {
            await sb.from("contacts").update({ email }).eq("id", found.id);
          }
        }
        return { contactId: found.id as string, created: false, matched: "phone" };
      }
    }
  }

  // ── 3. Create new contact ────────────────────────────────────────────
  const insertPayload: Record<string, unknown> = {
    organization_id: ORG_ID,
    full_name: name || "(unknown)",
    role: lead.role || null,
    phone: lead.phone || null,
    email,
    contact_type: inferContactType(lead.role),
    relationship_type: "prospect",
    warmth: warmthFor(lead.levelOfInterest),
    notes: lead.company ? `CREXi: ${lead.company}` : null,
  };
  const { data: created, error } = await sb
    .from("contacts")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !created) {
    return { error: error?.message ?? "contact insert failed" };
  }
  return { contactId: created.id as string, created: true, matched: null };
}
