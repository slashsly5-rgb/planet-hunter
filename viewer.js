// Shared pieces: the image viewer, date formatting, and the SVG overlays.
import { t, tr, locale } from "./i18n.js?v=66";
export const BLINK_MS = 700, PLAY_MS = 650;
export const BANDS = { D1: "0.75 to 1.11", D2: "1.10 to 1.65", D3: "1.63 to 2.43" };   // micrometres
export const ARCHIVE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/";
export const $ = (id) => document.getElementById(id);
export const utc = (iso) => new Date(iso + "Z");
export const fmtDate = (iso) => utc(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fmtTime = (iso) => utc(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }) + " UTC";
export const span = (days) => (days >= 1 ? t`${days.toFixed(1)} days` : t`${(days * 24).toFixed(1)} hours`);

// ---------- image viewer: a stack of aligned frames with blink, slide, difference and time-lapse ----------
export class Viewer {
  constructor(root) {
    this.root = root;
    root.className = "viewer";
    root.innerHTML = `<div class="imgs"></div><canvas hidden></canvas><svg class="mark"></svg>
      <i class="corner tl"></i><i class="corner tr"></i><span class="chip date"></span><span class="chip tag"></span>`;
    [this.imgs, this.canvas, this.svg] = ["div", "canvas", "svg"].map((s) => root.querySelector(s));
    this.dateEl = root.querySelector(".date"); this.tagEl = root.querySelector(".tag");
    this.frames = []; this.els = []; this.pair = [0, 1]; this.fade = 0.5; this.paused = false; this.ready = false;
    root.addEventListener("click", (e) => {
      if (!this.ready || !this.onTap) return;
      const r = root.getBoundingClientRect();
      this.onTap({ x: ((e.clientX - r.left) / r.width) * this.size, y: ((e.clientY - r.top) / r.height) * this.size });
    });
  }
  async load(frames, size) {
    this.stop(); this.ready = false; this.frames = frames; this.size = size;
    this.svg.setAttribute("viewBox", `0 0 ${size} ${size}`); this.svg.innerHTML = "";
    const token = (this.token = {});
    const els = await Promise.all(frames.map((f) => new Promise((ok, bad) => {
      const im = new Image(); im.alt = ""; im.draggable = false;
      im.onload = () => ok(im); im.onerror = () => bad(new Error(f.img)); im.src = f.img;
    })));
    if (token !== this.token) return;          // a newer load started while these were downloading
    this.els = els; this.imgs.replaceChildren(...els);
    this.pair = [0, frames.length - 1]; this.ready = true; this.show(0);
  }
  show(i) {
    this.i = i;
    this.els.forEach((im, k) => (im.style.opacity = k === i ? 1 : 0));
    this.dateEl.textContent = `${fmtDate(this.frames[i].date)}, ${fmtTime(this.frames[i].date)}`;
    this.tagEl.textContent = `SPHEREx ${this.frames[i].band}`;
    this.onFrame?.(i);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  setMode(mode) {
    this.stop(); this.mode = mode; this.canvas.hidden = mode !== "diff";
    const [a, b] = this.pair;
    if (mode === "blink") { let on = false; this.show(a); this.timer = setInterval(() => { if (!this.paused) { on = !on; this.show(on ? b : a); } }, this.blinkMs || BLINK_MS); }
    if (mode === "play") this.timer = setInterval(() => { if (!this.paused) this.show((this.i + 1) % this.frames.length); }, PLAY_MS);
    if (mode === "slide") this.setFade(this.fade);
    if (mode === "diff") {
      const c = this.canvas.getContext("2d"); this.canvas.width = this.canvas.height = this.size;
      c.globalCompositeOperation = "source-over"; c.drawImage(this.els[a], 0, 0, this.size, this.size);
      c.globalCompositeOperation = "difference"; c.drawImage(this.els[b], 0, 0, this.size, this.size);
      this.dateEl.textContent = t`${fmtDate(this.frames[a].date)} minus ${fmtDate(this.frames[b].date)}`; this.tagEl.textContent = tr("difference");
    }
  }
  setFade(v) {
    this.fade = v; const [a, b] = this.pair;   // b is later in the stack, so it draws on top of a
    this.els.forEach((im, k) => (im.style.opacity = k === a ? 1 : k === b ? v : 0));
    this.dateEl.textContent = `${fmtDate(this.frames[a].date)} ↔ ${fmtDate(this.frames[b].date)}`; this.tagEl.textContent = "";
  }
  mark(svg) { this.svg.innerHTML = svg; }
}

export const ring = (f, cls = "") => `<circle class="ring ${cls}" cx="${f.x}" cy="${f.y}" r="18"/>`;
export const pathSvg = (frames, now = -1) =>
  `<polyline class="path" points="${frames.map((f) => `${f.x},${f.y}`).join(" ")}"/>` +
  frames.map((f, k) => `<circle class="dot ${k === now ? "now" : ""}" cx="${f.x}" cy="${f.y}" r="${k === now ? 6 : 4}"/>`).join("");

// Distance from the Sun on a log scale, with the hypothetical Planet X zone for comparison.
export function ruler(name, au) {
  const x = (d) => 30 + 540 * (Math.log10(d / 0.3) / Math.log10(1500 / 0.3));
  const tick = (d, label) => `<line x1="${x(d)}" y1="42" x2="${x(d)}" y2="58" stroke="#5b6a9c" stroke-width="2"/><text x="${x(d)}" y="80" text-anchor="middle">${label}</text>`;
  const me = name ? `<circle cx="${x(au)}" cy="50" r="8" fill="#ffb547"/><text class="me" x="${Math.min(Math.max(x(au), 90), 510)}" y="24" text-anchor="middle">${name}: ${au} au</text>` : "";
  return `<div class="rulerbox"><svg viewBox="0 0 600 90" role="img" aria-label="${tr("Distance from the Sun")}${name ? `: ${name}, ${au} au` : ""}">
    <rect x="${x(300)}" y="38" width="${x(900) - x(300)}" height="24" rx="5" fill="#ff6f9133" stroke="#ff6f91"/>
    <line x1="30" y1="50" x2="570" y2="50" stroke="#5b6a9c" stroke-width="2"/>
    ${tick(1, tr("Earth"))}${tick(5.2, tr("Jupiter"))}${tick(30, tr("Neptune"))}<text x="${x(520)}" y="80" text-anchor="middle" fill="#ff6f91">Planet X?</text>${me}
  </svg><p class="note">${tr("Distance from the Sun (each step is about 10 times farther). 1 au is the distance from Earth to the Sun.")}</p></div>`;
}

