"use client";

import { useEffect, useState } from "react";
import { ZONING, ZONING_FALLBACK, LISTING } from "./map-theme";

/**
 * Parcel card — right panel on desktop, bottom sheet on phones.
 * Tabs: Overview (public) · Owner · Sales · Permits (registered).
 */

export type Sale = { date: number | null; price: number | null; buyer: string | null; buyer_city: string | null; seller: string | null; valid: string | null; multi: string | null };
export type Permit = { num: string | null; date: number | null; cost: number | null; type: string | null; desc: string | null };

export type Listing = {
  id: string; pid: string | null; source: string; url: string | null; kind: "sale" | "lease" | "both"; status: string;
  title: string | null; address: string | null; price: number | null; price_text: string | null; lease_rate_text: string | null;
  sqft: number | null; acres: number | null; asset_type: string | null; broker_company: string | null; photo_url: string | null;
  first_seen_at: string; last_seen_at: string;
};

export type Business = {
  id: string; name: string; brand: string | null; category: string | null; type_label: string | null; description: string | null;
  address: string | null; phone: string | null; website: string | null; status: "open" | "closed" | "unknown"; confidence: number | null;
  sources: Array<{ source: string; id: string }>; last_seen_at: string;
};

export type ParcelProps = {
  pid: string; address: string | null; acres: number | null; class: string | null; class_code: string | null;
  zoning: string | null; flu: string | null; tif: string | null; flood: string | null; historic: string | null;
  legal: string | null; transfer_date: number | null;
  owner: string | null; mail: string | null; mail_city: string | null; mail_state: string | null; mail_zip: string | null;
  deduction: string | null; av_total: number | null; av_land: number | null; av_impr: number | null; conveyance: string | null;
  sales: Sale[]; permits: Permit[];
  businesses?: Business[];
};

type Tab = "overview" | "owner" | "sales" | "permits";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const dt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const sqft = (ac: number | null) => (ac == null ? null : Math.round(ac * 43560).toLocaleString());

export function ParcelCard({
  p, registered, mobile, loading, ownerParcels, ownerHighlighted, listings = [], onClose, onRegister, onZoom, onShare, onHighlightOwner, onAsk,
}: {
  p: ParcelProps; registered: boolean; mobile: boolean; loading?: boolean; ownerParcels: number | null; ownerHighlighted: boolean; listings?: Listing[];
  onClose: () => void; onRegister: () => void; onZoom: () => void; onShare: () => void; onHighlightOwner: () => void; onAsk: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => { setTab("overview"); }, [p.pid]);

  const z = p.zoning ? ZONING[p.zoning] : null;
  const homestead = (p.deduction || "").toLowerCase().includes("homestead");
  const lastSale = p.sales?.[0];
  const perAcre = p.av_total && p.acres ? p.av_total / p.acres : null;

  const tabBtn = (t: Tab, label: string, locked?: boolean) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`relative flex-1 py-2.5 text-[13px] font-semibold ${tab === t ? "text-blue-700" : "text-slate-500 hover:text-slate-800"}`}
    >
      {label}{locked && <span className="ml-1 text-[10px] text-slate-400">🔒</span>}
      {tab === t && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-blue-600" />}
    </button>
  );

  return (
    <aside
      className={
        mobile
          ? "absolute inset-x-0 bottom-0 z-20 flex max-h-[68dvh] flex-col rounded-t-[14px] bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)]"
          : "absolute bottom-4 right-4 top-[68px] z-20 flex w-[420px] flex-col rounded-[12px] bg-white shadow-xl ring-1 ring-slate-900/5"
      }
    >
      {mobile && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />}

      {/* Header */}
      <div className="px-4 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[11px] font-bold" style={{ background: z?.fill ?? ZONING_FALLBACK, color: "#0F172A" }}>
                {p.zoning ?? "No zoning"}
              </span>
              {z && <span className="truncate text-[12px] text-slate-500">{z.label}</span>}
            </div>
            <h2 className="mt-1 truncate text-[18px] font-bold leading-tight text-slate-900">{p.address || "No situs address"}{loading && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 align-middle" />}</h2>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-500">
              <span className="font-mono">{p.pid}</span>
              <button onClick={() => navigator.clipboard?.writeText(p.pid)} className="rounded-[4px] px-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Copy parcel number">copy</button>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-800">✕</button>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          <IconBtn onClick={onZoom} label="Zoom to" />
          <IconBtn onClick={onShare} label="Copy link" />
          {registered && p.owner && <IconBtn onClick={onHighlightOwner} label={ownerHighlighted ? "Clear owner" : ownerParcels == null ? "Owner's parcels" : `Owner's ${ownerParcels} parcel${ownerParcels === 1 ? "" : "s"}`} active={ownerHighlighted} />}
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-2 flex border-b border-slate-200 px-2">
        {tabBtn("overview", "Overview")}
        {tabBtn("owner", "Owner", !registered)}
        {tabBtn("sales", "Sales", !registered)}
        {tabBtn("permits", "Permits", !registered)}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "overview" && (
          <>
            {listings.length > 0 && (
              <div className="mb-3 space-y-2">
                {listings.map((l) => {
                  const c = LISTING[l.kind] ?? LISTING.sale;
                  const src = l.source === "crm" ? "Stewardship CRE" : l.source === "crexi" ? "CREXi" : l.source === "loopnet" ? "LoopNet" : l.source;
                  return (
                    <div key={l.id} className="overflow-hidden rounded-[10px] border" style={{ borderColor: c.fill, background: `${c.fill}14` }}>
                      {l.photo_url && (
                        <a href={l.url ?? undefined} target="_blank" rel="noreferrer" className="block">
                          <img src={l.photo_url} alt={l.title ?? "Listing photo"} className="h-[150px] w-full object-cover" loading="lazy" />
                        </a>
                      )}
                      <div className="flex items-start justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-[4px] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: c.fill }}>{c.label}{l.status === "under_contract" ? " · under contract" : ""}</span>
                            <span className="text-[11px] text-slate-500">via {src}</span>
                          </div>
                          <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">{l.title || l.address || "Listing"}</div>
                          <div className="text-[12px] text-slate-600">
                            {[l.asset_type, l.sqft ? `${l.sqft.toLocaleString()} SF` : null, l.acres ? `${l.acres} AC` : null, l.broker_company].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[16px] font-bold text-slate-900">{l.price_text || l.lease_rate_text || (l.price ? usd(l.price) : "Unpriced")}</div>
                          <div className="text-[11px] text-slate-500">seen {dt(Date.parse(l.last_seen_at))}</div>
                        </div>
                      </div>
                      {l.url && <a href={l.url} target="_blank" rel="noreferrer" className="mb-3 ml-3 inline-block text-[12px] font-semibold text-blue-700 hover:underline">View listing ↗</a>}
                    </div>
                  );
                })}
              </div>
            )}
            {p.businesses && p.businesses.length > 0 && (
              <div className="mb-3 rounded-[10px] border border-slate-200 bg-white">
                <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Businesses here</div>
                  <div className="text-[11px] text-slate-400">{p.businesses.filter((b) => b.status !== "closed").length} open{p.businesses.some((b) => b.status === "closed") ? ` · ${p.businesses.filter((b) => b.status === "closed").length} closed` : ""}</div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {p.businesses.map((b) => {
                    const src = b.sources.map((x) => x.source).filter((v, i, a) => a.indexOf(v) === i);
                    return (
                      <li key={b.id} className={`px-3 py-2 ${b.status === "closed" ? "opacity-60" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold text-slate-900">{b.name}{b.status === "closed" && <span className="ml-1.5 rounded-[4px] bg-red-100 px-1 py-px text-[10px] font-bold uppercase text-red-700">Closed</span>}</div>
                            <div className="truncate text-[12px] text-slate-600">{[b.type_label, b.description].filter(Boolean).join(" · ") || "Type not yet classified"}</div>
                            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                              {b.phone && <a href={`tel:${b.phone}`} className="hover:text-slate-800">{b.phone}</a>}
                              {b.website && <a href={b.website} target="_blank" rel="noreferrer" className="truncate hover:text-slate-800">{b.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-[10px] text-slate-400">
                            {src.includes("hobart_city") && <div className="rounded-[4px] bg-slate-100 px-1 py-px font-semibold text-slate-600">City license</div>}
                            {src.includes("overture") && <div className="mt-0.5">Overture</div>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {!p.businesses?.length && !loading && /^(4|3|6)/.test(p.class_code ?? "") && listings.length === 0 && (
              <div className="mb-3 rounded-[10px] border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                <span className="font-semibold">No business or listing found here.</span> Commercial-class parcel with no known occupant: a candidate for vacancy or under-use. Verify before acting.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Lot size" value={p.acres != null ? `${p.acres} ac` : "—"} sub={sqft(p.acres) ? `${sqft(p.acres)} sq ft` : undefined} />
              <Tile label="Future land use" value={p.flu ?? "—"} small />
              <Tile label="Property class" value={p.class ?? (p.class_code ? `Code ${p.class_code}` : "—")} sub={p.class && p.class_code ? `Code ${p.class_code}` : undefined} small />
              <Tile label="Flood zone" value={p.flood ? `FEMA ${p.flood}` : "None mapped"} sub={p.flood === "AE" ? "1% annual chance" : p.flood === "X" ? "Minimal risk" : undefined} small warn={p.flood === "AE"} />
            </div>
            <dl className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
              <Row k="TIF district" v={p.tif === "Yes" ? "In a TIF district" : p.tif ?? "None"} highlight={!!p.tif} />
              <Row k="Historic district" v={p.historic === "Yes" ? "Yes" : p.historic ?? "None"} highlight={!!p.historic} />
              <Row k="Last transfer" v={dt(p.transfer_date)} />
              <Row k="Legal description" v={p.legal ?? "—"} mono />
            </dl>
            {!registered && (
              <Unlock onRegister={onRegister} compact />
            )}
          </>
        )}

        {tab !== "overview" && !registered && <Unlock onRegister={onRegister} />}

        {tab !== "overview" && registered && loading && !p.owner && (
          <div className="space-y-2 py-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-[8px] bg-slate-100" />)}</div>
        )}
        {tab === "owner" && registered && (p.owner || !loading) && (
          <>
            <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Deeded owner</div>
              <div className="mt-0.5 text-[16px] font-bold leading-tight text-slate-900">{p.owner ?? "—"}</div>
              <div className="mt-1 text-[13px] text-slate-600">{[p.mail, [p.mail_city, p.mail_state].filter(Boolean).join(", "), p.mail_zip].filter(Boolean).join(" · ") || "—"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {homestead ? <Tag tone="green">Owner occupied</Tag> : <Tag tone="amber">Absentee</Tag>}
                {p.mail_state && p.mail_state !== "IN" && <Tag tone="amber">Out of state</Tag>}
                {(ownerParcels ?? 0) > 1 && <Tag tone="blue">{ownerParcels} parcels in Hobart</Tag>}
                {p.conveyance && <Tag>{p.conveyance}</Tag>}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Tile label="Assessed" value={usd(p.av_total)} />
              <Tile label="Land" value={usd(p.av_land)} />
              <Tile label="Improvements" value={usd(p.av_impr)} />
            </div>
            <dl className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
              <Row k="Assessed per acre" v={perAcre ? usd(perAcre) : "—"} />
              <Row k="Deductions" v={p.deduction ?? "None"} />
              <Row k="Last sale" v={lastSale ? `${usd(lastSale.price)} · ${dt(lastSale.date)}` : "None on county list"} />
            </dl>
            <button onClick={onHighlightOwner} className={`mt-3 w-full rounded-[8px] px-3 py-2.5 text-[13px] font-semibold ${ownerHighlighted ? "bg-amber-100 text-amber-900" : "bg-slate-900 text-white hover:bg-slate-800"}`}>
              {ownerHighlighted ? "Clear owner highlight" : ownerParcels == null ? "Highlight all parcels by this owner" : `Highlight all ${ownerParcels} parcel${ownerParcels === 1 ? "" : "s"} by this owner`}
            </button>
          </>
        )}

        {tab === "sales" && registered && !(loading && !p.owner) && (
          p.sales.length === 0 ? <Empty>No recorded sales on the county sales list.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {p.sales.map((s, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-slate-900">{s.buyer ?? "—"}</div>
                    <div className="truncate text-[12px] text-slate-500">from {s.seller ?? "—"}{s.buyer_city ? ` · buyer in ${s.buyer_city}` : ""}</div>
                    <div className="mt-1 flex gap-1.5">
                      {s.valid === "N" && <Tag tone="amber">Non-arm's-length</Tag>}
                      {s.multi === "Y" && <Tag>Multi-parcel</Tag>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold text-slate-900">{usd(s.price)}</div>
                    <div className="text-[12px] text-slate-500">{dt(s.date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "permits" && registered && !(loading && !p.owner) && (
          p.permits.length === 0 ? <Empty>No permits on the county tracker for this parcel.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {p.permits.map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-slate-900">{r.type ?? "Permit"}</div>
                    <div className="line-clamp-2 text-[12px] text-slate-500">{r.desc ?? r.num ?? ""}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold text-slate-900">{r.cost ? usd(r.cost) : "—"}</div>
                    <div className="text-[12px] text-slate-500">{dt(r.date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 border-t border-slate-200 p-3">
        <button onClick={onShare} className="flex-1 rounded-[8px] border border-slate-300 px-3 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Share</button>
        <button onClick={onAsk} className="flex-[2] rounded-[8px] bg-blue-600 px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700">Ask about this parcel</button>
      </div>
    </aside>
  );
}

function Unlock({ onRegister, compact }: { onRegister: () => void; compact?: boolean }) {
  return (
    <div className={`${compact ? "mt-3" : ""} rounded-[10px] border border-blue-200 bg-blue-50 p-3.5`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Free registration</div>
      <div className="mt-0.5 text-[14px] font-bold leading-snug text-slate-900">Owner, mailing address, assessed value, sales history and permits.</div>
      <p className="mt-1 text-[12px] leading-snug text-slate-600">For developers, contractors and investors working Hobart. Name, email and phone. One broker, no spam.</p>
      <button onClick={onRegister} className="mt-2.5 w-full rounded-[8px] bg-blue-600 px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700">Unlock owner & value data</button>
    </div>
  );
}

function IconBtn({ onClick, label, active }: { onClick: () => void; label: string; active?: boolean }) {
  return (
    <button onClick={onClick} className={`rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold ${active ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{label}</button>
  );
}

function Tile({ label, value, sub, small, warn }: { label: string; value: string; sub?: string; small?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-[8px] border px-3 py-2 ${warn ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`${small ? "text-[13px]" : "text-[16px]"} font-bold leading-tight text-slate-900`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Row({ k, v, mono, highlight }: { k: string; v: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[12px] text-slate-500">{k}</dt>
      <dd className={`text-right ${mono ? "font-mono text-[11px] text-slate-600" : highlight ? "text-[13px] font-semibold text-blue-700" : "text-[13px] text-slate-800"}`}>{v}</dd>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "green" | "amber" | "blue" }) {
  const c = tone === "green" ? "bg-emerald-100 text-emerald-800" : tone === "amber" ? "bg-amber-100 text-amber-900" : tone === "blue" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[8px] border border-dashed border-slate-200 p-4 text-center text-[13px] text-slate-500">{children}</div>;
}
