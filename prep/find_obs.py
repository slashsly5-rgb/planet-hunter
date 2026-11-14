"""List SPHEREx exposures (detectors D1-D3) that contain a Solar System body.  usage: find_obs.py <target id>"""
import csv, io, json, math, sys, time, requests
import horizons
SIA = "https://irsa.ipac.caltech.edu/SIA"
BANDS = {"SPHEREx-D1", "SPHEREx-D2", "SPHEREx-D3"}

DR1_END = 61174   # MJD of 14 May 2026: spherex_dr1 holds earlier exposures, spherex_qr3 later ones

def sia(coll, ra, dec, radius, mjd):
    for _ in range(5):
        try:
            r = requests.get(SIA, params=dict(COLLECTION=coll, POS=f"circle {ra} {dec} {radius}", TIME=f"{mjd - 2} {mjd + 2}",
                                              RESPONSEFORMAT="csv"), timeout=180)
            if r.ok and r.text.startswith("s_ra"): return list(csv.DictReader(io.StringIO(r.text)))
        except requests.RequestException:
            pass
        time.sleep(15)
    print("  WARNING: archive did not answer 5 times for MJD", round(mjd), "- skipping that date", flush=True)
    return []   # one lost date costs a few exposures; crashing loses the whole 40-minute search

def inside(region, ra, dec):
    """Is the point inside a 'POLYGON ICRS ra dec ra dec ...' footprint? Flat-sky test around the point."""
    v = [float(x) for x in region.split()[2:]]
    c = math.cos(math.radians(dec))
    pts = [(((a - ra + 180) % 360 - 180) * c, d - dec) for a, d in zip(v[0::2], v[1::2])]
    hit = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > 0) != (y2 > 0) and x1 + (0 - y1) * (x2 - x1) / (y2 - y1) > 0: hit = not hit
    return hit

def main(tid):
    t = next(x for x in json.load(open("targets.json")) if x["id"] == tid)
    days = [d for d in horizons.daily(t["hid"], "2025-04-20", "2026-09-20") if 60 <= d["elong"] <= 125]  # SPHEREx imaged Pluto at 102-119 deg
    print(tid, "days in the SPHEREx viewing zone:", len(days), flush=True)
    rows = {}
    for d in days[::3]:
        mjd = d["jd"] - 2400000.5
        colls = [c for c, ok in (("spherex_dr1", mjd < DR1_END + 3), ("spherex_qr3", mjd > DR1_END - 3)) if ok]
        for coll in colls:
            for x in sia(coll, d["ra"], d["dec"], 1.2, mjd):
                tm = (float(x["t_min"]) + float(x["t_max"])) / 2
                if x["energy_bandpassname"] in BANDS and abs(tm - mjd) <= 2:
                    rows[(x["obs_id"], x["energy_bandpassname"])] = (tm, x)
        print(" ", round(mjd), "candidates so far", len(rows), flush=True)
    rows = sorted(rows.values(), key=lambda r: r[0])
    pos = horizons.at(t["hid"], [tm + 2400000.5 for tm, _ in rows]) if rows else []
    out = []
    for (tm, x), p in zip(rows, pos):
        if inside(x["s_region"], p["ra"], p["dec"]):
            out.append(dict(t_mjd=tm, band=x["energy_bandpassname"][-2:], key=x["access_url"].split("/ibe/data/spherex/")[1],
                            ra=p["ra"], dec=p["dec"], r=p["r"], delta=p["delta"], mag=p["mag"]))
    if not out:
        print(tid, "NO EXPOSURES"); sys.exit(1)
    json.dump(out, open(f"obs/{tid}.json", "w"), indent=0)
    print(tid, "exposures containing target:", len(out))

if __name__ == "__main__":
    assert inside("POLYGON ICRS 10 10 12 10 12 12 10 12 10 10", 11, 11) and not inside("POLYGON ICRS 10 10 12 10 12 12 10 12 10 10", 13, 11)
    main(sys.argv[1])
