/**
 * Shared lead-reply drafter.
 *
 * Lifted out of /api/leads/intake so multiple front doors can reuse it:
 *   - /api/leads/intake               (reactive — inbound email/SMS/voice/web)
 *   - /api/public/questionnaire       (reactive — vault-flow signup)
 *   - /api/leads/bulk-import-crexi    (proactive — daily CSV ingest)
 *
 * Caller supplies a leadId for an already-persisted lead row. The drafter
 * loads the lead + contact + matched property, gathers grounding intel
 * (sale comps, lease comps, active inventory, contact history) via
 * lib/agent-intel, then calls Sonnet with the right prompt variant.
 *
 * Two tone modes:
 *   - "first_touch": prospect just reached out — answer their question.
 *   - "proactive_engagement": WE noticed activity (CREXi visit, OM open,
 *     CA execution) — soft outreach acknowledging the action.
 *
 * Behavior on success: saves draft to leads.draft_reply, appends a
 * `draft_generated` lead_event with model + tokens + char count.
 * Behavior on failure: appends an `error` lead_event but doesn't throw —
 * caller decides what to do.
 */

import { callAnthropic, MODELS } from "./anthropic";
import { gatherIntel, formatIntelForPrompt } from "./agent-intel";

// ── Types ─────────────────────────────────────────────────────────────────

export type DraftTone = "first_touch" | "proactive_engagement";

export interface DraftLeadReplyOpts {
  supabase: any;
  organizationId: string;
  leadId: string;
  tone: DraftTone;
  /**
   * Optional override for proactive mode — describes WHY we're reaching
   * out. Examples: "executed CA on Liberty Square 4 hours ago" /
   * "opened OM 3 times this week without engaging".
   * Ignored for first_touch.
   */
  engagementSignal?: string | null;
}

export interface DraftLeadReplyResult {
  ok: boolean;
  draft?: string | null;
  error?: string;
  model?: string;
  tokens?: unknown;
  skipped?: "no_email" | "already_drafted" | "already_sent" | "spam" | null;
}

// ── Prompts ───────────────────────────────────────────────────────────────

const DRAFT_SYSTEM_BASE = `You are drafting an email on behalf of John Mathewson (Stewardship CRE — Northwest Indiana commercial real estate broker, owner-operator himself, Indianapolis-area focus).

GROUND TRUTH ONLY — this is what makes John's drafts credible:
- A "GROUND TRUTH CONTEXT" block will appear in the user message. It contains real CRM facts: matched listing details, sale + lease comp aggregates, active inventory, contact history.
- You MAY cite anything in that block — specific cap rates, $/SF medians, ranges, recent inventory, prior history. Numbers there are real. Use them.
- You MAY NOT invent specifics outside that block. No fabricated cap rates, $/SF numbers, inventory, or comps. If the ground truth block doesn't have a number, don't state one.
- Lease comps may include tenant names from rent rolls — those are CONFIDENTIAL. Never cite a specific tenant name to a prospect. Aggregate ranges and medians are fine.
- DO NOT invent inventory the agent does not actually have. If the active-inventory line is empty, do not say "I have several other properties." If a matched property exists, you may discuss its facts.

VAULT LINK — when the GROUND TRUTH block includes a "Vault link" line, ALWAYS include that exact link in your draft (typically once, near the close), framed naturally — e.g. "Full package — financials, rent roll, due diligence — is here, quick questionnaire + NDA to access: <link>". Do NOT invent a vault URL when no matched property exists.

Voice guidelines:
- John reads pro formas like an investor, not a listing agent. Plain language. Confident.
- NEVER open with "Dear ___" or "Thank you for your inquiry" or "I hope this email finds you well".
- NEVER close with "Best regards", "Sincerely", "Looking forward to". Sign off with "— John" only.
- NO broker-speak: skip "premier", "elevate", "luxury", "trophy", "unparalleled". John doesn't talk like that.
- Direct, warm, concrete. Implies movement and momentum without sounding rushed.
- Keep it tight. 2-3 short paragraphs at most.

Output: plain text email body only. No subject line. No signature block other than "— John". No markdown.`;

const FIRST_TOUCH_INSTRUCTIONS = `MODE: FIRST-TOUCH REPLY

The prospect just reached out via the channel and message shown below. Reply directly to their ask.

Structure:
- Hook on their specific ask (1 sentence).
- Brief acknowledgment grounded only in what the prospect said + (if matched) the listing's actual facts. Buyer → financials/value-add framing. Tenant → space functionality, location framing. Unclear → balanced.
- 2-3 qualifying questions max — the things you'd actually need to know to send a package or have a useful next conversation. Phrase as a list only if it reads naturally.
- Soft mention that you're putting together the full info package and will send once they confirm interest.

Reference something specific from their inbound message. NEVER generic.`;

const PROACTIVE_ENGAGEMENT_INSTRUCTIONS = `MODE: PROACTIVE OUTREACH (no inbound message yet)

This person did NOT reach out to you — WE noticed them engaging with one of your listings on CREXi (the engagement signal is in the user message). They're not expecting your email.

Tone: warm and low-pressure. You're saying "hi, I saw you took a look — happy to answer questions or send the package." NOT pushy, NOT salesy. The fact that they engaged is the only reason you're writing; lean into that naturally without making it weird.

Structure:
- Open with the specific action they took on the listing (cite it from the engagement signal). Don't be creepy — frame it as "saw you spent some time on Liberty Square" or "noticed you executed the CA on the Valparaiso hotel," not "we tracked your behavior."
- One sentence on what makes the listing interesting from John's actual GROUND TRUTH facts. Pick the most concrete number that's relevant (cap rate, NOI, $/SF, occupancy).
- Offer two things: (1) the full package via the vault link if matched, and (2) a 15-minute call. No more than that.
- Light close. "If you've already got what you need, no need to reply" is the right energy — never desperate.

This email goes out cold to someone who didn't ask for it. Tone matters more than length. Aim for 4-6 sentences, signed "— John".`;

// ── Helpers ───────────────────────────────────────────────────────────────

async function recordEvent(
  supabase: any,
  organizationId: string,
  leadId: string,
  eventType: string,
  actor: "agent" | "user" | "system",
  summary: string,
  metadata: Record<string, unknown> = {}
) {
  await supabase.from("lead_events").insert({
    organization_id: organizationId,
    lead_id: leadId,
    event_type: eventType,
    actor,
    summary,
    metadata,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────

export async function draftLeadReply(
  opts: DraftLeadReplyOpts
): Promise<DraftLeadReplyResult> {
  const { supabase, organizationId, leadId, tone, engagementSignal } = opts;

  // Load the lead + contact + matched property facts. Single query that
  // pulls everything we need.
  const { data: lead, error: loadErr } = await supabase
    .from("leads")
    .select(
      `id, organization_id, contact_id, property_id, source, status,
       sender_name, sender_email, sender_phone, property_label,
       intent, urgency, qualifier_summary,
       raw_subject, raw_body, claude_extraction,
       draft_reply, final_reply, final_sent_at`
    )
    .eq("id", leadId)
    .maybeSingle();

  if (loadErr || !lead) {
    return {
      ok: false,
      error: `lead ${leadId} not found: ${loadErr?.message || "no row"}`,
    };
  }

  // Skip if already sent — don't overwrite a sent reply
  if (lead.final_sent_at) {
    return { ok: false, skipped: "already_sent" };
  }
  // Skip if a draft already exists and we're not explicitly re-drafting
  if (lead.draft_reply) {
    return { ok: false, skipped: "already_drafted", draft: lead.draft_reply };
  }
  // Skip spam
  if (lead.status === "spam") {
    return { ok: false, skipped: "spam" };
  }

  // Reconstruct a qualification-shaped object for gatherIntel (its
  // contract pre-dates this refactor and accepts a partial qualification).
  const qualification = {
    intent: lead.intent || null,
    property_label: lead.property_label || null,
    sender_name_clean: lead.sender_name || null,
    qualifier_summary: lead.qualifier_summary || "",
  };

  let intel: Awaited<ReturnType<typeof gatherIntel>>;
  try {
    intel = await gatherIntel({
      supabase,
      organizationId,
      matchedPropertyId: lead.property_id || null,
      contactId: lead.contact_id || null,
      qualification,
      rawSubject: lead.raw_subject || null,
      rawBody: lead.raw_body || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEvent(supabase, organizationId, leadId, "error", "agent", `Intel gather failed: ${message}`, {
      stage: "intel",
      tone,
    });
    return { ok: false, error: `gatherIntel failed: ${message}` };
  }

  await recordEvent(
    supabase,
    organizationId,
    leadId,
    "qualified",
    "agent",
    `Pulled intel — ${intel.saleComps?.count || 0} sale comps, ${
      intel.leaseComps?.count || 0
    } lease comps, ${intel.activeInventory.length} active listings, contact ${
      intel.contactHistory?.isNew ? "new" : "returning"
    }`,
    {
      sale_comp_count: intel.saleComps?.count || 0,
      lease_comp_count: intel.leaseComps?.count || 0,
      active_inventory_count: intel.activeInventory.length,
      tone,
    }
  );

  const intelBlock = formatIntelForPrompt(intel);

  // Build the user message based on tone
  let userMessage: string;

  if (tone === "first_touch") {
    userMessage = `Inbound message:
From: ${lead.sender_name || "Unknown"} <${lead.sender_email || "no email"}>
Channel: ${lead.source}
Subject: ${lead.raw_subject || "(none)"}

Body:
${lead.raw_body || "(no body)"}

---
Quick context:
- Lead intent: ${lead.intent || "unclear"}
- Urgency: ${lead.urgency || "warm"}
- AI summary: ${lead.qualifier_summary || "(none)"}
---

${intelBlock}

---
${FIRST_TOUCH_INSTRUCTIONS}

Draft John's reply now.`;
  } else {
    userMessage = `Person we want to reach out to:
${lead.sender_name || "Unknown"} <${lead.sender_email || "no email"}>
${lead.qualifier_summary ? `Background: ${lead.qualifier_summary}\n` : ""}
Engagement signal (the reason we're writing):
${engagementSignal || "Engaged with one of your listings on CREXi."}

---

${intelBlock}

---
${PROACTIVE_ENGAGEMENT_INSTRUCTIONS}

Draft John's outreach email now.`;
  }

  let draftReply: string | null = null;
  let draftTokens: unknown = null;
  try {
    const result = await callAnthropic({
      model: MODELS.SONNET,
      system: DRAFT_SYSTEM_BASE,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 1024,
      temperature: 0.6,
    });
    draftReply = result.text.trim();
    draftTokens = result.usage;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEvent(supabase, organizationId, leadId, "error", "agent", `Draft failed: ${message}`, {
      stage: "drafting",
      tone,
    });
    return { ok: false, error: message };
  }

  await supabase.from("leads").update({ draft_reply: draftReply }).eq("id", leadId);
  await recordEvent(
    supabase,
    organizationId,
    leadId,
    "draft_generated",
    "agent",
    tone === "proactive_engagement"
      ? `Drafted proactive outreach (${engagementSignal ? `re: ${engagementSignal}` : "engagement"})`
      : "Drafted reply to inbound",
    {
      model: MODELS.SONNET,
      tokens: draftTokens,
      tone,
      char_count: draftReply.length,
    }
  );

  return {
    ok: true,
    draft: draftReply,
    model: MODELS.SONNET,
    tokens: draftTokens,
  };
}
