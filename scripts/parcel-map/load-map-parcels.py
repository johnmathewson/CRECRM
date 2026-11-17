#!/usr/bin/env python3 -I
"""Load data/parcel-map/<city>-full.json into Supabase map_parcels through the
map_parcels_upsert RPC (SECURITY DEFINER, needs the MAP_DATA_KEY).

Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, MAP_DATA_KEY
Usage: python3 -I scripts/parcel-map/load-map-parcels.py data/parcel-map/hobart-full.json
"""
import json, os, sys, time, urllib.request

url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/map_parcels_upsert"
anon = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
key = os.environ["MAP_DATA_KEY"]
rows = json.load(open(sys.argv[1]))
BATCH = 400
total = 0
for i in range(0, len(rows), BATCH):
    chunk = rows[i:i + BATCH]
    body = json.dumps({"p_key": key, "p_rows": chunk}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                n = json.load(r); total += int(n); break
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if attempt == 2: raise SystemExit(f"batch {i}: {e.code} {msg}")
            time.sleep(2)
    sys.stderr.write(f"\r  upserted {total}/{len(rows)}")
print(f"\ndone: {total} rows")
