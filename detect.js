// Automatic detector: classic computer vision, not machine learning. It subtracts one image from the other and looks at what is left.
//   mover      a bright spot in image A with a matching spot somewhere else in image B, each missing from the other image
//   single     something that appears in only one image (usually a cosmic ray hitting the detector, or noise)
//   changed    something in the same place in both images whose brightness changed (a star seen at two wavelengths)
const N = 242;   // working size in pixels; the pictures are 484 across

function grey(img) {
  const c = document.createElement("canvas"); c.width = c.height = N;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data, out = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = d[i * 4];
  return out;
}
function median(arr) { const s = Float32Array.from(arr).sort(); return s[s.length >> 1]; }
// each image is scaled differently, so put both on the same footing: subtract the sky, divide by the noise, smooth a little
function standardise(a) {
  const m = median(a), dev = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) dev[i] = Math.abs(a[i] - m);
  const sigma = 1.4826 * median(dev) || 1, z = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) z[i] = (a[i] - m) / sigma;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += z[(y + j) * N + x + i];
    out[y * N + x] = s / 9;
  }
  return out;
}
function peaks(d, sign, threshold) {
  const found = [];
  for (let y = 4; y < N - 4; y++) for (let x = 4; x < N - 4; x++) {
    const v = sign * d[y * N + x]; if (v < threshold) continue;
    let top = true;
    for (let j = -4; j <= 4 && top; j++) for (let i = -4; i <= 4; i++) if (sign * d[(y + j) * N + x + i] > v) { top = false; break; }
    if (top) found.push({ x, y, v });
  }
  return found.sort((p, q) => q.v - p.v).slice(0, 14);
}

// imgA, imgB: loaded <img> elements of two aligned pictures. Returns positions in picture pixels (0..size).
export function detect(imgA, imgB, size) {
  const A = standardise(grey(imgA)), B = standardise(grey(imgB)), D = new Float32Array(N * N);
  for (let i = 0; i < D.length; i++) D[i] = A[i] - B[i];
  const dev = new Float32Array(D.length), m = median(D);
  for (let i = 0; i < D.length; i++) dev[i] = Math.abs(D[i] - m);
  const sigma = 1.4826 * median(dev) || 1, T = 6 * sigma, k = size / N;
  const at = (arr, p) => arr[p.y * N + p.x];
  // "only here": clearly present in this image and essentially absent at the same place in the other
  const onlyA = peaks(D, 1, T).map((p) => ({ ...p, lone: at(B, p) < 0.3 * at(A, p) }));
  const onlyB = peaks(D, -1, T).map((p) => ({ ...p, lone: at(A, p) < 0.3 * at(B, p) }));
  const movers = [], used = new Set();
  for (const p of onlyA.filter((q) => q.lone)) {
    let best = null;
    for (const q of onlyB.filter((r) => r.lone && !used.has(r))) {
      const gap = Math.hypot(p.x - q.x, p.y - q.y), ratio = Math.min(p.v, q.v) / Math.max(p.v, q.v);
      if (gap < 3 || gap > 90 || ratio < 0.3) continue;
      const score = (Math.min(p.v, q.v) / sigma) * ratio;
      if (!best || score > best.score) best = { q, score };
    }
    if (best) { used.add(best.q); p.paired = true; movers.push({ a: { x: p.x * k, y: p.y * k }, b: { x: best.q.x * k, y: best.q.y * k }, score: best.score, confidence: Math.round(100 * best.score / (best.score + 10)) }); }
  }
  movers.sort((p, q) => q.score - p.score);
  const singles = [...onlyA.filter((p) => p.lone && !p.paired).map((p) => ({ x: p.x * k, y: p.y * k, image: 0 })),
                   ...onlyB.filter((p) => p.lone && !used.has(p)).map((p) => ({ x: p.x * k, y: p.y * k, image: 1 }))];
  const changed = [...onlyA, ...onlyB].filter((p) => !p.lone).map((p) => ({ x: p.x * k, y: p.y * k }));
  return { movers: movers.slice(0, 4), singles: singles.slice(0, 10), changed: changed.slice(0, 10) };
}

// Did the detector's top pick land on the real object? truth: the object's real positions in the two pictures.
export function judge(result, truth, radius = 18) {
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= radius, top = result.movers[0];
  const right = (mv) => (near(mv.a, truth[0]) && near(mv.b, truth[1])) || (near(mv.a, truth[1]) && near(mv.b, truth[0]));
  return { found: !!top && right(top), listed: result.movers.some(right), top };
}

// SVG overlay: green boxes joined by a line for movers, amber for things in one picture only, grey for brightness changes
export function overlay(result) {
  const box = (p, r, cls) => `<rect class="det ${cls}" x="${p.x - r}" y="${p.y - r}" width="${2 * r}" height="${2 * r}"/>`;
  return result.changed.map((p) => box(p, 9, "chg")).join("") + result.singles.map((p) => box(p, 10, "one")).join("") +
    result.movers.map((mv, i) => `<line class="det mv" x1="${mv.a.x}" y1="${mv.a.y}" x2="${mv.b.x}" y2="${mv.b.y}"/>` + box(mv.a, 14, "mv") + box(mv.b, 14, "mv") +
      `<text class="dett" x="${Math.min(mv.a.x, mv.b.x) - 14}" y="${Math.min(mv.a.y, mv.b.y) - 20}">${i ? "" : "#1 "}${mv.confidence}%</text>`).join("");
}
