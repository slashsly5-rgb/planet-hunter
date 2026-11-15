"""Update the website with the latest SPHEREx data, in one command (see UPDATING.md).
  python prep/update.py --check       only report whether NASA has published a release the site does not use yet (a few seconds)
  python prep/update.py               add any new release, search it for every world, rebuild the pictures and data files (about an hour)
  python prep/update.py pluto ceres   the same, for some worlds only
  python prep/update.py --no-search   rebuild the pictures from the last search, without searching again
It changes files but never publishes: look at the site and run the tests, then commit and push."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
os.chdir(HERE); sys.path.insert(0, HERE)
import releases

def step(*args, cwd=HERE):
    print("\n>", " ".join(args), flush=True)
    subprocess.run([sys.executable, "-u", *args], check=True, cwd=cwd)

def images():
    levels = json.load(open(os.path.join(ROOT, "levels.json")))
    return {l["id"]: (len(l.get("track") or l["frames"]), max(f["date"] for f in (l.get("track") or l["frames"]))[:10]) for l in levels}

def main():
    args = sys.argv[1:]; ids = [a for a in args if not a.startswith("-")]
    new = releases.new()
    print("Releases the site uses:", ", ".join(releases.use()))
    print("New releases from NASA:", ", ".join(new) or "none")
    if os.environ.get("GITHUB_OUTPUT"):                      # the weekly check on GitHub reads this
        open(os.environ["GITHUB_OUTPUT"], "a").write(f"new={' '.join(new)}\n")
    if "--check" in args:
        if new: print("\nTo use them, run:  python prep/update.py")
        return
    for c in new:
        if not releases.searchable(c): print(f"WARNING: the archive's search does not know {c} yet, so it may add nothing. Try again in a few days.")
    if new: releases.add(new); print("Added to prep/releases.json:", ", ".join(new))

    targets = ids or [t["id"] for t in json.load(open("targets.json"))]
    before = images()
    def find(t):                                            # the slow part: three worlds at a time
        with open(f"obs/{t}.log", "w") as log:
            ok = subprocess.run([sys.executable, "-u", "find_obs.py", t], stdout=log, stderr=subprocess.STDOUT).returncode == 0
        print(f"  searched {t}: {'ok' if ok else 'no exposures found (kept the old list), see prep/obs/' + t + '.log'}", flush=True)
    if "--no-search" not in args:
        print(f"\nSearching the archive for {len(targets)} worlds (about an hour for all of them)...", flush=True)
        with ThreadPoolExecutor(3) as pool: list(pool.map(find, targets))
    step("build_levels.py", *ids)      # two images per world, checked against NASA JPL positions
    step("build_tracks.py", *ids)      # the time-lapse images
    step("build_passes.py", *ids)      # the same sky six months apart
    step("build_orbits.py")            # the 3D Solar System's timeline
    step("release.py", cwd=ROOT)       # new version number, so browsers fetch the new files

    after = images()
    print("\nWorld        images before -> after   latest image")
    for k, (n, last) in after.items():
        b = before.get(k, (0, "-"))
        print(f"  {k:<10} {b[0]:>5} -> {n:<5} {b[1]} -> {last}{'   NEW' if (n, last) != b else ''}")
    print("\nNext: python -m http.server 8765, look at http://localhost:8765, run the tests in tests/, then commit and push.")
    print("To undo everything instead:  git checkout -- levels.json orbits.json img prep/obs prep/releases.json VERSION")

if __name__ == "__main__":
    main()
