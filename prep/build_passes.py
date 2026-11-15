"""Add a 'six months apart' image to each level: the same patch of sky from a different SPHEREx pass, when the object has moved away.
usage: build_passes.py [level id ...]   Reads and rewrites ../levels.json; writes ../img/<id>_pass.png"""
import csv, io, json, sys
import requests
from astropy.time import Time
import cutter
from build_levels import N, SCALE
from find_obs import SIA, BANDS
import releases

MIN_GAP_DAYS, TRIES = 60, 6

def build(level):
    c, first = level["center"], level["track"][0]
    t0 = Time(first["date"]).mjd
    rows = []
    for coll in releases.use():   # every exposure that ever covered this spot: one query per release, no date filter
        r = requests.get(SIA, params=dict(COLLECTION=coll, POS=f"circle {c['ra']} {c['dec']} 0.02", RESPONSEFORMAT="csv"), timeout=300)
        if r.ok and r.text.startswith("s_ra"): rows += [x for x in csv.DictReader(io.StringIO(r.text)) if x["energy_bandpassname"] in BANDS]
    seen, cands = set(), []
    for x in rows:
        tm = (float(x["t_min"]) + float(x["t_max"])) / 2
        if x["obs_id"] + x["energy_bandpassname"] not in seen and abs(tm - t0) >= MIN_GAP_DAYS:
            seen.add(x["obs_id"] + x["energy_bandpassname"]); cands.append((tm, x))
    cands.sort(key=lambda r: (r[1]["energy_bandpassname"][-2:] != first["band"], abs(abs(r[0] - t0) - 182)))
    print(level["id"], "candidates from another pass:", len(cands), flush=True)
    for tm, x in cands[:TRIES]:
        key = x["access_url"].split("/ibe/data/spherex/")[1]
        arr, _ = cutter.cutout(key, c["ra"], c["dec"], N)
        if arr is None: continue
        img = f"img/{level['id']}_pass.png"
        cutter.to_png(arr, "../" + img, SCALE)
        level["other_pass"] = dict(img=img, date=Time(tm, format="mjd").isot[:19], band=x["energy_bandpassname"][-2:], source=key)
        print("  ", level["id"], "other pass:", level["other_pass"]["date"], level["other_pass"]["band"], "(%.0f days away)" % abs(tm - t0), flush=True)
        return
    print(level["id"], "NO OTHER PASS FOUND")

if __name__ == "__main__":
    levels = json.load(open("../levels.json"))
    for level in levels:
        if (not sys.argv[1:] or level["id"] in sys.argv[1:]) and level.get("track"):
            build(level)
            json.dump(levels, open("../levels.json", "w"), indent=1)
    print("passes:", {l["id"]: l.get("other_pass", {}).get("date") for l in levels})
