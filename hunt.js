// The Hunt: each world is a three-step mission, the same steps an astronomer takes.
//   1 Detect    find the object that moves between two real images
//   2 Predict   from its two positions, say where it will be in a third real image
//   3 Classify  from how fast it moves, say where it orbits
// The last missions are simulated Planet X candidates (made-up objects on real images, labelled as simulated).
import { isHit } from "./score.js?v=27";
import { $, Viewer, fmtDate, fmtTime, span, ring, ruler } from "./viewer.js?v=27";
import { speedChart, simFrames } from "./lab.js?v=27";
import { t, tr } from "./i18n.js?v=27";
import { detect, judge } from "./detect.js?v=27";

const FOUND_RADIUS = 20;          // image pixels: how close a tap must be to count as a detection
const TRIES = 2;
const DIFF_COST = 30;             // points lost for using the Difference view while detecting
const BOSSES = [150, 220];        // distances (au) of the simulated Planet X missions
const BOSS_KM = 19113;            // three times Earth's width
const ZONES = [
  { id: "belt", label: "Inner Solar System, in the asteroid belt", why: "It crosses hundreds of arcseconds a day. Only nearby objects move that fast." },
  { id: "outer", label: "Outer Solar System, beyond Jupiter", why: "It moves only tens of arcseconds a day. That means it is far away." },
  { id: "px", label: "Far beyond Neptune, where a Planet X would be", why: "It barely moves at all: a few arcseconds a day. That is what a very distant planet looks like." },
];
const when = (iso) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// A third real image for the Predict step: the next one after the pair in which the object has clearly moved on.
function targetOf(L) {
  const track = L.track || [], [a, b] = L.frames, ib = track.findIndex((f) => f.source === b.source), ia = track.findIndex((f) => f.source === a.source);
  if (ib < 0 || ia < 0) return null;
  const later = track.slice(ib + 1).find((f) => dist(f, b) >= 12);
  if (later) return { frame: later, forward: true };
  const earlier = track.slice(0, ia).reverse().find((f) => dist(f, a) >= 12);
  return earlier ? { frame: earlier, forward: false } : null;
}

export function initHunt(levels, go) {
  const view = new Viewer($("huntView"));
  view.root.classList.add("tappable");
  const base = levels.find((l) => l.id === "pluto") || levels[levels.length - 1];   // the simulated planets are scaled from this real world
  const missions = [...levels.map((L) => ({ L })), ...BOSSES.map((au) => ({ boss: au }))];
  let n = 0, m = null, step = "", scores = [], pts = {}, tries = 0, t0 = 0, usedDiff = false, userPaused = false;

  const maxOf = (x) => (x.boss ? 200 : x.target === null ? 200 : 300);
  const total = () => scores.reduce((s, v) => s + (v || 0), 0);
  const prompt = (html) => ($("prompt").innerHTML = html);
  const note = (html) => { $("stepNote").innerHTML = html; $("stepNote").hidden = !html; };

  function mode(name) {
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === name));
    $("slider").hidden = name !== "slide"; $("pauseBtn").hidden = name !== "blink";
    $("modeTip").textContent = name === "slide" ? tr("Drag the slider to fade from one date to the other.")
      : name === "diff" ? t`Astronomer's trick: subtract one image from the other. Stars cancel out. Whatever moved is left behind, twice. Using it here costs ${DIFF_COST} points.` : "";
    if (name === "diff" && step === "detect") usedDiff = true;
    view.setMode(name);
  }
  function bar() {
    $("dots").innerHTML = missions.map((x, k) => {
      const f = scores[k] == null ? -1 : scores[k] / maxOf(x);
      return `<i class="${f < 0 ? "" : f >= 0.66 ? "hit" : f >= 0.33 ? "mid" : "miss"} ${k === n ? "cur" : ""} ${x.boss ? "boss" : ""}"></i>`;
    }).join("");
    $("progress").textContent = t`Mission ${n + 1} of ${missions.length}`;
    $("tally").textContent = t`Score ${total() + Object.values(pts).reduce((s, v) => s + v, 0)}`;
    document.querySelectorAll("#steps3 li").forEach((li) => {
      const order = ["detect", "predict", "classify", "done"], i = order.indexOf(li.dataset.step), now = order.indexOf(step);
      li.className = i < now ? "done" : i === now ? "now" : "";
      li.hidden = li.dataset.step === "predict" && !m?.target;
    });
    $("skipRow").hidden = !(step === "detect" || step === "predict");
  }

  async function startMission() {
    m = missions[n]; pts = {}; tries = 0; usedDiff = false; step = "";
    $("card").hidden = true; $("quiz").hidden = true; $("nextRow").hidden = true; note(""); $("huntControls").hidden = false;
    prompt(tr("Loading…")); window.scrollTo(0, 0);
    if (m.boss && !m.L) {
      const made = await simFrames(base, m.boss, BOSS_KM);
      m.L = { id: "px" + m.boss, name: t`Simulated planet at ${m.boss} au`, kind: tr("simulated Planet X candidate"), sim: true,
        blurb: tr("This planet is made up. We placed it into two real SPHEREx images, as bright and as slow as a planet three times Earth's width would be at this distance."),
        size: base.size, arcsec_per_px: base.arcsec_per_px, distance_au: m.boss, moved_arcsec: Math.round(made.moved * 10) / 10, days_between: base.days_between, frames: made.frames };
      m.target = null;
    }
    if (m.target === undefined) m.target = targetOf(m.L);
    const frames = [...m.L.frames, ...(m.target ? [m.target.frame] : [])];
    await view.load(frames, m.L.size).catch(() => prompt(tr("An image did not load. Check your connection and refresh the page.")));
    view.pair = [0, 1]; step = "detect"; t0 = performance.now(); mode("blink"); view.root.classList.add("askclick");
    prompt(m.boss ? t`<strong>Detect.</strong> Planet X drill: a simulated planet is hidden in these two real images. It is faint and barely moves. Tap it.`
      : tr("<strong>Detect.</strong> One object moves between these two real images. Tap it. You have two tries."));
    bar();
  }

  function marks(extra = "") {
    const [a, b] = m.L.frames;
    view.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` + ring(a, "was") + ring(b) + extra);
  }

  function afterDetect() {
    $("huntControls").hidden = true; $("modeTip").textContent = "";
    view.stop(); view.canvas.hidden = true; view.show(1); marks();   // freeze on the second image with both positions ringed
    m.human = pts.detect > 0;
    m.machine = judge(detect(view.els[0], view.els[1], m.L.size), m.L.frames);   // the same pair, given to the automatic detector
    if (!m.target) return toClassify();
    step = "predict"; bar(); view.root.classList.add("askclick");
    const [a, b] = m.L.frames, f = m.target.frame;
    prompt(m.target.forward
      ? t`<strong>Predict.</strong> Now click on the picture where you think it will be next. It was at the dashed ring on ${when(a.date)}, then at the solid ring on ${when(b.date)}. Where will it be on <strong>${when(f.date)}</strong>? Follow the line onward.`
      : t`<strong>Predict.</strong> Now click on the picture where you think it was before. It was at the dashed ring on ${when(a.date)}, then at the solid ring on ${when(b.date)}. Where was it earlier, on <strong>${when(f.date)}</strong>? Follow the line backward, past the dashed ring.`);
  }

  function toClassify() {
    step = "classify"; bar(); view.root.classList.remove("askclick");
    window.scrollTo({ top: 0, behavior: "smooth" });      // the three answers are at the top of the right-hand column
    const L = m.L, rate = L.moved_arcsec / L.days_between;
    prompt(t`<strong>Classify.</strong> It moved ${L.moved_arcsec} arcseconds in ${span(L.days_between)}: about ${rate < 10 ? rate.toFixed(1) : Math.round(rate)} arcseconds a day. Where does it orbit?`);
    $("quiz").innerHTML = ZONES.map((z) => `<button class="zone" data-z="${z.id}">${tr(z.label)}</button>`).join("");
    $("quiz").hidden = false;
    document.querySelectorAll(".zone").forEach((b) => (b.onclick = () => classify(b.dataset.z)));
  }

  function classify(choice) {
    const L = m.L, truth = L.sim ? "px" : L.distance_au < 6 ? "belt" : "outer", ok = choice === truth, z = ZONES.find((x) => x.id === truth);
    pts.classify = ok ? 100 : 0;
    document.querySelectorAll(".zone").forEach((b) => { b.disabled = true; b.classList.toggle("right", b.dataset.z === truth); b.classList.toggle("wrong", b.dataset.z === choice && !ok); });
    note(`<strong>${ok ? tr("Correct.") : tr("Not quite.")}</strong> ${tr(z.why)} ${tr("Speed is a first clue, not proof: it also depends on where Earth is in its orbit.")}`);
    finishMission();
  }

  function finishMission() {
    const L = m.L, got = Object.values(pts).reduce((s, v) => s + v, 0);
    scores[n] = got; pts = {}; step = "done"; bar();
    prompt(t`Mission complete: ${got} of ${maxOf(m)} points.`);
    $("card").classList.toggle("hit", got >= maxOf(m) * 0.66);
    $("verdict").textContent = `${L.name}`;
    $("objName").textContent = tr(L.kind);
    $("blurb").textContent = tr(L.blurb);
    $("facts").innerHTML = [
      t`Moved <strong>${L.moved_arcsec} arcseconds</strong> across the sky in <strong>${span(L.days_between)}</strong>`,
      t`Distance from the Sun: <strong>${L.distance_au} au</strong>`,
      m.machine.found ? t`Automatic detector: found it too, at ${m.machine.top.confidence}% confidence`
        : m.machine.listed ? tr("Automatic detector: fooled. The real object was on its list, but its top pick was a false alarm")
        : tr("Automatic detector: missed it. Too faint for simple image subtraction"),
    ].map((li) => `<li>${li}</li>`).join("");
    $("ruler").innerHTML = ruler(L.name, L.distance_au);
    $("badge").textContent = L.sim ? tr("⚠ Simulated object on real SPHEREx images") : tr("✔ Checked against NASA JPL Horizons");
    $("nextBtn").textContent = n + 1 < missions.length ? tr("Next mission") : tr("See your result");
    $("card").hidden = false; $("quiz").hidden = true; $("nextRow").hidden = false; view.root.classList.remove("askclick");
    window.scrollTo({ top: 0, behavior: "smooth" });      // the Next button sits at the top, under the result line
    $("nextBtn").focus({ preventScroll: true });
  }

  view.onTap = (tap) => {
    if (step === "detect") {
      const [a, b] = m.L.frames;
      if (isHit(tap, [a, b], FOUND_RADIUS)) {
        const secs = (performance.now() - t0) / 1000;
        pts.detect = Math.max(10, (tries === 0 ? Math.round(Math.max(40, 100 - Math.max(0, secs - 15) * 2)) : 50) - (usedDiff ? DIFF_COST : 0));
        note(t`<strong>Found it: ${pts.detect} points.</strong> The rings show where it was on each date.`);
        afterDetect();
      } else if (++tries < TRIES) {
        note(tr("<strong>Not there.</strong> One more try. Watch for the dot that jumps while everything else stays still."));
      } else {
        pts.detect = 0;
        note(tr("<strong>Missed.</strong> The rings show where it was on each date."));
        afterDetect();
      }
      bar();
    } else if (step === "predict") {
      const f = m.target.frame, L = m.L, err = dist(tap, f) * L.arcsec_per_px, moved = dist(f, L.frames[m.target.forward ? 1 : 0]) * L.arcsec_per_px;
      pts.predict = Math.round(100 * Math.min(1, Math.max(0, 1 - (err - 10) / 110)));
      view.show(2);
      view.mark(`<line class="path" x1="${tap.x}" y1="${tap.y}" x2="${f.x}" y2="${f.y}"/><circle class="dot now" cx="${tap.x}" cy="${tap.y}" r="6"/>` + ring(f) + ring(f, "pulse"));
      note(t`<strong>${pts.predict} points.</strong> This is the real image from ${when(f.date)}. Your guess was ${Math.round(err)} arcseconds from where it really was (the ring). It had travelled ${Math.round(moved)} arcseconds since the last image.`);
      toClassify();
    }
  };

  function finish() {
    const got = total(), max = missions.reduce((s, x) => s + maxOf(x), 0), f = got / max;
    view.stop();
    $("huntPlay").hidden = true; $("huntEnd").hidden = false;
    $("scoreLine").textContent = t`You scored ${got} of ${max}`;
    $("rank").textContent = f >= 0.85 ? tr("Rank: Discoverer. Clyde Tombaugh would be proud.") : f >= 0.65 ? tr("Rank: Astronomer. Sharp eyes and good predictions.")
      : f >= 0.4 ? tr("Rank: Observer. The faint, slow ones are the hard part.") : tr("Rank: Cadet. Try the Difference view, and watch how far each object travels.");
    const slow = levels.reduce((p, l) => (l.moved_arcsec / l.days_between < p.moved_arcsec / p.days_between ? l : p));
    const far = levels.reduce((p, l) => (l.distance_au > p.distance_au ? l : p));
    $("planetx").textContent =
      t`The slowest object you hunted, ${slow.name}, crept only about ${Math.round(slow.moved_arcsec / slow.days_between)} arcseconds a day.` + " " +
      t`The farthest, ${far.name}, is ${Math.round(far.distance_au)} times as far from the Sun as Earth.` + " " +
      tr(`If a "Planet X" exists, astronomers think it could be hundreds of times as far as Earth: much fainter, and moving much more slowly still. That is why nobody has found it yet.`);
    $("rulerX").innerHTML = ruler(far.name, far.distance_au);
    const done = missions.filter((x) => x.machine);
    $("vsLine").innerHTML = t`<strong>You against the machine.</strong> You detected ${done.filter((x) => x.human).length} of ${done.length}. The automatic detector's top pick was right ${done.filter((x) => x.machine.found).length} times. Software is fast, but it is fooled by cosmic rays and misses faint objects, so people still check.`;
    $("endChart").innerHTML = speedChart(levels);
    window.scrollTo(0, 0);
  }

  function start() {
    n = 0; scores = []; missions.forEach((x) => { delete x.machine; delete x.human; if (x.boss) { delete x.L; delete x.target; } });   // new hiding places each run
    $("huntPlay").hidden = false; $("huntEnd").hidden = true; go("hunt"); startMission();
  }
  $("nextBtn").onclick = () => { if (step !== "done") return; if (++n < missions.length) startMission(); else finish(); };
  addEventListener("keydown", (e) => {                     // Enter moves on once a mission is complete
    if (e.key === "Enter" && step === "done" && !$("hunt").hidden && !$("huntPlay").hidden) { e.preventDefault(); $("nextBtn").click(); }
  });
  $("skipBtn").onclick = () => {            // never leave a player stuck: give up on this step and carry on
    if (step === "detect") { pts.detect = 0; note(tr("<strong>Skipped.</strong> The rings show where it was on each date.")); afterDetect(); bar(); }
    else if (step === "predict") { pts.predict = 0; const f = m.target.frame; view.show(2); view.mark(ring(f) + ring(f, "pulse")); note(t`<strong>Skipped.</strong> This is the real image from ${when(f.date)}. The ring shows where it really was.`); toClassify(); }
  };
  $("startBtn").onclick = start;
  $("againBtn").onclick = start;
  document.querySelector('.top [data-view="hunt"]').onclick = () => { if (m) go("hunt"); else start(); };
  $("pauseBtn").onclick = () => { userPaused = !userPaused; view.paused = userPaused; $("pauseBtn").textContent = userPaused ? tr("Resume") : tr("Pause"); };
  $("slider").oninput = (e) => view.setFade(e.target.value / 100);
  document.querySelectorAll(".mode").forEach((b) => (b.onclick = () => mode(b.dataset.mode)));

  window.__hunt = { state: () => ({ step, frames: m?.L.frames, target: m?.target?.frame, zone: m?.L ? (m.L.sim ? "px" : m.L.distance_au < 6 ? "belt" : "outer") : null, size: m?.L.size }) };   // used by the browser check
  return { pause: (hidden) => (view.paused = hidden || userPaused) };
}
