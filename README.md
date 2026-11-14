# Planet Hunter

Spot what moved in real images from NASA's SPHEREx space telescope.

**Play:** https://aufahannan222.github.io/planet-hunter/

Built for the 2026 NASA Space Apps Challenge, "Planet X and SPHEREx".

## How it works

The site flips between two SPHEREx images of the same patch of sky taken on different dates. Stars stay still. A Solar System object moves. Tap it, and the site shows what it is and how far it travelled.

Every object is already known. This site has not found Planet X.

## Where the images come from

- Images: SPHEREx spectral images from the NASA/IPAC Infrared Science Archive (IRSA), read from NASA's copy on AWS Open Data.
- Positions: NASA JPL Horizons.

The scripts in `prep/` run once to make the images. The website only loads the finished pictures and `levels.json`.

| Script | What it does |
|---|---|
| `prep/find_obs.py <id>` | Lists SPHEREx exposures (detectors D1 to D3) that contain an object. |
| `prep/build_levels.py [id ...]` | Picks two exposures per object, cuts a small aligned north-up image from each, checks the object is detected at the JPL position, and writes `img/` and `levels.json`. |
| `prep/horizons.py`, `prep/cutter.py` | JPL Horizons client; cutouts by HTTP range request. |

## Run it yourself

```
pip install -r prep/requirements.txt
cd prep
python find_obs.py pluto
python build_levels.py pluto
cd ..
python -m http.server 8765      # then open http://localhost:8765
node --test tests/score.test.mjs
```

## Limits

- It does not search for new objects.
- It shows small prepared patches of sky, not the whole survey.
- Brightness is scaled for visibility and is not a measurement.

## Credits

SPHEREx is a NASA mission managed by JPL; data are served by Caltech/IPAC IRSA. Positions from NASA JPL Horizons. An AI assistant (Claude) helped write the code.
