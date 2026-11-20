#!/usr/bin/env python3 -I
"""Sweep Google Places (API New) over a city and merge the results into the
parcel map's occupancy layer (map_businesses).

Why Google: the Business Profile is the record nearly every operating
storefront keeps current, and businessStatus is the best closure signal.
License rules shape the design: place IDs may be stored indefinitely; the
rest must be refreshed within 30 days (this script is meant to run monthly),
and only Pro-tier fields are requested in bulk so the sweep stays inside the
free tier (5,000 Nearby Search Pro calls / month).

Grid: circles over the city bbox; any circle that returns the 20-result cap is
split into four smaller ones (down to 60 m) so dense corridors are covered.

Env: GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, MAP_DATA_KEY
Usage: python3 -I scripts/parcel-map/google-places-sweep.py [--dry-run] [--city Hobart]
"""
import json, math, os, re, sys, time, urllib.request

DRY = "--dry-run" in sys.argv
CITY = sys.argv[sys.argv.index("--city") + 1] if "--city" in sys.argv else "Hobart"
KEY = os.environ.get("GOOGLE_MAPS_API_KEY")
if not KEY: raise SystemExit("GOOGLE_MAPS_API_KEY not set")

META = json.load(open("public/data/hobart/meta.json"))
XMIN, YMIN, XMAX, YMAX = META["bbox"]
PARCELS = json.load(open("public/data/hobart/parcels-lite.geojson"))["features"]
OUT = f"data/parcel-map/google-places-{CITY.lower()}.json"

FIELDS = "places.id,places.displayName,places.primaryType,places.types,places.businessStatus,places.formattedAddress,places.location"
calls = 0

def nearby(lat, lng, radius):
    global calls
    body = {"maxResultCount": 20, "rankPreference": "DISTANCE",
            "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius}}}
    req = urllib.request.Request("https://places.googleapis.com/v1/places:searchNearby", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": FIELDS})
    for attempt in range(3):
        try:
            calls += 1
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r).get("places", [])
        except urllib.error.HTTPError as e:
            msg = e.read().decode()
            if e.code == 429 and "per day" in msg:
                raise QuotaExhausted(msg[:200])
            if e.code == 429 and attempt < 2: time.sleep(2 * (attempt + 1)); continue
            raise SystemExit(f"Places API {e.code}: {msg[:300]}")
    return []

class QuotaExhausted(Exception): pass

# ── adaptive grid ─────────────────────────────────────────────────────────────
places = {}
lat0 = (YMIN + YMAX) / 2
m_per_deg_lat = 111_320; m_per_deg_lng = 111_320 * math.cos(math.radians(lat0))
def sweep(lat, lng, radius):
    res = nearby(lat, lng, radius)
    for p in res: places[p["id"]] = p
    if len(res) >= 20 and radius > 60:
        d = radius / 2
        for dy in (-d, d):
            for dx in (-d, d):
                sweep(lat + dy / m_per_deg_lat, lng + dx / m_per_deg_lng, radius * 0.72)

R0 = 500.0  # starting circle radius (m); spacing so circles overlap
step_lat = R0 * 1.4 / m_per_deg_lat; step_lng = R0 * 1.4 / m_per_deg_lng
# Resume support: previous partial pulls are merged, and finished grid cells skipped.
PROGRESS = OUT.replace(".json", ".progress.json")
done_cells = set()
if os.path.exists(PROGRESS):
    prev = json.load(open(PROGRESS)); done_cells = set(prev.get("cells", [])); places.update({p["id"]: p for p in prev.get("places", [])})
    print(f"resuming: {len(done_cells)} cells done, {len(places)} places carried over", file=sys.stderr)
exhausted = False
lat = YMIN + step_lat / 2
try:
    while lat < YMAX:
        lng = XMIN + step_lng / 2
        while lng < XMAX:
            cell = f"{lat:.5f},{lng:.5f}"
            if cell not in done_cells:
                sweep(lat, lng, R0); done_cells.add(cell)
            lng += step_lng
        lat += step_lat
        sys.stderr.write(f"\r  calls {calls} · places {len(places)}")
except QuotaExhausted as e:
    exhausted = True
    print(f"\nDAILY QUOTA EXHAUSTED after {calls} calls this run — saving progress; re-run tomorrow to continue. ({e})", file=sys.stderr)
json.dump({"cells": sorted(done_cells), "places": list(places.values())}, open(PROGRESS, "w"))
sys.stderr.write("\n")

# ── normalize + parcel match ─────────────────────────────────────────────────
def bbox(geom):
    xs, ys = [], []
    def w(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else: [w(k) for k in c]
    w(geom["coordinates"]); return (min(xs), min(ys), max(xs), max(ys))
def pip_ring(pt, ring):
    x, y = pt; inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1: inside = not inside
    return inside
def pip(pt, geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return any(pip_ring(pt, poly[0]) and not any(pip_ring(pt, h) for h in poly[1:]) for poly in polys)
pbox = [(bbox(f["geometry"]), f) for f in PARCELS]
def match_pid(lon, lat):
    for (x0, y0, x1, y1), f in pbox:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and pip((lon, lat), f["geometry"]): return f["properties"]["pid"]
    return None

STATUS = {"OPERATIONAL": "open", "CLOSED_PERMANENTLY": "closed", "CLOSED_TEMPORARILY": "unknown"}
SKIP_TYPES = {"route", "street_address", "premise", "subpremise", "locality", "political", "neighborhood", "postal_code", "bus_stop", "transit_station", "intersection"}
# Places that are not businesses occupying space: amenities, infrastructure, landmarks.
SKIP_PRIMARY = {"atm", "public_bathroom", "restroom", "parking", "parking_lot", "bus_stop", "bus_station", "train_station", "transit_station",
                "historical_landmark", "park", "playground", "dog_park", "cemetery", "point_of_interest", "establishment", "premise", "route",
                "electric_vehicle_charging_station", "tourist_attraction", "hiking_area", "trailhead", "monument"}
rows = []
for p in places.values():
    types = set(p.get("types") or [])
    if types and types <= SKIP_TYPES: continue
    addr = p.get("formattedAddress") or ""
    lon, lat = p["location"]["longitude"], p["location"]["latitude"]
    pid = match_pid(lon, lat)
    in_city = CITY.lower() in addr.lower()
    if not pid and not in_city: continue
    prim = p.get("primaryType")
    if (prim or "") in SKIP_PRIMARY: continue
    rows.append({
        "google_id": p["id"], "name": p["displayName"]["text"], "category": prim, "category_alt": sorted(types - {prim} if prim else types)[:8],
        "type_label": (prim or "").replace("_", " ").capitalize() or None,
        "address": addr, "lon": lon, "lat": lat, "status": STATUS.get(p.get("businessStatus"), "unknown"), "pid": pid,
    })
json.dump({"pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "calls": calls, "rows": rows}, open(OUT, "w"), separators=(",", ":"))
from collections import Counter
print(f"{len(rows)} Google places kept ({len(places)} raw) · {calls} API calls · on parcels {sum(1 for r in rows if r['pid'])} · status {dict(Counter(r['status'] for r in rows))}")

# ── merge into map_businesses ────────────────────────────────────────────────
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"); anon = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"); mkey = os.environ.get("MAP_DATA_KEY")
if DRY or not (url and anon and mkey):
    print("dry run / not loaded"); sys.exit(0)

def rpc(fn, payload):
    req = urllib.request.Request(url.rstrip("/") + f"/rest/v1/rpc/{fn}", data=json.dumps(payload).encode(), method="POST",
                                 headers={"apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)

existing = rpc("map_businesses_active", {"p_key": mkey, "p_city": CITY})
def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"\b(the|llc|inc|co|corp|company|of|and)\b", " ", (s or "").lower()))).strip()
def dist(a, b):
    dx = (a[0] - b[0]) * m_per_deg_lng; dy = (a[1] - b[1]) * m_per_deg_lat; return math.hypot(dx, dy)

now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
out, merged, added = [], 0, 0
for r in rows:
    nn = norm(r["name"]).replace(" ", ""); hit = None; best = 1e9
    for e in existing:
        if e.get("lon") is None or any(s.get("source") == "google" for s in (e.get("sources") or [])): continue
        d = dist((r["lon"], r["lat"]), (e["lon"], e["lat"]))
        if d > 80: continue
        en = norm(e["name"]).replace(" ", "")
        if nn == en or (len(nn) > 4 and (nn in en or en in nn)):
            if d < best: best, hit = d, e
    if hit:
        # existing record gains Google as a source and Google's status/location win
        srcs = [s for s in (hit.get("sources") or [])] + [{"source": "google", "id": r["google_id"]}]
        out.append({"source_key": None, "_existing_id": hit["id"], "sources": srcs, "name": hit["name"], "status": r["status"],
                    "category": hit.get("category") or r["category"], "type_label": hit.get("type_label") or r["type_label"],
                    "pid": hit.get("pid") or r["pid"], "lon": r["lon"], "lat": r["lat"], "verified_at": now, "city": CITY})
        merged += 1
    else:
        out.append({"source_key": f"google:{r['google_id']}", "sources": [{"source": "google", "id": r["google_id"]}], "name": r["name"],
                    "category": r["category"], "category_alt": r["category_alt"], "type_label": r["type_label"], "address": r["address"],
                    "lon": r["lon"], "lat": r["lat"], "status": r["status"], "pid": r["pid"], "verified_at": now, "city": CITY})
        added += 1

# Rows merging into an existing record need that record's source_key; look it up.
keymap = {e["id"]: e.get("source_key") for e in existing}
for o in out:
    if o.get("_existing_id"): o["source_key"] = keymap.get(o["_existing_id"]); o.pop("_existing_id", None)
out = [o for o in out if o.get("source_key")]
total = 0
for i in range(0, len(out), 300):
    total += int(rpc("map_businesses_upsert", {"p_key": mkey, "p_rows": out[i:i + 300]}))
print(f"merged into existing {merged} · added new {added} · upserted {total}")
