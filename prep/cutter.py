"""North-up cutout from a SPHEREx level-2 image on NASA's Amazon copy, using HTTP range requests (no full download)."""
import time, warnings, numpy as np, requests
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates, maximum_filter
warnings.simplefilter("ignore")
BASE = "https://nasa-irsa-spherex.s3.amazonaws.com/"
PIX = 6.15 / 3600  # degrees per pixel, the detector's own scale

def rng(key, a, b):
    for _ in range(5):
        try:
            r = requests.get(BASE + key, headers={"Range": f"bytes={a}-{b-1}"}, timeout=120)
            if r.status_code == 206 and len(r.content) == b - a: return r.content
        except requests.RequestException:
            pass
        time.sleep(3)
    raise RuntimeError(f"range fetch failed 5 times: {key}")

def image_header(key):
    raw = rng(key, 0, 2880 * 12)
    hdr = fits.Header.fromstring(raw[2880:].decode("latin1"))
    assert hdr["XTENSION"].strip() == "IMAGE" and hdr["BITPIX"] == -32, "unexpected file layout"
    ncards = len(hdr.cards) + 1  # + END
    return hdr, 2880 + -(-ncards * 80 // 2880) * 2880

def grid(ra0, dec0, n):
    w = WCS(naxis=2); w.wcs.ctype = ["RA---TAN", "DEC--TAN"]; w.wcs.crval = [ra0, dec0]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]; w.wcs.cdelt = [-PIX, PIX]
    return w

def sky_to_px(ra0, dec0, n, ra, dec):
    """Array pixel (x, y) of a sky position in a cutout centred on ra0, dec0. y grows north."""
    x, y = grid(ra0, dec0, n).all_world2pix(ra, dec, 0)
    return float(x), float(y)

def cutout(key, ra0, dec0, n=121):
    """n x n north-up array centred on ra0, dec0 (NaN where the detector has no data). (None, hdr) if off the detector."""
    hdr, off = image_header(key)
    w = WCS(hdr); nx, ny = hdr["NAXIS1"], hdr["NAXIS2"]
    jj, ii = np.mgrid[0:n, 0:n]
    sra, sdec = grid(ra0, dec0, n).all_pix2world(ii, jj, 0)
    x, y = w.all_world2pix(sra, sdec, 0)
    y0, y1 = int(np.floor(y.min())) - 2, int(np.ceil(y.max())) + 3
    if y0 < 0 or y1 > ny or x.min() < 2 or x.max() > nx - 3: return None, hdr
    rows = np.frombuffer(rng(key, off + y0 * nx * 4, off + y1 * nx * 4), dtype=">f4").reshape(y1 - y0, nx).astype("f4")
    bad = map_coordinates(np.isnan(rows).astype("f4"), [y - y0, x], order=1) > 0.01
    a = map_coordinates(np.nan_to_num(rows, nan=float(np.nanmedian(rows))), [y - y0, x], order=1)
    a[bad] = np.nan
    return a, hdr

def to_png(a, path, scale=4):
    from PIL import Image
    lo, hi = np.nanpercentile(a, [25, 99.6])
    # Missing pixels take the brightest neighbour: an overloaded star core turns white, a dead pixel in dark sky stays dark.
    filled = np.where(np.isnan(a), maximum_filter(np.nan_to_num(a, nan=lo), size=5), a)
    im = np.sqrt(np.clip((filled - lo) / (hi - lo), 0, 1))
    Image.fromarray((im * 255).astype("uint8")[::-1]).resize((a.shape[1] * scale, a.shape[0] * scale), Image.LANCZOS).save(path, optimize=True)
