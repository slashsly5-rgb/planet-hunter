import { BANDS, ARCHIVE, $, fmtDate, fmtTime, span, Viewer, ring, pathSvg, ruler } from "./viewer.js";
import { speedChart } from "./lab.js";
import { t, tr } from "./i18n.js";
import { initSpace } from "./space.js";
import { showStack, hideStack } from "./stack3d.js";
import { initHunt } from "./hunt.js";
import { detect, judge, overlay } from "./detect.js";

// ---------- state ----------
let levels = [], hunt = null;
const ex = new Viewer($("exView"));

function fail(msg) { $("error").textContent = msg; $("error").hidden = false; }
const guard = (p) => p.catch(() => fail(tr("An image did not load. Check your connection and refresh the page.")));

function go(view) {
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== view));
  document.querySelectorAll(".top nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  hunt?.pause(view !== "hunt"); ex.paused = view !== "explore" || exPaused;
  if (view === "explore") showList(); else hideStack();
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => go(b.dataset.view)));

// ---------- explore ----------
let exLevel = null, exPaused = false;
function showList() { $("exploreList").hidden = false; $("exploreDetail").hidden = true; ex.stop(); hideStack(); }
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
  const stack = m === "stack";
  $("exPause").hidden = m === "diff" || stack; $("scrub").hidden = m !== "play";
  measure = null; ex.root.classList.remove("tappable"); tip("");
  ex.root.hidden = stack;
  if (stack) {
    ex.stop(); showStack($("stackView"), exLevel, exFrames());
    tip(t`Each sheet is one real SPHEREx image, and time runs upward. Stars do not move, so they line up into straight pillars. ${exLevel.name} moves, so it cuts a slanted line through them. Drag to turn it.`);
    return;
  }
  hideStack();
  const L = exLevel, pass = m === "pass", scan = m === "scan", want = pass ? [exFrames()[0], L.other_pass] : scan ? L.frames : exFrames();
  scanSvg = null;
  if (ex.frames !== want && ex.frames[1] !== want[1]) await guard(ex.load(want, L.size));   // swap between the time-lapse, the six-month pair and the scan pair
  if (scan) {
    const r = detect(ex.els[0], ex.els[1], L.size), j = judge(r, L.frames);
    scanSvg = overlay(r);
    tip(t`The computer subtracted one image from the other and flagged what was left: <strong>${r.movers.length} possible movers</strong> (green), ${r.singles.length} things seen in only one image (amber, usually cosmic rays) and ${r.changed.length} stars whose brightness changed (grey).` + " " +
      (j.found ? t`Its top pick, at ${j.top.confidence}% confidence, is the real ${L.name}.`
        : j.listed ? t`The real ${L.name} is on its list, but its top pick is a false alarm.`
        : t`It missed the real ${L.name} completely: too faint for this simple method. This is why people still check.`));
  }
  ex.setMode(pass || scan ? "blink" : m);
  if (m === "diff") ex.mark("");
  if (pass) {
    const then = fmtDate(want[0].date), other = fmtDate(L.other_pass.date);
    tip(t`SPHEREx photographed this same patch on <strong>${then}</strong> and again on <strong>${other}</strong>, in a different pass over the sky. The stars are all still there. ${L.name} is not: it moved on long ago. The ring shows where it was.`);
  }
}

// Measure it yourself: tap the object in the first and last image; compare with NASA JPL.
let measure = null, scanSvg = null;
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
function openObject(L, mode = "play") {
  exLevel = L; go("explore");
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
    if (scanSvg) {
      ex.mark(scanSvg);
    } else if (ex.frames !== frames) {               // the six-month pair: ring where the object was in the first image
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
  ex.frames = []; exMode(mode);
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
    hunt = initHunt(levels, go);
    $("startBtn").textContent = tr("Start the hunt"); $("startBtn").disabled = false;
    drawGrid();
    return initSpace(levels, { explore: (L) => openObject(L), stack: (L) => openObject(L, "stack") });
  })
  .catch(() => fail(tr("The game data did not load. Check your connection and refresh the page.")));
