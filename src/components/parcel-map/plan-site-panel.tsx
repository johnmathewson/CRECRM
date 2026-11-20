"use client";

import { useEffect, useRef } from "react";
import { PLAN_2040, ZONING } from "./map-theme";

/**
 * Opportunity-site panel for the Hobart 2040 plan layer.
 *
 * Shows the city's own vision for a site — the concept plan or aerial, the
 * plan's text sections and character image — next to what is on the ground
 * today (the parcels inside the boundary, their zoning, their 2040
 * designation, what is on market). Content comes from plan-2040.geojson
 * (scripts/parcel-map/digitize-plan-2040.py), pp. 44–47 of the plan.
 */

export type PlanSite = {
  num: number; name: string; desc: string; approx: boolean;
  vision?: string; tag?: string; note?: string | null;
  sections?: [string, string][];
  character?: { src: string; caption: string } | null;
  aerial?: string | null;
  concept?: { src: string; coordinates: number[][]; px: number[] } | null;
};
export type SiteParcel = { pid: string; address: string | null; acres: number | null; zoning: string | null; plan: string | null; onMarket: boolean };

export function PlanSitePanel({ site, parcels, mobile, onClose, onZoom, onSelectParcel }: {
  site: PlanSite; parcels: SiteParcel[]; mobile: boolean;
  onClose: () => void; onZoom: () => void; onSelectParcel: (pid: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [site.num]);

  const acres = parcels.reduce((a, p) => a + (p.acres ?? 0), 0);
  const mix = (key: "zoning" | "plan") => {
    const m = new Map<string, number>();
    for (const p of parcels) { const k = p[key]; if (k) m.set(k, (m.get(k) ?? 0) + (p.acres ?? 0)); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  };
  const onMarket = parcels.filter((p) => p.onMarket).length;
  const hero = site.concept?.src ?? site.aerial ?? null;
  const top = [...parcels].sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0)).slice(0, 12);

  return (
    <aside
      className={
        mobile
          ? "absolute inset-x-0 bottom-0 z-20 flex max-h-[72dvh] flex-col rounded-t-[14px] bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)]"
          : "absolute bottom-4 right-4 top-[68px] z-20 flex w-[440px] flex-col rounded-[12px] bg-white shadow-xl ring-1 ring-slate-900/5"
      }
    >
      {mobile && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" />}
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-orange-700">Hobart 2040 plan · Opportunity site {site.num}</div>
          <h2 className="mt-0.5 truncate text-[18px] font-bold leading-tight text-slate-900">{site.name}</h2>
          {site.vision && <div className="mt-0.5 text-[13px] text-slate-600">{site.vision}</div>}
        </div>
        <button onClick={onClose} className="mt-0.5 h-7 w-7 shrink-0 rounded-[6px] text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">✕</button>
      </div>
      <div className="mt-2 flex gap-2 px-4">
        <button onClick={onZoom} className="h-8 rounded-[6px] bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200">Zoom to site</button>
        {site.tag && <span className={`inline-flex h-8 items-center rounded-[6px] px-2.5 text-[12px] font-semibold ${site.concept ? "bg-orange-50 text-orange-800 ring-1 ring-orange-200" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"}`}>{site.tag}</span>}
      </div>

      <div ref={scroller} className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {hero && (
          <figure className="overflow-hidden rounded-[10px] ring-1 ring-slate-900/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero} alt={site.concept ? `${site.name} concept site plan` : `${site.name} aerial`} className="block w-full" />
            <figcaption className="bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
              {site.concept ? "The city's concept site plan, drawn on the map at true position (north up)." : site.approx ? "Aerial from the plan. The plan marks this site with a circle, not a boundary." : "Aerial from the plan; dashed line is the city's site boundary."}
            </figcaption>
          </figure>
        )}

        {site.sections?.map(([h, body]) => (
          <section key={h} className="mt-4">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{h}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-800">{body}</p>
          </section>
        ))}
        {site.note && <p className="mt-3 rounded-[8px] bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">{site.note}</p>}

        {site.character && (
          <figure className="mt-4 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={site.character.src} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-1 ring-slate-900/10" />
            <figcaption className="text-[12px] leading-snug text-slate-600">{site.character.caption}. The look the plan has in mind, not a rendering of this site.</figcaption>
          </figure>
        )}

        <section className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">On the ground today</h3>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label="Parcels" value={String(parcels.length)} />
            <Stat label="Acres" value={acres ? acres.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"} />
            <Stat label="On market" value={String(onMarket)} warn={onMarket > 0} />
          </div>
          {parcels.length > 0 && (
            <dl className="mt-3 space-y-2 text-[12px]">
              <div>
                <dt className="font-semibold text-slate-700">Zoned today</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {mix("zoning").map(([k, ac]) => (
                    <span key={k} className="inline-flex items-center gap-1.5 rounded-[5px] bg-slate-100 px-2 py-0.5 text-slate-700">
                      <span className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-slate-900/10" style={{ background: ZONING[k]?.fill ?? "#E2E8F0" }} />
                      {k} <span className="text-slate-500">{ac.toFixed(0)} ac</span>
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">2040 designation</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {mix("plan").map(([k, ac]) => (
                    <span key={k} className="inline-flex items-center gap-1.5 rounded-[5px] bg-slate-100 px-2 py-0.5 text-slate-700">
                      <span className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-slate-900/10" style={{ background: PLAN_2040[k]?.fill ?? "#E2E8F0" }} />
                      {PLAN_2040[k]?.label ?? k} <span className="text-slate-500">{ac.toFixed(0)} ac</span>
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          )}
          {top.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
              {top.map((p) => (
                <li key={p.pid}>
                  <button onClick={() => onSelectParcel(p.pid)} className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:bg-blue-50">
                    <span className="min-w-0 truncate text-[12px] font-semibold text-slate-800">{p.address || p.pid}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{p.zoning ?? "—"} · {p.acres != null ? `${p.acres} ac` : "—"}{p.onMarket ? " · listed" : ""}</span>
                  </button>
                </li>
              ))}
              {parcels.length > top.length && <li className="py-1.5 text-[11px] text-slate-500">+ {parcels.length - top.length} smaller parcels</li>}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-500">Tap a parcel for its owner and sales (free registration).</p>
        </section>

        <p className="mt-4 text-[10px] leading-snug text-slate-400">Source: Hobart 2040 Comprehensive Plan, Opportunity Sites (pp. 44–47), adopted Sept 6, 2023. Concepts are the city&apos;s illustrations of intent, not approved or entitled projects.</p>
      </div>
    </aside>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-[8px] px-2.5 py-2 ring-1 ${warn ? "bg-green-50 ring-green-200" : "bg-slate-50 ring-slate-200"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[16px] font-bold ${warn ? "text-green-800" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
