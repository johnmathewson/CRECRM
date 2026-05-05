"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import InboxList, { type LeadRow } from "./inbox-list";
import InboxOverview from "./inbox-overview";
import LeadDetailContent from "./lead-detail-content";

interface Props {
  selectedLeadId?: string;
}

export type StatusFilter =
  | "active"
  | "hot"
  | "today"
  | "unmatched"
  | "promoted"
  | "spam"
  | "archived"
  | "all";

export interface PropertyOption {
  id: string;
  label: string;
  count: number;
}

const C = {
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

export default function InboxSplitView({ selectedLeadId }: Props) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [propertyFilter, setPropertyFilter] = useState<string>("all"); // "all" or property id or "unmatched"
  const [seedingFixture, setSeedingFixture] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("leads")
      .select(`
        id, source, status, intent, urgency,
        sender_name, sender_email, sender_phone,
        property_label, qualifier_summary, raw_subject, raw_body,
        draft_reply, final_sent_at, auto_ack_sent_at,
        property_id, linked_deal_id, created_at,
        property:properties(id, name, headline)
      `)
      .order("created_at", { ascending: false })
      .limit(300);

    // Pill-driven filter behavior:
    //   "active"   → everything not archived/spam (the daily working view)
    //   "archived" → only archived
    //   "spam"     → only spam
    //   "all"      → everything
    //   anything else (legacy) → fall back to active
    if (statusFilter === "active" || statusFilter === "hot" || statusFilter === "today" || statusFilter === "unmatched" || statusFilter === "promoted") {
      query = query.not("status", "in", '("spam","archived")');
    } else if (statusFilter === "archived") {
      query = query.eq("status", "archived");
    } else if (statusFilter === "spam") {
      query = query.eq("status", "spam");
    }
    // "all" — no status filter

    if (propertyFilter === "unmatched") {
      query = query.is("property_id", null);
    } else if (propertyFilter !== "all") {
      query = query.eq("property_id", propertyFilter);
    }

    const { data } = await query;
    setLeads((data as any) || []);
    setLoading(false);
  }, [statusFilter, propertyFilter]);

  useEffect(() => { load(); }, [load]);

  // Derive property options from leads (so the dropdown only shows properties
  // that actually have leads; otherwise it'd be a giant unfiltered list).
  const propertyOptions = useMemo<PropertyOption[]>(() => {
    const map = new Map<string, { label: string; count: number }>();
    let unmatched = 0;
    for (const lead of leads) {
      if (lead.property?.id) {
        const existing = map.get(lead.property.id);
        const label = lead.property.headline || lead.property.name || "(unnamed)";
        if (existing) existing.count += 1;
        else map.set(lead.property.id, { label, count: 1 });
      } else {
        unmatched += 1;
      }
    }
    const opts: PropertyOption[] = Array.from(map.entries()).map(([id, v]) => ({ id, label: v.label, count: v.count }));
    opts.sort((a, b) => b.count - a.count);
    if (unmatched > 0) opts.unshift({ id: "unmatched", label: "Unmatched (no CRM property)", count: unmatched });
    return opts;
  }, [leads]);

  async function seed(fixture: string) {
    setSeedingFixture(fixture);
    setSeedError(null);
    try {
      const res = await fetch("/api/leads/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixture }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setSeedError(body.error || `Failed (${res.status})`);
      else await load();
    } catch (e: any) {
      setSeedError(e.message || "Seed failed");
    } finally {
      setSeedingFixture(null);
    }
  }

  return (
    <div
      className="flex w-full"
      style={{ height: "calc(100vh - 56px)" }}
    >
      {/* List pane — full width on mobile when no detail; 380px on desktop always */}
      <aside
        className={`
          ${selectedLeadId ? "hidden lg:flex" : "flex"}
          flex-col w-full lg:w-[380px] lg:max-w-[380px] flex-shrink-0
          lg:border-r overflow-hidden
        `}
        style={{ borderColor: "rgba(255,255,255,0.05)" }}
      >
        <InboxList
          leads={leads}
          loading={loading}
          selectedLeadId={selectedLeadId}
          statusFilter={statusFilter}
          propertyFilter={propertyFilter}
          propertyOptions={propertyOptions}
          onStatusFilterChange={setStatusFilter}
          onPropertyFilterChange={setPropertyFilter}
          onLeadsChanged={load}
          seedingFixture={seedingFixture}
          seedError={seedError}
          onSeed={seed}
        />
      </aside>

      {/* Right pane — detail when selected; overview (all leads) when not */}
      <section
        className={`
          ${selectedLeadId ? "flex" : "hidden lg:flex"}
          flex-col flex-1 overflow-hidden
        `}
      >
        {selectedLeadId ? (
          <LeadDetailContent leadId={selectedLeadId} mode="pane" />
        ) : (
          <InboxOverview
            leads={leads}
            loading={loading}
            statusFilter={statusFilter}
            propertyFilter={propertyFilter}
            propertyOptions={propertyOptions}
          />
        )}
      </section>
    </div>
  );
}
