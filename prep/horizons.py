"""Positions of Solar System bodies from NASA JPL Horizons (geocentric; SPHEREx is in low Earth orbit)."""
import time, requests
API = "https://ssd.jpl.nasa.gov/api/horizons.api"

def _get(params):
    for _ in range(5):
        try:
            t = requests.get(API, params=params, timeout=120).text
            if "$$SOE" in t: return t
        except requests.RequestException:
            pass
        time.sleep(4)
    raise RuntimeError(f"Horizons failed 5 times for {params.get('COMMAND')}")

def _parse(text):
    lines = text.split("\n")
    i = next(n for n, l in enumerate(lines) if l.startswith("$$SOE"))
    cols = [c.strip() for c in lines[i - 2].split(",")]
    ix = {name: next(n for n, c in enumerate(cols) if c == name or (name.endswith("_") and c.startswith(name)))
          for name in ("R.A._", "DEC_", "APmag", "r", "delta", "S-O-T")}
    out = []
    for l in lines[i + 1:]:
        if l.startswith("$$EOE"): break
        f = [x.strip() for x in l.split(",")]
        def num(k):
            try: return float(f[ix[k]])
            except ValueError: return None
        out.append(dict(jd=float(f[0]), ra=num("R.A._"), dec=num("DEC_"), mag=num("APmag"), r=num("r"), delta=num("delta"), elong=num("S-O-T")))
    return out

def _base(hid):
    return dict(format="text", COMMAND=f"'{hid}'", OBJ_DATA="NO", MAKE_EPHEM="YES", EPHEM_TYPE="OBSERVER", CENTER="'500@399'",
                QUANTITIES="'1,9,19,20,23'", ANG_FORMAT="DEG", CSV_FORMAT="YES", CAL_FORMAT="JD")

def daily(hid, start, stop):
    return _parse(_get(dict(_base(hid), START_TIME=f"'{start}'", STOP_TIME=f"'{stop}'", STEP_SIZE="'1 d'")))

def at(hid, jds):
    out = []
    for i in range(0, len(jds), 40):
        out += _parse(_get(dict(_base(hid), TLIST="'" + " ".join(f"{j:.6f}" for j in jds[i:i + 40]) + "'")))
    return out

if __name__ == "__main__":
    p = at("999", [2460952.684])[0]   # Pluto, 4 Oct 2025: the value seen in the data test
    assert abs(p["ra"] - 304.149) < 0.005 and 30 < p["r"] < 40, p
    c = daily("1;", "2025-10-01", "2025-10-03")
    assert len(c) == 3 and 2 < c[0]["r"] < 3.1 and c[0]["mag"] is not None, c
    print("ok", p)
