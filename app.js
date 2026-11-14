import { isHit } from "./score.js";
import { BANDS, ARCHIVE, $, fmtDate, fmtTime, span, Viewer, ring, pathSvg, ruler } from "./viewer.js";
import { speedChart } from "./lab.js";
import { t, tr } from "./i18n.js";

const HIT_RADIUS = 28;   // image pixels; forgiving enough for a fingertip

// ---------- state ----------
let levels = [], n = 0, results = [], answered = false;
const demo = new Viewer($("demoView")), hunt = new Viewer($("huntView")), ex = new Viewer($("exView"));
hunt.root.classList.add("tappable");

function fail(msg) { $("error").textContent = msg; $("error").hidden = false; }
const guard = (p) => p.catch(() => fail(tr("An image did not load. Check your connection and refresh the page.")));

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
  blink: "", slide: tr("Drag the slider to fade from one date to the other."),
  diff: tr("Astronomer's trick: subtract one image from the other. Stars cancel out. Whatever moved is left behind, twice."),
};
function huntMode(m) {
  document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("slider").hidden = m !== "slide"; $("pauseBtn").hidden = m !== "blink"; $("modeTip").textContent = TIPS[m];
  hunt.setMode(m);
}
function drawDots() {
  $("dots").innerHTML = levels.map((_, k) => `<i class="${results[k] === true ? "hit" : results[k] === false ? "miss" : ""} ${k === n ? "cur" : ""}"></i>`).join("");
  $("progress").textContent = t`Level ${n + 1} of ${levels.length}`;
  $("tally").textContent = t`Found ${results.filter(Boolean).length}`;
}
function loadLevel() {
  const L = levels[n];
  answered = false; $("card").hidden = true; $("huntControls").hidden = false;
  $("prompt").textContent = tr("Tap the object that moves.");
  drawDots();
  guard(hunt.load(L.frames, L.size).then(() => huntMode("blink")));
}
function reveal(hit) {
  const L = levels[n], [a, b] = L.frames;
  answered = true; results[n] = hit;
  hunt.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` + ring(a, "was") + ring(b) + ring(b, "pulse"));
  $("card").classList.toggle("hit", hit);
  $("verdict").textContent = hit ? tr("You found it!") : tr("Not quite. Here it is.");
  $("objName").textContent = `${L.name}, ${tr(L.kind)}`;
  $("blurb").textContent = tr(L.blurb);
  $("facts").innerHTML = [
    t`Moved <strong>${L.moved_arcsec} arcseconds</strong> across the sky in <strong>${span(L.days_between)}</strong>`,
    t`Dashed ring: ${fmtDate(a.date)}, ${fmtTime(a.date)}. Solid ring: ${fmtDate(b.date)}, ${fmtTime(b.date)}`,
  ].map((li) => `<li>${li}</li>`).join("");
  $("ruler").innerHTML = ruler(L.name, L.distance_au);
  $("prompt").textContent = tr("The rings show where it was on each date.");
  $("pathBtn").hidden = !(L.track?.length > 2);
  $("nextBtn").textContent = n + 1 < levels.length ? tr("Next level") : tr("See your result");
  drawDots();
  $("card").hidden = false;
  $("card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
hunt.onTap = (tap) => { if (!answered) reveal(isHit(tap, levels[n].frames, HIT_RADIUS)); };

$("pathBtn").onclick = () => {
  const L = levels[n];
  $("huntControls").hidden = true; $("modeTip").textContent = ""; $("pathBtn").hidden = true;
  $("prompt").textContent = t`${L.name} across ${L.track.length} real SPHEREx images`;
  hunt.onFrame = (i) => hunt.mark(pathSvg(L.track, i));
  guard(hunt.load(L.track, L.size).then(() => hunt.setMode("play")));
  hunt.root.scrollIntoView({ behavior: "smooth", block: "center" });
};
$("nextBtn").onclick = () => { hunt.onFrame = null; if (++n < levels.length) loadLevel(); else finish(); };

function finish() {
  const found = results.filter(Boolean).length;
  hunt.stop();
  $("huntPlay").hidden = true; $("huntEnd").hidden = false;
  $("scoreLine").textContent = t`You found ${found} of ${levels.length}`;
  $("rank").textContent = found === levels.length ? tr("Perfect hunt. Clyde Tombaugh would be proud.") : found >= levels.length / 2 ? tr("Sharp eyes. The faint, slow ones are the hard part.") : tr("The sky is crowded. Try the Difference view next time.");
  const slow = levels.reduce((m, l) => (l.moved_arcsec / l.days_between < m.moved_arcsec / m.days_between ? l : m));
  const far = levels.reduce((m, l) => (l.distance_au > m.distance_au ? l : m));
  $("planetx").textContent =
    t`The slowest object you hunted, ${slow.name}, crept only about ${Math.round(slow.moved_arcsec / slow.days_between)} arcseconds a day.` + " " +
    t`The farthest, ${far.name}, is ${Math.round(far.distance_au)} times as far from the Sun as Earth.` + " " +
    tr(`If a "Planet X" exists, astronomers think it could be hundreds of times as far as Earth: much fainter, and moving much more slowly still. That is why nobody has found it yet.`);
  $("rulerX").innerHTML = ruler(far.name, far.distance_au);
  $("endChart").innerHTML = speedChart(levels);
  window.scrollTo(0, 0);
}
function startHunt() { n = 0; results = []; $("huntPlay").hidden = false; $("huntEnd").hidden = true; go("hunt"); loadLevel(); }
$("startBtn").onclick = startHunt;
$("againBtn").onclick = startHunt;
document.querySelector('.top [data-view="hunt"]').onclick = () => { if (results.length || !levels.length) go("hunt"); else startHunt(); };
$("pauseBtn").onclick = () => { userPaused = !userPaused; hunt.paused = userPaused; $("pauseBtn").textContent = userPaused ? tr("Resume") : tr("Pause"); };
$("slider").oninput = (e) => hunt.setFade(e.target.value / 100);
document.querySelectorAll(".mode").forEach((b) => (b.onclick = () => huntMode(b.dataset.mode)));

// ---------- explore ----------
let exLevel = null, exPaused = false;
function showList() { $("exploreList").hidden = false; $("exploreDetail").hidden = true; ex.stop(); }
function drawGrid() {
  $("grid").innerHTML = levels.map((L, k) => {
    const f = L.frames[0], z = 3.3, pos = (v) => Math.max(0, Math.min(100, (((v / L.size) * z - 0.5) / (z - 1)) * 100));
    return `<button class="cardlink" data-k="${k}"><span class="thumb" style="display:block;background-image:url(${f.img});background-position:${pos(f.x)}% ${pos(f.y)}%"></span>
      <span class="meta"><b>${L.name}</b><span>${tr(L.kind)}</span><span>${t`${L.distance_au} au from the Sun · ${(L.track || L.frames).length} images`}</span></span></button>`;
  }).join("");
  document.querySelectorAll(".cardlink").forEach((b) => (b.onclick = () => openObject(levels[b.dataset.k])));
}
function exFrames() { return exLevel.track?.length > 1 ? exLevel.track : exLevel.frames; }
const tip = (html) => { $("exTip").innerHTML = html; $("exTip").hidden = !html; };
async function exMode(m) {
  document.querySelectorAll(".exmode").forEach((b) => b.classList.toggle("on", b.dataset.exmode === m));
  $("exPause").hidden = m === "diff"; $("scrub").hidden = m !== "play";
  measure = null; ex.root.classList.remove("tappable"); tip("");
  const L = exLevel, pass = m === "pass", want = pass ? [exFrames()[0], L.other_pass] : exFrames();
  if (ex.frames !== want && ex.frames[1] !== want[1]) await guard(ex.load(want, L.size));   // swap between the time-lapse and the six-month pair
  ex.setMode(pass ? "blink" : m);
  if (m === "diff") ex.mark("");
  if (pass) {
    const then = fmtDate(want[0].date), other = fmtDate(L.other_pass.date);
    tip(t`SPHEREx photographed this same patch on <strong>${then}</strong> and again on <strong>${other}</strong>, in a different pass over the sky. The stars are all still there. ${L.name} is not: it moved on long ago. The ring shows where it was.`);
  }
}

// Measure it yourself: tap the object in the first and last image; compare with NASA JPL.
let measure = null;
function startMeasure() {
  const frames = exFrames();
  exMode("play").then(() => {
    ex.stop(); measure = { pts: [] }; ex.root.classList.add("tappable");
    ex.show(0); ex.mark("");
    tip(t`<strong>Step 1 of 2.</strong> This is the first image (${fmtDate(frames[0].date)}, ${fmtTime(frames[0].date)}). Tap ${exLevel.name}.`);
  });
}
ex.onTap = (p) => {
  if (!measure) return;
  const frames = exFrames(), L = exLevel, last = frames.length - 1, dot = (q) => `<circle class="dot now" cx="${q.x}" cy="${q.y}" r="6"/>`;
  measure.pts.push(p);
  if (measure.pts.length === 1) {
    ex.show(last); ex.mark(dot(p));
    tip(t`<strong>Step 2 of 2.</strong> Now the last image (${fmtDate(frames[last].date)}, ${fmtTime(frames[last].date)}). Tap ${L.name} again.`);
    return;
  }
  const [a, b] = measure.pts, days = (new Date(frames[last].date) - new Date(frames[0].date)) / 864e5;
  const mine = Math.hypot(b.x - a.x, b.y - a.y) * L.arcsec_per_px, jpl = Math.hypot(frames[last].x - frames[0].x, frames[last].y - frames[0].y) * L.arcsec_per_px;
  ex.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` + dot(a) + dot(b));
  tip(t`You measured <strong>${Math.round(mine)} arcseconds</strong> in ${span(days)}: about <strong>${Math.round(mine / days)} arcseconds a day</strong>.` + " " +
      t`NASA JPL's answer is ${Math.round(jpl)} arcseconds. You were ${Math.round(Math.abs(mine - jpl) / jpl * 100)}% off.` + " " +
      tr("(An arcsecond is tiny: the full Moon is about 1,800 arcseconds wide.)"));
  measure = null; ex.root.classList.remove("tappable");
};
function openObject(L) {
  exLevel = L;
  const frames = exFrames(), first = frames[0], last = frames[frames.length - 1];
  $("exploreList").hidden = true; $("exploreDetail").hidden = false;
  $("exName").textContent = L.name; $("exBlurb").textContent = tr(L.blurb);
  $("scrub").max = frames.length - 1;
  $("objInfo").innerHTML = [
    [tr("Type"), tr(L.kind)], [tr("Distance from the Sun"), `${L.distance_au} au`], [tr("Brightness"), t`magnitude ${L.mag.toFixed(1)} (lower is brighter)`],
    [tr("Images"), t`${frames.length}, from ${fmtDate(first.date)} to ${fmtDate(last.date)}`],
    [tr("Patch of sky"), t`${Math.round((L.size * L.arcsec_per_px) / 60)} arcminutes across, north up`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("exRuler").innerHTML = ruler(L.name, L.distance_au);
  $("exChart").innerHTML = speedChart(levels, L.id);
  $("passBtn").hidden = !L.other_pass;
  ex.onFrame = (i) => {
    const f = ex.frames[i];
    if (measure) return;
    if (ex.frames !== frames) {                      // the six-month pair: ring where the object was in the first image
      ex.mark(ring(frames[0], "was"));
    } else {
      $("scrub").value = i;
      ex.mark($("pathChk").checked ? pathSvg(frames, i) : "");
    }
    $("frameInfo").innerHTML = [
      [tr("Taken"), `${fmtDate(f.date)}, ${fmtTime(f.date)}`],
      [tr("Detector"), t`SPHEREx ${f.band}, ${BANDS[f.band]} micrometres (infrared)`],
      [tr("Object position"), f.ra != null ? `RA ${f.ra}°, Dec ${f.dec}° (NASA JPL Horizons)` : f.snr ? tr("from NASA JPL Horizons") : tr("not in this image")],
      ...(f.snr ? [[tr("Detection"), t`${Math.round(f.snr)} times the background noise`]] : []),
      [tr("Original file"), `<a href="${ARCHIVE + f.source}" rel="noopener">${tr("NASA/IPAC archive (FITS, about 65 MB)")}</a>`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  };
  ex.frames = []; exMode("play");
  window.scrollTo(0, 0);
}
$("backBtn").onclick = showList;
$("measureBtn").onclick = startMeasure;
$("exPause").onclick = () => { exPaused = !exPaused; ex.paused = exPaused; $("exPause").textContent = exPaused ? tr("Resume") : tr("Pause"); };
$("scrub").oninput = (e) => { exPaused = true; ex.paused = true; $("exPause").textContent = tr("Resume"); ex.show(+e.target.value); };
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
    $("stats").innerHTML = [[levels.length, tr("real worlds to find")], [images, tr("real SPHEREx images")], ["100%", tr("positions checked with NASA JPL")]]
      .map(([b, label]) => `<div class="stat"><b>${b}</b><span>${label}</span></div>`).join("");
    $("startBtn").textContent = tr("Start the hunt"); $("startBtn").disabled = false;
    drawGrid();
    const L = levels[0];
    $("demoCap").textContent = t`Live: two real SPHEREx images, ${span(L.days_between)} apart. Can you see what moves?`;
    return demo.load(L.frames, L.size).then(() => demo.setMode("blink"));
  })
  .catch(() => fail(tr("The game data did not load. Check your connection and refresh the page.")));
