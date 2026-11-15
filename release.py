"""Stamp every script and stylesheet reference with a new version number, so a browser never mixes old cached files with new ones.
Run before each upload:  python release.py
It rewrites  from "./x.js"  /  from "./x.js?v=7"  in every .js file, and the references in index.html, to ?v=<next number>."""
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
vfile = os.path.join(ROOT, "VERSION")
n = (int(open(vfile).read().strip()) if os.path.exists(vfile) else 8) + 1
open(vfile, "w").write(str(n))

for name in os.listdir(ROOT):
    if not name.endswith(".js"): continue
    p = os.path.join(ROOT, name); s = io.open(p, encoding="utf-8").read()
    t = re.sub(r'(from\s+"\./[\w-]+\.js)(\?v=\d+)?"', rf'\1?v={n}"', s)      # our own modules only; vendor/ files never change
    if t != s: io.open(p, "w", encoding="utf-8", newline="\n").write(t)

p = os.path.join(ROOT, "index.html"); s = io.open(p, encoding="utf-8").read()
s = re.sub(r'((?:style\.css|app\.js))(\?v=\d+)?"', rf'\1?v={n}"', s)
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("version", n)
