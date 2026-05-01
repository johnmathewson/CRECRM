/**
 * Agent intel: gather real CRM data the drafting model can reference instead
 * of fabricating market specifics.
 *
 * Data sources used:
 *   - properties        — matched listing's full facts; relevant active inventory
 *   - sale_comps        — recent transactions near the property (PostGIS)
 *   - lease_comps       — recent leases near the property
 *   - find_nearby_comps  RPC — does the geo + asset_type query for both
 *   - communications    — prior conversations with this contact
 *
 * The output is fed into the Sonnet drafting prompt as a "GROUND TRUTH"
 * block. The model is allowed (and encouraged) to cite anything in this
 * block; everything else is off-limits.
 *
 * Confidentiality note: lease comps may include tenant names from rent
 * rolls John has worked with privately. We pass aggregates + ranges to
 * the model and explicitly tell it NOT to share specific tenant names.
 */

import { geocodeAddress } from "./geocoder";
import type { NearbyComp } from "./valuation-engine";

// ── Types ───────────────────────────────────────────────────────────────────

export interface MatchedPropertyContext {
  id: string;
  name: string | null;
  headline: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  transaction_type: string | null;
  status: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  acreage: number | null;
  year_built: number | null;
  noi: number | null;
  cap_rate: number | null;
  price_per_sf: number | null;
  occupancy_pct: number | null;
  parking_spaces: number | null;
  zoning: string | null;
  description: string | null;
  highlights: string[] | null;
  slug: string | null;
}

export interface CompSummary {
  mode: "sale" | "lease";
  count: number;
  radiusMiles: number;
  assetTypeFilter: string | null;
  geoSource: "matched-property" | "geocoded-city" | "none";
  geoLabel: string;
  median: {
    pricePerSqft?: number;
    capRate?: number;
    rentPerSqft?: number;
    sqft?: number;
  };
  range: {
    pricePerSqft?: { low: number; high: number };
    capRate?: { low: number; high: number };
    rentPerSqft?: { low: number; high: number };
  };
  recent: Array<{
    address: string;
    city: string;
    state: string;
    asset_type: string;
    distance_miles: number;
    sqft: number | null;
    price_per_sqft?: number | null;
    cap_rate?: number | null;
    rent_per_sqft?: number | null;
    lease_type?: string | null;
    sale_date?: string | null;
    lease_date?: string | null;
    year_built?: number | null;
  }>;
}

export interface ActiveInventoryItem {
  id: string;
  name: string;
  headline: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  asset_type: string | null;
  transaction_type: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  slug: string | null;
}

export interface ContactHistoryContext {
  isNew: boolean;
  totalConversations: number;
  lastConversation?: string;
  warmth?: string | null;
  notableNotes?: string | null;
  priorLeadCount: number;
}

export interface AgentIntel {
  matchedProperty: MatchedPropertyContext | null;
  saleComps: CompSummary | null;
  leaseComps: CompSummary | null;
  activeInventory: ActiveInventoryItem[];
  contactHistory: ContactHistoryContext | null;
  notes: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function lowHigh(values: number[]): { low: number; high: number } | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  // Trim outliers if we have enough samples
  const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return { low: trimmed[0], high: trimmed[trimmed.length - 1] };
}

function summarizeComps(
  comps: NearbyComp[],
  mode: "sale" | "lease",
  radiusMiles: number,
  assetTypeFilter: string | null,
  geoSource: CompSummary["geoSource"],
  geoLabel: string
): CompSummary | null {
  if (comps.length === 0) return null;

  const filtered = comps.filter(c => c.comp_type === mode);
  if (filtered.length === 0) return null;

  if (mode === "sale") {
    const psf = filtered.map(c => c.price_per_sqft).filter((v): v is number => !!v && v > 0);
    const caps = filtered.map(c => c.cap_rate).filter((v): v is number => !!v && v > 0);
    const sqfts = filtered.map(c => c.sqft).filter((v): v is number => !!v && v > 0);

    return {
      mode,
      count: filtered.length,
      radiusMiles,
      assetTypeFilter,
      geoSource,
      geoLabel,
      median: {
        pricePerSqft: median(psf),
        capRate: median(caps),
        sqft: median(sqfts),
      },
      range: {
        pricePerSqft: lowHigh(psf),
        capRate: lowHigh(caps),
      },
      recent: filtered
        .filter(c => c.sale_date)
        .sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""))
        .slice(0, 4)
        .map(c => ({
          address: c.address,
          city: c.city,
          state: c.state,
          asset_type: c.asset_type,
          distance_miles: c.distance_miles,
          sqft: c.sqft,
          price_per_sqft: c.price_per_sqft,
          cap_rate: c.cap_rate,
          sale_date: c.sale_date,
          year_built: c.year_built,
        })),
    };
  } else {
    const rents = filtered.map(c => c.rent_per_sqft).filter((v): v is number => !!v && v > 0);
    const sqfts = filtered.map(c => c.sqft).filter((v): v is number => !!v && v > 0);

    return {
      mode,
      count: filtered.length,
      radiusMiles,
      assetTypeFilter,
      geoSource,
      geoLabel,
      median: {
        rentPerSqft: median(rents),
        sqft: median(sqfts),
      },
      range: {
        rentPerSqft: lowHigh(rents),
      },
      recent: filtered
        .filter(c => c.lease_date)
        .sort((a, b) => (b.lease_date || "").localeCompare(a.lease_date || ""))
        .slice(0, 4)
        .map(c => ({
          address: c.address,
          city: c.city,
          state: c.state,
          asset_type: c.asset_type,
          distance_miles: c.distance_miles,
          sqft: c.sqft,
          rent_per_sqft: c.rent_per_sqft,
          lease_type: c.lease_type,
          lease_date: c.lease_date,
        })),
    };
  }
}

async function fetchCompsNearLatLng(
  supabase: any,
  lat: number,
  lng: number,
  assetType: string | null
): Promise<{ comps: NearbyComp[]; radiusMiles: number; assetTypeUsed: string | null }> {
  // Try increasing radius until we have enough samples
  for (const radius of [3, 5, 10]) {
    const { data } = await supabase.rpc("find_nearby_comps", {
      p_lat: lat,
      p_lng: lng,
      p_radius_miles: radius,
      p_asset_type: assetType,
      p_limit: 60,
    });
    if (data && data.length >= 5) {
      return { comps: data as NearbyComp[], radiusMiles: radius, assetTypeUsed: assetType };
    }
  }
  // Fall back to no asset-type filter at 10mi
  if (assetType) {
    const { data } = await supabase.rpc("find_nearby_comps", {
      p_lat: lat,
      p_lng: lng,
      p_radius_miles: 10,
      p_asset_type: null,
      p_limit: 60,
    });
    if (data && data.length > 0) {
      return { comps: data as NearbyComp[], radiusMiles: 10, assetTypeUsed: null };
    }
  }
  return { comps: [], radiusMiles: 10, assetTypeUsed: assetType };
}

// ── Main orchestrator ──────────────────────────────────────────────────────

interface GatherIntelOpts {
  supabase: any;
  organizationId: string;
  matchedPropertyId: string | null;
  contactId: string | null;
  qualification: {
    intent: string | null;
    property_label: string | null;
    sender_name_clean?: string | null;
    qualifier_summary?: string;
  };
  rawSubject?: string | null;
  rawBody?: string | null;
}

export async function gatherIntel(opts: GatherIntelOpts): Promise<AgentIntel> {
  const { supabase, organizationId, matchedPropertyId, contactId, qualification } = opts;
  const notes: string[] = [];

  // ── 1. Matched property full facts ───────────────────────────────────────
  let matchedProperty: MatchedPropertyContext | null = null;
  let propertyLat: number | null = null;
  let propertyLng: number | null = null;

  if (matchedPropertyId) {
    const { data } = await supabase
      .from("properties")
      .select(`
        id, name, headline, address, city, state, zip,
        asset_type, transaction_type, status,
        asking_price, lease_rate, sqft, acreage, year_built,
        noi, cap_rate, price_per_sf, occupancy_pct,
        parking_spaces, zoning, description, highlights, slug
      `)
      .eq("id", matchedPropertyId)
      .maybeSingle();
    if (data) {
      matchedProperty = data as MatchedPropertyContext;
      // Geocode the matched property's address so we can pull comps near it.
      // Direct geocode is cleaner than wrestling Supabase's WKB-encoded geography column.
      if (data.address) {
        const fullAddr = [data.address, data.city, data.state].filter(Boolean).join(", ");
        const geocoded = await geocodeAddress(fullAddr);
        if (geocoded) {
          propertyLat = geocoded.lat;
          propertyLng = geocoded.lng;
        }
      }
    }
  }

  // ── 2. If unmatched, try to geocode the prospect's mentioned property ──
  let geoLabel = "no geo";
  let geoSource: CompSummary["geoSource"] = "none";

  if (matchedProperty && propertyLat && propertyLng) {
    geoLabel = `${matchedProperty.address || ""}, ${matchedProperty.city || ""}, ${matchedProperty.state || ""}`.replace(/^, |, $/g, "");
    geoSource = "matched-property";
  } else if (qualification.property_label) {
    // Try to geocode the label (e.g. "Crown Point", "Westville industrial building")
    const geocoded = await geocodeAddress(`${qualification.property_label}, Indiana`);
    if (geocoded) {
      propertyLat = geocoded.lat;
      propertyLng = geocoded.lng;
      geoLabel = qualification.property_label;
      geoSource = "geocoded-city";
    } else {
      notes.push(`Could not geocode property label "${qualification.property_label}"`);
    }
  } else if (opts.rawBody) {
    // Look for "<city>, IN" pattern in raw body as last resort
    const cityMatch = opts.rawBody.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?),?\s+(IN|Indiana|IL|Illinois)\b/);
    if (cityMatch) {
      const geocoded = await geocodeAddress(`${cityMatch[1]}, ${cityMatch[2]}`);
      if (geocoded) {
        propertyLat = geocoded.lat;
        propertyLng = geocoded.lng;
        geoLabel = `${cityMatch[1]}, ${cityMatch[2]}`;
        geoSource = "geocoded-city";
        notes.push(`Pulled comps near "${geoLabel}" inferred from inbound text`);
      }
    }
  }

  // ── 3. Pull comps if we have a geo anchor ────────────────────────────────
  let saleComps: CompSummary | null = null;
  let leaseComps: CompSummary | null = null;

  if (propertyLat !== null && propertyLng !== null) {
    const assetType = matchedProperty?.asset_type || inferAssetTypeFromIntent(qualification);
    const { comps, radiusMiles, assetTypeUsed } = await fetchCompsNearLatLng(
      supabase,
      propertyLat,
      propertyLng,
      assetType
    );
    if (comps.length > 0) {
      saleComps = summarizeComps(comps, "sale", radiusMiles, assetTypeUsed, geoSource, geoLabel);
      leaseComps = summarizeComps(comps, "lease", radiusMiles, assetTypeUsed, geoSource, geoLabel);
    } else {
      notes.push(`No comps found near ${geoLabel}`);
    }
  } else {
    notes.push("No geographic anchor — skipped comp lookup");
  }

  // ── 4. Active inventory (relevant to lead's intent + asset type) ─────────
  const activeInventory = await getRelevantActiveInventory(
    supabase,
    organizationId,
    qualification,
    matchedProperty
  );

  // ── 5. Contact history ───────────────────────────────────────────────────
  let contactHistory: ContactHistoryContext | null = null;
  if (contactId) {
    contactHistory = await getContactHistory(supabase, organizationId, contactId);
  }

  return {
    matchedProperty,
    saleComps,
    leaseComps,
    activeInventory,
    contactHistory,
    notes,
  };
}

function inferAssetTypeFromIntent(q: GatherIntelOpts["qualification"]): string | null {
  // Asset type isn't always in the qualification result. Scan label + summary
  // for hints. Keep it simple — the matcher will already have done the heavy
  // lifting if there was a match.
  const haystack = `${q.property_label || ""} ${q.qualifier_summary || ""}`.toLowerCase();
  if (/industrial|warehouse|flex|distribution/.test(haystack)) return "industrial";
  if (/retail|strip|anchor|shopping/.test(haystack)) return "retail";
  if (/office|professional/.test(haystack)) return "office";
  if (/multifamily|apartment|unit/.test(haystack)) return "multifamily";
  if (/medical|healthcare|clinic/.test(haystack)) return "medical";
  if (/restaurant|food/.test(haystack)) return "restaurant";
  if (/hotel|hospitality/.test(haystack)) return "hotel";
  if (/land|acre|raw/.test(haystack)) return "land";
  return null;
}

async function getRelevantActiveInventory(
  supabase: any,
  organizationId: string,
  qualification: GatherIntelOpts["qualification"],
  matchedProperty: MatchedPropertyContext | null
): Promise<ActiveInventoryItem[]> {
  // Skip if matched — agent should focus on the matched listing, not push other inventory.
  if (matchedProperty) return [];

  const assetType = inferAssetTypeFromIntent(qualification);
  let query = supabase
    .from("properties")
    .select("id, name, headline, address, city, state, asset_type, transaction_type, asking_price, lease_rate, sqft, slug")
    .eq("organization_id", organizationId)
    .eq("publish_to_website", true)
    .in("status", ["listed", "for_lease", "under_contract"])
    .order("updated_at", { ascending: false })
    .limit(6);

  if (assetType) {
    query = query.eq("asset_type", assetType);
  }
  // If lead is buy-only, filter to sale; if lease-only, filter to lease.
  if (qualification.intent === "buy") {
    query = query.in("transaction_type", ["sale", "sale_or_lease"]);
  } else if (qualification.intent === "lease") {
    query = query.in("transaction_type", ["lease", "sale_or_lease"]);
  }

  const { data } = await query;
  return (data as any) || [];
}

async function getContactHistory(
  supabase: any,
  organizationId: string,
  contactId: string
): Promise<ContactHistoryContext> {
  const [{ data: contact }, { data: comms, count: commsCount }, { data: priorLeads, count: priorLeadsCount }] =
    await Promise.all([
      supabase.from("contacts").select("warmth, last_conversation, notes").eq("id", contactId).maybeSingle(),
      supabase
        .from("communications")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contactId),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId),
    ]);

  const totalConversations = commsCount || 0;
  const priorLeadCount = (priorLeadsCount || 1) - 1; // subtract the current one being created

  return {
    isNew: priorLeadCount === 0 && totalConversations <= 1,
    totalConversations,
    lastConversation: contact?.last_conversation || undefined,
    warmth: contact?.warmth || null,
    notableNotes: contact?.notes || null,
    priorLeadCount: Math.max(0, priorLeadCount),
  };
}

// ── Format for prompt ──────────────────────────────────────────────────────

export function formatIntelForPrompt(intel: AgentIntel): string {
  const lines: string[] = ["GROUND TRUTH CONTEXT:"];
  lines.push(
    "(You may cite any number, fact, or detail in this block. You may NOT invent additional specifics outside what's listed here. Aggregates like medians and ranges are fair to share with the prospect; tenant names from lease comps are confidential and must not be shared.)"
  );
  lines.push("");

  // ── Matched property ──
  if (intel.matchedProperty) {
    const p = intel.matchedProperty;
    lines.push("Matched property in CRM (use these facts when discussing this listing):");
    lines.push(`  · Name: ${p.headline || p.name || "(unnamed)"}`);
    if (p.slug) lines.push(`  · Vault link: https://stewardshipcre.com/properties/${p.slug}/inquire`);
    lines.push(`  · Address: ${[p.address, p.city, p.state, p.zip].filter(Boolean).join(", ")}`);
    if (p.asset_type) lines.push(`  · Asset type: ${p.asset_type}${p.transaction_type ? ` · ${p.transaction_type}` : ""}`);
    if (p.sqft) lines.push(`  · Building: ${p.sqft.toLocaleString()} SF${p.year_built ? ` · built ${p.year_built}` : ""}`);
    if (p.acreage) lines.push(`  · Lot: ${p.acreage} acres`);
    if (p.asking_price) lines.push(`  · Asking price: $${p.asking_price.toLocaleString()}`);
    if (p.lease_rate) lines.push(`  · Lease rate: $${p.lease_rate}/SF/yr`);
    if (p.noi) lines.push(`  · NOI: $${p.noi.toLocaleString()}`);
    if (p.cap_rate) lines.push(`  · Cap rate: ${p.cap_rate}%`);
    if (p.occupancy_pct !== null && p.occupancy_pct !== undefined) lines.push(`  · Occupancy: ${p.occupancy_pct}%`);
    if (p.price_per_sf) lines.push(`  · Price/SF: $${p.price_per_sf}`);
    if (p.zoning) lines.push(`  · Zoning: ${p.zoning}`);
    if (p.parking_spaces) lines.push(`  · Parking: ${p.parking_spaces} spaces`);
    if (p.description) lines.push(`  · Description: ${p.description}`);
    if (Array.isArray(p.highlights) && p.highlights.length > 0) {
      lines.push(`  · Highlights: ${p.highlights.join(" · ")}`);
    }
    lines.push("");
  } else {
    lines.push("Matched property: NONE — the matcher couldn't tie this inquiry to a CRM listing. Don't fabricate one.");
    lines.push("");
  }

  // ── Sale comps ──
  if (intel.saleComps) {
    const c = intel.saleComps;
    lines.push(
      `Sale comps (${c.count} trades within ${c.radiusMiles} mi of ${c.geoLabel}${c.assetTypeFilter ? `, ${c.assetTypeFilter}` : ", all asset types"}):`
    );
    if (c.median.pricePerSqft) lines.push(`  · Median $/SF: $${c.median.pricePerSqft.toFixed(0)}`);
    if (c.median.capRate) lines.push(`  · Median cap rate: ${c.median.capRate.toFixed(2)}%`);
    if (c.range.pricePerSqft) lines.push(`  · $/SF range: $${c.range.pricePerSqft.low.toFixed(0)}–$${c.range.pricePerSqft.high.toFixed(0)}`);
    if (c.range.capRate) lines.push(`  · Cap rate range: ${c.range.capRate.low.toFixed(2)}–${c.range.capRate.high.toFixed(2)}%`);
    if (c.recent.length > 0) {
      lines.push("  · Recent trades (anonymized — DO NOT cite buyer/seller names to prospects):");
      for (const r of c.recent.slice(0, 3)) {
        const parts = [
          r.sale_date ? r.sale_date.slice(0, 7) : "—",
          r.asset_type,
          r.sqft ? `${r.sqft.toLocaleString()} SF` : "",
          r.price_per_sqft ? `$${r.price_per_sqft.toFixed(0)}/SF` : "",
          r.cap_rate ? `${r.cap_rate.toFixed(2)}% cap` : "",
        ].filter(Boolean);
        lines.push(`    – ${parts.join(" · ")}`);
      }
    }
    lines.push("");
  } else {
    lines.push("Sale comps: none available for this geo.");
    lines.push("");
  }

  // ── Lease comps ──
  if (intel.leaseComps) {
    const c = intel.leaseComps;
    lines.push(
      `Lease comps (${c.count} leases within ${c.radiusMiles} mi of ${c.geoLabel}${c.assetTypeFilter ? `, ${c.assetTypeFilter}` : ", all asset types"}):`
    );
    if (c.median.rentPerSqft) lines.push(`  · Median rent: $${c.median.rentPerSqft.toFixed(2)}/SF/yr`);
    if (c.range.rentPerSqft) lines.push(`  · Rent range: $${c.range.rentPerSqft.low.toFixed(2)}–$${c.range.rentPerSqft.high.toFixed(2)}/SF/yr`);
    if (c.recent.length > 0) {
      lines.push("  · Recent leases (anonymized — DO NOT cite tenant names to prospects):");
      for (const r of c.recent.slice(0, 3)) {
        const parts = [
          r.lease_date ? r.lease_date.slice(0, 7) : "—",
          r.asset_type,
          r.sqft ? `${r.sqft.toLocaleString()} SF` : "",
          r.rent_per_sqft ? `$${r.rent_per_sqft.toFixed(2)}/SF` : "",
          r.lease_type || "",
        ].filter(Boolean);
        lines.push(`    – ${parts.join(" · ")}`);
      }
    }
    lines.push("");
  } else {
    lines.push("Lease comps: none available for this geo.");
    lines.push("");
  }

  // ── Active inventory ──
  if (intel.activeInventory.length > 0) {
    lines.push(`Other relevant Stewardship CRE inventory (${intel.activeInventory.length} listing${intel.activeInventory.length > 1 ? "s" : ""}):`);
    for (const inv of intel.activeInventory) {
      const parts = [
        inv.headline || inv.name,
        [inv.city, inv.state].filter(Boolean).join(", "),
        inv.asset_type,
        inv.sqft ? `${inv.sqft.toLocaleString()} SF` : "",
        inv.asking_price ? `$${inv.asking_price.toLocaleString()}` : "",
        inv.lease_rate ? `$${inv.lease_rate}/SF` : "",
      ].filter(Boolean);
      lines.push(`  · ${parts.join(" · ")}`);
    }
    lines.push("(You may mention these if relevant to the prospect's criteria. Don't oversell.)");
    lines.push("");
  } else if (!intel.matchedProperty) {
    lines.push("Active inventory: nothing matching this prospect's criteria in the CRM right now.");
    lines.push("");
  }

  // ── Contact history ──
  if (intel.contactHistory) {
    const ch = intel.contactHistory;
    if (ch.isNew) {
      lines.push("Contact: NEW prospect — no prior history with this person.");
    } else {
      const parts: string[] = [];
      parts.push(`${ch.priorLeadCount} prior lead${ch.priorLeadCount !== 1 ? "s" : ""}`);
      parts.push(`${ch.totalConversations} prior message${ch.totalConversations !== 1 ? "s" : ""}`);
      if (ch.warmth) parts.push(`warmth: ${ch.warmth}`);
      if (ch.lastConversation) parts.push(`last contact: ${ch.lastConversation}`);
      lines.push(`Contact: RETURNING — ${parts.join(", ")}.`);
      if (ch.notableNotes) lines.push(`  · CRM note: ${ch.notableNotes.slice(0, 200)}`);
    }
    lines.push("");
  }

  // ── Diagnostic notes (mostly for our debugging) ──
  if (intel.notes.length > 0) {
    lines.push(`(intel notes: ${intel.notes.join(" · ")})`);
  }

  return lines.join("\n");
}
