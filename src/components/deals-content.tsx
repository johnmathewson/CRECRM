"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";
import CreateDealModal from "./create-deal-modal";
import Modal, { FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from "./modal";
import { useRef } from "react";

// ── Constants ─────────────────────────────────────────────
const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

const STAGES = ["Lead", "LOI", "Listing", "Under Contract", "Closed"];

const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  blue: "#5B9BD5",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)", redM: "rgba(231,76,60,0.20)",
  blueM: "rgba(91,155,213,0.20)",
};

const stageColors: Record<string, { bg: string; t: string; border: string }> = {
  Lead: { bg: C.amberM, t: C.amber, border: "rgba(242,201,76,0.25)" },
  LOI: { bg: C.tealM, t: C.teal, border: "rgba(78,205,196,0.25)" },
  Listing: { bg: C.blueM, t: C.blue, border: "rgba(91,155,213,0.25)" },
  "Under Contract": { bg: C.coralM, t: C.coral, border: "rgba(224,122,95,0.25)" },
  Closed: { bg: C.greenM, t: C.green, border: "rgba(107,203,119,0.25)" },
};

// ── Types ─────────────────────────────────────────────────
interface Deal {
  id: string;
  deal_name: string;
  deal_type: string;
  price: number;
  commission_pct: number;
  estimated_commission: number;
  probability_pct: number;
  weighted_commission: number;
  expected_close: string | null;
  actual_close: string | null;
  is_closed: boolean;
  is_dead: boolean;
  dead_reason: string | null;
  notes: string | null;
  property?: { name: string; asset_type: string; city: string; address: string } | null;
  client?: { full_name: string; phone: string; email: string } | null;
  current_stage?: string;
  property_id?: string | null;
  client_contact_id?: string | null;
}

// ── Helpers ───────────────────────────────────────────────
const fmt = (n: number) => {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmtF = (n: number) => n ? `$${n.toLocaleString()}` : "—";
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// ── Inline Editable Field ─────────────────────────────────
function EditableField({ label, value, displayValue, accent, onSave, type = "text", prefix, suffix }: {
  label: string;
  value: string;
  displayValue: string;
  accent?: boolean;
  onSave: (val: string) => void;
  type?: "text" | "number" | "date";
  prefix?: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  return (
    <div
      className="glass-inner px-3 py-2.5 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
      onClick={() => !editing && startEdit()}
    >
      <div className="flex justify-between items-center mb-1">
        <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium">{label}</div>
        {!editing && <span className="text-[8px] text-cream-subtle opacity-0 group-hover:opacity-100 transition-opacity">click to edit</span>}
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          {prefix && <span className="text-xs text-cream-subtle">{prefix}</span>}
          <input
            ref={inputRef}
            type={type}
            step={type === "number" ? "any" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="w-full bg-transparent border-none outline-none text-sm font-semibold tnum"
            style={{
              color: accent ? C.coral : "#F0EDE4",
              borderBottom: `1px solid ${C.coral}`,
              padding: "1px 0",
            }}
          />
          {suffix && <span className="text-xs text-cream-subtle">{suffix}</span>}
        </div>
      ) : (
        <div className="text-sm font-semibold tnum" style={accent ? { color: C.coral } : undefined}>
          {displayValue}
        </div>
      )}
    </div>
  );
}

// ── Inline Text (for deal name, etc.) ─────────────────────
function InlineText({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => { setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); };
  const commit = () => { setEditing(false); if (draft && draft !== value) onSave(draft); };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
        className={className}
        style={{ background: "transparent", border: "none", outline: "none", borderBottom: `1px solid ${C.coral}`, color: "#F0EDE4", width: "100%", padding: 0, fontFamily: "inherit" }}
      />
    );
  }
  return (
    <div className={`${className} cursor-pointer group`} onClick={start} style={{ position: "relative" }}>
      {value}
      <span className="text-[8px] text-cream-subtle opacity-0 group-hover:opacity-100 transition-opacity ml-2">✎</span>
    </div>
  );
}

// ── Droppable Stage Column ────────────────────────────────
function StageColumn({ stage, children, isOver }: { stage: string; children: React.ReactNode; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: stage });
  const sc = stageColors[stage] || stageColors.Lead;
  return (
    <div ref={setNodeRef} className="flex flex-col min-h-[200px]" style={{ transition: "background 0.15s" }}>
      <div
        className="glass px-3 py-2.5 mb-2.5"
        style={{ borderTopColor: sc.border, background: isOver ? `${sc.t}10` : undefined }}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 inline-block" style={{ borderRadius: 2, background: sc.t, boxShadow: `0 0 6px ${sc.t}40` }} />
            <span className="text-xs font-semibold">{stage === "Touring/Underwriting" ? "Touring" : stage}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 flex-1" style={{ minHeight: 60, borderRadius: 6, border: isOver ? `1px dashed ${sc.t}60` : "1px dashed transparent", padding: isOver ? 4 : 0, transition: "all 0.15s" }}>
        {children}
      </div>
    </div>
  );
}

// ── Draggable Deal Card ───────────────────────────────────
function DealCard({ deal, isSelected, onSelect, isDragging }: { deal: Deal; isSelected: boolean; onSelect: () => void; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const sc = stageColors[deal.current_stage || "Lead"] || stageColors.Lead;
  const prop = deal.property as any;
  const client = deal.client as any;

  const style: React.CSSProperties = {
    borderColor: isSelected ? sc.border : undefined,
    boxShadow: isSelected ? `0 0 16px ${sc.t}20` : undefined,
    opacity: isDragging ? 0.4 : deal.is_dead ? 0.5 : 1,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    zIndex: transform ? 999 : undefined,
    cursor: "grab",
    touchAction: "none",
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="glass transition-all hover:bg-[rgba(255,255,255,0.06)]"
      style={style}
      onClick={(e) => { if (!transform) onSelect(); }}
    >
      <div className="p-3">
        <div className="flex justify-between items-start mb-1.5">
          <div className="text-xs font-bold leading-snug pr-2">
            {deal.deal_name?.replace(" Sale", "").replace(" Lease", "")}
          </div>
          <span className="px-1.5 py-0.5 text-[9px] font-semibold flex-shrink-0" style={{
            borderRadius: 4,
            background: deal.deal_type === "sale" ? C.coralM : C.tealM,
            color: deal.deal_type === "sale" ? C.coral : C.teal,
          }}>
            {deal.deal_type}
          </span>
        </div>
        {prop?.name && <div className="text-[10.5px] text-cream-subtle mb-1">{prop.asset_type} · {prop.city}</div>}
        {client?.full_name && <div className="text-[10.5px] text-cream-muted mb-2">{client.full_name}</div>}
        <div className="flex justify-between items-end">
          <div>
            <div className="text-[9px] text-cream-subtle uppercase tracking-wider">Comm.</div>
            <div className="text-sm font-bold tnum" style={{ color: sc.t }}>{fmt(deal.estimated_commission)}</div>
          </div>
          <span className="inline-flex items-center justify-center w-10 h-5 text-[10px] font-semibold" style={{
            borderRadius: 4,
            background: deal.probability_pct >= 0.5 ? C.greenM : deal.probability_pct >= 0.25 ? C.amberM : C.redM,
            color: deal.probability_pct >= 0.5 ? C.green : deal.probability_pct >= 0.25 ? C.amber : C.red,
          }}>
            {pct(deal.probability_pct)}
          </span>
        </div>
        {deal.is_dead && (
          <div className="mt-2 px-2 py-1 text-[10px] font-medium" style={{ borderRadius: 4, background: C.redM, color: C.red }}>
            Dead: {deal.dead_reason || "No reason"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overlay card (shown while dragging) ───────────────────
function DealCardOverlay({ deal }: { deal: Deal }) {
  const sc = stageColors[deal.current_stage || "Lead"] || stageColors.Lead;
  return (
    <div className="glass" style={{ width: 220, opacity: 0.92, boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 12px ${sc.t}30`, cursor: "grabbing" }}>
      <div className="p-3">
        <div className="text-xs font-bold leading-snug mb-1">{deal.deal_name?.replace(" Sale", "").replace(" Lease", "")}</div>
        <div className="text-sm font-bold tnum" style={{ color: sc.t }}>{fmt(deal.estimated_commission)}</div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────
export default function DealsContent() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const [showDead, setShowDead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Edit deal state
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editProperties, setEditProperties] = useState<{ id: string; name: string }[]>([]);
  const [editContacts, setEditContacts] = useState<{ id: string; full_name: string }[]>([]);

  // Stage change modal
  const [stageModal, setStageModal] = useState<Deal | null>(null);
  const [newStage, setNewStage] = useState("");

  // Mark dead modal
  const [deadModal, setDeadModal] = useState<Deal | null>(null);
  const [deadReason, setDeadReason] = useState("");

  // Activity log modal
  const [activityModal, setActivityModal] = useState<Deal | null>(null);
  const [activityForm, setActivityForm] = useState({ type: "note", content: "" });

  // Notes edit
  const [notesModal, setNotesModal] = useState<Deal | null>(null);
  const [notesText, setNotesText] = useState("");

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Load pipeline rows from properties ──────────────────
  // Post migration 0003, properties is the source of truth. Each property is a
  // single record carrying both asset details and pipeline financials. The
  // local Deal interface is kept (less invasive) — populated via PostgREST
  // column aliasing so internal references like d.deal_name / d.price keep
  // working. property_id mirrors id so dashboard deep-links continue to land
  // here via setSelected lookup by id.
  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("properties")
      .select(`
        id,
        deal_name:name,
        deal_type:transaction_type,
        price:agreed_price,
        commission_pct,
        estimated_commission,
        probability_pct,
        weighted_commission,
        expected_close,
        actual_close,
        is_dead,
        dead_reason,
        notes,
        client_contact_id,
        current_stage:pipeline_stage,
        asset_type, address, city, state, zip, headline, asking_price, sqft,
        client:contacts!properties_client_contact_id_fkey(full_name, phone, email)
      `)
      .order("weighted_commission", { ascending: false, nullsFirst: false });

    // Synthesize the legacy `property` block + `is_closed` flag so existing
    // render code (e.g. selected.property?.name, .is_closed checks) keeps
    // working without 100s of changes scattered through the file.
    if (data) {
      for (const row of data as any[]) {
        row.property = {
          name: row.deal_name,
          asset_type: row.asset_type,
          city: row.city,
          address: row.address,
        };
        row.property_id = row.id; // alias for "this is its own property"
        row.is_closed = row.current_stage === "Closed";
      }
    }

    setDeals((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Deep-link focus: open ?focus=<deal_id> in the editor on load ────────
  // Triggered from dashboard pipeline / closed-commission rows (and other
  // surfaces that want a single-click handoff into the deal editor).
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading || deals.length === 0) return;
    const focusId = searchParams.get("focus");
    if (!focusId) return;
    const target = deals.find((d) => d.id === focusId);
    if (target) {
      // Make sure dead deals are visible if the focused deal is dead
      if (target.is_dead) setShowDead(true);
      // Switch to table view for closed deals (kanban only shows active stages)
      if (target.is_closed) setView("table");
      setSelected(target);
      // Drop the param from the URL so a refresh doesn't re-fire / lock state
      router.replace(pathname, { scroll: false });
    }
  }, [loading, deals, searchParams, router, pathname]);

  // ── Detail modal: ESC to close + body scroll lock ──────
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  // ── Stage transition (DB) ───────────────────────────────
  // Post migration 0003: pipeline_stage lives directly on the property row.
  // No more deal_stages history inserts; stage is a single column we PATCH.
  const changeStage = useCallback(async (dealId: string, fromStage: string, toStage: string) => {
    const supabase = createClient();
    const now = new Date().toISOString();

    const update: Record<string, unknown> = { pipeline_stage: toStage };
    // Auto-set/clear actual_close when crossing the Closed boundary
    if (toStage === "Closed") update.actual_close = now;
    if (fromStage === "Closed" && toStage !== "Closed") update.actual_close = null;

    await supabase.from("properties").update(update).eq("id", dealId);

    // Optimistic local update so the kanban repaints instantly
    setDeals((prev) => prev.map((d) =>
      d.id === dealId
        ? { ...d, current_stage: toStage, is_closed: toStage === "Closed", actual_close: toStage === "Closed" ? now : null }
        : d
    ));
    if (selected?.id === dealId) {
      setSelected((s) => s ? { ...s, current_stage: toStage, is_closed: toStage === "Closed", actual_close: toStage === "Closed" ? now : null } : null);
    }
  }, [selected]);

  // ── Inline field save ────────────────────────────────────
  const inlineSave = useCallback(async (field: string, rawVal: string) => {
    if (!selected) return;
    const supabase = createClient();

    // Build the update payload — recalculate derived fields
    const deal = selected;
    let price = deal.price;
    let commPct = deal.commission_pct;
    let prob = deal.probability_pct;

    if (field === "price") price = parseFloat(rawVal) || 0;
    if (field === "commission_pct") commPct = (parseFloat(rawVal) || 0) / 100;
    if (field === "probability_pct") prob = (parseFloat(rawVal) || 0) / 100;

    const estComm = price * commPct;
    const weighted = estComm * prob;

    // Map to property column names: price→agreed_price, deal_name→name.
    const update: any = {
      agreed_price: price,
      commission_pct: commPct,
      estimated_commission: estComm,
      probability_pct: prob,
      weighted_commission: weighted,
    };

    if (field === "expected_close") update.expected_close = rawVal || null;
    if (field === "deal_name") update.name = rawVal;
    if (field === "notes") update.notes = rawVal || null;

    await supabase.from("properties").update(update).eq("id", deal.id);

    // Optimistic update
    const updatedDeal = { ...deal, ...update };
    setDeals((prev) => prev.map((d) => d.id === deal.id ? { ...d, ...update } : d));
    setSelected(updatedDeal);
  }, [selected]);

  // ── Drag handlers ───────────────────────────────────────
  const onDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(e.active.id as string);
  }, []);

  const onDragOver = useCallback((e: any) => {
    setOverId(e.over?.id as string || null);
  }, []);

  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setDraggingId(null);
    setOverId(null);
    const dealId = e.active.id as string;
    const newStage = e.over?.id as string;
    if (!newStage || !STAGES.includes(newStage)) return;

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.current_stage === newStage) return;

    await changeStage(dealId, deal.current_stage || "Lead", newStage);
  }, [deals, changeStage]);

  // ── Mark dead ───────────────────────────────────────────
  const handleMarkDead = useCallback(async () => {
    if (!deadModal) return;
    const supabase = createClient();
    await supabase.from("properties").update({
      is_dead: true,
      dead_reason: deadReason || null,
    }).eq("id", deadModal.id);

    setDeals((prev) => prev.map((d) => d.id === deadModal.id ? { ...d, is_dead: true, dead_reason: deadReason || null } : d));
    if (selected?.id === deadModal.id) setSelected((s) => s ? { ...s, is_dead: true, dead_reason: deadReason || null } : null);
    setDeadModal(null);
    setDeadReason("");
  }, [deadModal, deadReason, selected]);

  // ── Revive dead deal ────────────────────────────────────
  const handleRevive = useCallback(async (deal: Deal) => {
    const supabase = createClient();
    await supabase.from("properties").update({ is_dead: false, dead_reason: null }).eq("id", deal.id);
    setDeals((prev) => prev.map((d) => d.id === deal.id ? { ...d, is_dead: false, dead_reason: null } : d));
    if (selected?.id === deal.id) setSelected((s) => s ? { ...s, is_dead: false, dead_reason: null } : null);
  }, [selected]);

  // ── Edit deal ───────────────────────────────────────────
  const openEditModal = useCallback(async (deal: Deal) => {
    setEditDeal(deal);
    setEditForm({
      deal_name: deal.deal_name,
      deal_type: deal.deal_type,
      price: deal.price?.toString() || "",
      commission_pct: deal.commission_pct ? (deal.commission_pct * 100).toFixed(1) : "2.5",
      probability_pct: deal.probability_pct ? (deal.probability_pct * 100).toFixed(0) : "25",
      expected_close: deal.expected_close ? deal.expected_close.split("T")[0] : "",
      notes: deal.notes || "",
      property_id: deal.property_id || "",
      client_contact_id: deal.client_contact_id || "",
    });
    const supabase = createClient();
    const [{ data: props }, { data: contacts }] = await Promise.all([
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("contacts").select("id, full_name").order("full_name"),
    ]);
    setEditProperties(props || []);
    setEditContacts(contacts || []);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editDeal) return;
    setEditSaving(true);
    const supabase = createClient();

    const price = editForm.price ? parseFloat(editForm.price) : 0;
    const commPct = editForm.commission_pct ? parseFloat(editForm.commission_pct) / 100 : 0;
    const prob = editForm.probability_pct ? parseFloat(editForm.probability_pct) / 100 : 0;
    const estComm = price * commPct;
    const weighted = estComm * prob;

    // Property column mapping: deal_name→name, deal_type→transaction_type,
    // price→agreed_price. property_id is a no-op now (the row IS the property).
    const { error } = await supabase.from("properties").update({
      name: editForm.deal_name,
      transaction_type: editForm.deal_type,
      agreed_price: price,
      commission_pct: commPct,
      estimated_commission: estComm,
      probability_pct: prob,
      weighted_commission: weighted,
      expected_close: editForm.expected_close || null,
      notes: editForm.notes || null,
      client_contact_id: editForm.client_contact_id || null,
    }).eq("id", editDeal.id);

    setEditSaving(false);
    if (!error) {
      setEditDeal(null);
      await load(); // full reload to get joined data
    } else {
      alert("Error: " + error.message);
    }
  }, [editDeal, editForm, load]);

  // ── Save notes ──────────────────────────────────────────
  const handleSaveNotes = useCallback(async () => {
    if (!notesModal) return;
    const supabase = createClient();
    await supabase.from("properties").update({ notes: notesText || null }).eq("id", notesModal.id);
    setDeals((prev) => prev.map((d) => d.id === notesModal.id ? { ...d, notes: notesText || null } : d));
    if (selected?.id === notesModal.id) setSelected((s) => s ? { ...s, notes: notesText || null } : null);
    setNotesModal(null);
  }, [notesModal, notesText, selected]);

  // ── Stage change via modal ──────────────────────────────
  const handleStageChange = useCallback(async () => {
    if (!stageModal || !newStage) return;
    await changeStage(stageModal.id, stageModal.current_stage || "Lead", newStage);
    setStageModal(null);
    setNewStage("");
  }, [stageModal, newStage, changeStage]);

  // ── Delete deal ─────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<Deal | null>(null);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const supabase = createClient();
    // Hard delete: remove the property row entirely (deals table is dormant).
    // The CASCADE on properties handles related deal_stages/communications/etc.
    await supabase.from("properties").delete().eq("id", deleteConfirm.id);
    setDeals((prev) => prev.filter((d) => d.id !== deleteConfirm.id));
    if (selected?.id === deleteConfirm.id) setSelected(null);
    setDeleteConfirm(null);
  }, [deleteConfirm, selected]);

  // ── Derived data ────────────────────────────────────────
  const visible = deals.filter((d) => showDead || !d.is_dead);
  const byStage: Record<string, Deal[]> = {};
  STAGES.forEach((s) => (byStage[s] = []));
  visible.forEach((d) => {
    const s = d.current_stage || "Lead";
    if (byStage[s]) byStage[s].push(d);
    else byStage["Lead"].push(d);
  });

  const active = deals.filter((d) => !d.is_closed && !d.is_dead);
  const closed = deals.filter((d) => d.is_closed);
  const dead = deals.filter((d) => d.is_dead);
  const pipeTotal = active.reduce((s, d) => s + (d.estimated_commission || 0), 0);
  const weightTotal = active.reduce((s, d) => s + (d.weighted_commission || 0), 0);
  const earnedTotal = closed.reduce((s, d) => s + (d.estimated_commission || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Loading deals...</div>
      </div>
    );
  }

  const editSet = (key: string, val: string) => setEditForm((f: any) => ({ ...f, [key]: val }));

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Deal Pipeline</h1>
          <p className="mt-1 text-cream-muted text-[13px]">
            <span className="text-coral font-semibold">{active.length} active</span>
            {" · "}{fmt(pipeTotal)} pipeline · {fmt(weightTotal)} weighted
            {" · "}<span style={{ color: C.green }}>{closed.length} closed ({fmt(earnedTotal)})</span>
            {dead.length > 0 && <span className="text-cream-subtle"> · {dead.length} dead</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1.5 text-[11px] text-cream-subtle cursor-pointer">
            <input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} className="accent-coral" />
            Show dead
          </label>
          <div className="glass-inner flex overflow-hidden" style={{ borderRadius: 5 }}>
            <button
              onClick={() => setView("pipeline")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "pipeline" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "pipeline" ? C.coralM : "transparent" }}
            >
              Pipeline
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "table" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "table" ? C.coralM : "transparent" }}
            >
              Table
            </button>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 border-none cursor-pointer text-xs font-semibold text-white"
            style={{ borderRadius: 5, background: "linear-gradient(135deg, #E07A5F, #E07A5FCC)", boxShadow: "0 3px 16px rgba(224,122,95,0.35)" }}
          >
            + New Deal
          </button>
        </div>
      </div>

      <CreateDealModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />

      <div>
        {/* ── Pipeline View ─────────────────────────────── */}
        {view === "pipeline" ? (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${STAGES.length}, 1fr)` }}>
              {STAGES.map((stage) => {
                const stageDeals = byStage[stage] || [];
                const stageValue = stageDeals.reduce((s, d) => s + (d.estimated_commission || 0), 0);
                const sc = stageColors[stage] || stageColors.Lead;
                return (
                  <StageColumn key={stage} stage={stage} isOver={overId === stage}>
                    {/* Column stats */}
                    <div className="text-[10.5px] text-cream-subtle mb-1 px-1 flex justify-between">
                      <span>{stageDeals.length} deal{stageDeals.length !== 1 ? "s" : ""}</span>
                      <span className="tnum">{fmt(stageValue)}</span>
                    </div>
                    {stageDeals.map((d) => (
                      <DealCard
                        key={d.id}
                        deal={d}
                        isSelected={selected?.id === d.id}
                        onSelect={() => setSelected(selected?.id === d.id ? null : d)}
                        isDragging={draggingId === d.id}
                      />
                    ))}
                  </StageColumn>
                );
              })}
            </div>
            <DragOverlay>
              {draggingId ? <DealCardOverlay deal={deals.find((d) => d.id === draggingId)!} /> : null}
            </DragOverlay>
          </DndContext>
        ) : (
          /* ── Table View ──────────────────────────────── */
          <Panel title={`${visible.length} Deals`} actions={
            <div className="flex gap-1"><IconBtn onClick={load}>↻</IconBtn></div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
                <thead>
                  <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
                    {["Deal", "Client", "Stage", "Type", "Price", "Est. Comm", "Prob", "Weighted", "Close"].map((h, i) => (
                      <th key={h} className={`px-2.5 pb-2 font-medium ${i >= 4 && i !== 6 ? "text-right" : i === 6 ? "text-center" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => {
                    const client = d.client as any;
                    const sc = stageColors[d.current_stage || "Lead"] || stageColors.Lead;
                    const isSelected = selected?.id === d.id;
                    const bg = isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)";
                    return (
                      <tr key={d.id} className="cursor-pointer" onClick={() => setSelected(isSelected ? null : d)} style={{ opacity: d.is_dead ? 0.5 : 1 }}>
                        <td className="px-2.5 py-2.5 text-[12.5px] font-medium" style={{ borderRadius: "4px 0 0 4px", background: bg }}>
                          {d.deal_name?.replace(" Sale", "").replace(" Lease", "")}
                        </td>
                        <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ background: bg }}>{client?.full_name || "—"}</td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <span className="px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 4, background: sc.bg, color: sc.t }}>
                            {(d.current_stage || "Lead") === "Touring/Underwriting" ? "Touring" : d.current_stage || "Lead"}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <span className="px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ borderRadius: 4, background: d.deal_type === "sale" ? C.coralM : C.tealM, color: d.deal_type === "sale" ? C.coral : C.teal }}>
                            {d.deal_type}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs text-cream-muted tnum" style={{ background: bg }}>{fmtF(d.price)}</td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ color: C.coral, background: bg }}>{fmtF(d.estimated_commission)}</td>
                        <td className="px-2.5 py-2.5 text-center" style={{ background: bg }}>
                          <span className="inline-flex items-center justify-center w-10 h-5 text-[10.5px] font-semibold" style={{
                            borderRadius: 4,
                            background: d.probability_pct >= 0.5 ? C.greenM : d.probability_pct >= 0.25 ? C.amberM : C.redM,
                            color: d.probability_pct >= 0.5 ? C.green : d.probability_pct >= 0.25 ? C.amber : C.red,
                          }}>
                            {pct(d.probability_pct)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ background: bg }}>{fmtF(d.weighted_commission)}</td>
                        <td className="px-2.5 py-2.5 text-right text-[11px] text-cream-subtle" style={{ borderRadius: "0 4px 4px 0", background: bg }}>
                          {d.actual_close ? new Date(d.actual_close).toLocaleDateString("en-US", { month: "short", day: "numeric" }) :
                           d.expected_close ? new Date(d.expected_close).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="glass-inner flex justify-between items-center mt-2 px-3.5 py-2.5">
              <span className="text-xs font-semibold">Pipeline Total</span>
              <div className="flex gap-5 text-xs tnum">
                <span>Est: <span className="font-bold" style={{ color: C.coral }}>{fmtF(pipeTotal)}</span></span>
                <span>Weighted: <span className="font-bold" style={{ color: C.teal }}>{fmtF(weightTotal)}</span></span>
                <span>Earned: <span className="font-bold" style={{ color: C.green }}>{fmtF(earnedTotal)}</span></span>
              </div>
            </div>
          </Panel>
        )}

        {/* ── Detail Modal (centered overlay) ─────────────── */}
        {selected && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          >
            <div
              className="flex flex-col gap-4"
              style={{ width: "min(720px, 92vw)", maxHeight: "88vh", overflow: "auto" }}
              data-lenis-prevent
            >
            <Panel title="Deal Detail" actions={
              <div className="flex gap-1">
                <IconBtn onClick={() => openEditModal(selected)}>✎</IconBtn>
                <IconBtn onClick={() => setSelected(null)}>✕</IconBtn>
              </div>
            }>
              <div className="mb-3">
                <InlineText
                  value={selected.deal_name}
                  onSave={(v) => inlineSave("deal_name", v)}
                  className="text-lg font-bold"
                />
                <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                  <span className="px-2 py-0.5 text-[10px] font-semibold" style={{
                    borderRadius: 4,
                    background: selected.deal_type === "sale" ? C.coralM : C.tealM,
                    color: selected.deal_type === "sale" ? C.coral : C.teal,
                  }}>
                    {selected.deal_type}
                  </span>
                  {(() => {
                    const sc = stageColors[selected.current_stage || "Lead"] || stageColors.Lead;
                    return (
                      <button
                        className="px-2 py-0.5 text-[10px] font-semibold border-none cursor-pointer hover:brightness-125 transition-all"
                        style={{ borderRadius: 4, background: sc.bg, color: sc.t }}
                        onClick={() => { setStageModal(selected); setNewStage(""); }}
                        title="Click to change stage"
                      >
                        {selected.current_stage || "Lead"} ▾
                      </button>
                    );
                  })()}
                  {selected.is_dead && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 4, background: C.redM, color: C.red }}>Dead</span>
                  )}
                </div>
              </div>

              {/* Financials — click any field to edit */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <EditableField
                  label="Price"
                  value={selected.price?.toString() || "0"}
                  displayValue={fmtF(selected.price)}
                  type="number"
                  prefix="$"
                  onSave={(v) => inlineSave("price", v)}
                />
                <EditableField
                  label="Commission %"
                  value={selected.commission_pct ? (selected.commission_pct * 100).toFixed(1) : "0"}
                  displayValue={selected.commission_pct ? `${(selected.commission_pct * 100).toFixed(1)}%` : "—"}
                  type="number"
                  suffix="%"
                  onSave={(v) => inlineSave("commission_pct", v)}
                />
                <div className="glass-inner px-3 py-2.5">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Est. Commission</div>
                  <div className="text-sm font-semibold tnum" style={{ color: C.coral }}>{fmtF(selected.estimated_commission)}</div>
                </div>
                <EditableField
                  label="Probability"
                  value={selected.probability_pct ? (selected.probability_pct * 100).toFixed(0) : "0"}
                  displayValue={pct(selected.probability_pct)}
                  type="number"
                  suffix="%"
                  onSave={(v) => inlineSave("probability_pct", v)}
                />
                <div className="glass-inner px-3 py-2.5">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Weighted</div>
                  <div className="text-sm font-semibold tnum">{fmtF(selected.weighted_commission)}</div>
                </div>
                <EditableField
                  label="Expected Close"
                  value={selected.expected_close ? selected.expected_close.split("T")[0] : ""}
                  displayValue={selected.expected_close ? new Date(selected.expected_close).toLocaleDateString() : "—"}
                  type="date"
                  onSave={(v) => inlineSave("expected_close", v)}
                />
              </div>

              {/* Property */}
              {(selected.property as any)?.name && (
                <button
                  type="button"
                  className="glass-inner px-3 py-2.5 mb-3 w-full text-left border-none cursor-pointer hover:brightness-125 transition-all"
                  onClick={() => selected.property_id && router.push(`/properties?focus=${selected.property_id}`)}
                  title="Open in Properties"
                >
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1 flex items-center justify-between">
                    <span>Property</span>
                    <span className="text-cream-muted text-[9.5px] normal-case tracking-normal">View →</span>
                  </div>
                  <div className="text-xs font-semibold">{(selected.property as any).name}</div>
                  <div className="text-[10.5px] text-cream-subtle mt-0.5">{(selected.property as any).asset_type} · {(selected.property as any).city}</div>
                </button>
              )}

              {/* Client */}
              {(selected.client as any)?.full_name && (
                <div className="glass-inner px-3 py-2.5 mb-3">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Client</div>
                  <div className="text-xs font-semibold">{(selected.client as any).full_name}</div>
                  <div className="text-[10.5px] text-cream-subtle mt-0.5">
                    {[(selected.client as any).phone, (selected.client as any).email].filter(Boolean).join(" · ") || "No contact info"}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div
                className="glass-inner px-3 py-2.5 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                onClick={() => { setNotesModal(selected); setNotesText(selected.notes || ""); }}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium">Notes</div>
                  <span className="text-[9px] text-cream-subtle">click to edit</span>
                </div>
                <div className="text-xs text-cream-muted leading-relaxed">{selected.notes || "No notes yet — click to add"}</div>
              </div>

              {selected.is_dead && selected.dead_reason && (
                <div className="px-3 py-2.5 mt-2" style={{ borderRadius: 4, background: C.redM, border: `1px solid rgba(231,76,60,0.15)` }}>
                  <div className="text-[9.5px] uppercase tracking-wider font-medium mb-1" style={{ color: C.red }}>Dead Reason</div>
                  <div className="text-xs text-cream-muted">{selected.dead_reason}</div>
                </div>
              )}
            </Panel>

            {/* ── Quick Actions ──────────────────────────── */}
            <Panel title="Quick Actions">
              <div className="flex flex-col gap-1.5">
                {/* Edit deal */}
                <button
                  onClick={() => openEditModal(selected)}
                  className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="text-[13px]">✎</span>
                  <div>
                    <div className="text-xs font-medium text-cream">Edit deal</div>
                    <div className="text-[10px] text-cream-subtle">Update price, probability, close date</div>
                  </div>
                </button>

                {/* Update stage */}
                <button
                  onClick={() => { setStageModal(selected); setNewStage(""); }}
                  className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="text-[13px]">&#x2192;</span>
                  <div>
                    <div className="text-xs font-medium text-cream">Update stage</div>
                    <div className="text-[10px] text-cream-subtle">Move to next stage or drag in pipeline</div>
                  </div>
                </button>

                {/* Log activity / note */}
                <button
                  onClick={() => { setNotesModal(selected); setNotesText(selected.notes || ""); }}
                  className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="text-[13px]">&#x1F4DD;</span>
                  <div>
                    <div className="text-xs font-medium text-cream">Add / edit notes</div>
                    <div className="text-[10px] text-cream-subtle">Record calls, meetings, or updates</div>
                  </div>
                </button>

                {/* Mark dead / Revive */}
                {!selected.is_dead ? (
                  <button
                    onClick={() => { setDeadModal(selected); setDeadReason(""); }}
                    className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <span className="text-[13px]">&#x1F480;</span>
                    <div>
                      <div className="text-xs font-medium text-cream">Mark dead</div>
                      <div className="text-[10px] text-cream-subtle">Kill this deal with a reason</div>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={() => handleRevive(selected)}
                    className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <span className="text-[13px]">&#x1F4AA;</span>
                    <div>
                      <div className="text-xs font-medium" style={{ color: C.green }}>Revive deal</div>
                      <div className="text-[10px] text-cream-subtle">Bring this deal back to life</div>
                    </div>
                  </button>
                )}

                {/* Delete */}
                <button
                  onClick={() => setDeleteConfirm(selected)}
                  className="glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="text-[13px]" style={{ color: C.red }}>&#x2716;</span>
                  <div>
                    <div className="text-xs font-medium" style={{ color: C.red }}>Delete deal</div>
                    <div className="text-[10px] text-cream-subtle">Permanently remove this deal</div>
                  </div>
                </button>
              </div>
            </Panel>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODALS ═══════════════════════════════════════ */}

      {/* ── Stage Change Modal ──────────────────────────── */}
      <Modal open={!!stageModal} onClose={() => setStageModal(null)} title="Update Stage" width={400}>
        {stageModal && (
          <div>
            <div className="text-xs text-cream-muted mb-3">
              Moving <strong>{stageModal.deal_name}</strong> from <strong>{stageModal.current_stage || "Lead"}</strong>
            </div>
            <div className="flex flex-col gap-2 mb-4">
              {STAGES.filter((s) => s !== stageModal.current_stage).map((s) => {
                const sc = stageColors[s];
                return (
                  <button
                    key={s}
                    onClick={() => setNewStage(s)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all"
                    style={{
                      borderRadius: 4,
                      background: newStage === s ? sc.bg : "rgba(255,255,255,0.03)",
                      border: newStage === s ? `1px solid ${sc.border}` : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className="w-2.5 h-2.5 inline-block" style={{ borderRadius: 2, background: sc.t }} />
                    <span className="text-xs font-semibold" style={{ color: newStage === s ? sc.t : "rgba(240,237,228,0.8)" }}>{s}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button style={btnSecondary} onClick={() => setStageModal(null)}>Cancel</button>
              <button
                style={{ ...btnPrimary, opacity: !newStage ? 0.5 : 1 }}
                disabled={!newStage}
                onClick={handleStageChange}
              >
                Move to {newStage || "..."}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Mark Dead Modal ─────────────────────────────── */}
      <Modal open={!!deadModal} onClose={() => setDeadModal(null)} title="Mark Deal as Dead" width={440}>
        {deadModal && (
          <div>
            <div className="text-xs text-cream-muted mb-3">
              Why is <strong>{deadModal.deal_name}</strong> dead?
            </div>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={deadReason}
              onChange={(e) => setDeadReason(e.target.value)}
              placeholder="Lost to competitor, buyer walked, financing fell through..."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button style={btnSecondary} onClick={() => setDeadModal(null)}>Cancel</button>
              <button
                style={{ ...btnPrimary, background: "linear-gradient(135deg, #E74C3C, #E74C3CCC)", boxShadow: "0 3px 16px rgba(231,76,60,0.35)" }}
                onClick={handleMarkDead}
              >
                Mark Dead
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Notes Modal ─────────────────────────────────── */}
      <Modal open={!!notesModal} onClose={() => setNotesModal(null)} title="Deal Notes" width={500}>
        {notesModal && (
          <div>
            <div className="text-xs text-cream-muted mb-2">{notesModal.deal_name}</div>
            <textarea
              style={{ ...inputStyle, minHeight: 160, resize: "vertical" }}
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Add notes about this deal — calls, meetings, next steps..."
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button style={btnSecondary} onClick={() => setNotesModal(null)}>Cancel</button>
              <button style={btnPrimary} onClick={handleSaveNotes}>Save Notes</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Edit Deal Modal ─────────────────────────────── */}
      <Modal open={!!editDeal} onClose={() => setEditDeal(null)} title="Edit Deal" width={580}>
        {editDeal && (
          <div>
            <FormField label="Deal Name *">
              <input style={inputStyle} value={editForm.deal_name} onChange={(e) => editSet("deal_name", e.target.value)} />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <FormField label="Deal Type">
                <select style={selectStyle} value={editForm.deal_type} onChange={(e) => editSet("deal_type", e.target.value)}>
                  <option value="sale">Sale</option>
                  <option value="lease">Lease</option>
                </select>
              </FormField>
              <FormField label="Expected Close">
                <input style={inputStyle} type="date" value={editForm.expected_close} onChange={(e) => editSet("expected_close", e.target.value)} />
              </FormField>
              <FormField label="Property">
                <select style={selectStyle} value={editForm.property_id} onChange={(e) => editSet("property_id", e.target.value)}>
                  <option value="">— None —</option>
                  {editProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </FormField>
              <FormField label="Client Contact">
                <select style={selectStyle} value={editForm.client_contact_id} onChange={(e) => editSet("client_contact_id", e.target.value)}>
                  <option value="">— None —</option>
                  {editContacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </FormField>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 14px" }}>
              <FormField label="Price ($)">
                <input style={inputStyle} type="number" value={editForm.price} onChange={(e) => editSet("price", e.target.value)} />
              </FormField>
              <FormField label="Commission %">
                <input style={inputStyle} type="number" step="0.1" value={editForm.commission_pct} onChange={(e) => editSet("commission_pct", e.target.value)} />
              </FormField>
              <FormField label="Probability %">
                <input style={inputStyle} type="number" value={editForm.probability_pct} onChange={(e) => editSet("probability_pct", e.target.value)} />
              </FormField>
            </div>
            <FormField label="Notes">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={editForm.notes} onChange={(e) => editSet("notes", e.target.value)} />
            </FormField>

            {/* Live preview */}
            <div className="glass-inner px-3 py-2.5 mb-3">
              <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1.5">Commission Preview</div>
              <div className="flex gap-4 text-xs tnum">
                {(() => {
                  const p = parseFloat(editForm.price) || 0;
                  const cp = parseFloat(editForm.commission_pct) / 100 || 0;
                  const pp = parseFloat(editForm.probability_pct) / 100 || 0;
                  return (
                    <>
                      <span>Est: <span className="font-bold" style={{ color: C.coral }}>{fmtF(p * cp)}</span></span>
                      <span>Weighted: <span className="font-bold" style={{ color: C.teal }}>{fmtF(p * cp * pp)}</span></span>
                    </>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
              <button type="button" style={btnSecondary} onClick={() => setEditDeal(null)}>Cancel</button>
              <button
                style={{ ...btnPrimary, opacity: editSaving ? 0.6 : 1 }}
                disabled={editSaving}
                onClick={handleEditSave}
              >
                {editSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirmation ─────────────────────────── */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Deal" width={400}>
        {deleteConfirm && (
          <div>
            <div className="text-xs text-cream-muted mb-4">
              Are you sure you want to permanently delete <strong>{deleteConfirm.deal_name}</strong>? This cannot be undone.
            </div>
            <div className="flex justify-end gap-2">
              <button style={btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button
                style={{ ...btnPrimary, background: "linear-gradient(135deg, #E74C3C, #E74C3CCC)", boxShadow: "0 3px 16px rgba(231,76,60,0.35)" }}
                onClick={handleDelete}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
