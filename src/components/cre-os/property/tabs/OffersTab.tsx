"use client";

/**
 * OffersTab — internal counterpart to the seller-net calculator the owner
 * sees on stewardshipcre.com. Lives as a tab on the property workspace so
 * the broker can:
 *   • See every offer scenario for this property (drafts + published)
 *   • Spin up a new draft, iterate, then publish it to the owner portal
 *     (or unpublish to pull it back into private)
 *   • Edit / delete any existing scenario
 *   • Compare offers side-by-side at a glance
 *
 * Same math (computeSellerNet from src/lib/seller-net.ts) and same data
 * model (seller_net_offers) as the public calculator — the only difference
 * is the `published_at` gate.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import {
  computeSellerNet,
  type SellerNetInputs,
  type SellerNetLineItem,
  type SellerNetPartner,
  type SellerNetTotals,
} from "@/lib/seller-net";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

interface AdminOffer {
  id: string;
  property_id: string;
  title: string;
  buyer_name: string | null;
  offer_date: string | null;
  offer_price: number;
  commission_pct: number | null;
  commission_amount: number | null;
  line_items: SellerNetLineItem[];
  partners: SellerNetPartner[];
  computed_commission: number | null;
  computed_adjustments: number | null;
  computed_net_proceeds: number | null;
  computed_partners_due: number | null;
  computed_net_after_partners: number | null;
  notes: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_LINE_ITEMS: SellerNetLineItem[] = [
  { label: "Tax prorations", amount: 0, sign: "credit" },
  { label: "Tax credits", amount: 0, sign: "credit" },
  { label: "Seller concessions", amount: 0, sign: "debit" },
];

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};
const fmtMoneyExact = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "$0";

type EditorState = {
  id: string | null;
  title: string;
  buyer_name: string;
  offer_date: string;
  offer_price: string;
  commission_mode: "pct" | "amount";
  commission_pct: string;
  commission_amount: string;
  line_items: SellerNetLineItem[];
  partners: SellerNetPartner[];
  notes: string;
};

function emptyEditor(askingPrice: number | null): EditorState {
  return {
    id: null,
    title: "",
    buyer_name: "",
    offer_date: new Date().toISOString().slice(0, 10),
    offer_price: askingPrice ? String(askingPrice) : "",
    commission_mode: "pct",
    commission_pct: "5",
    commission_amount: "",
    line_items: DEFAULT_LINE_ITEMS,
    partners: [],
    notes: "",
  };
}

function offerToEditor(o: AdminOffer): EditorState {
  return {
    id: o.id,
    title: o.title,
    buyer_name: o.buyer_name ?? "",
    offer_date: o.offer_date ?? new Date().toISOString().slice(0, 10),
    offer_price: String(o.offer_price),
    commission_mode: o.commission_amount !== null && o.commission_amount !== undefined ? "amount" : "pct",
    commission_pct: o.commission_pct !== null ? String(o.commission_pct) : "5",
    commission_amount: o.commission_amount !== null && o.commission_amount !== undefined ? String(o.commission_amount) : "",
    line_items: o.line_items.length > 0 ? o.line_items : DEFAULT_LINE_ITEMS,
    partners: o.partners,
    notes: o.notes ?? "",
  };
}

export function OffersTab({ p }: { p: PropertyDetail }) {
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/properties/${p.id}/offers`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOffers(json.offers ?? []);
    } catch (err: any) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [p.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Live computation for editor preview ──────────────────────────────────
  const editorInputs: SellerNetInputs | null = useMemo(() => {
    if (!editor) return null;
    return {
      offer_price: parseFloat(editor.offer_price.replace(/[$,]/g, "")) || 0,
      commission_pct: editor.commission_mode === "pct" ? (parseFloat(editor.commission_pct) || 0) : null,
      commission_amount:
        editor.commission_mode === "amount" ? (parseFloat(editor.commission_amount.replace(/[$,]/g, "")) || 0) : null,
      line_items: editor.line_items,
      partners: editor.partners,
    };
  }, [editor]);
  const totals: SellerNetTotals | null = useMemo(
    () => (editorInputs ? computeSellerNet(editorInputs) : null),
    [editorInputs],
  );

  function startNew() {
    setEditor(emptyEditor(p.askingPrice));
    setActionError(null);
  }
  function startEdit(o: AdminOffer) {
    setEditor(offerToEditor(o));
    setActionError(null);
  }
  function closeEditor() {
    setEditor(null);
    setActionError(null);
  }

  async function save(opts: { publish?: boolean } = {}) {
    if (!editor || !editorInputs) return;
    if (editorInputs.offer_price <= 0) {
      setActionError("Offer price is required.");
      return;
    }
    const effectiveTitle =
      editor.title.trim() ||
      (editor.buyer_name.trim()
        ? `${editor.buyer_name.trim()} — ${fmtMoney(editorInputs.offer_price)}`
        : `Offer — ${fmtMoney(editorInputs.offer_price)}`);

    const payload: Record<string, any> = {
      title: effectiveTitle,
      buyer_name: editor.buyer_name.trim() || null,
      offer_date: editor.offer_date || null,
      offer_price: editorInputs.offer_price,
      commission_pct: editorInputs.commission_pct,
      commission_amount: editorInputs.commission_amount,
      line_items: editor.line_items,
      partners: editor.partners,
      notes: editor.notes.trim() || null,
    };

    setBusy("save");
    setActionError(null);
    try {
      let savedId: string;
      if (editor.id) {
        const res = await fetch(`/api/properties/${p.id}/offers/${editor.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        savedId = editor.id;
      } else {
        const res = await fetch(`/api/properties/${p.id}/offers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, published: !!opts.publish }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        savedId = json.offer.id;
      }
      // If saving an existing draft + asking to publish, hit the publish endpoint
      if (editor.id && opts.publish) {
        await fetch(`/api/properties/${p.id}/offers/${savedId}/publish`, { method: "POST" });
      }
      closeEditor();
      await reload();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function togglePublish(o: AdminOffer) {
    setBusy(`pub-${o.id}`);
    setActionError(null);
    try {
      const isPublished = !!o.published_at;
      const res = await fetch(`/api/properties/${p.id}/offers/${o.id}/publish`, {
        method: isPublished ? "DELETE" : "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await reload();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(`del-${id}`);
    setActionError(null);
    try {
      const res = await fetch(`/api/properties/${p.id}/offers/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setConfirmDelete(null);
      if (editor?.id === id) closeEditor();
      await reload();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const drafts = offers.filter((o) => !o.published_at);
  const published = offers.filter((o) => !!o.published_at);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Eyebrow tone="coral">Offers · Seller-net analysis</Eyebrow>
          <h2 className="mt-1 font-heading text-base font-semibold text-cream tracking-tight">
            Run scenarios, save them, publish to the owner
          </h2>
          <p className="mt-1 font-body text-[12px] text-cream-dim leading-relaxed max-w-2xl">
            Drafts stay internal. When a scenario is ready for the seller's eyes, click <em>Publish to owner</em> and it
            appears on their portal magic link. Unpublish anytime to pull it back to private.
          </p>
        </div>
        <button
          onClick={startNew}
          className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
        >
          + New offer
        </button>
      </div>

      {actionError && (
        <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
          {actionError}
        </div>
      )}

      {/* Editor (inline panel above the lists when active) */}
      {editor && (
        <Panel
          eyebrow={editor.id ? "Editing offer" : "New offer"}
          actions={
            <button
              onClick={closeEditor}
              className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
            >
              Close
            </button>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
            {/* Inputs column */}
            <div className="space-y-5">
              <Section label="Offer">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Title">
                    <input
                      value={editor.title}
                      onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                      placeholder="Smith Group — 4/22"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Buyer">
                    <input
                      value={editor.buyer_name}
                      onChange={(e) => setEditor({ ...editor, buyer_name: e.target.value })}
                      placeholder="Smith Group LLC"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Offer date">
                    <input
                      type="date"
                      value={editor.offer_date}
                      onChange={(e) => setEditor({ ...editor, offer_date: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Offer price">
                    <input
                      inputMode="decimal"
                      value={editor.offer_price}
                      onChange={(e) => setEditor({ ...editor, offer_price: e.target.value })}
                      placeholder="$2,400,000"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </Section>

              <Section label="Commission">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.02] p-0.5">
                    <ModeChip
                      active={editor.commission_mode === "pct"}
                      onClick={() => setEditor({ ...editor, commission_mode: "pct" })}
                    >
                      %
                    </ModeChip>
                    <ModeChip
                      active={editor.commission_mode === "amount"}
                      onClick={() => setEditor({ ...editor, commission_mode: "amount" })}
                    >
                      $
                    </ModeChip>
                  </div>
                  {editor.commission_mode === "pct" ? (
                    <Field label="Rate (%)">
                      <input
                        inputMode="decimal"
                        value={editor.commission_pct}
                        onChange={(e) => setEditor({ ...editor, commission_pct: e.target.value })}
                        placeholder="5"
                        className={inputCls}
                      />
                    </Field>
                  ) : (
                    <Field label="Amount">
                      <input
                        inputMode="decimal"
                        value={editor.commission_amount}
                        onChange={(e) => setEditor({ ...editor, commission_amount: e.target.value })}
                        placeholder="$120,000"
                        className={inputCls}
                      />
                    </Field>
                  )}
                  {totals && (
                    <div className="text-right text-[11px] text-cream-dim ml-auto">
                      Computed:{" "}
                      <span className="font-mono text-cream">{fmtMoneyExact(totals.commission)}</span>
                    </div>
                  )}
                </div>
              </Section>

              <Section
                label="Closing-cost adjustments"
                hint="Credits add to seller proceeds, debits reduce them."
                right={
                  <button
                    onClick={() =>
                      setEditor({
                        ...editor,
                        line_items: [...editor.line_items, { label: "", amount: 0, sign: "credit" }],
                      })
                    }
                    className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 transition-colors"
                  >
                    + Add line
                  </button>
                }
              >
                <div className="space-y-2">
                  {editor.line_items.map((li, i) => (
                    <LineItemRow
                      key={i}
                      item={li}
                      onChange={(next) =>
                        setEditor({
                          ...editor,
                          line_items: editor.line_items.map((c, j) => (j === i ? next : c)),
                        })
                      }
                      onDelete={() =>
                        setEditor({ ...editor, line_items: editor.line_items.filter((_, j) => j !== i) })
                      }
                    />
                  ))}
                  {editor.line_items.length === 0 && (
                    <p className="font-body text-[11px] text-cream-subtle italic">
                      No adjustments. Add one if relevant.
                    </p>
                  )}
                </div>
              </Section>

              <Section
                label="Partner equity waterfall"
                hint="Each partner's capital is returned 1:1, plus their preferred return × hold years. The residual splits by ownership %."
                right={
                  <button
                    onClick={() =>
                      setEditor({
                        ...editor,
                        partners: [
                          ...editor.partners,
                          { name: "", capital: 0, pref_pct: 10, hold_years: 1, ownership_pct: 0 },
                        ],
                      })
                    }
                    className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 transition-colors"
                  >
                    + Add partner
                  </button>
                }
              >
                {editor.partners.length === 0 ? (
                  <p className="font-body text-[11px] text-cream-subtle italic">
                    No partners. Add one to model a capital + preferred-return waterfall.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {editor.partners.map((part, i) => (
                      <PartnerRow
                        key={i}
                        partner={part}
                        computed={totals?.partner_breakdown[i]}
                        onChange={(next) =>
                          setEditor({
                            ...editor,
                            partners: editor.partners.map((c, j) => (j === i ? next : c)),
                          })
                        }
                        onDelete={() =>
                          setEditor({
                            ...editor,
                            partners: editor.partners.filter((_, j) => j !== i),
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </Section>

              <Section label="Notes">
                <textarea
                  value={editor.notes}
                  onChange={(e) => setEditor({ ...editor, notes: e.target.value })}
                  rows={2}
                  placeholder="Internal context. Won't appear on the owner portal even after publish."
                  className={`${inputCls} resize-y`}
                />
              </Section>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.05]">
                <button
                  onClick={() => save({ publish: false })}
                  disabled={!!busy}
                  className="px-4 py-2 rounded border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream disabled:opacity-50 transition-colors"
                >
                  {busy === "save" ? "Saving…" : editor.id ? "Save" : "Save as draft"}
                </button>
                <button
                  onClick={() => save({ publish: true })}
                  disabled={!!busy}
                  className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-50 transition-colors"
                >
                  {editor.id ? "Save & publish" : "Save & publish to owner"}
                </button>
                <button
                  onClick={closeEditor}
                  className="px-3 py-2 rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Live totals column */}
            {totals && <LiveTotals totals={totals} />}
          </div>
        </Panel>
      )}

      {/* Loading state */}
      {loading && (
        <div className="font-body text-[12px] text-cream-subtle py-6 text-center">Loading offers…</div>
      )}
      {loadError && (
        <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
          {loadError}
        </div>
      )}

      {/* Lists */}
      {!loading && offers.length === 0 && (
        <Panel>
          <div className="text-center py-6">
            <p className="font-heading text-[13px] text-cream-dim">No offer scenarios yet.</p>
            <p className="mt-1 font-body text-[11px] text-cream-subtle max-w-md mx-auto">
              Run a quick "what would I net?" analysis on any offer (real or hypothetical), save it, and publish to
              the owner when it's ready.
            </p>
            <button
              onClick={startNew}
              className="mt-4 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
            >
              Run first scenario
            </button>
          </div>
        </Panel>
      )}

      {/* Drafts */}
      {drafts.length > 0 && (
        <section>
          <Eyebrow tone="amber" num={1}>
            Drafts · {drafts.length}
          </Eyebrow>
          <p className="mt-1 mb-3 font-body text-[11px] text-cream-subtle">
            Internal-only. The seller does not see these.
          </p>
          <div className="space-y-2">
            {drafts.map((o) => (
              <OfferRow
                key={o.id}
                offer={o}
                busy={busy}
                onEdit={() => startEdit(o)}
                onPublish={() => togglePublish(o)}
                onDelete={() => setConfirmDelete(o.id)}
                onConfirmDelete={() => remove(o.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                confirmDelete={confirmDelete === o.id}
                isEditing={editor?.id === o.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Published */}
      {published.length > 0 && (
        <section>
          <Eyebrow tone="teal" num={drafts.length > 0 ? 2 : 1}>
            Published · {published.length}
          </Eyebrow>
          <p className="mt-1 mb-3 font-body text-[11px] text-cream-subtle">
            Visible on the owner's magic-link portal.
          </p>
          <div className="space-y-2">
            {published.map((o) => (
              <OfferRow
                key={o.id}
                offer={o}
                busy={busy}
                onEdit={() => startEdit(o)}
                onPublish={() => togglePublish(o)}
                onDelete={() => setConfirmDelete(o.id)}
                onConfirmDelete={() => remove(o.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                confirmDelete={confirmDelete === o.id}
                isEditing={editor?.id === o.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-[12px] text-cream placeholder:text-cream-subtle";

function Section({
  label,
  hint,
  right,
  children,
}: {
  label: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
          {hint && <div className="font-body text-[10px] text-cream-subtle mt-0.5 max-w-md">{hint}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ModeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded font-mono text-[11px] uppercase transition-colors ${
        active ? "bg-coral-400/[0.15] text-coral-200" : "text-cream-subtle hover:text-cream"
      }`}
    >
      {children}
    </button>
  );
}

function LineItemRow({
  item,
  onChange,
  onDelete,
}: {
  item: SellerNetLineItem;
  onChange: (next: SellerNetLineItem) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_100px_28px] gap-2 items-center">
      <input
        value={item.label}
        onChange={(e) => onChange({ ...item, label: e.target.value })}
        placeholder="Line description"
        className={inputCls}
      />
      <input
        inputMode="decimal"
        value={item.amount === 0 ? "" : String(item.amount)}
        onChange={(e) => onChange({ ...item, amount: parseFloat(e.target.value.replace(/[$,]/g, "")) || 0 })}
        placeholder="$0"
        className={inputCls}
      />
      <select
        value={item.sign}
        onChange={(e) => onChange({ ...item, sign: e.target.value as "credit" | "debit" })}
        className={inputCls}
      >
        <option value="credit">+ Credit</option>
        <option value="debit">− Debit</option>
      </select>
      <button
        onClick={onDelete}
        className="text-cream-subtle hover:text-coral-400 transition-colors text-lg leading-none"
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

function PartnerRow({
  partner,
  computed,
  onChange,
  onDelete,
}: {
  partner: SellerNetPartner;
  computed?: { capital: number; preferred_return: number; owed: number; total_distribution: number };
  onChange: (next: SellerNetPartner) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded border border-white/[0.06] bg-steward-surface/30 p-3">
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_70px_70px_70px_28px] gap-2 items-end">
        <Field label="Partner name">
          <input
            value={partner.name}
            onChange={(e) => onChange({ ...partner, name: e.target.value })}
            placeholder="Mike — Anchor LP"
            className={inputCls}
          />
        </Field>
        <Field label="Capital">
          <input
            inputMode="decimal"
            value={partner.capital === 0 ? "" : String(partner.capital)}
            onChange={(e) =>
              onChange({ ...partner, capital: parseFloat(e.target.value.replace(/[$,]/g, "")) || 0 })
            }
            placeholder="$100,000"
            className={inputCls}
          />
        </Field>
        <Field label="Pref %">
          <input
            inputMode="decimal"
            value={String(partner.pref_pct)}
            onChange={(e) => onChange({ ...partner, pref_pct: parseFloat(e.target.value) || 0 })}
            className={inputCls}
          />
        </Field>
        <Field label="Hold (yr)">
          <input
            inputMode="decimal"
            value={String(partner.hold_years)}
            onChange={(e) => onChange({ ...partner, hold_years: parseFloat(e.target.value) || 0 })}
            className={inputCls}
          />
        </Field>
        <Field label="Owns %">
          <input
            inputMode="decimal"
            value={String(partner.ownership_pct)}
            onChange={(e) => onChange({ ...partner, ownership_pct: parseFloat(e.target.value) || 0 })}
            className={inputCls}
          />
        </Field>
        <button
          onClick={onDelete}
          className="text-cream-subtle hover:text-coral-400 transition-colors text-lg leading-none mb-1"
          title="Remove"
        >
          ×
        </button>
      </div>
      {computed && (computed.capital > 0 || computed.preferred_return > 0) && (
        <div className="mt-2 pt-2 border-t border-white/[0.05] grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 font-body text-[10.5px] text-cream-subtle">
          <span>Capital back: <span className="font-mono text-cream">{fmtMoneyExact(computed.capital)}</span></span>
          <span>Preferred: <span className="font-mono text-cream">{fmtMoneyExact(computed.preferred_return)}</span></span>
          <span>Owed: <span className="font-mono text-cream">{fmtMoneyExact(computed.owed)}</span></span>
          <span>
            Total dist:{" "}
            <span className="font-mono text-coral-300 font-semibold">
              {fmtMoneyExact(computed.total_distribution)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function LiveTotals({ totals }: { totals: SellerNetTotals }) {
  // Derived offer = commission + (net - adj) — derive from totals so we
  // don't need to thread the raw input number into here.
  const offerPrice = totals.commission + totals.net_proceeds - totals.adjustments;
  return (
    <div className="rounded border border-coral-400/25 bg-coral-400/[0.04] p-4 self-start">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400 mb-3">Live result</div>
      <Row label="Offer price" value={fmtMoneyExact(offerPrice)} />
      <Row label="Commission" value={"-" + fmtMoneyExact(totals.commission)} muted />
      <Row
        label="Adjustments (net)"
        value={(totals.adjustments >= 0 ? "+" : "") + fmtMoneyExact(totals.adjustments)}
        muted
      />
      <div className="my-3 border-t border-white/[0.08]" />
      <Row label="Net proceeds" value={fmtMoneyExact(totals.net_proceeds)} emphasize />
      {totals.partners_due > 0 && (
        <>
          <Row label="Partners owed" value={"-" + fmtMoneyExact(totals.partners_due)} muted />
          <div className="my-3 border-t border-white/[0.08]" />
          <Row label="Net after partners" value={fmtMoneyExact(totals.net_after_partners)} emphasize />
          {totals.sponsor_residual !== 0 && (
            <p className="mt-3 font-body text-[10.5px] text-cream-subtle">
              Sponsor / common: <span className="font-mono text-cream">{fmtMoneyExact(totals.sponsor_residual)}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span
        className={`font-body text-[11.5px] ${
          emphasize ? "text-coral-200 font-medium" : muted ? "text-cream-subtle" : "text-cream-dim"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-mono ${
          emphasize ? "text-coral-300 text-base font-semibold" : "text-[12px] text-cream"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function OfferRow({
  offer,
  busy,
  isEditing,
  onEdit,
  onPublish,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  confirmDelete,
}: {
  offer: AdminOffer;
  busy: string | null;
  isEditing: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  confirmDelete: boolean;
}) {
  const isPublished = !!offer.published_at;
  const pubBusy = busy === `pub-${offer.id}`;
  const delBusy = busy === `del-${offer.id}`;

  return (
    <article
      className={`rounded border bg-steward-surface/40 px-4 py-3 transition-colors ${
        isEditing
          ? "border-coral-400/40 bg-coral-400/[0.04]"
          : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-heading text-[13px] font-semibold text-cream truncate">{offer.title}</h3>
            <StatusBadge tone={isPublished ? "teal" : "amber"} size="xs">
              {isPublished ? "Published" : "Draft"}
            </StatusBadge>
          </div>
          {(offer.buyer_name || offer.offer_date) && (
            <div className="mt-0.5 font-body text-[11px] text-cream-subtle truncate">
              {offer.buyer_name && <span className="text-cream-dim">{offer.buyer_name}</span>}
              {offer.buyer_name && offer.offer_date && <span> · </span>}
              {offer.offer_date && (
                <span>
                  {new Date(offer.offer_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {confirmDelete ? (
            <>
              <button
                onClick={onConfirmDelete}
                disabled={delBusy}
                className="px-2.5 py-1 rounded border border-red-400/40 bg-red-500/[0.12] text-red-300 font-heading text-[10px] uppercase tracking-eyebrow font-semibold disabled:opacity-50"
              >
                {delBusy ? "Deleting…" : "Confirm"}
              </button>
              <button
                onClick={onCancelDelete}
                className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.02] text-cream-dim font-heading text-[10px] uppercase tracking-eyebrow font-semibold"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
              >
                {isEditing ? "Editing" : "Edit"}
              </button>
              <button
                onClick={onPublish}
                disabled={pubBusy}
                className={`px-2.5 py-1 rounded border font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors disabled:opacity-50 ${
                  isPublished
                    ? "border-amber/30 bg-amber/[0.08] text-amber hover:bg-amber/[0.18]"
                    : "border-teal-400/40 bg-teal-400/[0.08] text-teal-300 hover:bg-teal-400/[0.18]"
                }`}
              >
                {pubBusy ? "…" : isPublished ? "Unpublish" : "Publish to owner"}
              </button>
              <button
                onClick={onDelete}
                className="px-2.5 py-1 rounded border border-red-400/25 bg-red-500/[0.06] hover:bg-red-500/[0.14] text-red-300 font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="mt-3 pt-3 border-t border-white/[0.04] grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 font-body text-[11px]">
        <Stat label="Offer" value={fmtMoney(offer.offer_price)} />
        <Stat
          label="Commission"
          value={offer.computed_commission !== null ? fmtMoney(offer.computed_commission) : "—"}
          muted
        />
        <Stat
          label="Net proceeds"
          value={offer.computed_net_proceeds !== null ? fmtMoney(offer.computed_net_proceeds) : "—"}
          emphasize
        />
        <Stat
          label="After partners"
          value={
            offer.computed_partners_due && offer.computed_partners_due > 0 && offer.computed_net_after_partners !== null
              ? fmtMoney(offer.computed_net_after_partners)
              : "—"
          }
          emphasize={!!offer.computed_partners_due && offer.computed_partners_due > 0}
        />
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-cream-subtle">{label}</span>
      <span
        className={`font-mono truncate ${
          emphasize ? "text-coral-300 font-semibold" : muted ? "text-cream-subtle" : "text-cream"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
