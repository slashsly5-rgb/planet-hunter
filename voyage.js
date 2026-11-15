// Voyage to Planet X: a cinematic adventure. Each chapter is one real world:
//   FLY     steer through the debris field, shoot rocks, grab power-ups
//   ARRIVE  fly past the world itself
//   SCAN    hold the reticle on the object that jumps between two real SPHEREx images until the lock completes
//   WARP    jump onward through the Solar System
// The ship, debris, lasers, radio chatter, sounds and the look of each world are game fiction.
// The scanner pictures, positions, distances and sunlight levels are real.
import * as THREE from "./vendor/three.module.min.js";
import { $, Viewer, span } from "./viewer.js?v=15";

const LOCK_RADIUS = 30, LOCK_SECONDS = 2.6, SCAN_SECONDS = 24;
const BASE_SPEED = 70, BOOST = 1.7, FIRE_EVERY = 0.15, BOLT_SPEED = 420;
const rand = (a, b) => a + Math.random() * (b - a), pick = (a) => a[Math.floor(Math.random() * a.length)];

// Where each chapter takes place: colours and what the debris is made of.
const ZONES = {
  belt:   { fog: 0x0b0806, glow: [0xb0622a, 0x7a3a1a, 0x8a5a2a], rock: [0.07, 0.35, 0.42], ice: 0, name: "ASTEROID BELT" },
  giants: { fog: 0x030a10, glow: [0x1f8a9a, 0x2a5ad0, 0x1a6a8a], rock: [0.55, 0.25, 0.5], ice: 0.6, name: "ICE GIANT REALM" },
  kuiper: { fog: 0x05030c, glow: [0x5a2aa0, 0x2a1a6a, 0x7a2a6a], rock: [0.72, 0.2, 0.36], ice: 0.35, name: "KUIPER BELT" },
};
const zoneOf = (L) => (L.distance_au < 6 ? "belt" : L.distance_au < 31 ? "giants" : "kuiper");
const LOOK = {   // how each world is drawn (artist's impression, not data)
  vesta: { base: "#8d8a86", kind: "rock", lumpy: 0.2 }, ceres: { base: "#77746f", kind: "rock", lumpy: 0.03, spots: true }, pallas: { base: "#7f8088", kind: "rock", lumpy: 0.16 },
  juno: { base: "#93897c", kind: "rock", lumpy: 0.22 }, hygiea: { base: "#55524f", kind: "rock", lumpy: 0.07 },
  uranus: { base: "#9fe3e6", kind: "gas", band: "#8ad6dc", ring: 0x9fd8e0, tilt: 1.45 }, neptune: { base: "#3a5fd0", kind: "gas", band: "#2a49b0", storm: true },
  pluto: { base: "#c9ab8a", kind: "ice", heart: true }, makemake: { base: "#b5674a", kind: "ice" }, haumea: { base: "#d8d4d0", kind: "ice", stretch: [1.7, 0.85, 1], ring: 0xcfc6c0, tilt: 0.3 },
};

// ---------- sound: everything is synthesised, no audio files ----------
class Sound {
  start() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C(); this.out = this.ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(this.ctx.destination);
    this.engine = this.ctx.createGain(); this.engine.gain.value = 0;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; this.lp = lp;
    for (const f of [55, 55.7]) { const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(this.engine); this.engine.connect(this.out);
  }
  setEngine(level, boost) { if (!this.ctx) return; const t = this.ctx.currentTime; this.engine.gain.setTargetAtTime(level * 0.15, t, 0.2); this.lp.frequency.setTargetAtTime(boost ? 520 : 220, t, 0.25); }
  tone(freq, dur = 0.12, type = "sine", vol = 0.25, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  laser() { this.tone(1500, 0.09, "square", 0.06, 300); }
  boom(big) { this.tone(big ? 90 : 160, big ? 0.45 : 0.22, "sawtooth", big ? 0.35 : 0.2, 30); }
  collect() { this.tone(880, 0.09, "triangle", 0.2); setTimeout(() => this.tone(1320, 0.12, "triangle", 0.2), 70); }
  power() { [520, 780, 1040, 1560].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, "triangle", 0.22), i * 60)); }
  hit() { this.tone(110, 0.4, "sawtooth", 0.42, 38); }
  blip() { this.tone(620, 0.03, "square", 0.04); }
  lockTick(p) { this.tone(400 + p * 700, 0.05, "sine", 0.12); }
  locked() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.25), i * 110)); }
  fail() { this.tone(300, 0.4, "sawtooth", 0.25, 120); }
  warp() { this.tone(90, 2.2, "sawtooth", 0.3, 1400); }
}

// ---------- painted surfaces for the worlds ----------
function surface(look) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d"); g.fillStyle = look.base; g.fillRect(0, 0, 512, 256);
  if (look.kind === "gas") {
    for (let i = 0; i < 26; i++) { g.fillStyle = i % 2 ? look.band : "#ffffff"; g.globalAlpha = rand(0.05, 0.22); g.fillRect(0, rand(0, 256), 512, rand(3, 22)); }
    if (look.storm) { g.globalAlpha = 0.55; g.fillStyle = "#16286e"; g.beginPath(); g.ellipse(330, 150, 44, 20, 0, 0, 7); g.fill(); g.globalAlpha = 0.5; g.fillStyle = "#fff"; g.beginPath(); g.ellipse(322, 126, 30, 4, 0, 0, 7); g.fill(); }
  } else {
    for (let i = 0; i < 240; i++) { g.globalAlpha = rand(0.04, 0.2); g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.beginPath(); g.arc(rand(0, 512), rand(0, 256), rand(2, 26), 0, 7); g.fill(); }
    for (let i = 0; i < (look.kind === "rock" ? 46 : 18); i++) {       // craters: dark floor, bright rim
      const x = rand(0, 512), y = rand(20, 236), r = rand(3, 16);
      g.globalAlpha = 0.35; g.fillStyle = "#000"; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.globalAlpha = 0.3; g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(x - 1, y - 1, r, 3.6, 5.8); g.stroke();
    }
    if (look.spots) { g.globalAlpha = 0.95; g.fillStyle = "#fff"; for (const [x, y] of [[250, 110], [258, 116], [244, 118]]) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); } }
    if (look.heart) { g.globalAlpha = 0.8; g.fillStyle = "#f3e6d2"; g.beginPath(); g.ellipse(250, 138, 46, 34, 0.2, 0, 7); g.fill(); g.beginPath(); g.ellipse(292, 130, 30, 26, -0.3, 0, 7); g.fill(); g.globalAlpha = 0.5; g.fillStyle = "#5a2e22"; g.beginPath(); g.ellipse(150, 150, 70, 26, 0, 0, 7); g.fill(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeWorld(id) {
  const look = LOOK[id] || LOOK.vesta, grp = new THREE.Group();
  const geo = look.kind === "rock" ? new THREE.IcosahedronGeometry(1, 5) : new THREE.SphereGeometry(1, 48, 32);
  if (look.lumpy) {                                   // small bodies are not round
    const p = geo.attributes.position, v = new THREE.Vector3(), s = rand(0, 10);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + look.lumpy * (Math.sin(v.x * 2.3 + s) * Math.cos(v.y * 2.9 - s) + 0.6 * Math.sin(v.z * 4.1 + s * 2)); p.setXYZ(i, v.x * k, v.y * k, v.z * k); }
    geo.computeVertexNormals();
  }
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: surface(look), roughness: look.kind === "gas" ? 0.6 : 0.95, metalness: 0, fog: false }));
  if (look.stretch) body.scale.set(...look.stretch);
  grp.add(body); grp.userData.body = body;
  if (look.kind === "gas") { const halo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 32, 24), new THREE.MeshBasicMaterial({ color: look.base, transparent: true, opacity: 0.16, side: THREE.BackSide, fog: false })); grp.add(halo); }
  if (look.ring) { const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.1, 80), new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false })); ring.rotation.x = look.tilt; grp.add(ring); }
  return grp;
}

export function initVoyage(levels) {
  const root = $("voyage"), holder = $("vyCanvas");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { $("vyStartMsg").textContent = "This browser cannot show 3D, so the voyage is unavailable. Use Hunt instead."; $("vyStart").disabled = true; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); holder.append(renderer.domElement);
  const sound = new Sound();
  const chapters = [...levels].sort((a, b) => a.distance_au - b.distance_au);   // travel outward from the Sun

  // ---------- scene ----------
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x04060f, 200, 470); scene.background = new THREE.Color(0x04060f);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2500); camera.position.set(0, 2.4, 9.5);
  const ambient = new THREE.AmbientLight(0x8a9bd0, 1.0); scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.4); sunLight.position.set(-5, 7, 14); scene.add(sunLight);   // the Sun is behind us
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "#fff"); gr.addColorStop(0.3, "#ffffffaa"); gr.addColorStop(1, "transparent"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = (color, size, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false })); s.scale.setScalar(size); return s; };

  // ---------- the ship: a swept-wing fighter built from flat panels ----------
  const ship = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef2fb, metalness: 0.75, roughness: 0.28, flatShading: true });
  const navy = new THREE.MeshStandardMaterial({ color: 0x1b2a55, metalness: 0.8, roughness: 0.35, flatShading: true });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.9, flatShading: true });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x6fe3ff, emissive: 0x2fc8ff, emissiveIntensity: 1.6 });
  const panel = (pts, mat, depth = 0.12) => {       // a flat plate from an outline in the x-z plane (nose is -z)
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], -pts[0][1]); for (const p of pts.slice(1)) sh.lineTo(p[0], -p[1]);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), mat); m.rotation.x = -Math.PI / 2; m.position.y = -depth / 2; return m;
  };
  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.62, 5.2, 8), white); fuselage.rotation.x = -Math.PI / 2; fuselage.scale.set(1, 1, 0.62); fuselage.position.z = -0.4; ship.add(fuselage);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 3.2), navy); spine.position.set(0, 0.2, 0.9); ship.add(spine);
  for (const s of [-1, 1]) {
    const w = panel([[0.35, -0.9], [3.6, 1.7], [3.6, 2.3], [0.35, 2.0]], white); w.scale.x = s; ship.add(w);             // main swept wing
    const stripe = panel([[1.2, 0.05], [3.6, 1.95], [3.6, 2.15], [1.2, 0.5]], orange, 0.15); stripe.scale.x = s; ship.add(stripe);
    const canard = panel([[0.3, -2.0], [1.25, -1.35], [1.25, -1.1], [0.3, -1.3]], navy, 0.08); canard.scale.x = s; ship.add(canard);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 1.25), navy); fin.position.set(s * 0.95, 0.6, 1.7); fin.rotation.z = -s * 0.42; fin.rotation.x = -0.25; ship.add(fin);
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 2.3, 10), navy); nacelle.rotation.x = Math.PI / 2; nacelle.position.set(s * 0.95, -0.02, 1.35); ship.add(nacelle);
    const nozzle = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 8, 16), cyan); nozzle.position.set(s * 0.95, -0.02, 2.52); ship.add(nozzle);
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6), navy); cannon.rotation.x = Math.PI / 2; cannon.position.set(s * 2.2, -0.05, 0.5); ship.add(cannon);
    const light = glow(s < 0 ? 0xff3344 : 0x33ff88, 0.7); light.position.set(s * 3.6, 0.06, 2.0); ship.add(light); light.userData.nav = true;
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2ad0ff, emissive: 0x0a6a9a, emissiveIntensity: 0.9, metalness: 1, roughness: 0.05 })); canopy.scale.set(0.85, 0.6, 2.0); canopy.position.set(0, 0.36, -0.9); ship.add(canopy);
  const flames = [-1, 1].map((s) => { const f = glow(0x6fd8ff, 2.2); f.position.set(s * 0.95, -0.02, 3.0); ship.add(f); return f; });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0x5ad0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true })); shield.scale.set(1, 0.45, 1); ship.add(shield);
  scene.add(ship);

  // ---------- star streaks ----------
  const NS = 1100, sp = new Float32Array(NS * 6), stars = [];
  for (let i = 0; i < NS; i++) stars.push({ x: rand(-110, 110), y: rand(-70, 70), z: rand(-470, 20) });
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const starLines = new THREE.LineSegments(starGeo, new THREE.LineBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.8, fog: false })); starLines.frustumCulled = false; scene.add(starLines);
  const nebulae = [[-460, 190, 980], [520, -140, 840], [140, 330, 700]].map(([x, y, s]) => { const nb = glow(0xffffff, s, 0.17); nb.position.set(x, y, -1250); scene.add(nb); return nb; });

  // ---------- particles: one pool for explosions, sparks and engine trails ----------
  const NP = 900, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), parts = Array.from({ length: NP }, () => ({ life: 0, v: new THREE.Vector3(), c: new THREE.Color(), max: 1 }));
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.75, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); points.frustumCulled = false; scene.add(points);
  let pNext = 0;
  function spark(x, y, z, color, vel, life, spread = 0) {
    const i = pNext, p = parts[i]; pNext = (pNext + 1) % NP;
    p.life = p.max = life; p.c.set(color); p.v.set(vel[0] + rand(-spread, spread), vel[1] + rand(-spread, spread), vel[2] + rand(-spread, spread));
    pPos.set([x, y, z], i * 3);
  }
  function explode(pos, r, color = 0xffb060) {
    for (let i = 0; i < 14 + r * 10; i++) spark(pos.x, pos.y, pos.z, i % 3 ? color : 0xffffff, [0, 0, 30], rand(0.35, 0.9), 14 + r * 6);
  }

  // ---------- debris, shards, pick-ups, bolts: all reused from pools ----------
  const rockGeo = new THREE.IcosahedronGeometry(1, 0), shardGeo = new THREE.OctahedronGeometry(1, 0), rocks = [];
  for (let i = 0; i < 150; i++) { const m = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.92 })); m.visible = false; scene.add(m); rocks.push({ m, r: 1, hp: 1, live: false, solid: true, spin: new THREE.Vector3(), drift: new THREE.Vector2() }); }
  const fragGeo = new THREE.OctahedronGeometry(0.6, 0), frags = [];
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(fragGeo, new THREE.MeshStandardMaterial({ color: 0x7dffcf, emissive: 0x2fe0a0, emissiveIntensity: 1.6, flatShading: true })); m.visible = false; scene.add(m); frags.push({ m, live: false }); }
  const POWERS = { shield: 0x5ad0ff, magnet: 0x7dffcf, rapid: 0xffb547 }, powers = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 8, 24), new THREE.MeshStandardMaterial({ emissiveIntensity: 2 })); m.visible = false; scene.add(m); powers.push({ m, live: false, kind: "shield" }); }
  const boltGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.2, 5).rotateX(Math.PI / 2), boltMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, fog: false }), bolts = [];
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(boltGeo, boltMat); m.visible = false; scene.add(m); bolts.push({ m, live: false }); }

  // ---------- state ----------
  let n = 0, phase = "idle", hull = 100, data = 0, travelled = 0, goal = 1, speed = BASE_SPEED, boost = false, shake = 0, tPhase = 0;
  let spawnR = 0, spawnS = 0, spawnF = 0, spawnP = 6, fireAt = 0, firing = false, combo = 0, comboT = 0, kills = 0, hullAtStart = 100;
  let shieldT = 0, magnetT = 0, rapidT = 0, lock = 0, scanLeft = 0, assisted = false, tickAt = 0, world = null, zone = ZONES.belt;
  const aim = new THREE.Vector2(), keys = new Set(), mouse = { x: 0, y: 0, used: false };
  const hud = (id, v) => ($(id).textContent = v);
  const L = () => chapters[Math.min(n, chapters.length - 1)];

  function say(who, text) {
    const el = $("vyComm"); el.hidden = false; $("vyWho").textContent = who; const body = $("vySay"); body.textContent = "";
    clearInterval(say.t); let i = 0;
    say.t = setInterval(() => { body.textContent = text.slice(0, ++i); if (i % 2) sound.blip(); if (i >= text.length) clearInterval(say.t); }, 20);
  }
  function card(kicker, title, sub, ms = 2600) {
    $("vyKicker").textContent = kicker; $("vyTitle").textContent = title; $("vySub").textContent = sub;
    root.classList.add("cine"); $("vyCard").hidden = false;
    return new Promise((ok) => setTimeout(() => { $("vyCard").hidden = true; root.classList.remove("cine"); ok(); }, ms));
  }
  function bars() {
    $("vyHull").style.width = Math.max(0, Math.min(100, hull)) + "%"; $("vyHull").classList.toggle("low", hull <= 40);
    hud("vyData", data); $("vyProg").style.width = Math.min(100, (travelled / goal) * 100) + "%";
    hud("vyChapter", `${n + 1} / ${chapters.length}  ${L().name.toUpperCase()}`);
    hud("vyCombo", combo > 1 ? `x${combo}` : ""); hud("vyBuff", [shieldT > 0 && "SHIELD", magnetT > 0 && "MAGNET", rapidT > 0 && "RAPID FIRE"].filter(Boolean).join("  "));
  }
  const clearField = (boom) => { for (const r of rocks) if (r.live) { if (boom && r.solid && r.m.position.z > -260) explode(r.m.position, r.r, 0x9fb4ff); r.live = false; r.m.visible = false; } [...frags, ...powers, ...bolts].forEach((o) => { o.live = false; o.m.visible = false; }); };

  // ---------- FLY ----------
  async function startFly() {
    phase = "card"; travelled = 0; goal = 2100 + n * 170; speed = BASE_SPEED + n * 5; spawnR = spawnS = spawnF = 0; spawnP = rand(5, 9); combo = 0; kills = 0; hullAtStart = hull;
    clearField(false);
    zone = ZONES[zoneOf(L())];
    scene.fog.color.set(zone.fog); scene.background.set(zone.fog); nebulae.forEach((nb, i) => nb.material.color.set(zone.glow[i]));
    // sunlight really does fall off with distance squared; the scene dims with it (softened so the game stays playable)
    const sun = 1 / L().distance_au ** 2; sunLight.intensity = 0.5 + 2.2 * Math.pow(sun / (1 / 2.15 ** 2), 0.22); ambient.intensity = 0.55 + 0.5 * Math.pow(sun * 4.6, 0.2);
    hud("vySun", sun >= 0.01 ? `${(sun * 100).toFixed(1)}%` : `${(sun * 100).toFixed(3)}%`);
    if (world) scene.remove(world);
    world = makeWorld(L().id); world.position.set(14, 9, -760); world.scale.setScalar(8); scene.add(world);
    for (let i = 0; i < 22; i++) spawnRock(true); for (let i = 0; i < 40; i++) spawnRock(false);
    rocks.filter((r) => r.live).forEach((r) => (r.m.position.z = rand(-460, -130)));
    $("vyScan").hidden = true; $("vyHud").hidden = false; bars(); sound.setEngine(1, false);
    await card(`CHAPTER ${n + 1}  ·  ${zone.name}`, L().name.toUpperCase(), `${L().kind}  ·  ${L().distance_au} au from the Sun`);
    say("CONTROL", n === 0 ? "Commander, SPHEREx picked up something moving out here. Punch through the debris and get us a scanner lock. Steer with the mouse, hold the button to fire, Space to boost."
      : pick([`Next signal: ${L().name}, ${L().distance_au} au out. The field is thicker here. Watch your hull.`, `${L().name} ahead. Sunlight is down to ${$("vySun").textContent} of what Earth gets. Stay sharp.`, `Signal bearing confirmed: ${L().name}. Clear a path, Commander.`]));
    phase = "fly";
  }
  function spawnRock(solid) {
    const r = rocks.find((x) => !x.live); if (!r) return;
    const icy = Math.random() < zone.ice;
    r.live = true; r.solid = solid; r.r = solid ? rand(0.9, 3.4) : rand(2, 9); r.hp = Math.ceil(r.r * 0.9);
    r.m.geometry = icy ? shardGeo : rockGeo;
    r.m.material.color.setHSL(zone.rock[0] + rand(-0.03, 0.03), icy ? 0.5 : zone.rock[1], zone.rock[2] + rand(-0.1, 0.1));
    r.m.material.emissive.setHex(icy ? 0x1a4a6a : 0x000000); r.m.material.transparent = icy; r.m.material.opacity = icy ? 0.85 : 1;
    r.m.scale.set(r.r * (icy ? 0.6 : 1), r.r * (icy ? 1.5 : rand(0.75, 1.1)), r.r * (icy ? 0.6 : 1));
    if (solid) r.m.position.set(rand(-14, 14), rand(-8.5, 8.5), -470);
    else { const side = Math.random() < 0.5 ? -1 : 1; r.m.position.set(side * rand(22, 80), rand(-45, 45), -470); }   // scenery: passes wide of the ship
    r.m.visible = true; r.spin.set(rand(-1.4, 1.4), rand(-1.4, 1.4), rand(-1, 1)); r.drift.set(solid ? rand(-2.6, 2.6) : 0, solid ? rand(-1.8, 1.8) : 0);
  }
  function spawn(pool, set) { const o = pool.find((x) => !x.live); if (!o) return; o.live = true; o.m.position.set(rand(-11, 11), rand(-6, 6), -470); o.m.visible = true; set?.(o); }
  function fireBolts() {
    for (const s of [-1, 1]) { const b = bolts.find((x) => !x.live); if (!b) return; b.live = true; b.m.position.set(ship.position.x + s * 2.2, ship.position.y - 0.05, -1.5); b.m.visible = true; }
    sound.laser();
  }
  function hurt(amount) {
    if (shieldT > 0) { shieldT = Math.max(0, shieldT - 2.5); shake = 0.25; sound.boom(false); return; }
    hull -= amount; shake = 0.6; combo = 0; sound.hit(); root.classList.add("hurt"); setTimeout(() => root.classList.remove("hurt"), 240);
    for (let i = 0; i < 20; i++) spark(ship.position.x, ship.position.y, 0, 0xff5a3c, [0, 0, 20], rand(0.3, 0.7), 16);
  }
  function fly(dt) {
    boost = keys.has(" ") || keys.has("Shift");
    const v = speed * (boost ? BOOST : 1), kx = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0), ky = (keys.has("ArrowUp") || keys.has("w") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("s") ? 1 : 0);
    if (kx || ky) { mouse.used = false; aim.x = THREE.MathUtils.clamp(aim.x + kx * dt * 2, -1, 1); aim.y = THREE.MathUtils.clamp(aim.y + ky * dt * 2, -1, 1); } else if (mouse.used) aim.set(mouse.x, mouse.y);
    const tx = aim.x * 13, ty = aim.y * 7.5, px = ship.position.x;
    ship.position.x += (tx - ship.position.x) * Math.min(1, dt * 6); ship.position.y += (ty - ship.position.y) * Math.min(1, dt * 6);
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, THREE.MathUtils.clamp(-(ship.position.x - px) / Math.max(dt, 0.001) * 0.04, -1.1, 1.1), 0.18);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, (ty - ship.position.y) * 0.06, 0.2);
    travelled += v * dt;
    // weapons
    fireAt -= dt; if ((firing || keys.has("z") || keys.has("Control")) && fireAt <= 0) { fireBolts(); fireAt = rapidT > 0 ? FIRE_EVERY * 0.45 : FIRE_EVERY; }
    for (const b of bolts) if (b.live) { b.m.position.z -= BOLT_SPEED * dt; if (b.m.position.z < -430) { b.live = false; b.m.visible = false; } }
    // spawning: the field thickens every chapter
    spawnR -= dt; if (spawnR <= 0) { spawnRock(true); spawnR = Math.max(0.085, 0.21 - n * 0.012) * (boost ? 0.75 : 1); }
    spawnS -= dt; if (spawnS <= 0) { spawnRock(false); spawnS = 0.09; }
    spawnF -= dt; if (spawnF <= 0) { spawn(frags); spawnF = rand(0.8, 1.7); }
    spawnP -= dt; if (spawnP <= 0) { spawn(powers, (o) => { o.kind = pick(Object.keys(POWERS)); o.m.material.color.setHex(POWERS[o.kind]); o.m.material.emissive.setHex(POWERS[o.kind]); }); spawnP = rand(9, 14); }
    for (const r of rocks) if (r.live) {
      r.m.position.z += v * dt; r.m.position.x += r.drift.x * dt; r.m.position.y += r.drift.y * dt; r.m.rotation.x += r.spin.x * dt; r.m.rotation.y += r.spin.y * dt;
      if (r.solid) {
        for (const b of bolts) if (b.live && Math.abs(b.m.position.z - r.m.position.z) < r.r + 3 && Math.hypot(b.m.position.x - r.m.position.x, b.m.position.y - r.m.position.y) < r.r + 0.3) {
          b.live = false; b.m.visible = false; r.hp--; spark(b.m.position.x, b.m.position.y, b.m.position.z, 0xffd08a, [0, 0, 40], 0.25, 10);
          if (r.hp <= 0) { r.live = false; r.m.visible = false; explode(r.m.position, r.r); sound.boom(r.r > 2.2); kills++; combo++; comboT = 2.2; data += 5 * Math.min(combo, 10); shake = Math.max(shake, r.r * 0.05); break; }
        }
        if (r.live && Math.abs(r.m.position.z) < 1.8 && Math.hypot(r.m.position.x - ship.position.x, r.m.position.y - ship.position.y) < r.r + 1.3) {
          r.live = false; r.m.visible = false; explode(r.m.position, r.r, 0xff7a4a); hurt(12 + r.r * 4);
          if (hull <= 0) return wrecked();
        }
      }
      if (r.m.position.z > 16) { r.live = false; r.m.visible = false; }
    }
    for (const f of frags) if (f.live) {
      f.m.position.z += v * dt; f.m.rotation.y += dt * 3;
      if (magnetT > 0 && f.m.position.z > -90) { f.m.position.x += (ship.position.x - f.m.position.x) * dt * 4; f.m.position.y += (ship.position.y - f.m.position.y) * dt * 4; }
      if (Math.abs(f.m.position.z) < 2 && Math.hypot(f.m.position.x - ship.position.x, f.m.position.y - ship.position.y) < 2.3) { f.live = false; f.m.visible = false; data += 25; sound.collect(); for (let i = 0; i < 8; i++) spark(f.m.position.x, f.m.position.y, 0, 0x7dffcf, [0, 0, 20], 0.4, 9); }
      if (f.m.position.z > 16) { f.live = false; f.m.visible = false; }
    }
    for (const p of powers) if (p.live) {
      p.m.position.z += v * dt; p.m.rotation.y += dt * 2; p.m.rotation.x += dt;
      if (Math.abs(p.m.position.z) < 2 && Math.hypot(p.m.position.x - ship.position.x, p.m.position.y - ship.position.y) < 3) {
        p.live = false; p.m.visible = false; sound.power();
        if (p.kind === "shield") shieldT = 9; else if (p.kind === "magnet") magnetT = 10; else rapidT = 8;
        say("ASTRA", { shield: "Shield up. It will take a few hits for you.", magnet: "Magnet on. Fragments will come to us.", rapid: "Cannons overcharged. Rapid fire!" }[p.kind]);
      }
      if (p.m.position.z > 16) { p.live = false; p.m.visible = false; }
    }
    shieldT = Math.max(0, shieldT - dt); magnetT = Math.max(0, magnetT - dt); rapidT = Math.max(0, rapidT - dt);
    comboT -= dt; if (comboT <= 0) combo = 0;
    const k = travelled / goal; world.scale.setScalar(8 + k * k * 60); world.position.set(14 - k * 4, 9 - k * 3, -760 + k * 300);
    sound.setEngine(1, boost);
    if (travelled >= goal) startArrive();
    bars();
  }
  async function wrecked() {
    phase = "card"; sound.fail(); sound.setEngine(0.3, false); clearField(true);
    explode(ship.position, 4, 0xff7a4a);
    say("ASTRA", "Hull breach. Emergency repairs done. We are going again, Commander. Shoot the big ones early, and save the boost for clear space.");
    await card("HULL FAILURE", "TRY AGAIN", "The debris field does not forgive", 2400);
    hull = 70; startFly();
  }

  // ---------- ARRIVE: fly past the world ----------
  function startArrive() {
    phase = "arrive"; tPhase = 0; clearField(true); sound.setEngine(0.6, false); firing = false;
    root.classList.add("cine");
    say("CONTROL", `There it is. ${L().name}. Bringing the scanner online.`);
  }
  function arrive(dt) {
    tPhase += dt; const k = Math.min(1, tPhase / 3.2), e = k * k * (3 - 2 * k);
    world.scale.setScalar(68); world.position.set(10 - e * 82, 6 - e * 2, -460 + e * 245);   // sweep past: the world settles as a globe off the port side
    ship.position.x += (6 - ship.position.x) * dt * 1.5; ship.position.y += (-2 - ship.position.y) * dt * 1.5;
    if (k >= 1) { root.classList.remove("cine"); startScan(); }
  }

  // ---------- SCAN ----------
  const view = new Viewer($("vyView")), reticle = $("vyReticle");
  let cursor = null;
  $("vyView").addEventListener("pointermove", (e) => { const r = $("vyView").getBoundingClientRect(); cursor = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; reticle.style.left = cursor.x * 100 + "%"; reticle.style.top = cursor.y * 100 + "%"; });
  async function startScan() {
    phase = "card"; sound.setEngine(0.25, false); lock = 0; scanLeft = SCAN_SECONDS; assisted = false; cursor = null;
    await view.load(L().frames, L().size); view.pair = [0, 1]; view.blinkMs = Math.max(430, 700 - n * 30); view.setMode("blink"); view.mark("");   // the flip gets faster each chapter
    $("vyScan").hidden = false; $("vyScan").classList.remove("done"); $("vyResult").hidden = true; $("vyLockRow").hidden = false;
    say("ASTRA", n === 0 ? "Scanner online. These are two real SPHEREx images, flipping. The stars hold still. Keep the reticle on the one thing that jumps until I have a lock."
      : "Scanner online. Find the jumper and stay on it. Ignore the cosmic-ray flashes.");
    phase = "scan";
  }
  function scan(dt) {
    scanLeft -= dt;
    const f = L().frames[view.i === 1 ? 1 : 0], on = cursor && Math.hypot(cursor.x * L().size - f.x, cursor.y * L().size - f.y) < LOCK_RADIUS;
    lock = THREE.MathUtils.clamp(lock + (on ? dt / LOCK_SECONDS : -dt * 0.65), 0, 1);
    reticle.classList.toggle("on", !!on); $("vyLock").style.width = lock * 100 + "%"; hud("vyTime", Math.max(0, Math.ceil(scanLeft)));
    if (on && performance.now() > tickAt) { tickAt = performance.now() + 140; sound.lockTick(lock); }
    if (Math.random() < dt * (1.4 + n * 0.25)) interference();
    if (lock >= 1) return locked();
    if (scanLeft <= 0) {
      sound.fail(); hull = Math.max(10, hull - 12); scanLeft = SCAN_SECONDS; assisted = true; bars();
      const [a, b] = L().frames;
      view.mark(`<circle cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="${Math.hypot(a.x - b.x, a.y - b.y) / 2 + 55}" fill="none" stroke="#ffb547" stroke-width="2" stroke-dasharray="8 8"/>`);
      say("ASTRA", "Signal lost, and the scanner overheated. I have narrowed it to the amber circle. Look for the dot that jumps.");
    }
  }
  function interference() {             // cosmic-ray flashes: brief false blips, as on a real detector
    const s = L().size, id = "cr" + Math.floor(Math.random() * 1e6);
    view.svg.insertAdjacentHTML("beforeend", `<circle id="${id}" cx="${rand(20, s - 20)}" cy="${rand(20, s - 20)}" r="${rand(3, 7)}" fill="#fff" opacity=".9"/>`);
    setTimeout(() => view.svg.querySelector("#" + id)?.remove(), 170);
  }
  function locked() {
    phase = "result"; const W = L(), [a, b] = W.frames, used = SCAN_SECONDS - scanLeft;
    const pts = Math.round(Math.max(0, 100 - Math.max(0, hullAtStart - hull) * 1.1 - Math.max(0, used - 7) * 2.2 - (assisted ? 30 : 0))), grade = pts >= 85 ? "S" : pts >= 65 ? "A" : pts >= 40 ? "B" : "C";
    const bonus = { S: 300, A: 200, B: 120, C: 60 }[grade]; data += bonus; sound.locked(); bars();
    view.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="ring was" cx="${a.x}" cy="${a.y}" r="18"/><circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/><circle class="ring pulse" cx="${b.x}" cy="${b.y}" r="18"/>`);
    $("vyLockRow").hidden = true; $("vyResult").hidden = false; $("vyScan").classList.add("done");
    hud("vyGrade", grade); $("vyGrade").className = "vy-grade g" + grade;
    hud("vyRName", W.name); hud("vyRKind", `${W.kind} · ${W.distance_au} au from the Sun`); hud("vyRBlurb", W.blurb);
    hud("vyRFact", `It moved ${W.moved_arcsec} arcseconds in ${span(W.days_between)} between these two real images. Rocks destroyed: ${kills}. Bonus: +${bonus} data.`);
    $("vyNext").textContent = n + 1 < chapters.length ? "Warp to the next signal  (Space)" : "Finish the voyage  (Space)";
    say("CONTROL", `Lock confirmed: ${W.name}. Position matches NASA JPL. ${grade === "S" ? "Flawless flying, Commander." : grade === "A" ? "Good work, Commander." : "We got it. Keep that hull together next time."}`);
  }

  // ---------- WARP ----------
  function startWarp() {
    if (phase !== "result") return;
    const from = L(); n++;
    if (n >= chapters.length) return ending();
    phase = "warp"; $("vyScan").hidden = true; sound.warp(); sound.setEngine(1, true);
    const au = Math.abs(L().distance_au - from.distance_au), mins = L().distance_au * 8.317;
    say("ASTRA", `Jumping ${au.toFixed(1)} au outward. At ${L().distance_au} au, sunlight takes ${mins < 90 ? Math.round(mins) + " minutes" : (mins / 60).toFixed(1) + " hours"} to arrive.`);
    setTimeout(() => { if (phase === "warp") startFly(); }, 2600);
  }
  async function ending() {
    phase = "card"; $("vyScan").hidden = true; sound.setEngine(0.2, false);
    await card("VOYAGE COMPLETE", `${data} DATA`, "Every world you locked is real. Planet X is still out there.", 5200);
    $("vyHud").hidden = true; $("vyComm").hidden = true; $("vyStartBox").hidden = false; $("vyStart").textContent = "Fly again";
    phase = "idle"; sound.setEngine(0, false); n = 0;
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
  holder.addEventListener("pointerdown", () => (firing = true)); addEventListener("pointerup", () => (firing = false));
  $("vyStart").onclick = () => { sound.start(); n = 0; hull = 100; data = 0; $("vyStartBox").hidden = true; startFly(); };

  // ---------- draw ----------
  function resize() { const w = holder.clientWidth, h = holder.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(holder);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (root.offsetParent === null) { last = now; sound.setEngine(0, false); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (phase === "fly") fly(dt); else if (phase === "arrive") arrive(dt); else if (phase === "scan") scan(dt);
    const moving = phase === "fly", flow = phase === "warp" ? 950 : moving ? speed * (boost ? BOOST : 1) : phase === "arrive" ? 40 : 14, len = Math.max(0.4, flow * 0.05);
    for (let i = 0; i < NS; i++) { const s = stars[i]; s.z += flow * dt; if (s.z > 20) { s.z = -470; s.x = rand(-110, 110); s.y = rand(-70, 70); } sp.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6); }
    starGeo.attributes.position.needsUpdate = true;
    // engine trail, then move every particle
    if (phase !== "idle") for (const s of [-1, 1]) spark(ship.position.x + s * 0.95, ship.position.y, 3.2, boost && moving ? 0xfff0c0 : 0x6fd8ff, [0, 0, 26 + flow * 0.25], 0.32, 1.4);
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      if (p.life > 0) { p.life -= dt; pPos[i * 3] += p.v.x * dt; pPos[i * 3 + 1] += p.v.y * dt; pPos[i * 3 + 2] += p.v.z * dt; const f = Math.max(0, p.life / p.max); pCol.set([p.c.r * f, p.c.g * f, p.c.b * f], i * 3); }
      else pCol.set([0, 0, 0], i * 3);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    const targetFov = phase === "warp" ? 106 : boost && moving ? 82 : 70;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
    shake = Math.max(0, shake - dt * 1.7);
    camera.position.set(ship.position.x * 0.5 + rand(-1, 1) * shake, 2.6 + ship.position.y * 0.5 + rand(-1, 1) * shake, 10.5);
    camera.lookAt(ship.position.x * 0.62, ship.position.y * 0.62, -30);
    const flick = 2.0 + Math.random() * 0.7 + (boost && moving ? 1.6 : 0) + (phase === "warp" ? 3 : 0);
    flames.forEach((f) => f.scale.setScalar(flick));
    ship.children.forEach((c) => { if (c.userData.nav) c.material.opacity = (now % 1000) < 500 ? 1 : 0.15; });
    shield.material.opacity = shieldT > 0 ? 0.22 + 0.1 * Math.sin(now / 90) : 0; shield.rotation.y += dt * 2;
    if (world) world.userData.body.rotation.y += dt * 0.12;
    if (!moving && phase !== "arrive") { ship.rotation.z *= 0.92; ship.rotation.x *= 0.92; ship.position.y += (Math.sin(now / 700) * 0.4 - 1.5 - ship.position.y) * dt * 1.5; ship.position.x += ((phase === "scan" || phase === "result" ? -7 : 0) - ship.position.x) * dt * 1.2; }
    renderer.render(scene, camera);
  }
  resize(); requestAnimationFrame(frame);

  // used by the browser check
  window.__voyage = { state: () => ({ phase, n, hull, data, lock, kills, frames: phase === "scan" || phase === "result" ? L().frames : null, size: L().size, i: view.i }), arrive: () => { travelled = goal; }, safe: () => { hull = 1e6; } };
}
