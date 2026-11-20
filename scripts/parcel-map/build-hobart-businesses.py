#!/usr/bin/env python3 -I
"""Merge business sources for Hobart, match each to a parcel, and load them
into Supabase map_businesses (occupancy layer for the parcel map).

Inputs (produced by the pull step):
  data/parcel-map/overture-places-hobart.json      Overture Maps Places (DuckDB pull)
  data/parcel-map/hobart-city-businesses.geojson   City of Hobart licensed businesses (ArcGIS)
  public/data/hobart/parcels-lite.geojson          parcel polygons (for point-in-polygon)
  data/parcel-map/hobart-full.json                 parcel addresses (for address matching)

Output: data/parcel-map/hobart-businesses.json, then upsert via RPC when
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / MAP_DATA_KEY are set.

Dedupe: a city-licensed business within 60 m of an Overture place with a
similar name is merged into the Overture record (Overture has category, web,
phone); unmatched city rows become their own records.
"""
import json, os, re, sys, math, urllib.request, time

OVERTURE = "data/parcel-map/overture-places-hobart.json"
CITY = "data/parcel-map/hobart-city-businesses.geojson"
PARCELS = "public/data/hobart/parcels-lite.geojson"
FULL = "data/parcel-map/hobart-full.json"
OUT = "data/parcel-map/hobart-businesses.json"

# ── helpers ──────────────────────────────────────────────────────────────────
def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\b(the|llc|inc|co|corp|company|of|and|&)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def norm_addr(s):
    s = (s or "").upper().split(",")[0]
    s = re.sub(r"[.#,]", "", s)
    for a, b in [("AVENUE", "AVE"), ("STREET", "ST"), ("ROAD", "RD"), ("DRIVE", "DR"), ("BOULEVARD", "BLVD"), ("LANE", "LN"),
                 ("PLACE", "PL"), ("COURT", "CT"), ("PARKWAY", "PKWY"), ("HIGHWAY", "HWY"), ("EAST", "E"), ("WEST", "W"), ("NORTH", "N"), ("SOUTH", "S")]:
        s = re.sub(rf"\b{a}\b", b, s)
    return re.sub(r"\s+", " ", s).strip()

def dist_m(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2)); dy = (a[1] - b[1]) * 111320
    return math.hypot(dx, dy)

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
    for poly in polys:
        if pip_ring(pt, poly[0]) and not any(pip_ring(pt, h) for h in poly[1:]): return True
    return False

# Human labels for the Overture taxonomy slugs we meet most; anything else is
# derived from the slug ("auto_repair_shop" → "Auto repair shop").
LABELS = {
    "restaurant": "Restaurant", "fast_food_restaurant": "Fast food", "pizza_restaurant": "Pizza", "bar": "Bar", "coffee_shop": "Coffee shop",
    "gas_station": "Gas station", "convenience_store": "Convenience store", "grocery_store": "Grocery", "supermarket": "Grocery",
    "auto_repair": "Auto repair", "automotive_repair": "Auto repair", "car_dealer": "Car dealer", "car_wash": "Car wash", "tire_shop": "Tire shop",
    "dentist": "Dentist", "doctor": "Medical office", "hospital": "Hospital", "physical_therapy": "Physical therapy", "pharmacy": "Pharmacy",
    "church_cathedral": "Church", "religious_organization": "Religious", "school": "School", "bank_credit_union": "Bank", "insurance_agency": "Insurance",
    "real_estate_agent": "Real estate", "lawyer": "Law office", "accountant": "Accounting", "hair_salon": "Salon", "beauty_salon": "Salon", "nail_salon": "Nail salon",
    "barber": "Barber", "gym": "Gym", "fitness_center": "Gym", "hotel": "Hotel", "motel": "Motel", "self_storage_facility": "Self storage",
    "warehouse": "Warehouse", "manufacturer": "Manufacturing", "contractor": "Contractor", "landscaping": "Landscaping", "plumber": "Plumber", "electrician": "Electrician",
    "trucking_company": "Trucking", "logistics": "Logistics", "veterinarian": "Veterinarian", "pet_groomer": "Pet grooming", "daycare": "Child care", "child_care": "Child care",
    "liquor_store": "Liquor store", "pet_store": "Pet store", "hardware_store": "Hardware", "furniture_store": "Furniture", "mattress_store": "Mattress store",
    "clothing_store": "Clothing", "shopping_center": "Shopping center", "apartments": "Apartments", "funeral_services_and_cemeteries": "Funeral home",
}
def label(cat):
    if not cat: return None
    if cat in LABELS: return LABELS[cat]
    return cat.replace("_", " ").capitalize()

# ── load ────────────────────────────────────────────────────────────────────
overture = json.load(open(OVERTURE))
city = json.load(open(CITY))["features"]
parcels = json.load(open(PARCELS))["features"]
full = {r["pid"]: r for r in json.load(open(FULL))}
pbox = [(bbox(f["geometry"]), f) for f in parcels]
addr_index = {}
for pid, r in full.items():
    if r.get("address"): addr_index.setdefault(norm_addr(r["address"]), pid)

def match_pid(lon, lat, address):
    if lon is not None and lat is not None:
        for (x0, y0, x1, y1), f in pbox:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and pip((lon, lat), f["geometry"]): return f["properties"]["pid"], "point"
    if address:
        a = norm_addr(address)
        if a in addr_index: return addr_index[a], "address"
        m = re.match(r"^(\d+)\s+(.*)$", a)
        if m:
            num, rest = m.group(1), re.sub(r"\b(N|S|E|W)\b ?", "", m.group(2)).strip()
            for k, pid in addr_index.items():
                if k.startswith(num + " ") and rest and rest.split(" ")[0] in k: return pid, "address~"
    return None, None

# ── Overture records ────────────────────────────────────────────────────────
recs = {}
for o in overture:
    loc = (o.get("locality") or "").lower()
    if loc and "hobart" not in loc: continue  # bbox pulls in Merrillville/Portage edges; keep Hobart only when locality known
    if not o.get("name"): continue
    status = {"open": "open", "permanently_closed": "closed", "temporarily_closed": "closed"}.get(o.get("operating_status") or "open", "unknown")
    pid, how = match_pid(o.get("lon"), o.get("lat"), o.get("address"))
    recs[f"overture:{o['id']}"] = {
        "source_key": f"overture:{o['id']}", "sources": [{"source": "overture", "id": o["id"]}] + [{"source": s.get("dataset"), "id": s.get("record_id")} for s in o.get("sources", []) if s.get("dataset")],
        "name": o["name"], "brand": o.get("brand"), "category": o.get("category"), "category_alt": o.get("category_alt") or [],
        "type_label": label(o.get("category")), "description": None,
        "address": ", ".join([x for x in [o.get("address"), o.get("locality"), o.get("postcode")] if x]) or None,
        "lon": o.get("lon"), "lat": o.get("lat"), "phone": (o.get("phones") or [None])[0], "website": (o.get("websites") or [None])[0],
        "status": status, "confidence": o.get("confidence"), "pid": pid, "_match": how, "city": "Hobart",
    }

# ── City licensed businesses: merge or add ───────────────────────────────────
ov_list = list(recs.values())
merged = added = 0
for f in city:
    p = f["properties"]; name = (p.get("premise_name") or "").strip(); addr = (p.get("address_line_1") or "").strip()
    if not name: continue
    g = f.get("geometry"); lon, lat = (g["coordinates"] if g else (None, None))
    nn = norm_name(name); hit = None
    if lon is not None:
        best = None
        for r in ov_list:
            if r["lon"] is None: continue
            d = dist_m((lon, lat), (r["lon"], r["lat"]))
            if d > 80: continue
            rn = norm_name(r["name"])
            sim = nn == rn or (len(nn) > 3 and (nn in rn or rn in nn))
            if sim and (best is None or d < best[0]): best = (d, r)
        hit = best[1] if best else None
    if hit:
        hit["sources"].append({"source": "hobart_city", "id": p.get("globalid")})
        if not hit.get("address") and addr: hit["address"] = addr + ", Hobart, IN"
        merged += 1
    else:
        pid, how = match_pid(lon, lat, addr)
        recs[f"hobart:{p.get('globalid')}"] = {
            "source_key": f"hobart:{p.get('globalid')}", "sources": [{"source": "hobart_city", "id": p.get("globalid")}],
            "name": name, "brand": None, "category": None, "category_alt": [], "type_label": None, "description": None,
            "address": (addr + ", Hobart, IN") if addr else None, "lon": lon, "lat": lat, "phone": None, "website": None,
            "status": "open", "confidence": None, "pid": pid, "_match": how, "city": "Hobart",
        }
        added += 1

# Keep what is demonstrably in Hobart: on a Hobart parcel, or Overture says the
# locality is Hobart. Edge-of-bbox Merrillville/Portage places drop out.
rows = [r for r in recs.values() if r["pid"] or "hobart" in (r.get("address") or "").lower()]
json.dump(rows, open(OUT, "w"), separators=(",", ":"))
from collections import Counter
print(f"overture kept {len(ov_list)} · city merged {merged} · city added {added} · total {len(rows)}")
print("matched to parcel:", sum(1 for r in rows if r["pid"]), "of", len(rows), Counter(r["_match"] for r in rows))
print("status:", Counter(r["status"] for r in rows))
print("parcels with ≥1 business:", len({r["pid"] for r in rows if r["pid"]}))

# ── load ────────────────────────────────────────────────────────────────────
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"); anon = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"); key = os.environ.get("MAP_DATA_KEY")
if url and anon and key and "--no-load" not in sys.argv:
    total = 0
    for i in range(0, len(rows), 300):
        chunk = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows[i:i + 300]]
        req = urllib.request.Request(url.rstrip("/") + "/rest/v1/rpc/map_businesses_upsert", data=json.dumps({"p_key": key, "p_rows": chunk}).encode(),
                                     method="POST", headers={"apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r: total += int(json.load(r))
        sys.stderr.write(f"\r  upserted {total}/{len(rows)}")
    print(f"\nloaded {total} rows")
else:
    print("not loaded (set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, MAP_DATA_KEY)")
