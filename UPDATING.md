# Updating Planet Hunter with new SPHEREx data

NASA publishes SPHEREx data in releases (so far DR1, QR2 and QR3). The website does not read the archive while people use it:
it shows pictures made in advance. So when a new release comes out, the pictures are made again, with one command.

## How you find out about a new release

- **Automatically (optional, off until you switch it on):** the file `.github/workflows/check-releases.yml` makes GitHub
  check NASA's servers every Monday. If there is a release the site does not use yet, it opens an issue called
  "New SPHEREx data: ..." on the repository, and GitHub emails you. To switch it on, commit and push that file
  (`git add .github` then commit and push). After that you can also run it by hand: repository > Actions >
  "Check for new SPHEREx data" > Run workflow.
- **By hand, on your computer** (a few seconds):

  ```
  python prep/update.py --check
  ```

## How to update the site (about an hour, mostly waiting)

One-time setup: `pip install -r prep/requirements.txt`

```
python prep/update.py
```

This one command:

1. adds any new release to `prep/releases.json`;
2. searches every release, up to today, for each of the ten worlds;
3. makes the pictures again, keeping a world only if it is found at NASA JPL's predicted position;
4. rebuilds the time-lapse, six-months-apart and 3D Solar System data;
5. gives the site a new version number, so visitors' browsers fetch the new files;
6. prints a table of how many images each world has, before and after.

The About page names the releases the pictures come from by itself.

To update only some worlds: `python prep/update.py pluto ceres`

## Check, then publish

The command changes files on your computer only. Before publishing:

```
python -m http.server 8765          # open http://localhost:8765 and look around
node tests/browser-check.mjs .      # play-through of the whole site
node tests/judges-check.mjs .       # every proof button, the tour and the explanations
```

Happy with it? Publish:

```
git add -A
git commit -m "Update to SPHEREx release ..."
git push
```

The live site updates a minute or two later.

Not happy? Undo every change: `git checkout -- levels.json orbits.json img prep/obs prep/releases.json VERSION`

## If something goes wrong

- **"the archive's search does not know spherex_... yet":** NASA's files appear before the archive's search learns about them.
  Wait a few days and run the update again.
- **The archive does not answer** (errors such as "502 Proxy Error"): the archive is busy or down. The search retries by itself;
  if it still fails, try again later. The site keeps working with the pictures it has.
- **A release replaces an older one** (as DR1 replaced QR2): put the old one under `"skip"` in `prep/releases.json`.
  When two releases hold the same exposure, the one listed later in `"use"` is used.
