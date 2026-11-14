import { isHit } from "./score.js";

const HIT_RADIUS = 28;   // image pixels; forgiving enough for a fingertip
const BLINK_MS = 700, PLAY_MS = 650;
const BANDS = { D1: "0.75 to 1.11", D2: "1.10 to 1.65", D3: "1.63 to 2.43" };   // micrometres
const ARCHIVE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/";
const $ = (id) => document.getElementById(id);
const utc = (iso) => new Date(iso + "Z");
const fmtDate = (iso) => utc(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (iso) => utc(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const span = (days) => (days >= 1 ? `${days.toFixed(1)} days` : `${(days * 24).toFixed(1)} hours`);

// ---------- image viewer: a stack of aligned frames with blink, slide, difference and time-lapse ----------
class Viewer {
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
    if (mode === "blink") { let on = false; this.show(a); this.timer = setInterval(() => { if (!this.paused) { on = !on; this.show(on ? b : a); } }, BLINK_MS); }
    if (mode === "play") this.timer = setInterval(() => { if (!this.paused) this.show((this.i + 1) % this.frames.length); }, PLAY_MS);
    if (mode === "slide") this.setFade(this.fade);
    if (mode === "diff") {
      const c = this.canvas.getContext("2d"); this.canvas.width = this.canvas.height = this.size;
      c.globalCompositeOperation = "source-over"; c.drawImage(this.els[a], 0, 0, this.size, this.size);
      c.globalCompositeOperation = "difference"; c.drawImage(this.els[b], 0, 0, this.size, this.size);
      this.dateEl.textContent = `${fmtDate(this.frames[a].date)} minus ${fmtDate(this.frames[b].date)}`; this.tagEl.textContent = "difference";
    }
  }
  setFade(v) {
    this.fade = v; const [a, b] = this.pair;   // b is later in the stack, so it draws on top of a
    this.els.forEach((im, k) => (im.style.opacity = k === a ? 1 : k === b ? v : 0));
    this.dateEl.textContent = `${fmtDate(this.frames[a].date)} ↔ ${fmtDate(this.frames[b].date)}`; this.tagEl.textContent = "";
  }
  mark(svg) { this.svg.innerHTML = svg; }
}

const ring = (f, cls = "") => `<circle class="ring ${cls}" cx="${f.x}" cy="${f.y}" r="18"/>`;
const pathSvg = (frames, now = -1) =>
  `<polyline class="path" points="${frames.map((f) => `${f.x},${f.y}`).join(" ")}"/>` +
  frames.map((f, k) => `<circle class="dot ${k === now ? "now" : ""}" cx="${f.x}" cy="${f.y}" r="${k === now ? 6 : 4}"/>`).join("");

// Distance from the Sun on a log scale, with the hypothetical Planet X zone for comparison.
function ruler(name, au) {
  const x = (d) => 30 + 540 * (Math.log10(d / 0.3) / Math.log10(1500 / 0.3));
  const tick = (d, label) => `<line x1="${x(d)}" y1="42" x2="${x(d)}" y2="58" stroke="#5b6a9c" stroke-width="2"/><text x="${x(d)}" y="80" text-anchor="middle">${label}</text>`;
  const me = name ? `<circle cx="${x(au)}" cy="50" r="8" fill="#ffb547"/><text class="me" x="${Math.min(Math.max(x(au), 90), 510)}" y="24" text-anchor="middle">${name}: ${au} au</text>` : "";
  return `<div class="rulerbox"><svg viewBox="0 0 600 90" role="img" aria-label="Distance from the Sun${name ? `: ${name} at ${au} au` : ""}; a hypothetical Planet X would be at several hundred au">
    <rect x="${x(300)}" y="38" width="${x(900) - x(300)}" height="24" rx="5" fill="#ff6f9133" stroke="#ff6f91"/>
    <line x1="30" y1="50" x2="570" y2="50" stroke="#5b6a9c" stroke-width="2"/>
    ${tick(1, "Earth")}${tick(5.2, "Jupiter")}${tick(30, "Neptune")}<text x="${x(520)}" y="80" text-anchor="middle" fill="#ff6f91">Planet X?</text>${me}
  </svg><p class="note">Distance from the Sun (each step is about 10 times farther). 1 au is the distance from Earth to the Sun.</p></div>`;
}

// ---------- state ----------
let levels = [], n = 0, results = [], answered = false;
const demo = new Viewer($("demoView")), hunt = new Viewer($("huntView")), ex = new Viewer($("exView"));
hunt.root.classList.add("tappable");

function fail(msg) { $("error").textContent = msg; $("error").hidden = false; }
const guard = (p) => p.catch(() => fail("An image did not load. Check your connection and refresh the page."));

function go(view) {
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== view));
  document.querySelectorAll(".top nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  demo.paused = view !== "home"; hunt.paused = view !== "hunt" || userPaused; ex.paused = view !== "explore" || exPaused;
  if (view === "explore") showList();
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => go(b.dataset.view)));

// ---------- hunt ----------
let userPaused = false;
const TIPS = {
  blink: "", slide: "Drag the slider to fade from one date to the other.",
  diff: "Astronomer's trick: subtract one image from the other. Stars cancel out. Whatever moved is left behind, twice.",
};
function huntMode(m) {
  document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("slider").hidden = m !== "slide"; $("pauseBtn").hidden = m !== "blink"; $("modeTip").textContent = TIPS[m];
  hunt.setMode(m);
}
function drawDots() {
  $("dots").innerHTML = levels.map((_, k) => `<i class="${results[k] === true ? "hit" : results[k] === false ? "miss" : ""} ${k === n ? "cur" : ""}"></i>`).join("");
  $("progress").textContent = `Level ${n + 1} of ${levels.length}`;
  $("tally").textContent = `Found ${results.filter(Boolean).length}`;
}
function loadLevel() {
  const L = levels[n];
  answered = false; $("card").hidden = true; $("huntControls").hidden = false;
  $("prompt").textContent = "Tap the object that moves.";
  drawDots();
  guard(hunt.load(L.frames, L.size).then(() => huntMode("blink")));
}
function reveal(hit) {
  const L = levels[n], [a, b] = L.frames;
  answered = true; results[n] = hit;
  hunt.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` + ring(a, "was") + ring(b) + ring(b, "pulse"));
  $("card").classList.toggle("hit", hit);
  $("verdict").textContent = hit ? "You found it!" : "Not quite. Here it is.";
  $("objName").textContent = `${L.name}, ${L.kind}`;
  $("blurb").textContent = L.blurb;
  $("facts").innerHTML = [
    `Moved <strong>${L.moved_arcsec} arcseconds</strong> across the sky in <strong>${span(L.days_between)}</strong>`,
    `Dashed ring: ${fmtDate(a.date)}, ${fmtTime(a.date)}. Solid ring: ${fmtDate(b.date)}, ${fmtTime(b.date)}`,
  ].map((t) => `<li>${t}</li>`).join("");
  $("ruler").innerHTML = ruler(L.name, L.distance_au);
  $("prompt").textContent = "The rings show where it was on each date.";
  $("pathBtn").hidden = !(L.track?.length > 2);
  $("nextBtn").textContent = n + 1 < levels.length ? "Next level" : "See your result";
  drawDots();
  $("card").hidden = false;
  $("card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
hunt.onTap = (tap) => { if (!answered) reveal(isHit(tap, levels[n].frames, HIT_RADIUS)); };

$("pathBtn").onclick = () => {
  const L = levels[n];
  $("huntControls").hidden = true; $("modeTip").textContent = ""; $("pathBtn").hidden = true;
  $("prompt").textContent = `${L.name} across ${L.track.length} real SPHEREx images`;
  hunt.onFrame = (i) => hunt.mark(pathSvg(L.track, i));
  guard(hunt.load(L.track, L.size).then(() => hunt.setMode("play")));
  hunt.root.scrollIntoView({ behavior: "smooth", block: "center" });
};
$("nextBtn").onclick = () => { hunt.onFrame = null; if (++n < levels.length) loadLevel(); else finish(); };

function finish() {
  const found = results.filter(Boolean).length;
  hunt.stop();
  $("huntPlay").hidden = true; $("huntEnd").hidden = false;
  $("scoreLine").textContent = `You found ${found} of ${levels.length}`;
  $("rank").textContent = found === levels.length ? "Perfect hunt. Clyde Tombaugh would be proud." : found >= levels.length / 2 ? "Sharp eyes. The faint, slow ones are the hard part." : "The sky is crowded. Try the Difference view next time.";
  const slow = levels.reduce((m, l) => (l.moved_arcsec / l.days_between < m.moved_arcsec / m.days_between ? l : m));
  const far = levels.reduce((m, l) => (l.distance_au > m.distance_au ? l : m));
  $("planetx").textContent =
    `The slowest object you hunted, ${slow.name}, crept only about ${Math.round(slow.moved_arcsec / slow.days_between)} arcseconds a day. ` +
    `${far === slow ? "It" : `The farthest, ${far.name},`} is ${Math.round(far.distance_au)} times as far from the Sun as Earth. ` +
    `If a "Planet X" exists, astronomers think it could be hundreds of times as far as Earth: much fainter, and moving much more slowly still. That is why nobody has found it yet.`;
  $("rulerX").innerHTML = ruler(far.name, far.distance_au);
  window.scrollTo(0, 0);
}
function startHunt() { n = 0; results = []; $("huntPlay").hidden = false; $("huntEnd").hidden = true; go("hunt"); loadLevel(); }
$("startBtn").onclick = startHunt;
$("againBtn").onclick = startHunt;
document.querySelector('.top [data-view="hunt"]').onclick = () => { if (results.length || !levels.length) go("hunt"); else startHunt(); };
$("pauseBtn").onclick = () => { userPaused = !userPaused; hunt.paused = userPaused; $("pauseBtn").textContent = userPaused ? "Resume" : "Pause"; };
$("slider").oninput = (e) => hunt.setFade(e.target.value / 100);
document.querySelectorAll(".mode").forEach((b) => (b.onclick = () => huntMode(b.dataset.mode)));

// ---------- explore ----------
let exLevel = null, exPaused = false;
function showList() { $("exploreList").hidden = false; $("exploreDetail").hidden = true; ex.stop(); }
function drawGrid() {
  $("grid").innerHTML = levels.map((L, k) => {
    const f = L.frames[0], z = 3.3, pos = (v) => Math.max(0, Math.min(100, (((v / L.size) * z - 0.5) / (z - 1)) * 100));
    return `<button class="cardlink" data-k="${k}"><span class="thumb" style="display:block;background-image:url(${f.img});background-position:${pos(f.x)}% ${pos(f.y)}%"></span>
      <span class="meta"><b>${L.name}</b><span>${L.kind}</span><span>${L.distance_au} au from the Sun · ${(L.track || L.frames).length} images</span></span></button>`;
  }).join("");
  document.querySelectorAll(".cardlink").forEach((b) => (b.onclick = () => openObject(levels[b.dataset.k])));
}
function exFrames() { return exLevel.track?.length > 1 ? exLevel.track : exLevel.frames; }
function exMode(m) {
  document.querySelectorAll(".exmode").forEach((b) => b.classList.toggle("on", b.dataset.exmode === m));
  $("exPause").hidden = m === "diff"; $("scrub").hidden = m !== "play";
  ex.setMode(m);
  if (m === "diff") ex.mark("");
}
function openObject(L) {
  exLevel = L;
  const frames = exFrames(), first = frames[0], last = frames[frames.length - 1];
  $("exploreList").hidden = true; $("exploreDetail").hidden = false;
  $("exName").textContent = L.name; $("exBlurb").textContent = L.blurb;
  $("scrub").max = frames.length - 1;
  $("objInfo").innerHTML = [
    ["Type", L.kind], ["Distance from the Sun", `${L.distance_au} au`], ["Brightness", `magnitude ${L.mag.toFixed(1)} (lower is brighter)`],
    ["Images", `${frames.length}, from ${fmtDate(first.date)} to ${fmtDate(last.date)}`],
    ["Patch of sky", `${Math.round((L.size * L.arcsec_per_px) / 60)} arcminutes across, north up`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("exRuler").innerHTML = ruler(L.name, L.distance_au);
  ex.onFrame = (i) => {
    const f = frames[i];
    $("scrub").value = i;
    ex.mark($("pathChk").checked ? pathSvg(frames, i) : "");
    $("frameInfo").innerHTML = [
      ["Taken", `${fmtDate(f.date)}, ${fmtTime(f.date)}`],
      ["Detector", `SPHEREx ${f.band}, ${BANDS[f.band]} micrometres (infrared)`],
      ["Object position", f.ra != null ? `RA ${f.ra}°, Dec ${f.dec}° (NASA JPL Horizons)` : "from NASA JPL Horizons"],
      ["Detection", `${Math.round(f.snr)} times the background noise`],
      ["Original file", `<a href="${ARCHIVE + f.source}" rel="noopener">NASA/IPAC archive (FITS, about 65 MB)</a>`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  };
  guard(ex.load(frames, L.size).then(() => exMode("play")));
  window.scrollTo(0, 0);
}
$("backBtn").onclick = showList;
$("exPause").onclick = () => { exPaused = !exPaused; ex.paused = exPaused; $("exPause").textContent = exPaused ? "Resume" : "Pause"; };
$("scrub").oninput = (e) => { exPaused = true; ex.paused = true; $("exPause").textContent = "Resume"; ex.show(+e.target.value); };
$("pathChk").onchange = () => ex.mode !== "diff" && ex.show(ex.i);
$("colourChk").onchange = (e) => document.body.classList.toggle("grey", !e.target.checked);
document.querySelectorAll(".exmode").forEach((b) => (b.onclick = () => exMode(b.dataset.exmode)));

// ---------- start ----------
fetch("levels.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => {
    if (!d.length) throw new Error("no levels");
    levels = d;
    const images = levels.reduce((s, l) => s + (l.track?.length > 1 ? l.track.length : 2), 0);
    $("stats").innerHTML = [[levels.length, "real worlds to find"], [images, "real SPHEREx images"], ["100%", "positions checked with NASA JPL"]]
      .map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
    $("startBtn").textContent = "Start the hunt"; $("startBtn").disabled = false;
    drawGrid();
    const L = levels[0];
    $("demoCap").textContent = `Live: two real SPHEREx images, ${span(L.days_between)} apart. Can you see what moves?`;
    return demo.load(L.frames, L.size).then(() => demo.setMode("blink"));
  })
  .catch(() => fail("The game data did not load. Check your connection and refresh the page."));
