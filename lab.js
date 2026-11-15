// Planet X lab: a speed-versus-distance chart, and a simulator that hides a made-up planet in real SPHEREx images.
import { $, Viewer, span } from "./viewer.js?v=52";
import { t, tr } from "./i18n.js?v=52";
import { isHit } from "./score.js?v=52";

const PLUTO_KM = 1188;   // Pluto's radius; the simulator scales brightness from the real Pluto in the same images
const SIZES = [{ label: "Pluto-sized", km: 1188 }, { label: "Earth-sized", km: 6371 }, { label: "3× Earth's width", km: 19113 }];
const SIGMA = 4.2;       // blur of a point of light in these images, in image pixels
const speed = (l) => l.moved_arcsec / l.days_between;   // arcseconds per day

// Every object by distance and speed, on log scales. Farther objects move more slowly; Planet X would sit bottom right.
export function speedChart(levels, markId) {
  const X = (au) => 60 + 500 * (Math.log10(au) / 3), Y = (s) => 250 - 220 * (Math.log10(s / 0.1) / Math.log10(20000));
  // trend: straight-line fit through the dots on the log-log chart
  const lx = levels.map((l) => Math.log10(l.distance_au)), ly = levels.map((l) => Math.log10(speed(l))), mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  const mx = mean(lx), my = mean(ly), slope = lx.reduce((t, v, i) => t + (v - mx) * (ly[i] - my), 0) / (lx.reduce((t, v) => t + (v - mx) ** 2, 0) || 1);
  const fit = (au) => Math.max(0.1, 10 ** (my + slope * (Math.log10(au) - mx)));
  const xt = [1, 10, 100, 1000].map((v) => `<line x1="${X(v)}" y1="250" x2="${X(v)}" y2="256" stroke="#5b6a9c"/><text x="${X(v)}" y="274" text-anchor="middle">${v}</text>`).join("");
  const yt = [0.1, 1, 10, 100, 1000].map((v) => `<line x1="54" y1="${Y(v)}" x2="60" y2="${Y(v)}" stroke="#5b6a9c"/><text x="50" y="${Y(v) + 5}" text-anchor="end">${v}</text>`).join("");
  const used = [];   // label rows already taken, so names of neighbouring dots do not overlap
  const pts = [...levels].sort((a, b) => speed(b) - speed(a)).map((l) => {
    const x = X(l.distance_au), y = Y(speed(l));
    let ty = y + 6; while (used.some((u) => Math.abs(u.x - x) < 90 && Math.abs(u.y - ty) < 19)) ty += 19;
    used.push({ x, y: ty });
    return `<circle cx="${x}" cy="${y}" r="${l.id === markId ? 9 : 6}" fill="${l.id === markId ? "#fff" : "#ffb547"}" stroke="#ffb547" stroke-width="2"/>
    <text x="${x + 13}" y="${ty}" class="${l.id === markId ? "me" : ""}">${l.name}</text>`;
  }).join("");
  return `<div class="chartbox"><svg viewBox="0 0 600 300" role="img" aria-label="${tr("Farther means slower")}">
    <rect x="${X(300)}" y="30" width="${X(900) - X(300)}" height="220" fill="#ff6f9122" stroke="#ff6f91" stroke-dasharray="4 4"/>
    <text x="${(X(300) + X(900)) / 2}" y="48" text-anchor="middle" fill="#ff6f91">Planet X?</text>
    <line x1="60" y1="250" x2="560" y2="250" stroke="#5b6a9c" stroke-width="2"/><line x1="60" y1="30" x2="60" y2="250" stroke="#5b6a9c" stroke-width="2"/>
    <line x1="${X(1)}" y1="${Y(Math.min(2000, fit(1)))}" x2="${X(1000)}" y2="${Y(fit(1000))}" stroke="#7dffcf" stroke-dasharray="6 6" opacity=".6"/>
    ${xt}${yt}${pts}
    <text x="310" y="295" text-anchor="middle">${tr("Distance from the Sun (au)")}</text>
    <text transform="translate(14 140) rotate(-90)" text-anchor="middle">${tr("Speed across the sky (arcseconds per day)")}</text>
  </svg><p class="note">${tr("Each dot is a real measurement from the SPHEREx images on this site. The dashed line is the trend through them: the farther from the Sun, the slower across the sky. Exact speeds also depend on where Earth is in its orbit.")}</p></div>`;
}

// ---------- simulator ----------
const view = new Viewer($("labView"));
view.root.classList.add("tappable");
let base = null, sim = null, sizeIx = 2, guessed = false;
const dist = () => Math.round(40 * Math.pow(20, $("distSlider").value / 100));   // 40 to 800 au, log scale

function toCanvas(src) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.onload = () => { const c = document.createElement("canvas"); c.width = c.height = im.naturalWidth; c.getContext("2d").drawImage(im, 0, 0); ok(c); };
    im.onerror = bad; im.src = src;
  });
}
const lin = (v) => (v / 255) ** 2;   // the PNGs store the square root of brightness; undo that before adding light

// How bright the real object is in one frame, above the sky around it.
function peakOf(c, f) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, at = (x, y) => lin(d[(Math.round(y) * c.width + Math.round(x)) * 4]);
  let peak = 0; const sky = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) peak = Math.max(peak, at(f.x + dx, f.y + dy));
  for (let a = 0; a < 24; a++) sky.push(at(f.x + 30 * Math.cos(a / 24 * 6.283), f.y + 30 * Math.sin(a / 24 * 6.283)));
  return peak - sky.sort((p, q) => p - q)[12];
}

function plant(c, x, y, amp) {
  const out = document.createElement("canvas"); out.width = out.height = c.width;
  const g = out.getContext("2d"); g.drawImage(c, 0, 0);
  const R = Math.ceil(4 * SIGMA), x0 = Math.round(x) - R, y0 = Math.round(y) - R, img = g.getImageData(x0, y0, 2 * R + 1, 2 * R + 1);
  for (let j = 0; j <= 2 * R; j++) for (let i = 0; i <= 2 * R; i++) {
    const r2 = (x0 + i - x) ** 2 + (y0 + j - y) ** 2, p = (j * (2 * R + 1) + i) * 4;
    const v = 255 * Math.sqrt(Math.min(1, lin(img.data[p]) + amp * Math.exp(-r2 / (2 * SIGMA * SIGMA))));
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
  }
  g.putImageData(img, x0, y0);
  return out.toDataURL("image/png");
}

// A made-up planet planted into a level's two real images. Movement and brightness are scaled from the level's real object.
const simCache = new Map();
export async function simFrames(level, au, km, spot) {
  if (!simCache.has(level.id)) {
    const cv = await Promise.all(level.frames.map((f) => toCanvas(f.img)));
    simCache.set(level.id, { cv, peaks: level.frames.map((f, k) => peakOf(cv[k], f)) });
  }
  const { cv, peaks: pk } = simCache.get(level.id), [a, b] = level.frames, near = level.distance_au / au;
  const bright = (km / PLUTO_KM) ** 2 * near ** 4;                      // reflected sunlight: area × 1 / distance⁴
  const dx = (b.x - a.x) * near, dy = (b.y - a.y) * near;                // motion scaled from the real object's
  if (!spot) {
    let x, y;
    do { x = 70 + Math.random() * (level.size - 140); y = 70 + Math.random() * (level.size - 140); }
    while (Math.hypot(x - a.x, y - a.y) < 70 || Math.hypot(x - b.x, y - b.y) < 70);
    spot = { x, y };
  }
  const pos = [{ x: spot.x - dx / 2, y: spot.y - dy / 2 }, { x: spot.x + dx / 2, y: spot.y + dy / 2 }];
  const frames = level.frames.map((f, k) => ({ ...f, ...pos[k], band: t`${f.band} + simulated object`, img: plant(cv[k], pos[k].x, pos[k].y, pk[k] * bright) }));
  return { frames, spot, bright, moved: level.moved_arcsec * near, snr: Math.min(a.snr, b.snr) * bright };
}

async function rebuild(newSpot) {
  const d = dist(), made = await simFrames(base, d, SIZES[sizeIx].km, newSpot || !sim ? null : sim);
  sim = { x: made.spot.x, y: made.spot.y, frames: made.frames }; guessed = false;
  const { frames, bright, snr, moved } = made;
  $("labDist").textContent = `${d} au`;
  $("labOut").innerHTML = [
    t`Moves <strong>${moved < 10 ? moved.toFixed(1) : Math.round(moved)} arcseconds</strong> in ${span(base.days_between)} (${base.name} moved ${base.moved_arcsec})`,
    bright >= 1 ? t`Brightness: <strong>${bright.toFixed(1)} times ${base.name}'s</strong>`
      : t`Brightness: <strong>${bright * 100 < 0.1 ? tr("under 0.1") : (bright * 100).toFixed(bright < 0.01 ? 1 : 0)}% of ${base.name}'s</strong>`,
    t`Signal: <strong>about ${snr < 1 ? snr.toFixed(1) : Math.round(snr)} times the background noise</strong>`,
  ].map((li) => `<li>${li}</li>`).join("");
  $("labVerdict").textContent = snr >= 5 && moved >= 6 ? tr("Findable: bright enough to see, and it moves enough to notice.")
    : snr >= 5 ? tr("Bright enough to see, but it barely moves in this time. You would need images taken further apart.")
    : tr("Too faint for a single SPHEREx image. Astronomers would have to add many images together to pull it out of the noise.");
  $("labMsg").textContent = tr("Tap where you think the simulated planet is.");
  view.load(frames, base.size).then(() => { view.pair = [0, 1]; view.setMode("blink"); });
}
function reveal(hit) {
  guessed = true;
  const [a, b] = sim.frames;
  view.mark(`<circle class="ring was" cx="${a.x}" cy="${a.y}" r="18"/><circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/><circle class="ring pulse" cx="${b.x}" cy="${b.y}" r="18"/>`);
  $("labMsg").textContent = hit === true ? tr("You found it!") : hit === false ? tr("Not there. The rings show where it was hidden.") : tr("The rings show where it was hidden.");
}
view.onTap = (tap) => { if (sim && !guessed) reveal(isHit(tap, sim.frames, 28)); };

fetch("levels.json").then((r) => r.json()).then(async (levels) => {
  $("labChart").innerHTML = speedChart(levels);
  base = levels.find((l) => l.id === "pluto") || levels.reduce((m, l) => (l.distance_au > m.distance_au ? l : m));
  $("labSizes").innerHTML = SIZES.map((s, k) => `<button class="size ${k === sizeIx ? "on" : ""}" data-k="${k}">${tr(s.label)}</button>`).join("");
  document.querySelectorAll(".size").forEach((b) => (b.onclick = () => { sizeIx = +b.dataset.k; document.querySelectorAll(".size").forEach((x) => x.classList.toggle("on", x === b)); rebuild(false); }));
  $("distSlider").oninput = () => rebuild(false);
  $("labNew").onclick = () => rebuild(true);
  $("labReveal").onclick = () => reveal(null);
  $("labBase").textContent = t`${base.name} is ${base.distance_au} au from the Sun`;
  rebuild(true);
}).catch(() => {});   // app.js reports a failed load
