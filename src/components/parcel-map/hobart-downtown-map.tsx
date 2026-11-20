"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ParcelCard, type ParcelProps, type Listing } from "./parcel-card";
import { RegisterModal, AskModal } from "./map-forms";
import {
  ZONING, ZONING_FALLBACK, LAND_USE, HEIGHT_LEGEND, BUILDING_NEUTRAL, PARCEL_LINE, SELECTION, OWNER_MATCH, LISTING,
  matchExpr, heightExpr,
} from "./map-theme";

/**
 * Hobart parcel map — citywide.
 *
 * Public tier ships as static "lite" GeoJSON (geometry + zoning / land use /
 * lot facts, no owners) built by scripts/parcel-map/fetch-hobart.py. The
 * gated tier (owner, mailing, values, sales, permits) is fetched per parcel
 * from /api/map/parcel/[pid], which only returns it when the registration
 * cookie is present and reads a table the browser's anon key cannot touch.
 */

const DATA = "/data/hobart";
const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };

type Mode = "zoning" | "flu" | "height" | "none";
/** Top-level filters shown as chips under the search box. Add future filters
 *  (asset type, price band, lot size, zoning…) as more entries. */
type MarketFilter = "all" | "sale" | "lease";
const MARKET_FILTERS: { id: MarketFilter; label: string; kinds: Array<"sale" | "lease" | "both"> }[] = [
  { id: "all", label: "All parcels", kinds: ["sale", "lease", "both"] },
  { id: "sale", label: "For sale", kinds: ["sale", "both"] },
  { id: "lease", label: "For lease", kinds: ["lease", "both"] },
];
type Basemap = "light" | "dark";
type Overlays = { lines: boolean; buildings: boolean; tif: boolean; flood: boolean; historic: boolean };
/** Lite feature properties as written by fetch-hobart.py. */
type Lite = { pid: string; a: string | null; z: string | null; f: string | null; ac: number | null; cc: string | null; t: 0 | 1; fl: string | null; h: 0 | 1 };
type FC = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: any; properties: Lite }> };
type Meta = { city: string; bbox: number[]; home: { center: [number, number]; zoom: number }; counts: Record<string, number>; pulled_at: string };

function fromLite(l: Lite): ParcelProps {
  return {
    pid: l.pid, address: l.a, acres: l.ac, class: null, class_code: l.cc, zoning: l.z, flu: l.f,
    tif: l.t ? "Yes" : null, flood: l.fl, historic: l.h ? "Yes" : null, legal: null, transfer_date: null,
    owner: null, mail: null, mail_city: null, mail_state: null, mail_zip: null, deduction: null,
    av_total: null, av_land: null, av_impr: null, conveyance: null, sales: [], permits: [],
  };
}

export default function HobartParcelMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const dataRef = useRef<{ parcels: FC; buildings: any } | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const basemapRef = useRef<Basemap>("light");

  const [ready, setReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mode, setMode] = useState<Mode>("zoning");
  const [basemap, setBasemap] = useState<Basemap>("light");
  const [threeD, setThreeD] = useState(true);
  const [overlays, setOverlays] = useState<Overlays>({ lines: true, buildings: true, tif: false, flood: false, historic: false });
  const [registered, setRegistered] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [modal, setModal] = useState<"register" | "ask" | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [selected, setSelected] = useState<ParcelProps | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; p: ParcelProps } | null>(null);
  const [ownerPids, setOwnerPids] = useState<{ owner: string; pids: string[] } | null>(null);
  const [ownerCount, setOwnerCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [serverHits, setServerHits] = useState<ParcelProps[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<MarketFilter>("all");
  // Derived from the chip: which overlay kinds paint, and whether the rest fades.
  const showSale = filter === "all" || filter === "sale";
  const showLease = filter === "all" || filter === "lease";
  const onlyMarket = filter !== "all";
  const setOnlyMarket = (v: boolean | ((b: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(onlyMarket) : v;
    setFilter(next ? (filter === "all" ? "sale" : filter) : "all");
  };
  const [width, setWidth] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const onR = () => setWidth(window.innerWidth);
    onR();
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  const isMobile = width > 0 && width < 768;

  useEffect(() => {
    fetch("/api/map/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => { if (s?.registered) { setRegistered(true); setSessionName(s.name ?? null); setAdmin(!!s.admin); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/map/listings?city=Hobart").then((r) => r.json()).then((d) => setListings(d.listings ?? [])).catch(() => {});
  }, []);

  /** pid → listings, and the kind to paint (sale / lease / both). */
  const byPid = useMemo(() => {
    const m = new Map<string, Listing[]>();
    for (const l of listings) if (l.pid) m.set(l.pid, [...(m.get(l.pid) ?? []), l]);
    return m;
  }, [listings]);
  const marketPids = useMemo(() => {
    const sale: string[] = [], lease: string[] = [], both: string[] = [];
    byPid.forEach((ls, pid) => {
      const kinds = new Set(ls.map((l) => (l.kind === "both" ? "sale" : l.kind)));
      const hasSale = kinds.has("sale") || ls.some((l) => l.kind === "both");
      const hasLease = kinds.has("lease") || ls.some((l) => l.kind === "both");
      if (hasSale && hasLease) both.push(pid); else if (hasSale) sale.push(pid); else lease.push(pid);
    });
    return { sale, lease, both };
  }, [byPid]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // ── Selection + detail fetch ───────────────────────────────────────────
  const detailReq = useRef(0);
  const loadDetail = useCallback(async (pid: string) => {
    const n = ++detailReq.current;
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/map/parcel/${encodeURIComponent(pid)}`, { cache: "no-store" });
      const out = await r.json();
      if (n !== detailReq.current) return;
      if (r.ok && out.parcel) {
        setSelected((cur) => (cur && cur.pid === pid ? { ...cur, ...out.parcel, sales: out.parcel.sales ?? [], permits: out.parcel.permits ?? [] } : cur));
        if (out.gated && out.parcel.owner) {
          const o = await fetch(`/api/map/owner?name=${encodeURIComponent(out.parcel.owner)}`).then((x) => x.json()).catch(() => null);
          if (n === detailReq.current) setOwnerCount(o?.parcels?.length ?? null);
        } else setOwnerCount(null);
      }
    } finally {
      if (n === detailReq.current) setDetailLoading(false);
    }
  }, []);

  const select = useCallback((p: ParcelProps | null, fly = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedIdRef.current) map.setFeatureState({ source: "parcels", id: selectedIdRef.current }, { selected: false });
    selectedIdRef.current = p?.pid ?? null;
    if (p) map.setFeatureState({ source: "parcels", id: p.pid }, { selected: true });
    setSelected(p);
    setOwnerPids(null);
    setOwnerCount(null);
    const url = new URL(window.location.href);
    if (p) url.searchParams.set("pid", p.pid); else url.searchParams.delete("pid");
    window.history.replaceState(null, "", url.toString());
    if (p) {
      loadDetail(p.pid);
      if (fly) {
        const f = dataRef.current?.parcels.features.find((x) => x.properties.pid === p.pid);
        if (f) flyToGeometry(map, f.geometry, isMobile);
      }
    }
  }, [isMobile, loadDetail]);
  const selectRef = useRef(select);
  useEffect(() => { selectRef.current = select; }, [select]);

  // Re-fetch the open parcel when the visitor registers (gated fields appear).
  useEffect(() => { if (registered && selected) loadDetail(selected.pid); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [registered]);

  // ── Layers (re-added on every style load so basemap switching works) ───
  const addLayers = useCallback((map: MLMap) => {
    const d = dataRef.current!;
    const dark = basemapRef.current === "dark";
    const labelLayer = (map.getStyle().layers ?? []).find((l) => l.type === "symbol")?.id;
    for (const l of map.getStyle().layers ?? []) {
      try {
        if (/building/i.test(l.id) && (l.type === "fill" || l.type === "fill-extrusion")) map.setLayoutProperty(l.id, "visibility", "none");
        if (l.type === "symbol" && /poi|housenumber|airport|place_other/i.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
      } catch { /* ignore */ }
    }
    if (!map.getSource("parcels")) map.addSource("parcels", { type: "geojson", data: d.parcels as any, promoteId: "pid" });
    if (!map.getSource("buildings")) map.addSource("buildings", { type: "geojson", data: d.buildings, generateId: true });

    map.addLayer({ id: "zoning-fill", type: "fill", source: "parcels", paint: { "fill-color": matchExpr(["get", "z"], ZONING, ZONING_FALLBACK) as any, "fill-opacity": 0.45 } }, labelLayer);
    map.addLayer({ id: "flu-fill", type: "fill", source: "parcels", paint: { "fill-color": matchExpr(["get", "f"], LAND_USE, ZONING_FALLBACK) as any, "fill-opacity": 0 } }, labelLayer);
    map.addLayer({ id: "parcel-hit", type: "fill", source: "parcels", paint: { "fill-color": "#000", "fill-opacity": 0 } }, labelLayer);
    map.addLayer({ id: "overlay-flood", type: "fill", source: "parcels", filter: ["==", ["get", "fl"], "AE"], paint: { "fill-color": "#38BDF8", "fill-opacity": 0 } }, labelLayer);
    map.addLayer({ id: "overlay-tif", type: "line", source: "parcels", filter: ["==", ["get", "t"], 1], paint: { "line-color": "#0EA5E9", "line-width": 1.5, "line-dasharray": [2, 1.5], "line-opacity": 0 } }, labelLayer);
    map.addLayer({ id: "overlay-historic", type: "fill", source: "parcels", filter: ["==", ["get", "h"], 1], paint: { "fill-color": "#A16207", "fill-opacity": 0 } }, labelLayer);
    map.addLayer({
      id: "parcel-line", type: "line", source: "parcels",
      paint: {
        "line-color": dark ? "#CBD5E1" : PARCEL_LINE,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.08, 15, 0.25, 17, 0.45, 19, 0.6],
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.2, 16, 0.6, 19, 1.4],
      },
    }, labelLayer);
    map.addLayer({ id: "owner-match", type: "fill", source: "parcels", paint: { "fill-color": OWNER_MATCH, "fill-opacity": 0.55 }, filter: ["in", ["get", "pid"], ["literal", []]] }, labelLayer);
    map.addLayer({ id: "owner-match-line", type: "line", source: "parcels", paint: { "line-color": "#B45309", "line-width": 2 }, filter: ["in", ["get", "pid"], ["literal", []]] }, labelLayer);
    // On-market overlay: parcel fills by kind + a strong outline, above zoning.
    map.addLayer({ id: "listing-sale", type: "fill", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "fill-color": LISTING.sale.fill, "fill-opacity": 0.6 } }, labelLayer);
    map.addLayer({ id: "listing-lease", type: "fill", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "fill-color": LISTING.lease.fill, "fill-opacity": 0.6 } }, labelLayer);
    map.addLayer({ id: "listing-both", type: "fill", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "fill-color": LISTING.both.fill, "fill-opacity": 0.6 } }, labelLayer);
    map.addLayer({ id: "listing-sale-line", type: "line", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "line-color": LISTING.sale.line, "line-width": 2 } }, labelLayer);
    map.addLayer({ id: "listing-lease-line", type: "line", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "line-color": LISTING.lease.line, "line-width": 2 } }, labelLayer);
    map.addLayer({ id: "listing-both-line", type: "line", source: "parcels", filter: ["in", ["get", "pid"], ["literal", []]], paint: { "line-color": LISTING.both.line, "line-width": 2, "line-dasharray": [2, 1] } }, labelLayer);
    if (!map.getSource("listing-points")) map.addSource("listing-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "parcel-hover", type: "line", source: "parcels", paint: { "line-color": SELECTION, "line-width": 2, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] } });
    map.addLayer({ id: "parcel-selected-fill", type: "fill", source: "parcels", paint: { "fill-color": SELECTION, "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.22, 0] } });
    map.addLayer({ id: "parcel-selected", type: "line", source: "parcels", paint: { "line-color": SELECTION, "line-width": 3, "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0] } });
    map.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: "buildings", minzoom: 14.5,
      paint: {
        "fill-extrusion-color": buildingColor(BUILDING_NEUTRAL),
        "fill-extrusion-height": ["*", ["coalesce", ["get", "h"], 10], 0.3048],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.9,
        "fill-extrusion-vertical-gradient": true,
      },
    });
    map.addLayer({
      id: "listing-markers", type: "circle", source: "listing-points",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 15, 7, 18, 10],
        "circle-color": ["match", ["get", "kind"], "sale", LISTING.sale.fill, "lease", LISTING.lease.fill, LISTING.both.fill],
        "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2, "circle-pitch-alignment": "map",
      },
    });
    map.addLayer({
      id: "listing-marker-labels", type: "symbol", source: "listing-points", minzoom: 14,
      layout: { "text-field": ["match", ["get", "kind"], "sale", "S", "lease", "L", "S/L"], "text-size": 10, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#FFFFFF" },
    });
  }, []);

  // ── Map init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const [m, parcels, buildings] = await Promise.all([
        fetch(`${DATA}/meta.json`).then((r) => r.json()),
        fetch(`${DATA}/parcels-lite.geojson`).then((r) => r.json()),
        fetch(`${DATA}/buildings-lite.geojson`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      dataRef.current = { parcels, buildings };
      setMeta(m);

      const map = new maplibregl.Map({
        container: containerRef.current!,
        style: STYLES.light,
        center: m.home.center, zoom: m.home.zoom, pitch: 50, bearing: -15, minZoom: 11.5, maxZoom: 20, maxPitch: 70,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      if (process.env.NODE_ENV !== "production") (window as any).__hobartMap = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

      map.on("style.load", () => {
        if (cancelled) return;
        addLayers(map);
        if (selectedIdRef.current) map.setFeatureState({ source: "parcels", id: selectedIdRef.current }, { selected: true });
        setReady(true);
        setStyleEpoch((e) => e + 1);
      });
      map.on("mousemove", "parcel-hit", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.id as string;
        if (hoverIdRef.current !== null && hoverIdRef.current !== id) map.setFeatureState({ source: "parcels", id: hoverIdRef.current }, { hover: false });
        hoverIdRef.current = id;
        map.setFeatureState({ source: "parcels", id }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
        setHover({ x: e.point.x, y: e.point.y, p: fromLite(f.properties as Lite) });
      });
      map.on("mouseleave", "parcel-hit", () => {
        if (hoverIdRef.current !== null) map.setFeatureState({ source: "parcels", id: hoverIdRef.current }, { hover: false });
        hoverIdRef.current = null;
        map.getCanvas().style.cursor = "";
        setHover(null);
      });
      map.on("click", (e) => {
        if (!map.getLayer("parcel-hit")) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: ["parcel-hit"] });
        if (hits.length) selectRef.current(fromLite((hits[0] as MapGeoJSONFeature).properties as Lite), false);
        else selectRef.current(null);
      });

      const pid = new URL(window.location.href).searchParams.get("pid");
      if (pid) {
        const f = (parcels as FC).features.find((x) => x.properties.pid === pid);
        if (f) map.once("idle", () => selectRef.current(fromLite(f.properties), true));
      }
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    map.setStyle(STYLES[basemap], { diff: false });
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("zoning-fill")) return;
    map.setPaintProperty("zoning-fill", "fill-opacity", mode === "zoning" ? 0.45 : 0);
    map.setPaintProperty("flu-fill", "fill-opacity", mode === "flu" ? 0.5 : 0);
    map.setLayoutProperty("buildings-3d", "visibility", overlays.buildings && threeD ? "visible" : "none");
    map.setLayoutProperty("parcel-line", "visibility", overlays.lines ? "visible" : "none");
    map.setPaintProperty("overlay-flood", "fill-opacity", overlays.flood ? 0.45 : 0);
    map.setPaintProperty("overlay-tif", "line-opacity", overlays.tif ? 0.9 : 0);
    map.setPaintProperty("overlay-historic", "fill-opacity", overlays.historic ? 0.35 : 0);
    const f: any = ["in", ["get", "pid"], ["literal", ownerPids?.pids ?? []]];
    map.setFilter("owner-match", f);
    map.setFilter("owner-match-line", f);

    // On-market overlay
    const sale = showSale ? marketPids.sale : [], lease = showLease ? marketPids.lease : [];
    const both = showSale || showLease ? marketPids.both : [];
    for (const [id, pids] of [["listing-sale", sale], ["listing-lease", lease], ["listing-both", both]] as [string, string[]][]) {
      map.setFilter(id, ["in", ["get", "pid"], ["literal", pids]] as any);
      map.setFilter(id + "-line", ["in", ["get", "pid"], ["literal", pids]] as any);
    }
    if (onlyMarket) {
      map.setPaintProperty("zoning-fill", "fill-opacity", mode === "zoning" ? 0.12 : 0);
      map.setPaintProperty("flu-fill", "fill-opacity", mode === "flu" ? 0.12 : 0);
    }
    // Markers + building colors
    const d = dataRef.current;
    if (d) {
      const kindOf = new Map<string, "sale" | "lease" | "both">();
      sale.forEach((p) => kindOf.set(p, "sale")); lease.forEach((p) => kindOf.set(p, "lease")); both.forEach((p) => kindOf.set(p, "both"));
      const feats: any[] = [];
      const polys: { kind: string; geom: any; bbox: number[] }[] = [];
      for (const pf of d.parcels.features) {
        const k = kindOf.get(pf.properties.pid);
        if (!k) continue;
        const bb = bboxOf(pf.geometry);
        polys.push({ kind: k, geom: pf.geometry, bbox: bb });
        feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] }, properties: { pid: pf.properties.pid, kind: k } });
      }
      (map.getSource("listing-points") as any)?.setData({ type: "FeatureCollection", features: feats });
      // Buildings: feature-state on footprints whose centroid falls in a listed parcel.
      const bf = d.buildings.features as any[];
      const prev: number[] = (map as any).__listedBuildings ?? [];
      for (const i of prev) map.setFeatureState({ source: "buildings", id: i }, { listing: null });
      const now: number[] = [];
      if (polys.length) {
        bf.forEach((b, i) => {
          const c = centroidOf(b.geometry);
          for (const p of polys) {
            if (c[0] < p.bbox[0] || c[0] > p.bbox[2] || c[1] < p.bbox[1] || c[1] > p.bbox[3]) continue;
            if (pointInGeom(c, p.geom)) { map.setFeatureState({ source: "buildings", id: i }, { listing: p.kind }); now.push(i); break; }
          }
        });
      }
      (map as any).__listedBuildings = now;
    }
    map.setPaintProperty("buildings-3d", "fill-extrusion-color", buildingColor(mode === "height" ? (heightExpr() as any) : BUILDING_NEUTRAL));
  }, [mode, overlays, threeD, ownerPids, ready, styleEpoch, marketPids, showSale, showLease, onlyMarket]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.easeTo({ pitch: threeD ? 50 : 0, bearing: threeD ? -15 : 0, duration: 600 });
  }, [threeD, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (modal) setModal(null); else { select(null); setLayersOpen(false); setQuery(""); } } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, modal]);

  // ── Search: instant client-side (address / parcel #) + server owner hits ─
  const localHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !dataRef.current) return [] as ParcelProps[];
    const qn = q.replace(/[-.]/g, "");
    const out: ParcelProps[] = [];
    for (const f of dataRef.current.parcels.features) {
      const p = f.properties;
      if ((p.a ?? "").toLowerCase().includes(q) || p.pid.replace(/[-.]/g, "").startsWith(qn)) {
        out.push(fromLite(p));
        if (out.length >= 8) break;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ready]);

  useEffect(() => {
    if (!registered || query.trim().length < 3 || /^[\d\-.]+$/.test(query.trim())) { setServerHits([]); return; }
    const t = window.setTimeout(async () => {
      const r = await fetch(`/api/map/search?q=${encodeURIComponent(query.trim())}`).then((x) => x.json()).catch(() => null);
      const hits = (r?.results ?? []).filter((h: any) => h.owner && h.owner.toLowerCase().includes(query.trim().toLowerCase()));
      setServerHits(hits.map((h: any) => ({ ...fromLite({ pid: h.pid, a: h.address, z: h.zoning, f: null, ac: null, cc: null, t: 0, fl: null, h: 0 }), owner: h.owner })));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, registered]);

  const results = useMemo(() => {
    const seen = new Set(localHits.map((p) => p.pid));
    return [...localHits, ...serverHits.filter((p) => !seen.has(p.pid))].slice(0, 10);
  }, [localHits, serverHits]);

  const highlightOwner = useCallback(async () => {
    if (!selected?.owner) return;
    if (ownerPids?.owner === selected.owner) { setOwnerPids(null); return; }
    const r = await fetch(`/api/map/owner?name=${encodeURIComponent(selected.owner)}`).then((x) => x.json()).catch(() => null);
    const pids: string[] = (r?.parcels ?? []).map((p: any) => p.pid);
    setOwnerPids({ owner: selected.owner, pids });
    setOwnerCount(pids.length);
    const map = mapRef.current;
    if (map && pids.length > 1 && dataRef.current) {
      let xmin = 180, ymin = 90, xmax = -180, ymax = -90;
      for (const p of r.parcels as any[]) { xmin = Math.min(xmin, p.lon); xmax = Math.max(xmax, p.lon); ymin = Math.min(ymin, p.lat); ymax = Math.max(ymax, p.lat); }
      map.fitBounds([[xmin, ymin], [xmax, ymax]], { padding: isMobile ? { top: 120, bottom: 360, left: 40, right: 40 } : { top: 120, bottom: 80, left: 80, right: 480 }, maxZoom: 17, duration: 800 });
    }
  }, [selected, ownerPids, isMobile]);

  const resetView = () => {
    const map = mapRef.current; if (!map || !meta) return;
    map.easeTo({ center: meta.home.center, zoom: meta.home.zoom, pitch: threeD ? 50 : 0, bearing: threeD ? -15 : 0, duration: 800 });
  };
  const fitCity = () => {
    const map = mapRef.current; if (!map || !meta) return;
    const [xmin, ymin, xmax, ymax] = meta.bbox;
    map.fitBounds([[xmin, ymin], [xmax, ymax]], { padding: 40, pitch: 0, bearing: 0, duration: 900 });
  };

  const legend = useMemo(() => {
    if (mode === "zoning") return ["R1", "R2", "R3", "R4", "B1", "B2", "B3", "OS1", "PBP", "M1", "PUD", "A1", "FP"].map((k) => ({ k, fill: ZONING[k].fill, label: ZONING[k].label }));
    if (mode === "flu") return Object.entries(LAND_USE).filter(([k]) => !/Moderate Density$/.test(k)).map(([k, v]) => ({ k: k.split(" ")[0], fill: v.fill, label: v.label }));
    if (mode === "height") return HEIGHT_LEGEND.map((h) => ({ k: h.sub, fill: h.fill, label: h.label }));
    return [];
  }, [mode]);

  const btn = "h-9 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200";
  const btnOn = "h-9 px-3 text-[13px] font-semibold bg-blue-600 text-white";

  return (
    <div className="relative h-full w-full select-none bg-slate-100 text-slate-900" style={{ fontFamily: "var(--font-archivo), system-ui, sans-serif" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {!ready && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-100">
          <div className="flex items-center gap-3 rounded-[10px] bg-white px-5 py-3 text-sm font-semibold text-slate-600 shadow-lg">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" /> Loading Hobart parcels…
          </div>
        </div>
      )}

      {/* Top-left: title + search */}
      <div className="absolute left-3 top-3 z-20 w-[calc(100%-24px)] md:left-4 md:top-4 md:w-[380px]">
        <div className="rounded-[10px] bg-white shadow-lg ring-1 ring-slate-900/5">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-blue-600 text-[11px] font-extrabold text-white">H</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[14px] font-bold text-slate-900">Hobart Parcel Map <span className="font-medium text-slate-400">· Indiana</span></div>
              <div className="hidden text-[11px] text-slate-500 md:block">
                Stewardship CRE · {meta ? `${meta.counts.parcels.toLocaleString()} parcels` : "…"} · {admin ? <span className="font-semibold text-blue-700">Admin{sessionName ? ` · ${sessionName.split(" ")[0]}` : ""}</span> : registered ? <span className="font-semibold text-emerald-700">Registered{sessionName ? ` · ${sessionName}` : ""}</span> : "public records"}
              </div>
            </div>
            {listings.length > 0 && (
              <span className="shrink-0 rounded-[6px] bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{byPid.size} on market</span>
            )}
            {!registered && (
              <button onClick={() => setModal("register")} className="hidden shrink-0 rounded-[6px] bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 md:block">Unlock owners</button>
            )}
          </div>
          <div className="relative m-2">
            <svg className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={registered ? "Address, parcel # or owner" : "Search address or parcel #"}
              className="h-9 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-9 pr-8 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {query && <button onClick={() => setQuery("")} className="absolute right-1.5 top-1.5 h-6 w-6 rounded-[6px] text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear">✕</button>}
            {query.trim().length >= 2 && (
              <ul className="absolute inset-x-0 top-10 z-30 max-h-72 overflow-y-auto rounded-[8px] border border-slate-200 bg-white py-1 shadow-xl">
                {results.length === 0 && <li className="px-3 py-2 text-[13px] text-slate-500">No matches{!registered ? " · register to search owners" : ""}</li>}
                {results.map((r) => (
                  <li key={r.pid}>
                    <button onClick={() => { select(r); setQuery(""); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-900">{r.address || "No situs address"}</div>
                        <div className="truncate text-[11px] text-slate-500">{r.pid}{r.owner ? ` · ${r.owner}` : ""}</div>
                      </div>
                      <Swatch fill={r.zoning ? ZONING[r.zoning]?.fill ?? ZONING_FALLBACK : ZONING_FALLBACK} label={r.zoning ?? "—"} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Filter chips — one row, scrolls sideways on phones */}
          <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-100 px-2 py-1.5">
            <span className="shrink-0 pl-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Show</span>
            {MARKET_FILTERS.map((f) => {
              const n = f.id === "all" ? null : f.id === "sale" ? marketPids.sale.length + marketPids.both.length : marketPids.lease.length + marketPids.both.length;
              const on = filter === f.id;
              const dot = f.id === "sale" ? LISTING.sale.fill : f.id === "lease" ? LISTING.lease.fill : null;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(on && f.id !== "all" ? "all" : f.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 transition ${on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
                >
                  {dot && <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />}
                  {f.label}{n != null && <span className={on ? "text-slate-300" : "text-slate-400"}>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top-right: view controls */}
      <div className={`absolute right-3 z-20 flex flex-col items-end gap-2 md:right-4 md:top-4 ${isMobile ? "top-[104px]" : ""}`}>
        <div className="flex overflow-hidden rounded-[10px] bg-white shadow-lg ring-1 ring-slate-900/5">
          <button onClick={() => setLayersOpen((v) => !v)} className={layersOpen ? btnOn : btn}>Layers</button>
          <span className="w-px bg-slate-200" />
          <button onClick={() => setThreeD((v) => !v)} className={btn} title="Toggle 3D">{threeD ? "3D" : "2D"}</button>
          <span className="w-px bg-slate-200" />
          <button onClick={() => setBasemap((b) => (b === "light" ? "dark" : "light"))} className={btn} title="Basemap">{basemap === "light" ? "Dark" : "Light"}</button>
          <span className="w-px bg-slate-200" />
          <button onClick={resetView} className={btn} title="Back to downtown">Downtown</button>
          <span className="w-px bg-slate-200" />
          <button onClick={fitCity} className={btn} title="Whole city">City</button>
        </div>

        {layersOpen && (
          <div className="w-[260px] rounded-[10px] bg-white p-3 text-[13px] shadow-xl ring-1 ring-slate-900/5">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Color parcels by</div>
            <div className="grid grid-cols-2 gap-1">
              {([["zoning", "Zoning"], ["flu", "Future land use"], ["height", "Building height"], ["none", "None"]] as [Mode, string][]).map(([m, l]) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-[6px] px-2 py-1.5 text-left font-semibold ${mode === m ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{l}</button>
              ))}
            </div>
            {legend.length > 0 && (
              <ul className="mt-2 grid grid-cols-1 gap-y-0.5 border-t border-slate-200 pt-2">
                {legend.map((l) => (
                  <li key={l.k + l.label} className="flex items-center gap-2 text-[12px] text-slate-700">
                    <span className="inline-block h-3 w-3 rounded-[3px] ring-1 ring-slate-900/10" style={{ background: l.fill }} />
                    <span className="w-11 shrink-0 font-semibold text-slate-900">{l.k}</span>
                    <span className="truncate text-slate-600">{l.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">On market</div>
            <div className="grid grid-cols-3 gap-1">
              {MARKET_FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-[6px] px-2 py-1.5 text-left font-semibold ${filter === f.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{f.id === "all" ? "All" : f.label}</button>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Listings come from CREXi, LoopNet and our own CRM, refreshed daily.</div>
            <div className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Overlays</div>
            {([["lines", "Parcel lines"], ["buildings", "3D buildings"], ["tif", "TIF districts (dashed)"], ["flood", "FEMA AE flood zone"], ["historic", "Historic district"]] as [keyof Overlays, string][]).map(([k, l]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 py-1 text-slate-700">
                <input type="checkbox" checked={overlays[k]} onChange={(e) => setOverlays({ ...overlays, [k]: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                {l}
              </label>
            ))}
            {registered && !admin && (
              <button
                onClick={async () => { await fetch("/api/map/session", { method: "DELETE" }); setRegistered(false); setSessionName(null); if (selected) loadDetail(selected.pid); }}
                className="mt-2 w-full border-t border-slate-200 pt-2 text-left text-[12px] text-slate-500 hover:text-slate-800"
              >
                Not {sessionName?.split(" ")[0] ?? "you"}? Sign out
              </button>
            )}
            {admin ? (
              <a href="/cre-os/today" className="mt-2 block border-t border-slate-200 pt-2 text-[12px] font-semibold text-blue-700 hover:underline">Open CRM →</a>
            ) : (
              <a href="/login?next=/map/hobart" className="mt-2 block border-t border-slate-200 pt-2 text-[12px] text-slate-500 hover:text-slate-800">Broker sign in</a>
            )}
            {meta && <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-400">Records pulled {new Date(meta.pulled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>}
          </div>
        )}
      </div>

      {!layersOpen && legend.length > 0 && !isMobile && (
        <div className="absolute bottom-7 left-4 z-10 rounded-[10px] bg-white/95 px-3 py-2 shadow-lg ring-1 ring-slate-900/5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{mode === "zoning" ? "Zoning" : mode === "flu" ? "Future land use" : "Building height"}</div>
          <ul className="flex max-w-[560px] flex-wrap gap-x-3 gap-y-1">
            {legend.map((l) => (
              <li key={l.k + l.label} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-slate-900/10" style={{ background: l.fill }} />
                {mode === "height" ? l.label : l.k}
              </li>
            ))}
            {listings.length > 0 && (
              <>
                <li className="ml-2 flex items-center gap-1.5 border-l border-slate-200 pl-3 text-[11px] font-semibold text-slate-800"><span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: LISTING.sale.fill }} />For sale</li>
                <li className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800"><span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: LISTING.lease.fill }} />For lease</li>
              </>
            )}
          </ul>
        </div>
      )}

      {ownerPids && (
        <div className="absolute left-1/2 top-[76px] z-20 flex -translate-x-1/2 items-center gap-3 rounded-[8px] bg-amber-500 px-3 py-1.5 text-[13px] font-semibold text-amber-950 shadow-lg md:top-4">
          <span className="max-w-[50vw] truncate">{ownerPids.pids.length} parcel{ownerPids.pids.length === 1 ? "" : "s"} · {ownerPids.owner}</span>
          <button onClick={() => setOwnerPids(null)} className="rounded-[4px] bg-amber-950/10 px-1.5 hover:bg-amber-950/20">✕</button>
        </div>
      )}

      <div className="absolute bottom-0 left-0 z-10 max-w-full truncate rounded-tr-[6px] bg-white/85 px-2 py-0.5 text-[10px] text-slate-500">
        <span className="hidden md:inline">Parcels & zoning <a className="underline" href="https://gis.cityofhobart.org" target="_blank" rel="noreferrer">City of Hobart GIS</a> · Values & sales Lake County GIS · </span>
        © <a className="underline" href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © OpenMapTiles © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </div>

      {hover && !isMobile && hover.p.pid !== selected?.pid && (() => {
        const hl = byPid.get(hover.p.pid) ?? [];
        const first = hl[0];
        return (
          <div className="pointer-events-none absolute z-10 w-[220px] overflow-hidden rounded-[8px] bg-slate-900 text-white shadow-lg" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            {first?.photo_url && <img src={first.photo_url} alt="" className="h-[110px] w-full object-cover" />}
            <div className="px-2.5 py-1.5">
              {first && (
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: (LISTING[first.kind] ?? LISTING.sale).fill }}>
                  {(LISTING[first.kind] ?? LISTING.sale).label}
                  <span className="font-semibold normal-case tracking-normal text-white">{first.price_text || first.lease_rate_text || ""}</span>
                </div>
              )}
              <div className="text-[12px] font-semibold">{hover.p.address || "No situs address"}</div>
              <div className="text-[11px] text-slate-300">{hover.p.zoning ?? "—"} · {hover.p.acres != null ? `${hover.p.acres} ac` : "—"}{hl.length > 1 ? ` · ${hl.length} listings` : ""}</div>
            </div>
          </div>
        );
      })()}

      {modal === "register" && (
        <RegisterModal
          parcel={selected}
          onClose={() => setModal(null)}
          onDone={(name) => { setRegistered(true); setSessionName(name); setModal(null); flash(`Welcome, ${name.split(" ")[0]}. Owner and value data unlocked.`); }}
        />
      )}
      {modal === "ask" && selected && (
        <AskModal parcel={selected} onClose={() => setModal(null)} onDone={() => { setModal(null); flash("Sent. John will follow up shortly."); }} />
      )}

      {toast && <div className="absolute bottom-10 left-1/2 z-30 -translate-x-1/2 rounded-[8px] bg-slate-900 px-3 py-1.5 text-[13px] font-semibold text-white shadow-lg">{toast}</div>}

      {selected && (
        <ParcelCard
          p={selected}
          registered={registered}
          mobile={isMobile}
          loading={detailLoading}
          ownerParcels={ownerCount}
          ownerHighlighted={ownerPids?.owner === selected.owner && !!selected.owner}
          listings={byPid.get(selected.pid) ?? []}
          onClose={() => select(null)}
          onRegister={() => setModal("register")}
          onAsk={() => (registered ? setModal("ask") : setModal("register"))}
          onZoom={() => select(selected, true)}
          onShare={() => { navigator.clipboard?.writeText(window.location.href); flash("Link copied"); }}
          onHighlightOwner={highlightOwner}
        />
      )}
    </div>
  );
}

function Swatch({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-[6px] bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
      <span className="inline-block h-2.5 w-2.5 rounded-[2px] ring-1 ring-slate-900/10" style={{ background: fill }} />{label}
    </span>
  );
}

/** Extrusion color: listed buildings take the listing color, else the mode color. */
function buildingColor(base: any): any {
  return ["case",
    ["==", ["feature-state", "listing"], "sale"], LISTING.sale.fill,
    ["==", ["feature-state", "listing"], "lease"], LISTING.lease.fill,
    ["==", ["feature-state", "listing"], "both"], LISTING.both.fill,
    base];
}
function bboxOf(geometry: any): number[] {
  let xmin = 180, ymin = 90, xmax = -180, ymax = -90;
  const walk = (c: any) => { if (typeof c[0] === "number") { xmin = Math.min(xmin, c[0]); xmax = Math.max(xmax, c[0]); ymin = Math.min(ymin, c[1]); ymax = Math.max(ymax, c[1]); } else for (const k of c) walk(k); };
  walk(geometry.coordinates);
  return [xmin, ymin, xmax, ymax];
}
function centroidOf(geometry: any): [number, number] {
  const b = bboxOf(geometry);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInGeom(pt: [number, number], geometry: any): boolean {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  for (const poly of polys) {
    if (!pointInRing(pt, poly[0])) continue;
    let hole = false;
    for (let r = 1; r < poly.length; r++) if (pointInRing(pt, poly[r])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

function flyToGeometry(map: MLMap, geometry: any, mobile: boolean) {
  let xmin = 180, ymin = 90, xmax = -180, ymax = -90;
  const walk = (c: any) => {
    if (typeof c[0] === "number") { xmin = Math.min(xmin, c[0]); xmax = Math.max(xmax, c[0]); ymin = Math.min(ymin, c[1]); ymax = Math.max(ymax, c[1]); }
    else for (const k of c) walk(k);
  };
  walk(geometry.coordinates);
  map.fitBounds([[xmin, ymin], [xmax, ymax]], {
    padding: mobile ? { top: 120, bottom: 360, left: 24, right: 24 } : { top: 100, bottom: 60, left: 60, right: 460 },
    maxZoom: 18.5, duration: 700,
  });
}
