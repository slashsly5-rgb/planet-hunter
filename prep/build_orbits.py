"""Real 3D positions for the Solar System view, from NASA JPL Horizons (Sun-centred, ecliptic plane, in au).
Writes ../orbits.json:
  start, step_days            timeline: positions every step_days from start
  earth:   {path, track}      path = one full orbit (for drawing the ring); track = positions along the timeline
  planets: [{name, path}]     other planets, rings only
  objects: {id: {path, track}}  the game's objects
usage: build_orbits.py"""
import json, time, requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
START, STOP, STEP = "2025-04-01", "2027-04-01", 5          # timeline covers every SPHEREx image on the site
PLANETS = [("Mercury", "199", 88), ("Venus", "299", 225), ("Mars", "499", 687), ("Jupiter", "5", 4333), ("Saturn", "6", 10759)]
PERIODS = {"ceres": 1680, "pallas": 1686, "juno": 1593, "vesta": 1325, "hygiea": 2030, "uranus": 30687, "neptune": 60190,
           "pluto": 90560, "makemake": 111800, "haumea": 103400}                                  # orbital periods in days
BARY = {"uranus": "7", "neptune": "8", "pluto": "9"}     # system barycentres: same place at this scale, longer ephemeris

def vectors(hid, start, stop, step):
    p = dict(format="text", COMMAND=f"'{hid}'", OBJ_DATA="NO", MAKE_EPHEM="YES", EPHEM_TYPE="VECTORS", CENTER="'500@10'",
             REF_PLANE="ECLIPTIC", OUT_UNITS="AU-D", VEC_TABLE="1", CSV_FORMAT="YES", START_TIME=f"'{start}'", STOP_TIME=f"'{stop}'", STEP_SIZE=f"'{step}'")
    for _ in range(5):
        try:
            t = requests.get(API, params=p, timeout=120).text
            if "$$SOE" in t:
                rows = t.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
                return [[round(float(v), 4) for v in r.split(",")[2:5]] for r in rows]
        except requests.RequestException:
            pass
        time.sleep(4)
    raise RuntimeError(f"Horizons vectors failed 5 times for {hid}: {t[-300:] if 't' in dir() else ''}")

def ring(hid, days):
    """One full orbit, about 120 points, starting in 2025."""
    years = int(days / 365.25) + 1
    return vectors(hid, "2025-01-01", f"{2025 + years}-01-02", f"{max(1, round(days / 120))} d")

if __name__ == "__main__":
    levels = json.load(open("../levels.json"))
    hid = {t["id"]: t["hid"] for t in json.load(open("targets.json"))}
    out = dict(start=START, step_days=STEP, planets=[], objects={})
    out["earth"] = dict(path=ring("399", 365.25), track=vectors("399", START, STOP, f"{STEP} d"))
    print("earth", len(out["earth"]["path"]), len(out["earth"]["track"]), flush=True)
    for name, h, days in PLANETS:
        out["planets"].append(dict(name=name, path=ring(h, days)))
        print(name, len(out["planets"][-1]["path"]), flush=True)
    for l in levels:
        h = BARY.get(l["id"], hid[l["id"]])
        out["objects"][l["id"]] = dict(path=ring(h, PERIODS[l["id"]]), track=vectors(h, START, STOP, f"{STEP} d"))
        o = out["objects"][l["id"]]
        r = sum(v * v for v in o["track"][0]) ** 0.5
        print(l["id"], "path", len(o["path"]), "track", len(o["track"]), "distance now %.2f au (level says %.2f)" % (r, l["distance_au"]), flush=True)
    json.dump(out, open("../orbits.json", "w"), separators=(",", ":"))
    print("wrote orbits.json")
