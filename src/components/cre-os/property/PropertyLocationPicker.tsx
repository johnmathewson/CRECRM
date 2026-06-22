"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * PropertyLocationPicker — click-to-drop pin map + lat/lng + APN inputs.
 *
 * Use case: properties without a clean street address (vacant land,
 * multi-parcel campuses, pre-platted sites). The valuation tool +
 * marketing maps need spatial coordinates; this UI lets the broker
 * set them by clicking on a map regardless of whether an address
 * exists.
 *
 * Saves: latitude, longitude, apn — all three are nullable in the
 * properties table. The caller can also leave `address` blank and
 * use a freeform display name in `name` for marketing.
 *
 * Loaded via dynamic import (no SSR) by the EditPropertyDialog —
 * Leaflet needs `window` on first mount so it can't render server-side.
 */

// Leaflet's default marker icons are loaded from a CDN path that
// breaks under Webpack. Rebind them to local assets shipped with the
// package. (Standard Leaflet+webpack incantation.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const DEFAULT_CENTER: [number, number] = [41.4929, -87.3320]; // Merrillville, IN — sensible NW Indiana default

export interface PropertyLocationPickerProps {
  initialLatitude: number | null;
  initialLongitude: number | null;
  initialApn: string | null;
  /** Address provided as a fallback search seed. If lat/lng are null but address is set, the map
   *  attempts a one-shot geocode via OpenStreetMap Nominatim on first mount. */
  fallbackAddress?: string | null;
  onChange: (next: { latitude: number | null; longitude: number | null; apn: string | null }) => void;
}

export function PropertyLocationPicker({
  initialLatitude,
  initialLongitude,
  initialApn,
  fallbackAddress,
  onChange,
}: PropertyLocationPickerProps) {
  const [lat, setLat] = useState<number | null>(initialLatitude);
  const [lng, setLng] = useState<number | null>(initialLongitude);
  const [apn, setApn] = useState<string | null>(initialApn);
  const [geocodeStatus, setGeocodeStatus] = useState<"idle" | "loading" | "found" | "not_found">("idle");
  const didGeocodeRef = useRef(false);

  // Push state up on every change so the parent form can include
  // it in its save payload.
  useEffect(() => {
    onChange({ latitude: lat, longitude: lng, apn });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, apn]);

  // One-shot geocode on mount if we have an address but no lat/lng.
  // Uses Nominatim (OSM) — no API key, generous rate limits for
  // single-shot lookups, accurate enough for parcel-level pinning.
  useEffect(() => {
    if (didGeocodeRef.current) return;
    didGeocodeRef.current = true;
    if (initialLatitude !== null && initialLongitude !== null) return;
    if (!fallbackAddress || fallbackAddress.trim().length < 4) return;

    setGeocodeStatus("loading");
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      fallbackAddress
    )}`;
    fetch(url, { headers: { "Accept-Language": "en-US" } })
      .then((r) => r.json())
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) {
          const r = rows[0];
          setLat(parseFloat(r.lat));
          setLng(parseFloat(r.lon));
          setGeocodeStatus("found");
        } else {
          setGeocodeStatus("not_found");
        }
      })
      .catch(() => setGeocodeStatus("not_found"));
  }, [fallbackAddress, initialLatitude, initialLongitude]);

  const hasPin = lat !== null && lng !== null;
  const center: [number, number] = hasPin ? [lat!, lng!] : DEFAULT_CENTER;

  return (
    <div className="space-y-3">
      <div className="rounded border border-white/[0.08] overflow-hidden h-64">
        <MapContainer
          center={center}
          zoom={hasPin ? 17 : 11}
          style={{ height: "100%", width: "100%", background: "#1A1A1A" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <PinAndClick lat={lat} lng={lng} onPin={(la, lo) => { setLat(la); setLng(lo); }} />
          {hasPin && <RecenterOnPin lat={lat!} lng={lng!} />}
        </MapContainer>
      </div>

      {geocodeStatus === "loading" && (
        <div className="font-mono text-[10.5px] text-cream-subtle">Geocoding address…</div>
      )}
      {geocodeStatus === "found" && (
        <div className="font-mono text-[10.5px] text-teal-300">
          Pinned from address — click the map to fine-tune the parcel center.
        </div>
      )}
      {geocodeStatus === "not_found" && (
        <div className="font-mono text-[10.5px] text-amber-300">
          Address didn&apos;t geocode. Click the map to drop a pin manually.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <input
            type="number"
            step="0.000001"
            value={lat ?? ""}
            onChange={(e) => setLat(e.target.value === "" ? null : parseFloat(e.target.value))}
            placeholder="41.492900"
            className={inputCls}
          />
        </Field>
        <Field label="Longitude">
          <input
            type="number"
            step="0.000001"
            value={lng ?? ""}
            onChange={(e) => setLng(e.target.value === "" ? null : parseFloat(e.target.value))}
            placeholder="-87.332000"
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="APN (Assessor Parcel Number)" hint="Optional — for vacant land / unaddressed parcels.">
        <input
          type="text"
          value={apn ?? ""}
          onChange={(e) => setApn(e.target.value === "" ? null : e.target.value)}
          placeholder="45-12-21-227-001"
          className={inputCls}
        />
      </Field>

      <p className="font-body text-[11px] text-cream-subtle leading-relaxed">
        Click anywhere on the map to drop a pin. Lat/lng update automatically. The display address can be
        anything (e.g. &ldquo;Lot 5, Industrial Park&rdquo;) — the spatial anchor is whatever you set here.
      </p>
    </div>
  );
}

/**
 * Click-to-pin behavior + the marker render. Splits cleanly so the
 * MapContainer's children stay declarative.
 */
function PinAndClick({
  lat,
  lng,
  onPin,
}: {
  lat: number | null;
  lng: number | null;
  onPin: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPin(e.latlng.lat, e.latlng.lng);
    },
  });
  if (lat === null || lng === null) return null;
  return <Marker position={[lat, lng]} />;
}

/** Recenter the view when the pin moves. */
function RecenterOnPin({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom() < 14 ? 17 : map.getZoom());
  }, [lat, lng, map]);
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
        {label}
      </label>
      {children}
      {hint && <p className="font-body text-[10.5px] text-cream-subtle italic">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.08] focus:border-teal-400/40 focus:outline-none font-body text-[12px] text-cream placeholder:text-cream-subtle";
