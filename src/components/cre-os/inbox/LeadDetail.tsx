"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { LeadDetail as LeadDetailData } from "@/lib/cre-os/inbox-queries";

/**
 * LeadDetail — full lead workspace.
 *
 * Layout (mobile-first):
 *   • Header — sender, property, urgency, SLA badge
 *   • AI extraction summary
 *   • Original message (collapsible body)
 *   • Draft reply (editable textarea)
 *   • Sticky bottom action bar — Send · Archive · Promote · Mark Spam
 *
 * Action handlers POST to existing /api/leads/[id]/* endpoints.
 */
export function LeadDetail({ lead }: { lead: LeadDetailData }) {
  const router = useRouter();
  const [draft, setDraft] = useState(lead.draftReply ?? "");
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<{
    busy: "send" | "archive" | "spam" | "promote" | "redraft" | "sms" | null;
    error: string | null;
    success: string | null;
  }>({ busy: null, error: null, success: null });
  const [smsText, setSmsText] = useState("");

  const status = (lead.status ?? "").toLowerCase();
  const isArchived = status === "archived" || status === "spam";
  const isSent = !!lead.finalSentAt;

  // ── Action handlers ─────────────────────────────────────────────────────
  async function send() {
    if (!draft.trim()) return setActionState({ busy: null, error: "Draft is empty.", success: null });
    setActionState({ busy: "send", error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Send failed");
      setActionState({ busy: null, error: null, success: "Reply sent" });
      startTransition(() => router.refresh());
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  async function sendText() {
    if (!smsText.trim()) return setActionState({ busy: null, error: "Text is empty.", success: null });
    setActionState({ busy: "sms", error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: smsText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Text failed");
      setSmsText("");
      setActionState({
        busy: null,
        error: null,
        success: data.rerouted ? "Text sent (TEST MODE — rerouted to your cell)" : "Text sent",
      });
      startTransition(() => router.refresh());
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  async function patchStatus(newStatus: string, label: string, busyKey: "archive" | "spam") {
    setActionState({ busy: busyKey, error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Update failed");
      setActionState({ busy: null, error: null, success: label });
      startTransition(() => router.refresh());
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  async function saveDraft() {
    setActionState({ busy: "redraft", error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_reply: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setActionState({ busy: null, error: null, success: "Draft saved" });
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  async function regenerateDraft() {
    setActionState({ busy: "redraft", error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}/draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Drafter failed");
      setActionState({ busy: null, error: null, success: "Fresh draft generated" });
      startTransition(() => router.refresh());
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  async function promoteToDeal() {
    setActionState({ busy: "promote", error: null, success: null });
    try {
      const res = await fetch(`/api/leads/${lead.id}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Promote failed");
      setActionState({ busy: null, error: null, success: `Deal created` });
      if (data.deal_id || data.dealId) {
        // navigate to the new deal
        router.push(`/cre-os/pipeline/${data.deal_id || data.dealId}`);
      } else {
        startTransition(() => router.refresh());
      }
    } catch (e: any) {
      setActionState({ busy: null, error: e.message, success: null });
    }
  }

  // ── Right rail ──────────────────────────────────────────────────────────
  const rail: RailSection[] = [
    {
      eyebrow: "Lead facts",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Source" value={lead.source ?? "—"} />
          <RailStat label="Intent" value={lead.intent ?? "—"} />
          <RailStat label="Urgency" value={lead.urgency ?? "—"} />
          <RailStat label="Status" value={lead.status ?? "—"} />
          <RailStat label="Arrived" value={lead.createdRelative} />
          <RailStat
            label="Hours since arrival"
            value={lead.hoursSinceArrival.toFixed(1)}
          />
          <RailStat label="Auto-ack" value={lead.ackSentAt ? "✓ sent" : "pending"} />
          <RailStat label="Reply" value={isSent ? "✓ sent" : lead.draftReply ? "drafted" : "no draft"} />
        </div>
      ),
    },
    {
      eyebrow: "Sender",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Name" value={lead.senderName ?? "—"} />
          <RailStat label="Email" value={lead.senderEmail ?? "—"} />
          <RailStat label="Phone" value={lead.senderPhone ?? "—"} />
          {lead.contact && (
            <a
              href={`/cre-os/relationships/${lead.contact.id}`}
              className="block mt-2 px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] text-cream font-medium transition-colors"
            >
              Open contact: {lead.contact.fullName}
            </a>
          )}
        </div>
      ),
    },
    ...(lead.property ? [{
      eyebrow: "Linked property",
      children: (
        <a
          href={`/cre-os/properties/${lead.property.slug}`}
          className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] transition-colors"
        >
          <div className="font-heading text-[12px] font-semibold text-cream truncate">
            {lead.property.name}
          </div>
          {(lead.property.city || lead.property.state) && (
            <div className="font-mono text-[10px] text-cream-subtle truncate mt-0.5">
              {[lead.property.city, lead.property.state].filter(Boolean).join(", ")}
            </div>
          )}
        </a>
      ),
    }] : []),
  ];

  return (
    <AppShell rail={rail}>
      <div className="bg-steward-base/80 backdrop-blur-md border-b border-white/[0.04] -mx-4 px-4 -mt-5 pt-5 pb-5 mb-6 lg:-mx-8 lg:px-8 lg:-mt-6 lg:pt-6">
        <Eyebrow tone="coral">
          Inbox · Lead{lead.source && <span className="ml-2 text-cream-subtle">·  {lead.source.toUpperCase()}</span>}
        </Eyebrow>
        <div className="mt-2 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-medium text-3xl text-cream tracking-tight leading-tight">
              {lead.senderDisplay}
            </h1>
            {lead.rawSubject && (
              <div className="mt-1 font-heading text-[14px] text-cream-dim leading-snug">
                {lead.rawSubject}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {lead.urgency && (
                <StatusBadge size="xs" tone={toneForUrgency(lead.urgency)}>
                  {lead.urgency}
                </StatusBadge>
              )}
              {lead.slaOverdue && <StatusBadge size="xs" tone="coral">SLA overdue</StatusBadge>}
              {isSent && <StatusBadge size="xs" tone="teal">Reply sent</StatusBadge>}
              {lead.linkedDealId && <StatusBadge size="xs" tone="teal">Promoted to deal</StatusBadge>}
              {isArchived && <StatusBadge size="xs" tone="neutral">{lead.status}</StatusBadge>}
              <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                · {lead.createdRelative}
              </span>
            </div>
            {(lead.property || lead.propertyLabel) && (
              <div className="mt-2 font-mono text-[11px] text-cream-dim">
                <span className="text-cream-subtle">RE:</span>{" "}
                {lead.property ? (
                  <a href={`/cre-os/properties/${lead.property.slug}`} className="text-coral-300 hover:underline">
                    {lead.property.name}
                  </a>
                ) : (
                  lead.propertyLabel
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body — leave space for sticky action bar */}
      <div className="space-y-5 pb-32">
        {/* AI qualifier summary */}
        {lead.qualifierSummary && (
          <div className="relative overflow-hidden rounded-md border border-coral-400/25 bg-gradient-to-r from-steward-surfaceHi/70 via-steward-mid/50 to-steward-surface/30 backdrop-blur-md">
            <div className="absolute inset-y-0 left-0 w-[3px] bg-coral-400" />
            <div className="px-5 py-4">
              <Eyebrow tone="coral">AI extraction</Eyebrow>
              <p className="mt-2 font-heading text-[15px] text-cream leading-snug">
                {lead.qualifierSummary}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-mono text-cream-subtle">
                {lead.intent && <span>intent: <span className="text-cream">{lead.intent}</span></span>}
                {lead.urgency && <span>·  urgency: <span className="text-cream">{lead.urgency}</span></span>}
                {lead.contact && <span>·  matched contact: <span className="text-cream">{lead.contact.fullName}</span></span>}
              </div>
            </div>
          </div>
        )}

        {/* Original message / CREXi activity */}
        {lead.source === "crexi"
          ? <CrexiLeadCard rawBody={lead.rawBody} qualifierSummary={lead.qualifierSummary} />
          : (
            <Panel
              eyebrow="Original message"
              num={1}
              title={lead.rawSubject ?? "(no subject)"}
              actions={
                lead.rawBody && lead.rawBody.length > 600 ? (
                  <button
                    onClick={() => setBodyExpanded(!bodyExpanded)}
                    className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300"
                  >
                    {bodyExpanded ? "Collapse" : "Show full"}
                  </button>
                ) : null
              }
            >
              {lead.rawBody ? (
                <pre className="whitespace-pre-wrap font-body text-[12px] text-cream-dim leading-relaxed max-w-none">
                  {bodyExpanded ? lead.rawBody : truncate(lead.rawBody, 600)}
                </pre>
              ) : (
                <p className="font-body text-[13px] text-cream-subtle py-4">No message body captured.</p>
              )}
            </Panel>
          )
        }

        {/* Draft reply */}
        <Panel
          eyebrow={isSent ? "Reply sent" : "Draft reply"}
          num={2}
          title={isSent ? "Final reply" : "Edit before sending"}
          actions={
            !isSent ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={regenerateDraft}
                  disabled={!!actionState.busy}
                  className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 disabled:opacity-50"
                >
                  {actionState.busy === "redraft" ? "Generating…" : "Regenerate"}
                </button>
                <button
                  onClick={saveDraft}
                  disabled={!!actionState.busy || draft === (lead.draftReply ?? "")}
                  className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream disabled:opacity-50"
                >
                  Save draft
                </button>
              </div>
            ) : null
          }
        >
          {isSent ? (
            <pre className="whitespace-pre-wrap font-body text-[12px] text-cream-dim leading-relaxed">
              {lead.finalReply ?? "(no reply body recorded)"}
            </pre>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(20, Math.max(8, draft.split("\n").length + 2))}
              placeholder="Draft your reply… or tap Regenerate to have the AI draft one."
              className="w-full bg-black/20 border border-white/[0.06] rounded-md px-4 py-3 text-base lg:text-[13px] text-cream font-body leading-relaxed outline-none focus:border-coral-400/40 transition-colors min-h-[200px]"
            />
          )}
          {lead.draftAttachments && Array.isArray(lead.draftAttachments) && lead.draftAttachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">Attachments</span>
              {lead.draftAttachments.map((a: any, i: number) => (
                <span key={i} className="font-mono text-[10px] text-cream-dim border border-white/[0.06] rounded px-2 py-0.5">
                  {a?.name ?? a?.filename ?? "attachment"}
                </span>
              ))}
            </div>
          )}
        </Panel>

        {/* Thread */}
        {lead.thread.length > 0 && (
          <Panel eyebrow="Conversation thread" num={3} title={`${lead.thread.length} message${lead.thread.length === 1 ? "" : "s"}`}>
            <div className="space-y-3">
              {lead.thread.map((m) => (
                <div key={m.id} className={`p-3 rounded border ${m.direction === "outbound" ? "border-teal-400/20 bg-teal-400/[0.03]" : "border-white/[0.05] bg-white/[0.02]"}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-heading text-[11px] font-semibold text-cream">
                      {m.direction === "outbound" ? "You" : (m.fromAddress ?? "Inbound")}
                      {m.channel === "sms" && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-teal-400/[0.10] border border-teal-400/25 font-mono text-[9px] uppercase tracking-wide text-teal-300 align-middle">
                          sms
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10px] text-cream-subtle">{m.when}</span>
                  </div>
                  {m.subject && <div className="font-body text-[12px] text-cream truncate">{m.subject}</div>}
                  {m.bodyPreview && (
                    <p className="mt-1 font-body text-[11px] text-cream-dim leading-snug line-clamp-3">{m.bodyPreview}</p>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* SMS composer — renders whenever the lead has a phone number.
            Sends from the business line (317-804-1980) via the A2P-registered
            Messaging Service. Honors TWILIO_TEST_MODE. */}
        {lead.senderPhone && !isArchived && (
          <Panel eyebrow="Text message" num={lead.thread.length > 0 ? 4 : 3} title={`Text ${lead.senderDisplay}`}>
            <div className="space-y-2">
              <textarea
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                rows={3}
                maxLength={1600}
                placeholder={`Text ${lead.senderPhone} from (317) 804-1980…`}
                className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2.5 font-body text-[13px] text-cream placeholder:text-cream-subtle focus:border-teal-400/40 focus:outline-none resize-y"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-cream-subtle">
                  {smsText.length > 0 && `${smsText.length} chars · ${Math.ceil(smsText.length / 160)} segment${smsText.length > 160 ? "s" : ""}`}
                </span>
                <button
                  onClick={sendText}
                  disabled={!!actionState.busy || !smsText.trim()}
                  className="px-4 py-2 rounded border border-teal-400/40 bg-teal-400/[0.06] text-teal-300 hover:bg-teal-400/[0.10] font-heading text-[12px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
                >
                  {actionState.busy === "sms" ? "Sending…" : "Send text"}
                </button>
              </div>
            </div>
          </Panel>
        )}

        {/* Lead events log */}
        {lead.events.length > 0 && (
          <Panel eyebrow="Lead history" num={4} title={`${lead.events.length} event${lead.events.length === 1 ? "" : "s"}`}>
            <div className="space-y-2 text-[11px] font-mono text-cream-dim">
              {lead.events.map((e) => (
                <div key={e.id} className="flex items-baseline gap-3 border-b border-white/[0.04] pb-1.5 last:border-b-0">
                  <span className="text-cream-subtle w-16 shrink-0">{e.when}</span>
                  <span className="text-cream-dim font-semibold">{e.eventType}</span>
                  {e.notes && <span className="text-cream-dim truncate">{e.notes}</span>}
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* Sticky action bar — fixed, thumb-zone friendly */}
      {!isArchived && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-56 lg:right-[300px] bg-steward-base/95 backdrop-blur-md border-t border-coral-400/20 px-4 lg:px-8 py-3 z-30 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          {actionState.error && (
            <div className="mb-2 px-3 py-1.5 rounded bg-coral-400/[0.08] border border-coral-400/30 font-body text-[12px] text-coral-300">
              {actionState.error}
            </div>
          )}
          {actionState.success && (
            <div className="mb-2 px-3 py-1.5 rounded bg-teal-400/[0.08] border border-teal-400/30 font-body text-[12px] text-teal-300">
              ✓ {actionState.success}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {!isSent && (
              <button
                onClick={send}
                disabled={!!actionState.busy || !draft.trim()}
                className="px-4 py-2.5 rounded bg-coral-400 hover:bg-coral-500 text-steward-base font-heading text-[12px] font-bold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
              >
                {actionState.busy === "send" ? "Sending…" : "Send reply"}
              </button>
            )}
            <button
              onClick={promoteToDeal}
              disabled={!!actionState.busy || !!lead.linkedDealId}
              className="px-4 py-2.5 rounded border border-teal-400/40 bg-teal-400/[0.06] text-teal-300 hover:bg-teal-400/[0.10] font-heading text-[12px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
            >
              {actionState.busy === "promote" ? "Promoting…" : lead.linkedDealId ? "Already a deal" : "Promote to deal"}
            </button>
            <button
              onClick={() => patchStatus("archived", "Archived", "archive")}
              disabled={!!actionState.busy}
              className="px-4 py-2.5 rounded border border-white/10 bg-white/[0.03] text-cream-dim hover:bg-white/[0.08] hover:text-cream font-heading text-[12px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
            >
              {actionState.busy === "archive" ? "Archiving…" : "Archive"}
            </button>
            <button
              onClick={() => patchStatus("spam", "Marked spam", "spam")}
              disabled={!!actionState.busy}
              className="px-4 py-2.5 rounded border border-white/10 bg-white/[0.03] text-cream-dim hover:bg-white/[0.08] hover:text-cream font-heading text-[12px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
            >
              Mark spam
            </button>
            <a
              href="/cre-os/inbox"
              className="ml-auto font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream-dim"
            >
              ← Back to inbox
            </a>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ── CREXi lead card — replaces raw JSON "Original message" for crexi source leads ──
function CrexiLeadCard({ rawBody, qualifierSummary }: { rawBody: string | null; qualifierSummary: string | null }) {
  let data: Record<string, unknown> = {};
  try { if (rawBody) data = JSON.parse(rawBody); } catch { /* fall through */ }

  const signal = typeof data.engagement_signal === "string" ? data.engagement_signal : null;
  const loi = typeof data.level_of_interest === "string" ? data.level_of_interest : null;
  const company = typeof data.company === "string" ? data.company : null;
  const role = typeof data.industry_role === "string" ? data.industry_role : null;
  const activityDate = typeof data.activity_date === "string" ? data.activity_date : null;
  const buyingPower = typeof data.buying_power === "string" ? data.buying_power : null;
  const proofOfFunds = typeof data.proof_of_funds === "string" ? data.proof_of_funds : null;
  const leadScore = typeof data.crexi_lead_score === "number" ? data.crexi_lead_score : null;
  const notes = typeof data.notes === "string" ? data.notes : null;

  const fmtDate = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <Panel eyebrow="CREXi activity" num={1} title={signal ?? loi ?? "CREXi lead"}>
      <div className="space-y-3">
        {/* Key stats row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] font-body">
          {loi && (
            <div>
              <span className="text-cream-subtle">Level of interest  </span>
              <span className="text-cream font-semibold">{loi}</span>
            </div>
          )}
          {activityDate && (
            <div>
              <span className="text-cream-subtle">Activity  </span>
              <span className="text-cream font-semibold">{fmtDate(activityDate)}</span>
            </div>
          )}
          {leadScore != null && (
            <div>
              <span className="text-cream-subtle">CREXi score  </span>
              <span className="text-cream font-semibold">{leadScore}</span>
            </div>
          )}
        </div>

        {/* Company / role */}
        {(company || role) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] font-body">
            {company && (
              <div>
                <span className="text-cream-subtle">Company  </span>
                <span className="text-cream">{company}</span>
              </div>
            )}
            {role && (
              <div>
                <span className="text-cream-subtle">Role  </span>
                <span className="text-cream">{role}</span>
              </div>
            )}
          </div>
        )}

        {/* Financial profile */}
        {(buyingPower || proofOfFunds) && (
          <div className="pt-2 border-t border-white/[0.05] flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] font-body">
            {buyingPower && (
              <div>
                <span className="text-cream-subtle">Buying power  </span>
                <span className="text-cream font-semibold">{buyingPower}</span>
              </div>
            )}
            {proofOfFunds && (
              <div>
                <span className="text-cream-subtle">Proof of funds  </span>
                <span className="text-cream">{proofOfFunds}</span>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {notes && (
          <div className="pt-2 border-t border-white/[0.05]">
            <p className="font-body text-[11.5px] text-cream-dim leading-relaxed">{notes}</p>
          </div>
        )}

        {/* AI qualifier echo — only if different from signal */}
        {qualifierSummary && qualifierSummary !== signal && (
          <div className="pt-2 border-t border-white/[0.05]">
            <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle">AI summary  </span>
            <p className="mt-1 font-body text-[11.5px] text-cream-dim leading-relaxed">{qualifierSummary}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold truncate">{value}</span>
    </div>
  );
}

function toneForUrgency(u: string | null): "coral" | "amber" | "neutral" {
  if (u === "hot") return "coral";
  if (u === "warm") return "amber";
  return "neutral";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
