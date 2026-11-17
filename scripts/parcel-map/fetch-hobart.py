#!/usr/bin/env python3 -I
"""Pull ALL of Hobart from the City of Hobart + Lake County public GIS servers.

Writes
  data/parcel-map/hobart-full.json           full records (gated fields too) → load-map-parcels.py
  public/data/hobart/parcels-lite.geojson    public tier only: geometry + zoning/land-use/lot facts
  public/data/hobart/buildings-lite.geojson  footprints + LiDAR height
  public/data/hobart/meta.json

Usage: python3 -I scripts/parcel-map/fetch-hobart.py
"""
import json, os, sys, time, urllib.parse, urllib.request

CITY = "https://gis.cityofhobart.org/arcgis/rest/services/Hosted"
CNTY = "https://lcsogis.lakecountyin.org/server/rest/services"
FULL_DIR, PUB_DIR = "data/parcel-map", "public/data/hobart"
os.makedirs(FULL_DIR, exist_ok=True); os.makedirs(PUB_DIR, exist_ok=True)

def get(url, params):
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=120) as r:
        return json.load(r)

def page(url, where="1=1", out_fields="*", geometry=None, extra=None, step=1000):
    feats, offset = [], 0
    while True:
        p = {"where": where, "outFields": out_fields, "outSR": 4326, "f": "geojson",
             "resultOffset": offset, "resultRecordCount": step}
        if geometry:
            p.update({"geometry": json.dumps(geometry), "geometryType": "esriGeometryEnvelope",
                      "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"})
        if extra: p.update(extra)
        d = get(url + "/query", p)
        if "error" in d: raise SystemExit(f"{url}: {d['error']}")
        f = d.get("features", [])
        feats += f
        sys.stderr.write(f"\r  {url.split('/Hosted/')[-1].split('/FeatureServer')[0] if 'Hosted' in url else url.split('/services/')[-1].split('/')[0]}: {len(feats)}")
        if len(f) < step and not d.get("properties", {}).get("exceededTransferLimit"): break
        offset += len(f); time.sleep(0.15)
    sys.stderr.write("\n")
    return feats

def rnd(coords, nd=6):
    if isinstance(coords[0], (int, float)): return [round(coords[0], nd), round(coords[1], nd)]
    return [rnd(c, nd) for c in coords]

def bbox(geom):
    xs, ys = [], []
    def w(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else: [w(k) for k in c]
    w(geom["coordinates"])
    return [min(xs), min(ys), max(xs), max(ys)]

# ── City layers (already Hobart-only) ──────────────────────────────────────
print("city layers", file=sys.stderr)
parcels = page(f"{CITY}/OpenGov_Permitting_Service/FeatureServer/1", out_fields=
    "parcelid,mdeededowner,situs_add,mail_add,mailcity,mailstate,mailzipcode,macres,mpropertyclass,mpropertyclasscode,mlegaldescription,mtif,mdeduction,mtransferdate")
bldgs = page(f"{CITY}/BaseLayers_BuildingFootprints3D/FeatureServer/0", out_fields="buildinghe,zoning,futurelanduse", step=2000)
flu = page(f"{CITY}/Planning_LandUse_Public_View/FeatureServer/0", out_fields="parcelid,futurelanduse", extra={"returnGeometry": "false"})
addr = page(f"{CITY}/OpenGov_Permitting_Service/FeatureServer/0", out_fields="pin,fld_zone,historic_district_name,zoning_tag", extra={"returnGeometry": "false"})

# ── County layers, clipped to the city's extent, joined by parcel id ───────
xs = [c for f in parcels for c in (bbox(f["geometry"])[0], bbox(f["geometry"])[2])]
ys = [c for f in parcels for c in (bbox(f["geometry"])[1], bbox(f["geometry"])[3])]
env = {"xmin": min(xs), "ymin": min(ys), "xmax": max(xs), "ymax": max(ys), "spatialReference": {"wkid": 4326}}
print("county layers (envelope)", file=sys.stderr)
av = page(f"{CNTY}/Assessed_Value/FeatureServer/0", out_fields=
    "PARCELID,TotalAssessedValue,LandAssessedValue,ImprAssessedValue,ZoningCode,ConveyanceDescription", geometry=env, extra={"returnGeometry": "false"}, step=2000)
sales = page(f"{CNTY}/Sales_List/FeatureServer/0", out_fields=
    "PARCELID,Date,Price,Buyer1Name,Buyer1City,Seller1Name,Valid,MultiParcelSale", geometry=env, extra={"returnGeometry": "false"}, step=2000)
permits = page(f"{CNTY}/Permit_Tracking/FeatureServer/0", out_fields=
    "PARCELID,PermitNumber,IssueDate,EstimatedCost,Description,PermitType", geometry=env, extra={"returnGeometry": "false"}, step=2000)

av_by = {f["properties"]["PARCELID"]: f["properties"] for f in av}
flu_by = {f["properties"]["parcelid"]: f["properties"]["futurelanduse"] for f in flu}
zone_by, flood_by, hist_by = {}, {}, {}
for f in addr:
    p = f["properties"]; pin = p.get("pin")
    if not pin: continue
    if p.get("zoning_tag"): zone_by.setdefault(pin, p["zoning_tag"])
    if p.get("fld_zone"): flood_by.setdefault(pin, p["fld_zone"])
    if p.get("historic_district_name"): hist_by.setdefault(pin, p["historic_district_name"])
sales_by, permits_by = {}, {}
for f in sales: sales_by.setdefault(f["properties"]["PARCELID"], []).append(f["properties"])
for f in permits: permits_by.setdefault(f["properties"]["PARCELID"], []).append(f["properties"])

full, lite, seen = [], [], set()
for f in parcels:
    p = f["properties"]; pid = p.get("parcelid")
    if not pid or pid in seen or not f.get("geometry"): continue
    seen.add(pid)
    a = av_by.get(pid, {})
    bb = bbox(f["geometry"])
    s = sorted(sales_by.get(pid, []), key=lambda r: r.get("Date") or 0, reverse=True)[:8]
    pr = sorted(permits_by.get(pid, []), key=lambda r: r.get("IssueDate") or 0, reverse=True)[:8]
    zoning = zone_by.get(pid) or a.get("ZoningCode")
    rec = {
        "pid": pid, "city": "Hobart", "address": p.get("situs_add"),
        "zoning": zoning, "flu": flu_by.get(pid),
        "acres": round(p["macres"], 3) if p.get("macres") is not None else None,
        "class_code": p.get("mpropertyclasscode"), "class": p.get("mpropertyclass"),
        "tif": (p.get("mtif") or "").strip() or None, "flood": flood_by.get(pid), "historic": hist_by.get(pid),
        "legal": p.get("mlegaldescription"), "transfer_date": p.get("mtransferdate"),
        "owner": p.get("mdeededowner"), "mail": p.get("mail_add"), "mail_city": p.get("mailcity"),
        "mail_state": p.get("mailstate"), "mail_zip": p.get("mailzipcode"),
        "deduction": (p.get("mdeduction") or "").strip() or None,
        "av_total": a.get("TotalAssessedValue"), "av_land": a.get("LandAssessedValue"), "av_impr": a.get("ImprAssessedValue"),
        "conveyance": a.get("ConveyanceDescription"),
        "sales": [{"date": r.get("Date"), "price": r.get("Price"), "buyer": r.get("Buyer1Name"), "buyer_city": r.get("Buyer1City"),
                   "seller": r.get("Seller1Name"), "valid": r.get("Valid"), "multi": r.get("MultiParcelSale")} for r in s],
        "permits": [{"num": r.get("PermitNumber"), "date": r.get("IssueDate"), "cost": r.get("EstimatedCost"),
                     "type": r.get("PermitType"), "desc": r.get("Description")} for r in pr],
        "lon": round((bb[0] + bb[2]) / 2, 6), "lat": round((bb[1] + bb[3]) / 2, 6), "bbox": [round(v, 6) for v in bb],
    }
    full.append(rec)
    lite.append({"type": "Feature", "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])},
                 "properties": {"pid": pid, "a": rec["address"], "z": zoning, "f": rec["flu"], "ac": rec["acres"],
                                "cc": rec["class_code"], "t": 1 if rec["tif"] else 0, "fl": rec["flood"], "h": 1 if rec["historic"] else 0}})

blite = [{"type": "Feature", "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])},
          "properties": {"h": round(f["properties"].get("buildinghe") or 0, 1), "z": f["properties"].get("zoning")}}
         for f in bldgs if f.get("geometry")]

with open(f"{FULL_DIR}/hobart-full.json", "w") as fh: json.dump(full, fh, separators=(",", ":"))
with open(f"{PUB_DIR}/parcels-lite.geojson", "w") as fh: json.dump({"type": "FeatureCollection", "features": lite}, fh, separators=(",", ":"))
with open(f"{PUB_DIR}/buildings-lite.geojson", "w") as fh: json.dump({"type": "FeatureCollection", "features": blite}, fh, separators=(",", ":"))
with open(f"{PUB_DIR}/meta.json", "w") as fh:
    json.dump({"city": "Hobart", "bbox": [env["xmin"], env["ymin"], env["xmax"], env["ymax"]],
               "home": {"center": [-87.2541, 41.5308], "zoom": 15.5},
               "counts": {"parcels": len(lite), "buildings": len(blite), "sales": len(sales), "permits": len(permits)},
               "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "sources": ["gis.cityofhobart.org (City of Hobart GIS)", "lcsogis.lakecountyin.org (Lake County GIS)"]}, fh, indent=1)
for name in ("hobart-full.json",):
    print(name, os.path.getsize(f"{FULL_DIR}/{name}") // 1024, "KB")
for name in ("parcels-lite.geojson", "buildings-lite.geojson"):
    print(name, os.path.getsize(f"{PUB_DIR}/{name}") // 1024, "KB")
print("parcels", len(full), "buildings", len(blite), "with owner", sum(1 for r in full if r["owner"]), "with AV", sum(1 for r in full if r["av_total"]))
