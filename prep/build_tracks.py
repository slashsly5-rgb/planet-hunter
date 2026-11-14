"""Add a time-lapse to each level: up to 8 exposures of the same patch of sky, so the object's path can be played back.
usage: build_tracks.py [level id ...]   Reads and rewrites ../levels.json; writes ../img/<id>_t<k>.png"""
import json, math, os, sys, zlib
from astropy.time import Time
import cutter
from build_levels import N, SCALE, MIN_SNR, measure

FRAMES, MARGIN = 8, 12

def centre(tid, a, b):
    """Same patch of sky that build_levels.py cut for this pair."""
    h = zlib.crc32(tid.encode())
    ox, oy = (h % 51 - 25) * cutter.PIX, (h // 51 % 51 - 25) * cutter.PIX
    dec0 = (a["dec"] + b["dec"]) / 2 + oy
    return (a["ra"] + b["ra"]) / 2 + ox / math.cos(math.radians(dec0)), dec0

def spread(items, k):
    if len(items) <= k: return items
    return [items[round(i * (len(items) - 1) / (k - 1))] for i in range(k)]

def build(level):
    tid = level["id"]
    obs = json.load(open(f"obs/{tid}.json"))
    by_key = {o["key"]: o for o in obs}
    a, b = (by_key[f["source"]] for f in level["frames"])
    ra0, dec0 = centre(tid, a, b)
    inside = []
    for o in obs:
        x, y = cutter.sky_to_px(ra0, dec0, N, o["ra"], o["dec"])
        if MARGIN <= x <= N - 1 - MARGIN and MARGIN <= y <= N - 1 - MARGIN: inside.append((o, x, y))
    inside.sort(key=lambda t: t[0]["t_mjd"])
    # one exposure per ~hour is plenty: drop near-simultaneous ones, then spread evenly in time
    thinned = [t for i, t in enumerate(inside) if i == 0 or t[0]["t_mjd"] - inside[i - 1][0]["t_mjd"] > 0.03 or t[0]["key"] in (a["key"], b["key"])]
    picked = {t[0]["key"]: t for t in spread(thinned, FRAMES)}
    for t in inside:
        if t[0]["key"] in (a["key"], b["key"]): picked[t[0]["key"]] = t
    track = []
    for k, (o, x, y) in enumerate(sorted(picked.values(), key=lambda t: t[0]["t_mjd"])):
        arr, _ = cutter.cutout(o["key"], ra0, dec0, N)
        if arr is None: print("  off detector, skipped"); continue
        snr, clean = measure(arr, x, y)
        if not clean or snr < MIN_SNR: print("  not detected cleanly (snr %.1f), skipped" % snr); continue
        img = f"img/{tid}_t{len(track)}.png"
        cutter.to_png(arr, "../" + img, SCALE)
        track.append(dict(img=img, date=Time(o["t_mjd"], format="mjd").isot[:19], band=o["band"], source=o["key"],
                          ra=round(o["ra"], 5), dec=round(o["dec"], 5), x=round((x + 0.5) * SCALE, 1), y=round((N - 1 - y + 0.5) * SCALE, 1), snr=round(snr, 1)))
        print(" ", tid, "frame", len(track), track[-1]["date"], o["band"], "snr %.0f" % snr, flush=True)
    level["track"] = track
    level["center"] = dict(ra=round(ra0, 5), dec=round(dec0, 5))

if __name__ == "__main__":
    levels = json.load(open("../levels.json"))
    for level in levels:
        if (not sys.argv[1:] or level["id"] in sys.argv[1:]) and os.path.exists(f"obs/{level['id']}.json"):
            build(level)
            json.dump(levels, open("../levels.json", "w"), indent=1)   # save after each object: the run is slow
    print("tracks:", {l["id"]: len(l.get("track", [])) for l in levels})
