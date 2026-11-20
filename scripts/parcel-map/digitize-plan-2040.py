#!/usr/bin/env python3 -I
"""Digitize the Hobart 2040 Comprehensive Plan (Vision & Future Land Use
chapter PDF) into map layers for the parcel map.

The Future Land Use figure (p.6, "Fig 11") is vector: every parcel is a filled
path colored by its 2040 designation, planned street extensions are dashed
white strokes, and the city boundary is a thick stroke. We:

  1. extract every filled path and classify it by the color it renders to
     (the legend swatch colors; the raw fill colors are pre-blend values);
  2. georeference page coordinates → lon/lat: a first fit from the city
     boundary's bounding box (OSM admin relation), refined by matching PDF
     parcel centroids to the county parcel centroids we already serve
     (public/data/hobart/parcels-lite.geojson) and solving a 6-parameter
     affine by least squares;
  3. tag every real parcel with its plan designation (`f2`) and dissolve
     per-designation areas; pull the seven street extensions and the four
     opportunity sites (p.15 "Fig 12", a smaller print of the same base map).

Inputs : the chapter PDF (arg 1), public/data/hobart/parcels-lite.geojson,
         an Overpass JSON with the Hobart admin relation (arg 2).
Outputs: public/data/hobart/parcels-lite.geojson   (adds `f2`)
         public/data/hobart/plan-2040.geojson      (areas, roads, sites)
Usage  : python3 -I scripts/parcel-map/digitize-plan-2040.py <plan-B.pdf> <overpass.json>
"""
import json, math, sys
import numpy as np
import fitz
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.affinity import affine_transform

PDF, OSM = sys.argv[1], sys.argv[2]
PARCELS = "public/data/hobart/parcels-lite.geojson"
OUT = "public/data/hobart/plan-2040.geojson"
FLU_PAGE, SITES_PAGE = 5, 14

# Legend swatch colors (sampled from the p.6 legend) → designation key / label.
LEGEND = {
    (236, 196, 161): ("tsn", "Traditional Suburban Neighborhood"),
    (221, 134, 42): ("mixed_nbhd", "Mixed Neighborhood"),
    (145, 105, 57): ("multifamily", "Multifamily"),
    (228, 92, 124): ("auto", "Auto-oriented Commercial"),
    (234, 11, 55): ("general_business", "General Business"),
    (170, 14, 58): ("mixed_use", "Mixed Use"),
    (94, 15, 15): ("commercial_core", "Commercial Centers"),
    (193, 141, 200): ("employment", "Employment Center"),
    (144, 71, 149): ("industrial", "Industrial"),
    (56, 168, 0): ("park", "Park / Open Space"),
    (36, 95, 3): ("agriculture", "Agriculture"),
    (177, 209, 102): ("conservation", "Conservation Areas"),
    (8, 74, 75): ("institutional", "Institutional"),
    (204, 204, 204): ("study", "Future Study Area"),
    (134, 134, 134): ("utility", "Utility"),
    # Rendered variants: the figure draws parks and farmland with a different
    # green than its own legend swatches.
    (57, 169, 72): ("park", "Park / Open Space"),
    (42, 97, 40): ("agriculture", "Agriculture"),
}
LEG_KEYS = list(LEGEND); LEG_RGB = np.array(LEG_KEYS, dtype=float)
ROADS = {1: "Colonial Drive Extension", 2: "Wisconsin Street Extension", 3: "Arizona Street Extension", 4: "65th Avenue (proposed)",
         5: "Iowa Street Extension", 6: "78th Avenue (proposed)", 7: "Underwood Drive Extension"}
SITES = {
    1: ("I-65 & Ridge Road", "Industrial. Several developable sites southwest of the interchange; the plan's stated obstacle is consolidating parcels held by different owners. Location approximate — the plan marks it with a circle, not a boundary."),
    2: ("37th Ave & Colonial Dr", "Sanitary District land near Strack & Van Til and wetlands. Light industrial, commercial, or higher-density senior housing."),
    3: ("61st Ave & Wisconsin St", "Mixed-use commercial and residential hub serving St. Mary Medical Center visitors, staff and nearby neighborhoods. Depends on the Wisconsin Street extension."),
    4: ("Former Drag Strip", "Employment Center near the US 30 commercial area: light industrial, office and incubator space. Needs 78th Avenue and Underwood Drive."),
}

doc = fitz.open(PDF)

# ── path → polygons ─────────────────────────────────────────────────────────
def rings_of(items):
    rings, cur = [], []
    def flush():
        nonlocal cur
        if len(cur) >= 3: rings.append(cur)
        cur = []
    for it in items:
        k = it[0]
        if k == "re":
            flush(); r = it[1]; rings.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
        elif k == "qu":
            flush(); q = it[1]; rings.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)])
        elif k in ("l", "c"):
            p1 = (it[1].x, it[1].y); pe = (it[-1].x, it[-1].y)
            if not cur or math.hypot(cur[-1][0] - p1[0], cur[-1][1] - p1[1]) > 0.05:
                flush(); cur = [p1]
            if k == "c":  # flatten the bezier with its midpoint
                p2, p3 = (it[2].x, it[2].y), (it[3].x, it[3].y)
                cur.append(tuple(0.125 * p1[i] + 0.375 * p2[i] + 0.375 * p3[i] + 0.125 * pe[i] for i in (0, 1)))
            cur.append(pe)
    flush()
    return rings

def polys_of(items):
    polys = [Polygon(r) for r in rings_of(items)]
    polys = [p.buffer(0) if not p.is_valid else p for p in polys if p.area > 0.02]
    polys.sort(key=lambda p: -p.area)
    out = []
    for p in polys:
        for o in out:
            if o.contains(p.representative_point()):
                out[out.index(o)] = o.difference(p); break
        else:
            out.append(p)
    return [p for p in out if not p.is_empty]

# ── 1. classify FLU fills by rendered color ─────────────────────────────────
page = doc[FLU_PAGE]
S = 4
pix = page.get_pixmap(matrix=fitz.Matrix(S, S), alpha=False)
img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3].astype(float)
def classify(poly):
    rp = poly.representative_point(); votes = {}
    step = max(0.25, min(1.0, math.sqrt(poly.area) * 0.15))
    for dx, dy in ((0, 0), (step, 0), (-step, 0), (0, step), (0, -step)):
        pt = Point(rp.x + dx, rp.y + dy)
        if not poly.contains(pt): continue
        px, py = int(pt.x * S), int(pt.y * S)
        if not (0 <= px < pix.w and 0 <= py < pix.h): continue
        d = np.sqrt(((LEG_RGB - img[py, px]) ** 2).sum(axis=1)); i = int(d.argmin())
        if d[i] < 30: votes[i] = votes.get(i, 0) + 1
    if not votes: return None
    return LEGEND[LEG_KEYS[max(votes, key=votes.get)]][0]

drawings = page.get_drawings()
flu = []  # (polygon in page pts, key)
for d in drawings:
    if not d.get("fill"): continue
    for p in polys_of(d["items"]):
        if p.area < 0.3: continue
        k = classify(p)
        if k: flu.append((p, k))
print(f"FLU fills classified: {len(flu)}", file=sys.stderr)

# ── 2. georeference ─────────────────────────────────────────────────────────
boundary = max((d for d in drawings if d.get("color") and not d.get("fill") and (d.get("width") or 0) > 1.5 and d["rect"].width > 300),
               key=lambda d: d["rect"].width * d["rect"].height)
B6 = boundary["rect"]
osm = json.load(open(OSM))
rel = next(e for e in osm["elements"] if e["type"] == "relation")
lons, lats = [], []
for m in rel["members"]:
    if m.get("role") == "outer":
        for g in m.get("geometry") or []: lons.append(g["lon"]); lats.append(g["lat"])
LON0, LAT0 = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
MX = 111320 * math.cos(math.radians(LAT0)); MY = 111320
def to_m(lon, lat): return ((lon - LON0) * MX, (lat - LAT0) * MY)
def to_ll(x, y): return (x / MX + LON0, y / MY + LAT0)
bx0, by0 = to_m(min(lons), min(lats)); bx1, by1 = to_m(max(lons), max(lats))
# initial affine page(x,y) → meters: [a b c d xoff yoff] for shapely (x' = a x + b y + xoff ; y' = c x + d y + yoff)
sx = (bx1 - bx0) / B6.width; sy = (by1 - by0) / B6.height
A = [sx, 0, 0, -sy, bx0 - sx * B6.x0, by1 + sy * B6.y0]
print(f"initial scale {sx:.3f} m/pt (x) {sy:.3f} m/pt (y); plan nominal {2000*0.3048/72:.3f}", file=sys.stderr)

parcels = json.load(open(PARCELS))
real = [shape(f["geometry"]) for f in parcels["features"]]
real_m = [affine_transform(g, [MX, 0, 0, MY, -LON0 * MX, -LAT0 * MY]) for g in real]
real_c = np.array([[g.centroid.x, g.centroid.y] for g in real_m]); real_a = np.array([g.area for g in real_m])
ctree = STRtree([Point(*c) for c in real_c])
flu = [(p, k) for p, k in flu if not p.is_empty and np.isfinite(p.centroid.x)]
pdf_c = np.array([[p.centroid.x, p.centroid.y] for p, _ in flu]); pdf_a = np.array([p.area for p, _ in flu])
for it, maxd in enumerate((40, 20, 12, 8)):
    a, b, c, d, xo, yo = A
    X = pdf_c[:, 0] * a + pdf_c[:, 1] * b + xo; Y = pdf_c[:, 0] * c + pdf_c[:, 1] * d + yo
    area_m = pdf_a * abs(a * d - b * c)
    src, dst = [], []
    pts = [Point(x, y) for x, y in zip(X, Y)]
    idx_pairs, dists = ctree.query_nearest(pts, max_distance=maxd, return_distance=True, all_matches=False)
    for i, j, dist in zip(idx_pairs[0], idx_pairs[1], dists):
        ratio = area_m[i] / max(real_a[j], 1)
        if 0.6 < ratio < 1.6 and 200 < real_a[j] < 60000:
            src.append(pdf_c[i]); dst.append(real_c[j])
    src = np.array(src); dst = np.array(dst)
    M = np.c_[src, np.ones(len(src))]
    px, *_ = np.linalg.lstsq(M, dst[:, 0], rcond=None); py, *_ = np.linalg.lstsq(M, dst[:, 1], rcond=None)
    A = [px[0], px[1], py[0], py[1], px[2], py[2]]
    res = np.hypot(M @ px - dst[:, 0], M @ py - dst[:, 1])
    print(f"fit {it}: {len(src)} matched parcels, rms {res.std():.1f} m, median {np.median(res):.1f} m", file=sys.stderr)
a, b, c, d, xo, yo = A
print(f"affine page→m: scale x {math.hypot(a, c):.4f} y {math.hypot(b, d):.4f} m/pt, rotation {math.degrees(math.atan2(c, a)):.3f}°", file=sys.stderr)
def page_to_ll_geom(g):
    gm = affine_transform(g, A)
    return affine_transform(gm, [1 / MX, 0, 0, 1 / MY, LON0, LAT0])

# ── 3. tag real parcels, dissolve areas ─────────────────────────────────────
flu_m = [(affine_transform(p, A), k) for p, k in flu]
ftree = STRtree([p for p, _ in flu_m])
counts = {}
for f, g in zip(parcels["features"], real_m):
    rp = g.representative_point(); key = None
    hits = ftree.query(rp, predicate="within")
    if len(hits): key = flu_m[min(hits, key=lambda i: flu_m[i][0].area)][1]
    else:
        j, dist = ftree.query_nearest(rp, max_distance=12, return_distance=True, all_matches=False)
        if len(j): key = flu_m[int(j[0])][1]
    f["properties"]["f2"] = key
    counts[key] = counts.get(key, 0) + 1
print("parcels by 2040 designation:", json.dumps(dict(sorted(counts.items(), key=lambda x: -x[1]))), file=sys.stderr)

features = []
by_key = {}
for f, g in zip(parcels["features"], real):
    k = f["properties"].get("f2")
    if k: by_key.setdefault(k, []).append(g)
label_of = {v[0]: v[1] for v in LEGEND.values()}
for k, gs in by_key.items():
    u = unary_union(gs).buffer(0.00004).buffer(-0.00004).simplify(0.00001, preserve_topology=True)  # close street gaps (~4 m)
    features.append({"type": "Feature", "geometry": mapping(u), "properties": {"kind": "area", "cat": k, "label": label_of[k], "parcels": len(gs)}})

# ── 4. street extensions (dashed white strokes) ─────────────────────────────
markers = {}
for blk in page.get_text("dict")["blocks"]:
    for l in blk.get("lines", []):
        t = "".join(s["text"] for s in l["spans"]).strip()
        if t.isdigit() and 1 <= int(t) <= 7 and l["bbox"][3] < 650 and (l["bbox"][3] - l["bbox"][1]) < 5:
            markers.setdefault(int(t), []).append(Point((l["bbox"][0] + l["bbox"][2]) / 2, (l["bbox"][1] + l["bbox"][3]) / 2))
def line_pts(items):
    pts = []
    for it in items:
        if it[0] not in ("l", "c"): continue
        p1 = (it[1].x, it[1].y); pe = (it[-1].x, it[-1].y)
        if not pts or math.hypot(pts[-1][0] - p1[0], pts[-1][1] - p1[1]) > 0.05: pts.append(p1)
        if it[0] == "c":
            p2, p3 = (it[2].x, it[2].y), (it[3].x, it[3].y)
            pts.append(tuple(0.125 * p1[i] + 0.375 * p2[i] + 0.375 * p3[i] + 0.125 * pe[i] for i in (0, 1)))
        pts.append(pe)
    return pts
kept = []  # the figure draws some extensions twice (a straight 'l' and a bezier copy); keep one
for d in drawings:
    if d.get("fill") or not d.get("dashes") or d["dashes"] == "[] 0": continue
    pts = line_pts(d["items"])
    if len(pts) < 2: continue
    line = LineString(pts)
    if any(line.hausdorff_distance(k) < 1.5 for k in kept): continue
    kept.append(line)
    num = min(markers, key=lambda n: min(line.distance(m) for m in markers[n]))
    lm = affine_transform(line, A)
    features.append({"type": "Feature", "geometry": mapping(page_to_ll_geom(line)), "properties": {"kind": "road", "num": num, "name": ROADS[num], "length_ft": int(round(lm.length / 0.3048, -1))}})

# ── 5. opportunity sites (p.15, same base map printed smaller) ──────────────
sp = doc[SITES_PAGE]; sd = sp.get_drawings()
b15 = max((d for d in sd if d.get("color") and not d.get("fill") and (d.get("width") or 0) > 1.2 and d["rect"].width > 150 and len(d["items"]) == len(boundary["items"])),
          key=lambda d: d["rect"].width * d["rect"].height)["rect"]
k15 = B6.width / b15.width
def p15_to_p6(g): return affine_transform(g, [k15, 0, 0, k15, B6.x0 - k15 * b15.x0, B6.y0 - k15 * b15.y0])
site_polys = []
for d in sd:
    f = d.get("fill")
    if not f: continue
    rgb = tuple(int(round(x * 255)) for x in f)
    if rgb == (255, 85, 0) and d["rect"].x0 > b15.x0:
        for p in polys_of(d["items"]): site_polys.append(p)
site_polys.sort(key=lambda p: -p.centroid.y)  # south → north: 4, 3, 2
for num, p in zip((4, 3, 2), site_polys):
    name, desc = SITES[num]
    features.append({"type": "Feature", "geometry": mapping(page_to_ll_geom(p15_to_p6(p))), "properties": {"kind": "site", "num": num, "name": name, "desc": desc, "approx": False}})
ring = next(d for d in sd if d.get("color") and not d.get("fill") and (d.get("width") or 0) >= 2.5 and all(i[0] == "c" for i in d["items"]) and d["rect"].x0 > b15.x0 - 30)
r = ring["rect"]; center = p15_to_p6(Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
circle_m = affine_transform(center, A).buffer(k15 * r.width / 2 * math.hypot(a, c), resolution=24)
features.append({"type": "Feature", "geometry": mapping(affine_transform(circle_m, [1 / MX, 0, 0, 1 / MY, LON0, LAT0])), "properties": {"kind": "site", "num": 1, "name": SITES[1][0], "desc": SITES[1][1], "approx": True}})

json.dump({"type": "FeatureCollection", "source": "Hobart 2040 Comprehensive Plan, Vision & Future Land Use chapter, Fig 11 (p.35) and Fig 12 (p.44); adopted Sept 6, 2023", "features": features}, open(OUT, "w"), separators=(",", ":"))
json.dump(parcels, open(PARCELS, "w"), separators=(",", ":"))
print(f"wrote {OUT}: {sum(1 for f in features if f['properties']['kind']=='area')} areas, {sum(1 for f in features if f['properties']['kind']=='road')} road segments, {sum(1 for f in features if f['properties']['kind']=='site')} sites; parcels-lite updated with f2", file=sys.stderr)
