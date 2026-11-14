"""Turn exposure lists (obs/<id>.json) into game levels: two aligned PNGs per object + ../levels.json.
usage: build_levels.py [target id ...]   (no ids = every target that has an obs file)"""
import itertools, json, math, os, sys, zlib
import numpy as np
from astropy.time import Time
from PIL import Image, ImageDraw
import cutter

N, SCALE = 121, 4          # cutout size in detector pixels; PNG upscale
MIN_SEP, MAX_SEP, BEST_SEP = 10, 45, 22   # how far the object should jump, in detector pixels
EDGE, MIN_SNR, TRIES = 10, 5, 6

def sep_px(a, b):
    c = math.cos(math.radians((a["dec"] + b["dec"]) / 2))
    return math.hypot((a["ra"] - b["ra"]) * c, a["dec"] - b["dec"]) / cutter.PIX

def measure(arr, x, y):
    """(snr, clean): peak near x,y against robust background noise; clean=False if data is missing there."""
    ix, iy = round(x), round(y)
    box = arr[iy - 3:iy + 4, ix - 3:ix + 4]
    if box.shape != (7, 7) or np.isnan(box).all(): return 0.0, False
    bg = np.nanmedian(arr); noise = 1.4826 * np.nanmedian(np.abs(arr - bg))
    snr = float((np.nanmax(box[1:6, 1:6]) - bg) / noise)
    # Missing pixels are fine only where a very bright object overloaded the detector (its edge still shows, far above the noise).
    return snr, not np.isnan(box).any() or snr > 200

def build(t, obs):
    pairs = [(a, b) for a, b in itertools.combinations(obs, 2) if MIN_SEP <= sep_px(a, b) <= MAX_SEP]
    pairs.sort(key=lambda p: (p[0]["band"] != p[1]["band"], abs(sep_px(*p) - BEST_SEP)))
    h = zlib.crc32(t["id"].encode())
    ox, oy = (h % 51 - 25) * cutter.PIX, (h // 51 % 51 - 25) * cutter.PIX   # so the answer is never dead centre
    print(t["id"], "exposures", len(obs), "usable pairs", len(pairs), flush=True)
    for a, b in pairs[:TRIES]:
        dec0 = (a["dec"] + b["dec"]) / 2 + oy
        ra0 = (a["ra"] + b["ra"]) / 2 + ox / math.cos(math.radians(dec0))
        frames, arrs = [], []
        for e, tag in ((a, "a"), (b, "b")):
            arr, hdr = cutter.cutout(e["key"], ra0, dec0, N)
            if arr is None: print("  off detector", e["key"][-40:]); break
            x, y = cutter.sky_to_px(ra0, dec0, N, e["ra"], e["dec"])
            snr, clean = measure(arr, x, y)
            if not (EDGE <= x <= N - 1 - EDGE and EDGE <= y <= N - 1 - EDGE) or not clean or snr < MIN_SNR:
                print("  rejected: x %.0f y %.0f snr %.1f clean %s" % (x, y, snr, clean)); break
            arrs.append(arr)
            frames.append(dict(img=f"img/{t['id']}_{tag}.png", date=Time(e["t_mjd"], format="mjd").isot[:19], band=e["band"],
                               source=e["key"], x=round((x + 0.5) * SCALE, 1), y=round((N - 1 - y + 0.5) * SCALE, 1), snr=round(snr, 1)))
        if len(frames) < 2: continue
        for f, arr in zip(frames, arrs): cutter.to_png(arr, "../" + f["img"], SCALE)
        debug(t["id"], frames)
        return dict(id=t["id"], name=t["name"], kind=t["kind"], blurb=t.get("blurb", ""), size=N * SCALE, arcsec_per_px=6.15 / SCALE,
                    distance_au=round((a["r"] + b["r"]) / 2, 2), mag=a["mag"], moved_arcsec=round(sep_px(a, b) * 6.15),
                    days_between=round(abs(b["t_mjd"] - a["t_mjd"]), 2), jpl_checked=True, frames=frames)
    print(t["id"], "NO LEVEL: no pair passed the checks")

def debug(tid, frames):
    """Side-by-side with the JPL position circled, for checking by eye."""
    ims = [Image.open("../" + f["img"]).convert("RGB") for f in frames]
    for im, f in zip(ims, frames):
        ImageDraw.Draw(im).ellipse([f["x"] - 16, f["y"] - 16, f["x"] + 16, f["y"] + 16], outline=(255, 60, 60), width=2)
    sheet = Image.new("RGB", (ims[0].width * 2 + 6, ims[0].height)); sheet.paste(ims[0], (0, 0)); sheet.paste(ims[1], (ims[0].width + 6, 0))
    os.makedirs("debug", exist_ok=True); sheet.save(f"debug/{tid}.png")

if __name__ == "__main__":
    targets = json.load(open("targets.json"))
    want = sys.argv[1:] or [t["id"] for t in targets if os.path.exists(f"obs/{t['id']}.json")]
    levels = {l["id"]: l for l in json.load(open("../levels.json"))} if os.path.exists("../levels.json") else {}
    for t in targets:
        if t["id"] in want:
            lvl = build(t, json.load(open(f"obs/{t['id']}.json")))
            if lvl: levels[t["id"]] = lvl
    out = sorted(levels.values(), key=lambda l: l["mag"] if l["mag"] is not None else 99)   # brightest (easiest) first
    json.dump(out, open("../levels.json", "w"), indent=1)
    print("levels:", [l["id"] for l in out])
