// Turns a greyscale SPHEREx picture into a three.js texture with the site's infrared colour ramp (same stops as the SVG filter in index.html).
import * as THREE from "./vendor/three.module.min.js";

const RAMP = [[0.01, 0.02, 0.07], [0.10, 0.07, 0.36], [0.42, 0.20, 0.50], [0.92, 0.66, 0.42], [1, 1, 1]];

// floor: brightness below this becomes black, so sky noise adds nothing when pictures are stacked
export function irTexture(src, floor = 0, onImage) {
  // The texture stays empty until the picture has loaded: three.js cannot resize a texture after its first upload.
  const c = document.createElement("canvas"), tex = new THREE.Texture(), im = new Image();
  tex.colorSpace = THREE.SRGBColorSpace;
  im.onload = () => {
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height), d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, (d[i] / 255 - floor) / (1 - floor)) * 4, k = Math.min(3, Math.floor(v)), f = v - k;
      for (let ch = 0; ch < 3; ch++) d[i + ch] = 255 * (floor && v === 0 ? 0 : RAMP[k][ch] + (RAMP[k + 1][ch] - RAMP[k][ch]) * f);
    }
    g.putImageData(px, 0, 0); tex.image = c; tex.needsUpdate = true; onImage?.(im);
  };
  im.src = src;
  return tex;
}
