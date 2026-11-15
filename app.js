import { BANDS, ARCHIVE, $, fmtDate, fmtTime, span, Viewer, ring, pathSvg, ruler } from "./viewer.js?v=56";
import { speedChart } from "./lab.js?v=56";
import { t, tr } from "./i18n.js?v=56";
import { initSpace } from "./space.js?v=56";
import { showStack, hideStack } from "./stack3d.js?v=56";
import { initHunt } from "./hunt.js?v=56";
import { initVoyage } from "./voyage.js?v=56";
import { detect, judge, overlay } from "./detect.js?v=56";
import { composite, colourMarks } from "./colour.js?v=56";

// ---------- state ----------
let levels = [], hunt = null;
const ex = new Viewer($("exView"));

function fail(msg) { $("error").textContent = msg; $("error").hidden = false; }
// if anything breaks, say so on the page instead of silently doing nothing
window.addEventListener("error", (e) => fail("Something went wrong: " + e.message + ". Press Ctrl + F5 to reload."));
window.addEventListener("unhandledrejection", (e) => fail("Something went wrong: " + (e.reason?.message || e.reason) + ". Press Ctrl + F5 to reload."));
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
  document.querySelectorAll(".cardlink").forEach((b) => {
    b.onclick = () => openObject(levels[b.dataset.k]);
    composite(levels[b.dataset.k]).then((rgb) => { if (rgb) { const th = b.querySelector(".thumb"); th.style.backgroundImage = `url(${rgb.url})`; th.classList.add("rgb"); } }).catch(() => {});
  });
}
function exFrames() { return exLevel.track?.length > 1 ? exLevel.track : exLevel.frames; }
const tip = (html) => { $("exTip").innerHTML = html; $("exTip").hidden = !html; };
async function exMode(m) {
  document.querySelectorAll(".exmode").forEach((b) => b.classList.toggle("on", b.dataset.exmode === m));
  const stack = m === "stack";
  $("exPause").hidden = m === "diff" || stack || m === "rgb"; $("scrub").hidden = m !== "play";
  measure = null; ex.root.classList.remove("tappable"); tip("");
  ex.root.hidden = stack;
  if (stack) {
    ex.stop(); showStack($("stackView"), exLevel, exFrames());
    tip(t`Each sheet is one real SPHEREx image, and time runs upward. Stars do not move, so they line up into straight pillars. ${exLevel.name} moves, so it cuts a slanted line through them. Drag to turn it.`);
    return;
  }
  hideStack();
  const L = exLevel, pass = m === "pass", scan = m === "scan", rgb = m === "rgb" ? await composite(L) : null;
  if (m === "rgb" && !rgb) return exMode("play");          // fewer than three images: nothing to combine
  ex.root.classList.toggle("nofilter", !!rgb);             // the three-colour picture is shown as it is, without the infrared tint
  if (rgb && !rgb.frames) rgb.frames = [{ img: rgb.url, date: rgb.channels[0].frame.date, band: rgb.channels.map((ch) => ch.frame.band).join(" + "), combined: true }];
  const want = rgb ? rgb.frames : pass ? [exFrames()[0], L.other_pass] : scan ? L.frames : exFrames();
  scanSvg = null;
  if (ex.frames !== want && (ex.frames[1] !== want[1] || ex.frames.length !== want.length)) await guard(ex.load(want, L.size));   // swap between the time-lapse, the six-month pair and the scan pair
  if (scan) {
    const r = detect(ex.els[0], ex.els[1], L.size), j = judge(r, L.frames);
    scanSvg = overlay(r);
    tip(t`The computer subtracted one image from the other and flagged what was left: <strong>${r.movers.length} possible movers</strong> (green), ${r.singles.length} things seen in only one image (amber, usually cosmic rays) and ${r.changed.length} stars whose brightness changed (grey).` + " " +
      (j.found ? t`Its top pick, at ${j.top.confidence}% confidence, is the real ${L.name}.`
        : j.listed ? t`The real ${L.name} is on its list, but its top pick is a false alarm.`
        : t`It missed the real ${L.name} completely: too faint for this simple method. This is why people still check.`));
  }
  if (rgb) {
    scanSvg = colourMarks(rgb);
    tip(rgb.channels.map((ch) => `<strong style="color:${ch.css}">${tr(ch.name)}</strong>: SPHEREx ${ch.frame.band}, ${BANDS[ch.frame.band]} µm, ${fmtDate(ch.frame.date)}, ${fmtTime(ch.frame.date)}`).join("<br>") + "<br>" +
      (rgb.bands > 1 ? tr("Three real images, one per colour. Stars are in all three, so their colour shows how bright they are at each infrared wavelength.")
        : tr("Three real images at the same wavelength, one per colour. Stars are in all three, so they look white.")) + " " +
      t`${L.name} moved between the images, so it appears three times, once in each colour (ringed).`);
  }
  ex.setMode(pass || scan ? "blink" : rgb ? "still" : m);
  if (rgb) ex.show(0);
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
function openObject(L, mode = "rgb") {
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
  $("exBands").innerHTML = bandChart(frames.concat(L.other_pass ? [L.other_pass] : []));
  $("passBtn").hidden = !L.other_pass;
  ex.onFrame = (i) => {
    const f = ex.frames[i];
    if (measure) return;
    if (f.combined) ex.dateEl.textContent = tr("three dates combined");
    if (scanSvg) {
      ex.mark(scanSvg);
    } else if (ex.frames !== frames) {               // the six-month pair: ring where the object was in the first image
      ex.mark(ring(frames[0], "was"));
    } else {
      $("scrub").value = i;
      ex.mark($("pathChk").checked ? pathSvg(frames, i) : "");
    }
    $("frameInfo").innerHTML = [
      [tr("Taken"), f.combined ? tr("three dates, listed under the picture") : `${fmtDate(f.date)}, ${fmtTime(f.date)}`],
      [tr("Detector"), f.combined ? t`three images combined: SPHEREx ${f.band}` : t`SPHEREx ${f.band}, ${BANDS[f.band]} micrometres (infrared)`],
      [tr("Object position"), f.combined ? tr("ringed once in each colour") : f.ra != null ? `RA ${f.ra}°, Dec ${f.dec}° (NASA JPL Horizons)` : f.snr ? tr("from NASA JPL Horizons") : tr("not in this image")],
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
    initVoyage(levels);
    // direct links: .../#voyage, #hunt, #explore, #lab, #about open that screen
    const want = location.hash.slice(1);
    if (want === "hunt") document.querySelector('.top [data-view="hunt"]').click();      // opening the hunt must also start its first mission
    else if (want && want !== "home" && document.getElementById(want)?.classList.contains("view")) go(want);
    $("startBtn").textContent = tr("Start the hunt"); $("startBtn").disabled = false;
    drawGrid();
    return initSpace(levels, { explore: (L) => openObject(L), stack: (L) => openObject(L, "stack") });
  })
  .catch((e) => { console.error(String((e && e.stack) || e)); fail(tr("The game data did not load. Check your connection and refresh the page.")); });


// ---------- which of SPHEREx's six detectors (its colours of infrared light) a world's images came from ----------
const DETECTORS = [["D1", 0.75, 1.11], ["D2", 1.10, 1.65], ["D3", 1.63, 2.43], ["D4", 2.40, 3.82], ["D5", 3.82, 4.42], ["D6", 4.42, 5.00]];
function bandChart(frames) {
  const used = new Set(frames.map((f) => f.band)), X = (um) => 20 + (um - 0.4) / (5.0 - 0.4) * 560;
  const bars = DETECTORS.map(([d, a, b]) => { const on = used.has(d); return `<rect x="${X(a)}" y="${on ? 22 : 30}" width="${X(b) - X(a) - 1}" height="${on ? 30 : 14}" rx="3" fill="${on ? "#ffb547" : "#27335a"}"/><text x="${(X(a) + X(b)) / 2}" y="70" text-anchor="middle" class="${on ? "me" : ""}">${d}</text>`; }).join("");
  const ticks = [0.5, 1, 2, 3, 4, 5].map((u) => `<text x="${X(u)}" y="92" text-anchor="middle">${u}</text>`).join("");
  const n = frames.filter((f) => f.band).length;
  return `<div class="rulerbox"><svg viewBox="0 0 600 100" role="img" aria-label="${tr("Which colours of infrared light these images captured")}">
    <rect x="${X(0.4)}" y="26" width="${X(0.7) - X(0.4)}" height="22" fill="url(#vis)"/><defs><linearGradient id="vis"><stop offset="0" stop-color="#7a4dff"/><stop offset=".5" stop-color="#3dd17a"/><stop offset="1" stop-color="#ff4a3a"/></linearGradient></defs>
    <text x="${X(0.55)}" y="18" text-anchor="middle">${tr("eyes")}</text>${bars}${ticks}
  </svg><p class="note">${t`SPHEREx sees infrared light from 0.75 to 5 micrometres, beyond what our eyes see, split into 102 colours by six detectors. These ${n} images came from the highlighted detectors, the short-wavelength ones, where worlds in our Solar System shine by reflected sunlight.`}</p></div>`;
}

// ---------- For judges: buttons that jump straight to the proof of a claim ----------
const findL = (id) => levels.find((l) => l.id === id);
function proof(spec) {
  const [where, a, b] = spec.split(":");
  if (where === "explore") return a ? openObject(findL(a), b || "rgb") : go("explore");
  if (where === "hunt") return $("startBtn").click();
  if (where === "home") { go("home"); if (a === "galaxy") window.__space?.galaxy(); else if (a) window.__space?.info(a); else window.__space?.home(); return; }
  if (where === "about") { go("about"); if (a) setTimeout(() => document.getElementById(a)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return; }
  go(where);
}
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-proof]"); if (p) { e.preventDefault(); proof(p.dataset.proof); return; }
  if (e.target.closest("[data-tour]")) { e.preventDefault(); tourGo(0); }
});

// ---------- the 60-second guided tour ----------
const TOUR = [
  [() => { go("home"); window.__space?.galaxy(); }, "This is a model of our galaxy, the Milky Way. The Sun is one of its hundreds of billions of stars."],
  [() => { go("home"); window.__space?.home(); }, "Our Solar System in 3D. Every planet and world is where NASA JPL says it is. You can click any of them to learn about it."],
  [() => { go("home"); window.__space?.select("pluto"); }, "Choose a world and the camera flies there. These are real pictures of Pluto taken by NASA's SPHEREx telescope."],
  [() => openObject(findL("pluto"), "play"), "Explore: watch Pluto move, picture by picture. The stars stay still. Every picture links to NASA's original file."],
  [() => openObject(findL("pluto"), "stack"), "The 3D time stack: each sheet is one real image. Stars make straight pillars; Pluto cuts across them."],
  [() => $("startBtn").click(), "The Hunt: find what moves, predict where it goes next, and decide where it orbits, just like an astronomer."],
  [() => go("lab"), "The Planet X lab: why a distant planet is so hard to find."],
  [() => go("voyage"), "And the Voyage: a space adventure across ten real worlds. Press Launch to play. That's the tour!"],
];
let tourAt = -1;
function tourGo(i) {
  if (i < 0 || i >= TOUR.length) return tourEnd();
  tourAt = i; TOUR[i][0]();
  $("tourStep").textContent = t`Tour ${i + 1} of ${TOUR.length}`; $("tourText").textContent = tr(TOUR[i][1]);
  $("tourBack").disabled = i === 0; $("tourNext").textContent = i === TOUR.length - 1 ? tr("Finish") : tr("Next");
  $("tour").hidden = false; document.body.classList.add("touring");
}
function tourEnd() { tourAt = -1; $("tour").hidden = true; document.body.classList.remove("touring"); }
$("tourNext").onclick = () => tourGo(tourAt + 1); $("tourBack").onclick = () => tourGo(tourAt - 1); $("tourEnd").onclick = tourEnd;
addEventListener("keydown", (e) => { if (tourAt < 0) return; if (e.key === "Escape") tourEnd(); else if (e.key === "ArrowRight") tourGo(tourAt + 1); else if (e.key === "ArrowLeft") tourGo(tourAt - 1); });

// ---------- plain-word explanations: dotted words open a one-line meaning ----------
const GLOSS = {
  au: "Astronomical unit: the distance from Earth to the Sun, about 150 million km.",
  arcsecond: "A tiny angle: 1/3600 of a degree. The full Moon is about 1,800 arcseconds wide.",
  arcminute: "A small angle: 1/60 of a degree. The full Moon is about 30 arcminutes wide.",
  infrared: "Light just beyond red, invisible to our eyes. SPHEREx sees in infrared.",
  magnitude: "Astronomers' brightness scale: lower numbers are brighter. 5 steps is 100 times brighter.",
  noise: "The random speckle in every image. A real detection must stand well above it.",
  lightyear: "The distance light travels in a year, about 9.5 trillion km.",
  micrometre: "A millionth of a metre. Used to measure the wavelength of infrared light.",
  dwarf: "A world big enough to be round, but which has not cleared its orbit of other bodies, like Pluto.",
};
const TERM_RE = /\b(au|[Aa]rcseconds?|[Aa]rcminutes?|[Ii]nfrared|[Mm]agnitude|[Bb]ackground noise|light-years?|micrometres?|[Dd]warf planets?|arka saat|arka minit|[Ii]nframerah|hingar latar|mikrometer|magnitud|planet kerdil)\b/;
const KEY = (w) => { w = w.toLowerCase();
  return w === "au" ? "au" : w.startsWith("arcs") || w === "arka saat" ? "arcsecond" : w.startsWith("arcm") || w === "arka minit" ? "arcminute" : w.includes("infra") || w.includes("inframerah") ? "infrared"
    : w.startsWith("magnitud") ? "magnitude" : w.includes("noise") || w === "hingar latar" ? "noise" : w.startsWith("light") ? "lightyear" : w.startsWith("micro") || w === "mikrometer" ? "micrometre" : "dwarf"; };
const SKIP = "button, a, abbr, svg, h1, h2, h3, label, input, select, textarea, script, style, .chip, .viewer, .labels, .slabel, .vy-hud, .vy-comm, .space-time, .step-head, .tour, .gloss-pop, .vy-card, .intro-cap, #stats";
function glossify(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), todo = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (TERM_RE.test(n.nodeValue) && !n.parentElement?.closest(SKIP)) todo.push(n);
  for (const n of todo) {
    const m = n.nodeValue.match(TERM_RE); if (!m) continue;
    const key = KEY(m[1]), block = n.parentElement.closest("p, li, dd, td, div") || n.parentElement;
    if (block.querySelector(`abbr.term[data-k="${key}"]`)) continue;      // one explanation per word per paragraph is enough
    const after = n.splitText(m.index), rest = after.splitText(m[1].length);
    const ab = document.createElement("abbr"); ab.className = "term"; ab.dataset.k = key; ab.tabIndex = 0; ab.textContent = after.nodeValue;
    after.replaceWith(ab); if (TERM_RE.test(rest.nodeValue)) todo.push(rest);
  }
}
let glossTimer = 0;
new MutationObserver((ms) => {
  if (ms.every((m) => m.target.parentElement?.closest?.(SKIP) || m.target.closest?.(SKIP))) return;   // ignore the many per-frame HUD updates
  clearTimeout(glossTimer); glossTimer = setTimeout(() => glossify(document.querySelector("main")), 150);
}).observe(document.querySelector("main"), { childList: true, subtree: true, characterData: true });
glossify(document.querySelector("main"));
function showGloss(el) {
  const pop = $("glossPop"); pop.textContent = tr(GLOSS[el.dataset.k]); pop.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(300, innerWidth - 24);
  pop.style.width = w + "px"; pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
  pop.style.top = (r.bottom + 8 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + "px";
}
document.addEventListener("click", (e) => { const a = e.target.closest("abbr.term"); if (a) showGloss(a); else $("glossPop").hidden = true; });
document.addEventListener("mouseover", (e) => { const a = e.target.closest("abbr.term"); if (a && matchMedia("(hover: hover)").matches) showGloss(a); });
document.addEventListener("mouseout", (e) => { if (e.target.closest("abbr.term") && matchMedia("(hover: hover)").matches) $("glossPop").hidden = true; });
document.addEventListener("focusin", (e) => { const a = e.target.closest("abbr.term"); if (a) showGloss(a); });
document.addEventListener("focusout", (e) => { if (e.target.closest("abbr.term")) $("glossPop").hidden = true; });
addEventListener("scroll", () => ($("glossPop").hidden = true), { passive: true });
window.__tour = { go: tourGo, at: () => tourAt };
