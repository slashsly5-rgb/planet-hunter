// Voyage to Planet X: a cinematic adventure. Each chapter is one real world:
//   FLY   steer the ship through a rock field toward the world
//   SCAN  hold the reticle on the object that jumps between two real SPHEREx images until the lock completes
//   WARP  jump onward through the Solar System
// The ship, rocks, radio chatter and sounds are game fiction. The scanner pictures, positions and distances are real.
import * as THREE from "./vendor/three.module.min.js";
import { $, Viewer, span } from "./viewer.js?v=12";

const LOCK_RADIUS = 34;        // image pixels: how close the reticle must be to the object's current position
const LOCK_SECONDS = 2.4;      // time on target needed
const SCAN_SECONDS = 28;
const BASE_SPEED = 62, BOOST = 1.75;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- sound: everything is synthesised, no audio files ----------
class Sound {
  start() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C(); this.out = this.ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(this.ctx.destination);
    // engine: two detuned saws through a low-pass filter
    this.engine = this.ctx.createGain(); this.engine.gain.value = 0;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; this.lp = lp;
    for (const f of [55, 55.7]) { const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(this.engine); this.engine.connect(this.out);
  }
  setEngine(level, boost) { if (!this.ctx) return; const t = this.ctx.currentTime; this.engine.gain.setTargetAtTime(level * 0.16, t, 0.2); this.lp.frequency.setTargetAtTime(boost ? 520 : 220, t, 0.25); }
  tone(freq, dur = 0.12, type = "sine", vol = 0.25, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  collect() { this.tone(880, 0.09, "triangle", 0.2); setTimeout(() => this.tone(1320, 0.12, "triangle", 0.2), 70); }
  hit() { this.tone(110, 0.35, "sawtooth", 0.4, 40); }
  blip() { this.tone(620, 0.03, "square", 0.05); }
  lockTick(p) { this.tone(400 + p * 700, 0.05, "sine", 0.12); }
  locked() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.25), i * 110)); }
  fail() { this.tone(300, 0.4, "sawtooth", 0.25, 120); }
  warp() { this.tone(90, 2.2, "sawtooth", 0.3, 1400); }
}

export function initVoyage(levels) {
  const root = $("voyage"), holder = $("vyCanvas");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { $("vyStartMsg").textContent = "This browser cannot show 3D, so the voyage is unavailable. Use Hunt instead."; $("vyStart").disabled = true; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); holder.append(renderer.domElement);
  const sound = new Sound();
  const chapters = [...levels].sort((a, b) => a.distance_au - b.distance_au);   // travel outward from the Sun

  // ---------- scene ----------
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x04060f, 180, 430); scene.background = new THREE.Color(0x04060f);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1500); camera.position.set(0, 2.4, 9.5);
  scene.add(new THREE.AmbientLight(0x6a7bb0, 1.1));
  const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.2); sunLight.position.set(-6, 9, 8); scene.add(sunLight);

  // ship, built from simple shapes
  const ship = new THREE.Group(), hullMat = new THREE.MeshStandardMaterial({ color: 0xdfe6f5, metalness: 0.5, roughness: 0.35, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff8a3c, emissive: 0xff5a14, emissiveIntensity: 0.6, flatShading: true });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.4, 6), hullMat); body.rotation.x = -Math.PI / 2; ship.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 1.2), hullMat); wing.position.set(0, -0.1, 0.9); ship.add(wing);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 1.3), accent); tip.position.set(s * 2.1, 0.2, 0.9); ship.add(tip);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.1, 8), accent); eng.rotation.x = Math.PI / 2; eng.position.set(s * 0.75, -0.15, 1.5); ship.add(eng);
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshStandardMaterial({ color: 0x6fe3ff, emissive: 0x1a6a8a, metalness: 0.9, roughness: 0.1 })); canopy.position.set(0, 0.32, 0.1); canopy.scale.set(1, 0.7, 1.7); ship.add(canopy);
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "#fff"); gr.addColorStop(0.3, "#6fe3ff"); gr.addColorStop(1, "transparent"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const flames = [-1, 1].map((s) => { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); f.position.set(s * 0.75, -0.15, 2.4); f.scale.setScalar(1.6); ship.add(f); return f; });
  scene.add(ship);

  // star streaks: line segments that stretch with speed
  const NS = 900, sp = new Float32Array(NS * 6), stars = [];
  for (let i = 0; i < NS; i++) stars.push({ x: rand(-90, 90), y: rand(-60, 60), z: rand(-430, 20) });
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const starLines = new THREE.LineSegments(starGeo, new THREE.LineBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.85, fog: false })); starLines.frustumCulled = false; scene.add(starLines);

  // rocks and signal fragments, reused from pools
  const rockGeo = new THREE.IcosahedronGeometry(1, 0), rocks = [], frags = [];
  for (let i = 0; i < 46; i++) { const m = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rand(0.05, 0.1), 0.3, rand(0.34, 0.52)), flatShading: true, roughness: 0.95 })); m.visible = false; scene.add(m); rocks.push({ m, r: 1, live: false, spin: new THREE.Vector3() }); }
  const fragGeo = new THREE.OctahedronGeometry(0.6, 0);
  for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(fragGeo, new THREE.MeshStandardMaterial({ color: 0x7dffcf, emissive: 0x2fe0a0, emissiveIntensity: 1.4, flatShading: true })); m.visible = false; scene.add(m); frags.push({ m, live: false }); }
  // the world ahead
  const dest = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); dest.position.set(0, 6, -520); scene.add(dest);

  // distant glow for depth (decoration)
  for (const [color, x, y, s] of [[0x6a3bd0, -420, 160, 900], [0x1f8a9a, 480, -120, 760], [0xa03a6a, 120, 300, 620]]) {
    const neb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.16, fog: false }));
    neb.position.set(x, y, -1100); neb.scale.setScalar(s); scene.add(neb);
  }

  // ---------- state ----------
  let n = 0, phase = "idle", hull = 100, data = 0, travelled = 0, goal = 1, speed = BASE_SPEED, boost = false, shake = 0, warpT = 0;
  let spawnR = 0, spawnF = 0, lock = 0, scanLeft = 0, assisted = false, tickAt = 0;
  const aim = new THREE.Vector2(), keys = new Set(), mouse = { x: 0, y: 0, used: false };
  const hud = (id, v) => ($(id).textContent = v);
  const L = () => chapters[n];

  function say(who, text) {              // radio line, typed out
    const el = $("vyComm"); el.hidden = false; $("vyWho").textContent = who; const body = $("vySay"); body.textContent = "";
    clearInterval(say.t); let i = 0;
    say.t = setInterval(() => { body.textContent = text.slice(0, ++i); if (i % 2) sound.blip(); if (i >= text.length) clearInterval(say.t); }, 22);
  }
  function card(kicker, title, sub, ms = 2600) {   // cinematic title card with letterbox bars
    $("vyKicker").textContent = kicker; $("vyTitle").textContent = title; $("vySub").textContent = sub;
    root.classList.add("cine"); $("vyCard").hidden = false;
    return new Promise((ok) => setTimeout(() => { $("vyCard").hidden = true; root.classList.remove("cine"); ok(); }, ms));
  }
  function bars() {
    $("vyHull").style.width = Math.max(0, hull) + "%"; $("vyHull").classList.toggle("low", hull <= 40);
    hud("vyData", data); $("vyProg").style.width = Math.min(100, (travelled / goal) * 100) + "%";
    hud("vyChapter", `${n + 1} / ${chapters.length}  ${L().name.toUpperCase()}`);
  }

  // ---------- FLY ----------
  async function startFly() {
    phase = "card"; travelled = 0; goal = 1500 + n * 140; speed = BASE_SPEED + n * 4; spawnR = spawnF = 0;
    rocks.forEach((r) => { r.live = false; r.m.visible = false; }); frags.forEach((f) => { f.live = false; f.m.visible = false; });
    for (let i = 0; i < 9; i++) { spawnRock(); }                                  // some debris already ahead, so the field is never empty
    rocks.filter((r) => r.live).forEach((r) => (r.m.position.z = rand(-420, -150)));
    dest.material.color.set(n < 5 ? 0xffc27a : 0x8ac8ff); $("vyScan").hidden = true; $("vyHud").hidden = false; bars();
    sound.setEngine(1, false);
    await card(`CHAPTER ${n + 1}`, L().name.toUpperCase(), `${L().kind}  ·  ${L().distance_au} au from the Sun`);
    say("CONTROL", n === 0 ? `Commander, SPHEREx picked up something moving out here. Fly through the debris and get us a scanner lock. Mouse or arrow keys to steer, hold Space to boost.`
      : `Next signal: ${L().name}, ${L().distance_au} au out. The field is thicker here. Watch your hull.`);
    phase = "fly";
  }
  function spawnRock() {
    const r = rocks.find((x) => !x.live); if (!r) return;
    r.live = true; r.r = rand(0.9, 2.7); r.m.scale.setScalar(r.r); r.m.position.set(rand(-12, 12), rand(-7, 7), -430); r.m.visible = true; r.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  }
  function spawnFrag() { const f = frags.find((x) => !x.live); if (!f) return; f.live = true; f.m.position.set(rand(-10, 10), rand(-5.5, 5.5), -430); f.m.visible = true; }
  function fly(dt) {
    boost = keys.has(" ") || keys.has("Shift");
    const v = speed * (boost ? BOOST : 1);
    // steering: keys move the aim point; the mouse sets it directly
    const kx = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0), ky = (keys.has("ArrowUp") || keys.has("w") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("s") ? 1 : 0);
    if (kx || ky) { mouse.used = false; aim.x = THREE.MathUtils.clamp(aim.x + kx * dt * 1.8, -1, 1); aim.y = THREE.MathUtils.clamp(aim.y + ky * dt * 1.8, -1, 1); }
    else if (mouse.used) aim.set(mouse.x, mouse.y);
    const tx = aim.x * 11, ty = aim.y * 6, px = ship.position.x;
    ship.position.x += (tx - ship.position.x) * Math.min(1, dt * 5.5); ship.position.y += (ty - ship.position.y) * Math.min(1, dt * 5.5);
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -(ship.position.x - px) / Math.max(dt, 0.001) * 0.035, 0.2);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, (ty - ship.position.y) * 0.05, 0.2);
    travelled += v * dt;
    spawnR -= dt; if (spawnR <= 0) { spawnRock(); spawnR = Math.max(0.16, 0.5 - n * 0.03) * (boost ? 0.7 : 1); }
    spawnF -= dt; if (spawnF <= 0) { spawnFrag(); spawnF = rand(1.1, 2.2); }
    for (const r of rocks) if (r.live) {
      r.m.position.z += v * dt; r.m.rotation.x += r.spin.x * dt; r.m.rotation.y += r.spin.y * dt;
      if (Math.abs(r.m.position.z) < 1.6 && Math.hypot(r.m.position.x - ship.position.x, r.m.position.y - ship.position.y) < r.r + 0.95) {
        r.live = false; r.m.visible = false; hull -= 18; shake = 0.5; sound.hit(); root.classList.add("hurt"); setTimeout(() => root.classList.remove("hurt"), 220);
        if (hull <= 0) return wrecked();
      }
      if (r.m.position.z > 14) { r.live = false; r.m.visible = false; }
    }
    for (const f of frags) if (f.live) {
      f.m.position.z += v * dt; f.m.rotation.y += dt * 3;
      if (Math.abs(f.m.position.z) < 1.8 && Math.hypot(f.m.position.x - ship.position.x, f.m.position.y - ship.position.y) < 1.9) { f.live = false; f.m.visible = false; data += 25; sound.collect(); }
      if (f.m.position.z > 14) { f.live = false; f.m.visible = false; }
    }
    dest.scale.setScalar(14 + (travelled / goal) * 70);
    sound.setEngine(1, boost);
    if (travelled >= goal) startScan();
    bars();
  }
  async function wrecked() {
    phase = "card"; sound.fail(); sound.setEngine(0.3, false);
    say("ASTRA", "Hull breach. Emergency repairs done. We are going again, Commander. Boosting is faster, but leaves less time to dodge.");
    await card("HULL FAILURE", "TRY AGAIN", "The debris field does not forgive", 2200);
    hull = 60; startFly();
  }

  // ---------- SCAN ----------
  const view = new Viewer($("vyView")), reticle = $("vyReticle");
  let cursor = null;
  $("vyView").addEventListener("pointermove", (e) => { const r = $("vyView").getBoundingClientRect(); cursor = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; reticle.style.left = cursor.x * 100 + "%"; reticle.style.top = cursor.y * 100 + "%"; });
  async function startScan() {
    phase = "card"; sound.setEngine(0.25, false); lock = 0; scanLeft = SCAN_SECONDS; assisted = false; cursor = null;
    rocks.forEach((r) => { r.live = false; r.m.visible = false; }); frags.forEach((f) => { f.live = false; f.m.visible = false; });
    await view.load(L().frames, L().size); view.pair = [0, 1]; view.setMode("blink"); view.mark("");
    $("vyScan").hidden = false; $("vyScan").classList.remove("done"); $("vyResult").hidden = true; $("vyLockRow").hidden = false;
    say("ASTRA", "Scanner online. These are two real SPHEREx images, flipping. The stars hold still. Keep the reticle on the one thing that jumps until I have a lock.");
    phase = "scan";
  }
  function scan(dt) {
    scanLeft -= dt;
    const f = L().frames[view.i === 1 ? 1 : 0], on = cursor && Math.hypot(cursor.x * L().size - f.x, cursor.y * L().size - f.y) < LOCK_RADIUS;
    lock = THREE.MathUtils.clamp(lock + (on ? dt / LOCK_SECONDS : -dt * 0.45), 0, 1);
    reticle.classList.toggle("on", !!on); $("vyLock").style.width = lock * 100 + "%"; hud("vyTime", Math.max(0, Math.ceil(scanLeft)));
    if (on && performance.now() > tickAt) { tickAt = performance.now() + 140; sound.lockTick(lock); }
    if (Math.random() < dt * 0.9) interference();
    if (lock >= 1) return locked();
    if (scanLeft <= 0) {
      sound.fail(); hull = Math.max(10, hull - 10); scanLeft = SCAN_SECONDS; assisted = true; bars();
      const [a, b] = L().frames;      // second attempt: show roughly where to look
      view.mark(`<circle cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="${Math.hypot(a.x - b.x, a.y - b.y) / 2 + 55}" fill="none" stroke="#ffb547" stroke-width="2" stroke-dasharray="8 8"/>`);
      say("ASTRA", "Signal lost. I have narrowed it to the amber circle. Look for the dot that jumps.");
    }
  }
  function interference() {             // cosmic-ray flashes: brief false blips, as on a real detector
    const s = L().size, x = rand(20, s - 20), y = rand(20, s - 20), id = "cr" + Math.floor(Math.random() * 1e6);
    view.svg.insertAdjacentHTML("beforeend", `<circle id="${id}" cx="${x}" cy="${y}" r="${rand(3, 6)}" fill="#fff" opacity=".9"/>`);
    setTimeout(() => view.svg.querySelector("#" + id)?.remove(), 160);
  }
  function locked() {
    phase = "result"; const W = L(), [a, b] = W.frames, bonus = assisted ? 60 : 100 + Math.ceil(scanLeft) * 4;
    data += bonus; sound.locked(); bars();
    view.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="ring was" cx="${a.x}" cy="${a.y}" r="18"/><circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/><circle class="ring pulse" cx="${b.x}" cy="${b.y}" r="18"/>`);
    $("vyLockRow").hidden = true; $("vyResult").hidden = false; $("vyScan").classList.add("done");
    hud("vyRName", W.name); hud("vyRKind", `${W.kind} · ${W.distance_au} au from the Sun`); hud("vyRBlurb", W.blurb);
    hud("vyRFact", `It moved ${W.moved_arcsec} arcseconds in ${span(W.days_between)} between these two real images. +${bonus} data.`);
    $("vyNext").textContent = n + 1 < chapters.length ? "Warp to the next signal  (Space)" : "Finish the voyage  (Space)";
    say("CONTROL", `Lock confirmed: ${W.name}. Position matches NASA JPL. Outstanding, Commander.`);
  }

  // ---------- WARP ----------
  async function startWarp() {
    if (phase !== "result") return;
    const from = L(); n++;
    if (n >= chapters.length) return ending();
    phase = "warp"; warpT = 0; $("vyScan").hidden = true; sound.warp(); sound.setEngine(1, true);
    const au = Math.abs(L().distance_au - from.distance_au), mins = L().distance_au * 8.317;
    say("ASTRA", `Jumping ${au.toFixed(1)} au outward. At ${L().distance_au} au, sunlight takes ${mins < 90 ? Math.round(mins) + " minutes" : (mins / 60).toFixed(1) + " hours"} to arrive.`);
    setTimeout(() => { if (phase === "warp") startFly(); }, 2600);
  }
  async function ending() {
    phase = "card"; $("vyScan").hidden = true; sound.setEngine(0.2, false);
    await card("VOYAGE COMPLETE", `${data} DATA`, "Every world you locked is real. Planet X is still out there.", 5200);
    $("vyHud").hidden = true; $("vyComm").hidden = true; $("vyStartBox").hidden = false; $("vyStart").textContent = "Fly again";
    phase = "idle"; sound.setEngine(0, false);
  }
  $("vyNext").onclick = startWarp;

  // ---------- input ----------
  addEventListener("keydown", (e) => {
    if (root.hidden) return;
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (e.key === " ") { e.preventDefault(); if (phase === "result") startWarp(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  holder.addEventListener("pointermove", (e) => { const r = holder.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1); mouse.used = true; });
  $("vyStart").onclick = () => { sound.start(); n = 0; hull = 100; data = 0; $("vyStartBox").hidden = true; startFly(); };

  // ---------- draw ----------
  function resize() { const w = holder.clientWidth, h = holder.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(holder);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (root.offsetParent === null) { last = now; sound.setEngine(0, false); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (phase === "fly") fly(dt); else if (phase === "scan") scan(dt);
    if (phase === "warp") warpT += dt;
    const flow = phase === "warp" ? 900 : phase === "fly" ? speed * (boost ? BOOST : 1) : 16, len = Math.max(0.4, flow * 0.045);
    for (let i = 0; i < NS; i++) { const s = stars[i]; s.z += flow * dt; if (s.z > 20) { s.z = -430; s.x = rand(-90, 90); s.y = rand(-60, 60); } sp.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6); }
    starGeo.attributes.position.needsUpdate = true;
    const targetFov = phase === "warp" ? 104 : boost && phase === "fly" ? 80 : 70;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
    shake = Math.max(0, shake - dt * 1.6);
    camera.position.set(ship.position.x * 0.45 + rand(-1, 1) * shake, 2.4 + ship.position.y * 0.45 + rand(-1, 1) * shake, 9.5);
    camera.lookAt(ship.position.x * 0.6, ship.position.y * 0.6, -30);
    const flick = 1.3 + Math.random() * 0.5 + (boost && phase === "fly" ? 1.2 : 0) + (phase === "warp" ? 2.2 : 0);
    flames.forEach((f) => f.scale.setScalar(flick));
    if (phase !== "fly") { ship.rotation.z *= 0.92; ship.position.y += (Math.sin(now / 700) * 0.4 - ship.position.y) * dt * 1.5; ship.position.x *= 1 - dt * 1.2; }
    renderer.render(scene, camera);
  }
  resize(); requestAnimationFrame(frame);

  // used by the browser check
  window.__voyage = { state: () => ({ phase, n, hull, data, lock, frames: phase === "scan" || phase === "result" ? L().frames : null, size: L().size, i: view.i }), arrive: () => { travelled = goal; }, safe: () => { hull = 1e6; } };
}
