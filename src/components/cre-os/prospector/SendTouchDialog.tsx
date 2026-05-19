"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PropertyHint {
  id: string;
  name: string | null;
  address: string | null;
  ownerNameRaw: string | null;
}

/**
 * Lead context — optional. When the dialog is opened from a property's Leads
 * tab on a specific warm lead, pass this so we can:
 *   1. Pre-fill the To: field with their actual email
 *   2. Generate a properly-framed AI draft that anchors on their engagement
 *      (e.g. "Saw you signed the CA on Liberty Square Tuesday")
 */
export interface LeadContext {
  name: string | null;
  email: string | null;
  role: string | null;
  company: string | null;
  /** CREXi level_of_interest — "Executed CA", "Viewed listing", etc. */
  levelOfInterest: string | null;
  visitCount: number | null;
  lastActivityDate: string | null;
}

interface PropertySearchResult {
  id: string;
  slug: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  owner_name_raw: string | null;
  asset_type: string | null;
  status: string | null;
}

function defaultSubject(p: PropertyHint | null): string {
  return `About ${p?.address ?? p?.name ?? "your property"}`;
}
function defaultBody(p: PropertyHint | null, toName: string): string {
  // Placeholder text. The user is expected to click "Generate AI draft" or
  // hand-write before sending. We do NOT auto-send this static template —
  // it produced direction-wrong copy in the past (cold-prospecting framing
  // on listing-side warm leads).
  const first = toName ? " " + toName.split(" ")[0] : "";
  return `Hi${first},\n\n[ Click "Generate AI draft" above to have the AI write a properly-framed message based on this recipient's engagement with ${p?.address ?? p?.name ?? "this property"}, or type your own. ]\n\n— John Mathewson\nStewardship CRE`;
}

/**
 * SendTouchDialog — manual one-off email send.
 *
 * Two modes:
 *   • Pre-selected property: opens straight into the compose form
 *     (used by cold-inventory row "Send touch" button).
 *   • No property: opens into a property picker first, then the form
 *     (used by the Compose button on the Prospector Inbox).
 */
export function SendTouchDialog({
  property,
  leadContext,
  open,
  onClose,
}: {
  property?: PropertyHint | null;
  /** Optional warm-lead context — when present, To: is pre-filled and the
   *  "Generate AI draft" button anchors on their actual engagement. */
  leadContext?: LeadContext | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedProperty, setSelectedProperty] = useState<PropertyHint | null>(property ?? null);
  const [to, setTo] = useState(leadContext?.email ?? "");
  const [toName, setToName] = useState(leadContext?.name ?? property?.ownerNameRaw ?? "");
  const [subject, setSubject] = useState(defaultSubject(property ?? null));
  const [bodyText, setBodyText] = useState(defaultBody(property ?? null, leadContext?.name ?? property?.ownerNameRaw ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ messageId: string } | null>(null);

  // AI draft state
  const [generating, setGenerating] = useState(false);
  const [draftArchetype, setDraftArchetype] = useState<string | null>(null);
  const [draftRationale, setDraftRationale] = useState<string | null>(null);
  // Snapshot of the AI draft as it was when first generated — needed so
  // we can detect whether the broker edited it before sending. Sent
  // to the server as `aiDraftOriginalBody` for voice-learning capture.
  const [aiDraftOriginalBody, setAiDraftOriginalBody] = useState<string | null>(null);
  const [aiDraftOriginalSubject, setAiDraftOriginalSubject] = useState<string | null>(null);

  // Property search state (only used when no property is preselected)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PropertySearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset state when the dialog re-opens for a different (or no) property
  useEffect(() => {
    if (!open) return;
    setSelectedProperty(property ?? null);
    setToName(leadContext?.name ?? property?.ownerNameRaw ?? "");
    setSubject(defaultSubject(property ?? null));
    setBodyText(defaultBody(property ?? null, leadContext?.name ?? property?.ownerNameRaw ?? ""));
    setTo(leadContext?.email ?? "");
    setError(null);
    setSent(null);
    setDraftArchetype(null);
    setDraftRationale(null);
  }, [open, property, leadContext]);

  // Debounced property search
  useEffect(() => {
    if (selectedProperty) return; // already picked
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        const r = await fetch(`/api/properties/search?${params.toString()}`);
        const data = await r.json();
        if (!cancelled) setSearchResults((data.properties ?? []) as PropertySearchResult[]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery, selectedProperty]);

  function pickProperty(p: PropertySearchResult) {
    const hint: PropertyHint = {
      id: p.id,
      name: p.name,
      address: p.address,
      ownerNameRaw: p.owner_name_raw,
    };
    setSelectedProperty(hint);
    setToName(p.owner_name_raw ?? "");
    setSubject(defaultSubject(hint));
    setBodyText(defaultBody(hint, p.owner_name_raw ?? ""));
  }

  if (!open) return null;

  async function generateDraft() {
    if (!selectedProperty) {
      setError("Pick a property first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/prospector/personalize-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedProperty.id,
          recipient: leadContext
            ? {
                name: leadContext.name,
                email: leadContext.email,
                role: leadContext.role,
                company: leadContext.company,
                levelOfInterest: leadContext.levelOfInterest,
                visitCount: leadContext.visitCount,
                lastActivityDate: leadContext.lastActivityDate,
              }
            : {
                name: toName || null,
                email: to || null,
              },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const aiSubject = data.subject ?? defaultSubject(selectedProperty);
      const aiBody = data.body ?? "";
      setSubject(aiSubject);
      setBodyText(aiBody);
      setDraftArchetype(data.archetype ?? null);
      setDraftRationale(data.rationale ?? null);
      // Snapshot what the AI produced so the send route can detect edits.
      setAiDraftOriginalBody(aiBody);
      setAiDraftOriginalSubject(aiSubject);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI draft failed");
    } finally {
      setGenerating(false);
    }
  }

  async function send() {
    if (!selectedProperty) {
      setError("Pick a property first.");
      return;
    }
    if (!to.trim()) {
      setError("Recipient email is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/lane-touches/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedProperty.id,
          to: to.trim(),
          toName: toName.trim() || undefined,
          subject: subject.trim(),
          bodyText,
          // Voice-learning capture: tell the server this was an AI draft
          // (if it was) AND pass the original so it can detect edits.
          aiDrafted: aiDraftOriginalBody !== null,
          personaSlug: draftArchetype ?? undefined,
          aiDraftOriginalBody: aiDraftOriginalBody ?? undefined,
          aiDraftOriginalSubject: aiDraftOriginalSubject ?? undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSent({ messageId: data.gmail_message_id });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.05] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
              {selectedProperty ? "Send touch · Manual" : "Compose · Pick a prospect"}
            </div>
            {selectedProperty ? (
              <>
                <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate max-w-md">
                  {selectedProperty.address ?? selectedProperty.name}
                </h2>
                <p className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate max-w-md">
                  {selectedProperty.ownerNameRaw ?? "—"}
                  {!property && (
                    <button
                      onClick={() => setSelectedProperty(null)}
                      className="ml-2 underline text-coral-300 hover:text-coral-200"
                    >
                      change
                    </button>
                  )}
                </p>
              </>
            ) : (
              <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">
                New email
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 p-2 text-cream-subtle hover:text-cream transition-colors shrink-0"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {!selectedProperty ? (
          <div className="px-6 py-5 space-y-3 max-h-[80vh] overflow-y-auto">
            <Field label="Search prospects (address, owner, city)">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. 850 Lakeshore, ABC Realty, Valparaiso…"
                autoFocus
                className={inputCls}
              />
            </Field>
            <div className="border border-white/[0.05] rounded bg-white/[0.02] max-h-[55vh] overflow-y-auto">
              {searching && (
                <div className="px-4 py-3 font-body text-[11.5px] text-cream-subtle italic">
                  Searching…
                </div>
              )}
              {!searching && searchResults.length === 0 && (
                <div className="px-4 py-6 text-center font-body text-[12px] text-cream-subtle">
                  No matches. Try a different query or browse the inventory.
                </div>
              )}
              {!searching && searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pickProperty(p)}
                  className="w-full text-left px-4 py-3 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-heading text-[13px] text-cream font-semibold truncate">
                        {p.name ?? p.address ?? "(unnamed)"}
                      </div>
                      <div className="font-mono text-[10.5px] text-cream-subtle truncate">
                        {[p.address, p.city, p.state].filter(Boolean).join(", ")}
                        {p.owner_name_raw ? ` · ${p.owner_name_raw}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {p.asset_type && (
                        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
                          {p.asset_type}
                        </span>
                      )}
                      {p.status === "prospect" && (
                        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300/80">
                          cold
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {selectedProperty && sent ? (
          <div className="px-6 py-5 space-y-3">
            <div className="rounded border border-teal-400/30 bg-teal-400/[0.05] px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">Sent</div>
              <p className="mt-1 font-body text-[12.5px] text-cream-dim">
                Email delivered. It's now in the Prospector Inbox.
              </p>
              <p className="mt-2 font-mono text-[10px] text-cream-subtle truncate">
                Gmail msg id: {sent.messageId}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Close
              </button>
              <a
                href="/cre-os/prospector/inbox"
                className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
              >
                Open Inbox →
              </a>
            </div>
          </div>
        ) : selectedProperty ? (
          <div className="px-6 py-5 space-y-3 max-h-[80vh] overflow-y-auto">
            {/* Lead context banner — visible only when launched with a known warm lead */}
            {leadContext && (
              <div className="rounded border border-coral-400/25 bg-coral-400/[0.04] px-3 py-2 font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">
                Warm lead ·{" "}
                <span className="text-cream-dim normal-case">
                  {leadContext.name ?? leadContext.email ?? "(unnamed)"}
                  {leadContext.company && <> · {leadContext.company}</>}
                  {leadContext.levelOfInterest && <> · {leadContext.levelOfInterest}</>}
                  {typeof leadContext.visitCount === "number" && leadContext.visitCount > 1 && (
                    <> · {leadContext.visitCount} visits</>
                  )}
                </span>
              </div>
            )}

            {/* Generate AI draft action — replaces hardcoded template with grounded copy */}
            <div className="flex items-center justify-between gap-3 rounded border border-teal-400/25 bg-teal-400/[0.04] px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">
                {draftArchetype
                  ? <>AI draft ready · archetype: <span className="text-cream-dim normal-case">{draftArchetype}</span></>
                  : "AI draft · grounds on listing status + recipient engagement"}
              </div>
              <button
                onClick={generateDraft}
                disabled={generating}
                className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.20] font-mono text-[10px] uppercase tracking-eyebrow text-teal-300 disabled:opacity-40"
              >
                {generating ? "Generating…" : draftArchetype ? "Regenerate" : "Generate AI draft"}
              </button>
            </div>

            {draftRationale && (
              <div className="rounded border border-white/[0.05] bg-white/[0.02] px-3 py-2 font-body text-[11px] text-cream-subtle italic">
                Anchor: {draftRationale}
              </div>
            )}

            <Field label="To (email)">
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="owner@example.com"
                autoFocus={!leadContext}
                className={inputCls}
              />
            </Field>
            <Field label="To (name, optional)">
              <input
                type="text"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder="Marcus Lee"
                className={inputCls}
              />
            </Field>
            <Field label="Subject">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Body">
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={10}
                className={`${inputCls} font-mono resize-y`}
              />
            </Field>

            {error && (
              <div className="rounded border border-amber/30 bg-amber/[0.08] px-3.5 py-2.5 font-body text-[12px] text-amber">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={busy}
                className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
