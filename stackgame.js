// Shift-and-stack: the real method astronomers use to look for a planet too faint to see in any single image.
// Take several images of the same sky. Guess how the planet drifts. Slide each image back along that guess and combine them.
// If the guess is right, the planet lands on the same pixel every time and adds up, while the stars smear away.
// Here the images are real SPHEREx pictures of one patch of sky, and the planet is SIMULATED: a faint dot planted in each image.
const N = 242;   // working size in pixels

const load = (src) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
function median(a) { const s = Float32Array.from(a).sort(); return s[s.length >> 1]; }

export async function makeStackGame(level, canvas) {
  const frames = level.track, t0 = Date.parse(frames[0].date + "Z");
  const days = frames.map((f) => (Date.parse(f.date + "Z") - t0) / 864e5), T = days[days.length - 1];
  const scratch = document.createElement("canvas"); scratch.width = scratch.height = N;
  const g = scratch.getContext("2d", { willReadFrequently: true });
  // each real image, in units of its own sky noise (so differently scaled images can be combined)
  const data = [];
  for (const f of frames) {
    g.drawImage(await load(f.img), 0, 0, N, N);
    const px = g.getImageData(0, 0, N, N).data, a = new Float32Array(N * N);
    for (let i = 0; i < a.length; i++) a[i] = (px[i * 4] / 255) ** 2;          // the pictures store the square root of brightness
    const m = median(a), dev = a.map((v) => Math.abs(v - m)), sigma = 1.4826 * median(dev) || 1e-3;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / sigma;
    data.push(a);
  }
  // the fixed sky: what is in the same place in every image (the stars). Middle value of the images, pixel by pixel.
  const fixed = new Float32Array(N * N), col = new Float32Array(data.length);
  for (let i = 0; i < fixed.length; i++) { for (let k = 0; k < data.length; k++) col[k] = data[k][i]; fixed[i] = median(col); }
  // the simulated planet: a straight, slow drift, and far too faint to pick out in one image
  const travel = 15 + Math.random() * 7, angle = Math.random() * Math.PI * 2, speed = travel / T;
  const truth = { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  // start it on empty sky: nowhere near a star in any of the images, so the only thing that can add up there is the planet
  const busy = (x, y) => { for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) if (fixed[(y + j) * N + x + i] > 1.2) return true; return false; };
  let x0, y0, tries = 0;
  do { x0 = 45 + Math.random() * (N - 90); y0 = 45 + Math.random() * (N - 90); } while (busy(Math.round(x0), Math.round(y0)) && ++tries < 400);
  const AMP = 2.4, S = 1.5;
  data.forEach((a, k) => {
    const cx = x0 + truth.vx * days[k], cy = y0 + truth.vy * days[k];
    for (let y = Math.max(0, Math.floor(cy - 6)); y <= Math.min(N - 1, Math.ceil(cy + 6)); y++)
      for (let x = Math.max(0, Math.floor(cx - 6)); x <= Math.min(N - 1, Math.ceil(cx + 6)); x++)
        a[y * N + x] += AMP * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * S * S));
  });

  // subtract the fixed sky from every image, and blank out where stars were, so only things that move are left
  for (const a of data) for (let i = 0; i < a.length; i++) a[i] = fixed[i] > 1.6 ? NaN : a[i] - fixed[i];

  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d"), out = ctx.createImageData(N, N), vals = new Float32Array(frames.length);
  const stackNoise = 1.25 / Math.sqrt(frames.length);   // noise left after taking the middle value of the images

  // Combine the images for a guessed drift (pixels per day). Returns how strongly the planet stands out, in units of the noise.
  function render(vx, vy) {
    const sx = days.map((d) => Math.round(vx * d)), sy = days.map((d) => Math.round(vy * d)), stack = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let n = 0;
      for (let k = 0; k < data.length; k++) { const xx = x + sx[k], yy = y + sy[k]; if (xx >= 0 && yy >= 0 && xx < N && yy < N) { const v = data[k][yy * N + xx]; if (v === v) vals[n++] = v; } }
      // middle value: a star that is in a different place in each shifted image drops out; the planet, in the same place, stays
      for (let i = 1; i < n; i++) { const v = vals[i]; let j = i - 1; while (j >= 0 && vals[j] > v) { vals[j + 1] = vals[j]; j--; } vals[j + 1] = v; }
      stack[y * N + x] = n >= 4 ? vals[n >> 1] : 0;
    }
    // display: the noise shows as a faint grain; anything that stands clear of it lights up
    for (let i = 0; i < stack.length; i++) { const v = 255 * Math.sqrt(Math.min(1, Math.max(0, (stack[i] + 0.15) / 2.3))); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
    ctx.putImageData(out, 0, 0);
    let peak = -9;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) peak = Math.max(peak, stack[(Math.round(y0) + j) * N + Math.round(x0) + i]);
    return peak / stackNoise;
  }
  return { render, truth, max: Math.ceil(speed * 1.6 * 10) / 10, days: T, count: frames.length, spot: { x: x0 / N, y: y0 / N } };
}
