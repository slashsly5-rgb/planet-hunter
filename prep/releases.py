"""Which SPHEREx data releases the scripts use (releases.json), and which ones NASA has published.
NASA's copy of SPHEREx on AWS Open Data has one folder per release (dr1/, qr3/, ...); a folder with level-2 images is a release,
and its IRSA collection name is spherex_<folder>.   usage: python releases.py   (lists both)"""
import json, os, re, requests

FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "releases.json")
BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
SIA = "https://irsa.ipac.caltech.edu/SIA"

def load(): return json.load(open(FILE))
def use(): return load()["use"]

def folders(prefix=""):
    xml = requests.get(BUCKET, params={"list-type": "2", "delimiter": "/", "prefix": prefix}, timeout=60).text
    return re.findall(r"<Prefix>([^<]+/)</Prefix>", xml)

def published():
    """IRSA collection names of every release in NASA's bucket that holds level-2 images."""
    return ["spherex_" + f[:-1] for f in folders() if f + "level2/" in folders(f)]

def new():
    r = load(); known = set(r["use"]) | set(r["skip"])
    return [c for c in published() if c not in known]

def add(colls):
    r = load(); r["use"] += [c for c in colls if c not in r["use"]]
    json.dump(r, open(FILE, "w"), indent=1)

def searchable(coll):
    """Does the archive's picture search know this collection yet? (It can lag behind the files appearing.)"""
    try:
        r = requests.get(SIA, params=dict(COLLECTION=coll, POS="circle 270 66.56 0.05", RESPONSEFORMAT="csv", MAXREC=1), timeout=120)
        return r.ok and r.text.startswith("s_ra") and len(r.text.splitlines()) > 1
    except requests.RequestException:
        return False

if __name__ == "__main__":
    print("used by the site:", ", ".join(use()))
    print("published by NASA:", ", ".join(published()))
    print("new:", ", ".join(new()) or "none")
