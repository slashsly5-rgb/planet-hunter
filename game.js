import { isHit } from "./score.js";

const HIT_RADIUS = 28;   // image pixels; forgiving enough for a fingertip
const BLINK_MS = 700;
const $ = (id) => document.getElementById(id);
const stage = $("stage"), panes = [$("paneA"), $("paneB")], imgs = [$("imgA"), $("imgB")];

let levels = [], n = 0, found = 0, answered = false, ready = false, paused = false, mode = "blink", showB = false;

function fail(msg) { $("error").textContent = msg; $("error").hidden = false; }

function show(id) { for (const s of ["start", "play", "end"]) $(s).hidden = s !== id; window.scrollTo(0, 0); }

function fmtDate(iso) { return new Date(iso + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }

function setMode(m) {
  mode = m;
  stage.className = "stage " + m;
  document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("slider").hidden = m !== "slide";
  $("pauseBtn").hidden = m !== "blink";
  paint();
}

function paint() {
  panes[1].style.opacity = mode === "slide" ? $("slider").value / 100 : mode === "blink" ? (showB ? 1 : 0) : 1;
}

setInterval(() => { if (mode === "blink" && !paused && ready) { showB = !showB; paint(); } }, BLINK_MS);

function loadLevel() {
  const L = levels[n];
  answered = false; ready = false; showB = false;
  $("card").hidden = true;
  $("progress").textContent = `Level ${n + 1} of ${levels.length}`;
  $("tally").textContent = `Found: ${found}`;
  $("prompt").textContent = "Tap the object that moves.";
  document.querySelectorAll(".mark").forEach((s) => { s.innerHTML = ""; s.setAttribute("viewBox", `0 0 ${L.size} ${L.size}`); });
  let pending = 2;
  imgs.forEach((im, i) => {
    im.onload = () => { if (--pending === 0) ready = true; };
    im.onerror = () => fail("An image did not load. Check your connection and refresh the page.");
    im.src = L.frames[i].img;
  });
  $("dateA").textContent = fmtDate(L.frames[0].date);
  $("dateB").textContent = fmtDate(L.frames[1].date);
  paint();
}

function reveal(hit) {
  const L = levels[n], [a, b] = L.frames;
  answered = true;
  if (hit) found++;
  const ring = (f, dash) => `<circle cx="${f.x}" cy="${f.y}" r="18" fill="none" stroke="#ffd166" stroke-width="3" ${dash ? 'stroke-dasharray="6 5"' : ""}/>`;
  const svg = `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffd166" stroke-width="2"/>` + ring(a, true) + ring(b, false);
  document.querySelectorAll(".mark").forEach((s) => (s.innerHTML = svg));
  $("card").classList.toggle("hit", hit);
  $("verdict").textContent = hit ? "You found it!" : "Not quite. Here it is.";
  $("objName").textContent = `${L.name}: ${L.kind}`;
  $("blurb").textContent = L.blurb;
  const days = L.days_between >= 1 ? `${L.days_between.toFixed(1)} days` : `${(L.days_between * 24).toFixed(1)} hours`;
  $("facts").innerHTML = [
    `Distance from the Sun: <strong>${L.distance_au} au</strong> (Earth is 1 au from the Sun)`,
    `Moved <strong>${L.moved_arcsec} arcseconds</strong> across the sky in <strong>${days}</strong>`,
    `Images taken ${fmtDate(a.date)} (dashed ring) and ${fmtDate(b.date)} (solid ring)`,
  ].map((t) => `<li>${t}</li>`).join("");
  $("prompt").textContent = "The rings show where it was on each date.";
  $("tally").textContent = `Found: ${found}`;
  $("nextBtn").textContent = n + 1 < levels.length ? "Next level" : "See your result";
  $("card").hidden = false;
  $("card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

panes.forEach((p) => p.addEventListener("click", (e) => {
  if (!ready || answered) return;
  const r = p.getBoundingClientRect(), L = levels[n];
  const tap = { x: ((e.clientX - r.left) / r.width) * L.size, y: ((e.clientY - r.top) / r.height) * L.size };
  reveal(isHit(tap, L.frames, HIT_RADIUS));
}));

function finish() {
  $("scoreLine").textContent = `You found ${found} of ${levels.length}`;
  const slow = levels.reduce((m, l) => (l.moved_arcsec / l.days_between < m.moved_arcsec / m.days_between ? l : m));
  const far = levels.reduce((m, l) => (l.distance_au > m.distance_au ? l : m));
  $("planetx").textContent =
    `The slowest object you hunted, ${slow.name}, crept only about ${Math.round(slow.moved_arcsec / slow.days_between)} arcseconds a day. ` +
    `${far === slow ? "It" : `The farthest, ${far.name},`} is ${Math.round(far.distance_au)} times as far from the Sun as Earth. ` +
    `If a "Planet X" exists, astronomers think it could be hundreds of times as far as Earth: much fainter, and moving much more slowly still. ` +
    `That is why nobody has found it yet.`;
  show("end");
}

$("nextBtn").onclick = () => { if (++n < levels.length) loadLevel(); else finish(); };
$("againBtn").onclick = () => { n = 0; found = 0; show("play"); loadLevel(); };
$("startBtn").onclick = () => { show("play"); loadLevel(); };
$("pauseBtn").onclick = () => { paused = !paused; $("pauseBtn").textContent = paused ? "Resume" : "Pause"; };
$("slider").oninput = paint;
document.querySelectorAll(".mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

fetch("levels.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => {
    if (!d.length) throw new Error("no levels");
    levels = d;
    $("startBtn").textContent = "Start hunting";
    $("startBtn").disabled = false;
  })
  .catch(() => fail("The game data did not load. Check your connection and refresh the page."));
