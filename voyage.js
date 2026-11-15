// Voyage to Planet X: a cinematic adventure. Each chapter is one real world:
//   FLY     steer through the debris field, shoot rocks, grab power-ups
//   ARRIVE  fly past the world itself
//   SCAN    hold the reticle on the object that jumps between two real SPHEREx images until the lock completes
//   WARP    jump onward through the Solar System
// The ship, debris, lasers, radio chatter, sounds and the look of each world are game fiction.
// The scanner pictures, positions, distances and sunlight levels are real.
import * as THREE from "./vendor/three.module.min.js";
import { $, Viewer, span } from "./viewer.js?v=62";
import { makeStackGame } from "./stackgame.js?v=62";
import { EffectComposer } from "./vendor/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/postprocessing/OutputPass.js";

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
// the last chapter: fiction. No such object is known; the scanner there uses a simulated planet on real images
const FINALE = { id: "planetx", name: "Unknown signal", kind: "unidentified source", distance_au: 300, finale: true };
// what the scanner asks for in each chapter, so no two neighbours play the same
const SCAN_TYPES = ["lock", "ghost", "probe"];
const dist2 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
// a third real image for the probe shot: the next one in which the object has clearly moved on
function targetOf(L) {
  const track = L.track || [], [a, b] = L.frames, ib = track.findIndex((f) => f.source === b.source), ia = track.findIndex((f) => f.source === a.source);
  if (ib < 0 || ia < 0) return null;
  const later = track.slice(ib + 1).find((f) => dist2(f, b) >= 12); if (later) return { frame: later, forward: true };
  const earlier = track.slice(0, ia).reverse().find((f) => dist2(f, a) >= 12); return earlier ? { frame: earlier, forward: false } : null;
}
const when = (iso) => new Date(iso + "Z").toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }) + " UTC";
const LOOK = {   // surface maps: see the About page for which are real spacecraft maps and which are artists' impressions
  vesta: { tex: "rock", tint: 0xd8d2c8, kind: "rock", lumpy: 0.16 }, ceres: { tex: "ceres", kind: "rock", lumpy: 0.02 }, pallas: { tex: "rock", tint: 0xb9bcc6, kind: "rock", lumpy: 0.13 },
  juno: { tex: "rock", tint: 0xd9c7ae, kind: "rock", lumpy: 0.18 }, hygiea: { tex: "rock", tint: 0x8f8a86, kind: "rock", lumpy: 0.05 },
  uranus: { tex: "uranus", kind: "gas", glow: 0x9fe3e6, ring: 0x9fd8e0, tilt: 1.45 }, neptune: { tex: "neptune", kind: "gas", glow: 0x4a7fff },
  earth: { tex: "earth", kind: "gas", glow: 0x6fb4ff }, planetx: { tex: "neptune", tint: 0x3a4466, kind: "gas", glow: 0x2a3a6a },
  pluto: { tex: "pluto", kind: "ice" }, makemake: { tex: "makemake", kind: "ice" }, haumea: { tex: "haumea", kind: "ice", stretch: [1.7, 0.85, 1], ring: 0xcfc6c0, tilt: 0.3 },
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

// ---------- asteroids: irregular bodies with dents and a rough, cratered surface ----------
function rockTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#8a8a8a"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.globalAlpha = rand(0.05, 0.22); g.fillStyle = Math.random() < 0.55 ? "#000" : "#fff"; g.beginPath(); g.arc(rand(0, 256), rand(0, 256), rand(0.6, 5), 0, 7); g.fill(); }
  for (let i = 0; i < 26; i++) {
    const x = rand(0, 256), y = rand(0, 256), r = rand(5, 22);
    g.globalAlpha = 0.45; g.fillStyle = "#000"; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.globalAlpha = 0.4; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x - 1.5, y - 1.5, r, 3.5, 5.9); g.stroke();
  }
  g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function rockShape() {
  const geo = new THREE.IcosahedronGeometry(1, 3), p = geo.attributes.position, v = new THREE.Vector3(), s = rand(0, 20);
  const dents = Array.from({ length: 5 }, () => ({ d: new THREE.Vector3().randomDirection(), r: rand(0.35, 0.7), depth: rand(0.12, 0.3) }));
  const sq = [rand(0.7, 1.15), rand(0.7, 1.15), rand(0.8, 1.2)];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1 + 0.2 * Math.sin(v.x * 2.1 + s) * Math.cos(v.y * 2.7 - s) + 0.11 * Math.sin(v.z * 5.3 + s * 2) * Math.sin(v.x * 4.7) + 0.05 * Math.sin(v.y * 11 + s) * Math.cos(v.z * 9.5);
    for (const d of dents) { const a = v.distanceTo(d.d); if (a < d.r) k -= d.depth * (1 - (a / d.r) ** 2); }      // impact craters
    p.setXYZ(i, v.x * k * sq[0], v.y * k * sq[1], v.z * k * sq[2]);
  }
  geo.computeVertexNormals(); return geo;
}

// ---------- the worlds ----------
const texLoader = new THREE.TextureLoader(), texCache = {};
function mapOf(name) {
  if (!texCache[name]) { const t = texLoader.load(`tex/${name}.jpg`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache[name] = t; }
  return texCache[name];
}
function makeWorld(id) {
  const look = LOOK[id] || LOOK.vesta, grp = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 128, 96);
  if (look.lumpy) {                                   // small bodies are not round
    const p = geo.attributes.position, v = new THREE.Vector3(), s = rand(0, 10);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + look.lumpy * (Math.sin(v.x * 2.3 + s) * Math.cos(v.y * 2.9 - s) + 0.6 * Math.sin(v.z * 4.1 + s * 2)) + look.lumpy * 0.25 * Math.sin(v.x * 9 + s) * Math.sin(v.y * 8 - s) * Math.sin(v.z * 7); p.setXYZ(i, v.x * k, v.y * k, v.z * k); }
    geo.computeVertexNormals();
  }
  const tex = mapOf(look.tex), solid = look.kind !== "gas";
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, color: look.tint ?? 0xffffff, bumpMap: solid ? tex : null, bumpScale: solid ? 6 : 0, roughness: solid ? 1 : 0.75, metalness: 0, fog: false }));
  if (look.stretch) body.scale.set(...look.stretch);
  grp.add(body); grp.userData.body = body;
  if (look.glow) {                                    // thin atmosphere seen at the edge
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 48), new THREE.MeshBasicMaterial({ color: look.glow, transparent: true, opacity: 0.13, side: THREE.BackSide, fog: false, blending: THREE.AdditiveBlending, depthWrite: false })); grp.add(halo);
  }
  if (look.ring) { const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.1, 96), new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false })); ring.rotation.x = look.tilt; grp.add(ring); }
  return grp;
}

const PHONE = matchMedia("(max-width: 760px), (pointer: coarse)").matches;

export function initVoyage(levels) {
  const root = $("voyage"), holder = $("vyCanvas");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { $("vyStartMsg").textContent = "This browser cannot show 3D, so the voyage is unavailable. Use Hunt instead."; $("vyStart").disabled = true; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, PHONE ? 1.5 : 2)); holder.append(renderer.domElement);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;      // film-style response: bright things roll off instead of clipping
  const sound = new Sound();
  const chapters = [...levels].sort((a, b) => a.distance_au - b.distance_au);   // travel outward from the Sun

  // ---------- scene ----------
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x04060f, 200, 470); scene.background = new THREE.Color(0x04060f);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000); camera.position.set(0, 2.4, 9.5);
  const ambient = new THREE.AmbientLight(0x8a9bd0, 1.0); scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.4); sunLight.position.set(-5, 7, 14); scene.add(sunLight);   // the Sun is behind us
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "#fff"); gr.addColorStop(0.3, "#ffffffaa"); gr.addColorStop(1, "transparent"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = (color, size, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false })); s.scale.setScalar(size); return s; };

  // glow around anything bright (engines, lasers, explosions, sunlit edges). Falls back to plain rendering if it cannot start.
  let composer = null;
  try {
    if (PHONE) throw new Error("no glow on phones: too slow");
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.7, 0.78));
    composer.addPass(new OutputPass());
  } catch { composer = null; }
  // a hard key light from the Sun and a faint cool fill, as in real space photographs: bright lit sides, dark shadows
  const rim = new THREE.DirectionalLight(0x7aa8ff, 0.5); rim.position.set(8, -3, -10); scene.add(rim);

  // ---------- the ship: a weathered disc freighter (our own design) ----------
  const hullTex = (() => {      // plating: panel lines, mismatched panels, scorch marks
    const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
    g.fillStyle = "#b4b7bb"; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) { const v = Math.floor(rand(120, 215)); g.globalAlpha = rand(0.25, 0.8); g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(rand(0, 512), rand(0, 512), rand(8, 70), rand(6, 40)); }
    for (let i = 0; i < 14; i++) { g.globalAlpha = 0.7; g.fillStyle = pick(["#7a3a2c", "#5d6672", "#8a4a32"]); g.fillRect(rand(0, 512), rand(0, 512), rand(14, 46), rand(8, 22)); }
    g.globalAlpha = 0.55; g.strokeStyle = "#3a3d42"; g.lineWidth = 1.2;
    for (let i = 0; i < 90; i++) { g.strokeRect(rand(0, 512), rand(0, 512), rand(14, 90), rand(10, 60)); }
    for (let i = 0; i < 600; i++) { g.globalAlpha = rand(0.04, 0.16); g.fillStyle = "#000"; g.beginPath(); g.arc(rand(0, 512), rand(0, 512), rand(1, 9), 0, 7); g.fill(); }
    g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ship = new THREE.Group();
  const plate = new THREE.MeshStandardMaterial({ map: hullTex, bumpMap: hullTex, bumpScale: 1.6, metalness: 0.55, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3d4148, metalness: 0.7, roughness: 0.5 });
  const engineGlow = new THREE.MeshBasicMaterial({ color: 0x6fb6f5, fog: false });      // kept below white so the glow does not hide the hull
  const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); ship.add(m); return m; };
  // main disc (plating mapped flat from above, so panels are not smeared towards the centre)
  const disc = part(new THREE.LatheGeometry([[0, 0.44], [1.2, 0.42], [2.25, 0.24], [2.75, 0.07], [2.75, -0.07], [2.25, -0.22], [1.2, -0.36], [0, -0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 64), plate, 0, 0, 0);
  { const p = disc.geometry.attributes.position, uv = disc.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.06 + 0.5, p.getZ(i) * 0.18 + 0.5); }
  part(new THREE.CylinderGeometry(0.95, 1.05, 0.2, 32), plate, 0, 0.5, 0);                              // raised centre
  part(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 20), dark, 0, 0.64, 0);                              // top turret ring
  for (const s2 of [-1, 1]) {
    part(new THREE.BoxGeometry(0.82, 0.34, 2.7), plate, s2 * 0.66, 0, -3.25);                            // forward prongs
    part(new THREE.BoxGeometry(0.5, 0.2, 0.9), dark, s2 * 0.66, 0.02, -4.75);                            // prong tips
    const nav = glow(s2 < 0 ? 0xff3344 : 0x33ff88, 0.5); nav.position.set(s2 * 2.75, 0.02, 0); nav.userData.nav = true; ship.add(nav);
  }
  part(new THREE.BoxGeometry(0.5, 0.26, 2.2), dark, 0, 0, -3.1);                                         // docking gap between the prongs
  // offset cockpit on an arm
  part(new THREE.BoxGeometry(1.3, 0.3, 0.7), plate, 2.2, 0.06, -1.5).rotation.y = -0.5;
  const pod = part(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 16), plate, 2.65, 0.1, -2.3); pod.rotation.x = Math.PI / 2;
  const glass = part(new THREE.ConeGeometry(0.34, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x2a6a9a, emissiveIntensity: 0.6, metalness: 1, roughness: 0.08 }), 2.65, 0.1, -3.4); glass.rotation.x = -Math.PI / 2;
  // sensor dish and vents
  part(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), dark, -1.25, 0.6, -0.9);
  const dish = part(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, 1.0), plate, -1.25, 0.72, -0.9); dish.rotation.x = Math.PI * 0.85; dish.scale.y = 0.45;
  for (let i = 0; i < 6; i++) { const a2 = 0.62 * Math.PI + (i / 5) * 0.76 * Math.PI; part(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), dark, Math.cos(a2) * 1.75, 0.34, Math.sin(a2) * 1.75 * -1 * -1); }
  // engine: one wide glowing band across the back
  const band = part(new THREE.TorusGeometry(2.62, 0.13, 10, 48, Math.PI * 0.8), engineGlow, 0, 0, 0); band.rotation.set(Math.PI / 2, 0, Math.PI * 0.1);
  const flames = [-1.5, -0.5, 0.5, 1.5].map((x) => { const f = glow(0x6fb8ff, 0.8, 0.4); f.position.set(x, 0, 2.5 + (Math.abs(x) < 1 ? 0.3 : 0)); ship.add(f); return f; });
  // shield: a soft bubble, brighter at its edge
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.6, 48, 32), new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })); shield.scale.set(1, 0.42, 1.15); ship.add(shield);
  ship.scale.setScalar(1.25);
  scene.add(ship);

  // ---------- star streaks ----------
  const NS = 1100, sp = new Float32Array(NS * 6), stars = [];
  for (let i = 0; i < NS; i++) stars.push({ x: rand(-110, 110), y: rand(-70, 70), z: rand(-470, 20) });
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const starLines = new THREE.LineSegments(starGeo, new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.4, fog: false })); starLines.frustumCulled = false; scene.add(starLines);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 48, 32), new THREE.MeshBasicMaterial({ map: mapOf("sky"), side: THREE.BackSide, fog: false, depthWrite: false, color: 0xffffff }));
  sky.rotation.set(0.5, 1.2, 0.3); scene.add(sky);     // a real all-sky photograph of the Milky Way
  const nebulae = [[-460, 190, 980], [520, -140, 840], [140, 330, 700]].map(([x, y, s]) => { const nb = glow(0xffffff, s, 0.045); nb.position.set(x, y, -1250); scene.add(nb); return nb; });

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
  const rockGeos = Array.from({ length: 7 }, rockShape), rockTex = rockTexture(), shardGeo = new THREE.OctahedronGeometry(1, 0), rocks = [];
  for (let i = 0; i < 150; i++) { const m = new THREE.Mesh(rockGeos[i % 7], new THREE.MeshStandardMaterial({ map: rockTex, bumpMap: rockTex, bumpScale: 2.2, roughness: 0.96, metalness: 0.04 })); m.visible = false; scene.add(m); rocks.push({ m, r: 1, hp: 1, live: false, solid: true, spin: new THREE.Vector3(), drift: new THREE.Vector2() }); }
  const fragGeo = new THREE.OctahedronGeometry(0.6, 0), frags = [];
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(fragGeo, new THREE.MeshStandardMaterial({ color: 0x7dffcf, emissive: 0x2fe0a0, emissiveIntensity: 1.6, flatShading: true })); m.visible = false; scene.add(m); frags.push({ m, live: false }); }
  const POWERS = { shield: 0x5ad0ff, magnet: 0x7dffcf, rapid: 0xffb547 }, powers = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 8, 24), new THREE.MeshStandardMaterial({ emissiveIntensity: 2 })); m.visible = false; scene.add(m); powers.push({ m, live: false, kind: "shield" }); }
  const boltGeo = new THREE.CylinderGeometry(0.2, 0.2, 7, 6).rotateX(Math.PI / 2), boltMat = new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false, toneMapped: false }), bolts = [];      // thick and bright enough to see on a phone
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(boltGeo, boltMat); m.add(glow(0xff7a2a, 2.2, 0.8)); m.visible = false; scene.add(m); bolts.push({ m, live: false, pz: 0 }); }

  // missiles: slow, homing, and they clear everything near where they go off
  const missileGeo = new THREE.ConeGeometry(0.28, 1.8, 8).rotateX(-Math.PI / 2), missileMat = new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xff7a1a, emissiveIntensity: 1.2 }), missiles = [];
  for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(missileGeo, missileMat); const g = glow(0xffa040, 2.6); g.position.z = 1.2; m.add(g); m.visible = false; scene.add(m); missiles.push({ m, live: false, target: null }); }
  const MISSILE_SPEED = 250, BLAST = 17;
  let fired = 0, missileAt = 0;
  function launchMissile() {
    if (phase !== "fly" || missileAt > 0) return;      // unlimited; only a short reload between launches
    const ms = missiles.find((x) => !x.live); if (!ms) return;
    fired++; missileAt = 0.3; ms.live = true; ms.m.visible = true; ms.m.position.set(ship.position.x, ship.position.y - 0.5, -2);
    // aim at the biggest threat ahead: the solid rock closest to the ship's line of flight
    let best = null, bestD = 1e9;
    for (const r of rocks) if (r.live && r.solid && r.m.position.z < -30 && r.m.position.z > -330) { const d = Math.hypot(r.m.position.x - ship.position.x, r.m.position.y - ship.position.y) - r.r * 2; if (d < bestD) { bestD = d; best = r; } }
    ms.target = best; sound.tone(220, 0.5, "sawtooth", 0.22, 900); bars();
  }
  function detonate(ms) {
    const p = ms.m.position; ms.live = false; ms.m.visible = false; let n = 0;
    for (const r of rocks) if (r.live && r.solid && Math.hypot(r.m.position.x - p.x, r.m.position.y - p.y, (r.m.position.z - p.z) * 0.5) < BLAST) { r.live = false; r.m.visible = false; explode(r.m.position, r.r); n++; }
    for (let i = 0; i < 70; i++) spark(p.x, p.y, p.z, i % 2 ? 0xffb060 : 0xffffff, [0, 0, 30], rand(0.5, 1.2), 46);
    kills += n; combo += n; comboT = 2.2; data += 10 * n; shake = Math.max(shake, 0.55); sound.boom(true); setTimeout(() => sound.boom(true), 90);
  }
  function moveMissiles(dt, v) {
    missileAt = Math.max(0, missileAt - dt);
    for (const ms of missiles) if (ms.live) {
      const p = ms.m.position, t = ms.target?.live ? ms.target.m.position : null;
      if (t) { p.x += THREE.MathUtils.clamp(t.x - p.x, -1, 1) * 34 * dt; p.y += THREE.MathUtils.clamp(t.y - p.y, -1, 1) * 34 * dt; }
      p.z -= MISSILE_SPEED * dt;
      spark(p.x, p.y, p.z + 1.5, 0xffa040, [0, 0, 20 + v * 0.3], 0.45, 2);
      if ((t && p.z <= t.z + 4) || p.z < -300 || (!t && p.z < -150)) detonate(ms);
    }
  }

  // ---------- state ----------
  let n = 0, phase = "idle", hull = 100, data = 0, travelled = 0, goal = 1, speed = BASE_SPEED, boost = false, shake = 0, tPhase = 0;
  let spawnR = 0, spawnS = 0, spawnF = 0, spawnP = 6, fireAt = 0, firing = false, combo = 0, comboT = 0, kills = 0, hullAtStart = 100;
  let shieldT = 0, magnetT = 0, rapidT = 0, lock = 0, scanLeft = 0, assisted = false, tickAt = 0, world = null, zone = ZONES.belt;
  const aim = new THREE.Vector2(), keys = new Set(), mouse = { x: 0, y: 0, used: false };
  const hud = (id, v) => ($(id).textContent = v);
  const L = () => (n >= chapters.length ? FINALE : chapters[n]);
  const TOTAL = chapters.length + 1, grades = [];
  let scanType = "lock", target = null, ghost = null, stack = null, stackLeft = 0, probeLeft = 0, probeBonus = 0;

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
    hud("vyChapter", `${n + 1} / ${TOTAL}  ${L().name.toUpperCase()}`);
    hud("vyMissiles", missileAt > 0 ? "RELOADING" : "∞ READY"); hud("vyCombo", combo > 1 ? `x${combo}` : ""); hud("vyBuff", [shieldT > 0 && "SHIELD", magnetT > 0 && "MAGNET", rapidT > 0 && "RAPID FIRE"].filter(Boolean).join("  "));
  }
  const clearField = (boom) => { for (const r of rocks) if (r.live) { if (boom && r.solid && r.m.position.z > -260) explode(r.m.position, r.r, 0x9fb4ff); r.live = false; r.m.visible = false; } [...frags, ...powers, ...bolts].forEach((o) => { o.live = false; o.m.visible = false; }); };

  // ---------- FLY ----------
  async function startFly() {
    phase = "card"; travelled = 0; goal = 2100 + n * 170; speed = BASE_SPEED + n * 5; spawnR = spawnS = spawnF = 0; spawnP = rand(5, 9); combo = 0; kills = 0; hullAtStart = hull;
    clearField(false); missiles.forEach((ms) => { ms.live = false; ms.m.visible = false; });
    zone = ZONES[zoneOf(L())];
    scene.fog.color.set(zone.fog); scene.background.set(0x000000); sky.rotation.y = 1.2 + n * 0.55; nebulae.forEach((nb, i) => nb.material.color.set(zone.glow[i]));
    // sunlight really does fall off with distance squared; the scene dims with it (softened so the game stays playable)
    const sun = 1 / L().distance_au ** 2; sunLight.intensity = 0.5 + 2.2 * Math.pow(sun / (1 / 2.15 ** 2), 0.22); ambient.intensity = 0.22 + 0.3 * Math.pow(sun * 4.6, 0.2);
    hud("vySun", sun >= 0.01 ? `${(sun * 100).toFixed(1)}%` : `${(sun * 100).toFixed(3)}%`);
    if (world) scene.remove(world);
    world = makeWorld(L().id); world.position.set(14, 9, -760); world.scale.setScalar(8); scene.add(world);
    for (let i = 0; i < 22; i++) spawnRock(true); for (let i = 0; i < 40; i++) spawnRock(false);
    rocks.filter((r) => r.live).forEach((r) => (r.m.position.z = rand(-460, -130)));
    $("vyScan").hidden = true; $("vyHud").hidden = false; bars(); sound.setEngine(1, false);
    await card(L().finale ? "FINAL CHAPTER  ·  BEYOND THE KUIPER BELT" : `CHAPTER ${n + 1}  ·  ${zone.name}`, L().finale ? "THE DARK" : L().name.toUpperCase(), L().finale ? "300 au from the Sun  ·  no known world" : `${L().kind}  ·  ${L().distance_au} au from the Sun`);
    say("CONTROL", L().finale ? "Commander, there is something else out here. Fainter than anything we have locked. Nothing is charted at this distance. Get us there in one piece." : n === 0 ? (tilt ? "Commander, SPHEREx picked up something moving out here. Punch through the debris and get us a scanner lock. Tilt your phone to steer. The lasers fire by themselves. Use the buttons for missiles and boost."
        : PHONE ? "Commander, SPHEREx picked up something moving out here. Punch through the debris and get us a scanner lock. Drag your finger to steer. The lasers fire by themselves. Use the buttons for missiles and boost."
        : "Commander, SPHEREx picked up something moving out here. Punch through the debris and get us a scanner lock. Steer with the mouse. The lasers fire by themselves. Right click for a missile, Space to boost.")
      : pick([`Next signal: ${L().name}, ${L().distance_au} au out. The field is thicker here. Watch your hull.`, `${L().name} ahead. Sunlight is down to ${$("vySun").textContent} of what Earth gets. Stay sharp.`, `Signal bearing confirmed: ${L().name}. Clear a path, Commander.`]));
    phase = "fly";
  }
  function spawnRock(solid) {
    const r = rocks.find((x) => !x.live); if (!r) return;
    const icy = Math.random() < zone.ice;
    r.live = true; r.solid = solid; r.r = solid ? rand(0.9, 3.4) : rand(2, 9); r.hp = Math.ceil(r.r * 0.9);
    r.m.geometry = icy ? shardGeo : pick(rockGeos); r.m.material.flatShading = icy; r.m.material.map = icy ? null : rockTex; r.m.material.bumpMap = icy ? null : rockTex; r.m.material.needsUpdate = true;
    r.m.material.color.setHSL(zone.rock[0] + rand(-0.03, 0.03), icy ? 0.5 : zone.rock[1], zone.rock[2] + rand(-0.1, 0.1));
    r.m.material.emissive.setHex(icy ? 0x1a4a6a : 0x000000); r.m.material.transparent = icy; r.m.material.opacity = icy ? 0.85 : 1;
    r.m.scale.set(r.r * (icy ? 0.6 : 1), r.r * (icy ? 1.5 : rand(0.75, 1.1)), r.r * (icy ? 0.6 : 1));
    if (solid) r.m.position.set(rand(-14, 14), rand(-8.5, 8.5), -470);
    else { const side = Math.random() < 0.5 ? -1 : 1; r.m.position.set(side * rand(22, 80), rand(-45, 45), -470); }   // scenery: passes wide of the ship
    r.m.visible = true; r.spin.set(rand(-1.4, 1.4), rand(-1.4, 1.4), rand(-1, 1)); r.drift.set(solid ? rand(-2.6, 2.6) : 0, solid ? rand(-1.8, 1.8) : 0);
  }
  function spawn(pool, set) { const o = pool.find((x) => !x.live); if (!o) return; o.live = true; o.m.position.set(rand(-11, 11), rand(-6, 6), -470); o.m.visible = true; set?.(o); }
  function fireBolts() {
    for (const s of [-1, 1]) { const b = bolts.find((x) => !x.live); if (!b) return; b.live = true; b.m.position.set(ship.position.x + s * 0.8, ship.position.y, -6); b.pz = -6; b.m.visible = true; }
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
    if (tilt) aim.set(tilt.x, tilt.y);
    else if (kx || ky) { mouse.used = false; aim.x = THREE.MathUtils.clamp(aim.x + kx * dt * 2, -1, 1); aim.y = THREE.MathUtils.clamp(aim.y + ky * dt * 2, -1, 1); } else if (mouse.used) aim.set(mouse.x, mouse.y);
    const tx = aim.x * 13 * Math.min(1, camera.aspect * 1.15), ty = aim.y * 7.5, px = ship.position.x;      // a tall phone screen sees a narrower strip
    ship.position.x += (tx - ship.position.x) * Math.min(1, dt * 6); ship.position.y += (ty - ship.position.y) * Math.min(1, dt * 6);
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, THREE.MathUtils.clamp(-(ship.position.x - px) / Math.max(dt, 0.001) * 0.04, -1.1, 1.1), 0.18);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, (ty - ship.position.y) * 0.06, 0.2);
    travelled += v * dt;
    // weapons
    // the lasers fire by themselves for the whole flight, on every device
    fireAt -= dt; if (fireAt <= 0) { fireBolts(); fireAt = rapidT > 0 ? FIRE_EVERY * 0.45 : FIRE_EVERY; }
    for (const b of bolts) if (b.live) { b.pz = b.m.position.z; b.m.position.z -= BOLT_SPEED * dt; if (b.m.position.z < -430) { b.live = false; b.m.visible = false; } }
    moveMissiles(dt, v);
    // spawning: the field thickens every chapter
    spawnR -= dt; if (spawnR <= 0) { spawnRock(true); spawnR = Math.max(0.085, 0.21 - n * 0.012) * (boost ? 0.75 : 1); }
    spawnS -= dt; if (spawnS <= 0) { spawnRock(false); spawnS = 0.09; }
    spawnF -= dt; if (spawnF <= 0) { spawn(frags); spawnF = rand(0.8, 1.7); }
    spawnP -= dt; if (spawnP <= 0) { spawn(powers, (o) => { o.kind = pick(Object.keys(POWERS)); o.m.material.color.setHex(POWERS[o.kind]); o.m.material.emissive.setHex(POWERS[o.kind]); }); spawnP = rand(9, 14); }
    for (const r of rocks) if (r.live) {
      r.m.position.z += v * dt; r.m.position.x += r.drift.x * dt; r.m.position.y += r.drift.y * dt; r.m.rotation.x += r.spin.x * dt; r.m.rotation.y += r.spin.y * dt;
      if (r.solid) {
        for (const b of bolts) if (b.live && r.m.position.z > b.m.position.z - r.r - 3 && r.m.position.z < b.pz + r.r + 3 && Math.hypot(b.m.position.x - r.m.position.x, b.m.position.y - r.m.position.y) < r.r + 0.6) {      // the bolt's whole path this frame is checked, so a fast bolt cannot jump through a rock
          b.live = false; b.m.visible = false; r.hp--; spark(b.m.position.x, b.m.position.y, b.m.position.z, 0xffd08a, [0, 0, 40], 0.25, 10);
          if (r.hp <= 0) { r.live = false; r.m.visible = false; explode(r.m.position, r.r); sound.boom(r.r > 2.2); kills++; combo++; comboT = 2.2; data += 5 * Math.min(combo, 10); shake = Math.max(shake, r.r * 0.05); break; }
        }
        if (r.live && Math.abs(r.m.position.z) < 1.8 && Math.hypot(r.m.position.x - ship.position.x, r.m.position.y - ship.position.y) < r.r + 1.9) {
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
    say("CONTROL", L().finale ? "We are on top of the signal, but there is nothing to see. Scanner, deep mode." : `There it is. ${L().name}. Bringing the scanner online.`);
  }
  function arrive(dt) {
    tPhase += dt; const k = Math.min(1, tPhase / 3.2), e = k * k * (3 - 2 * k);
    world.scale.setScalar(68); world.position.set(10 - e * 82, 6 - e * 2, -460 + e * 245);   // sweep past: the world settles as a globe off the port side
    ship.position.x += (6 - ship.position.x) * dt * 1.5; ship.position.y += (-2 - ship.position.y) * dt * 1.5;
    if (k >= 1) { root.classList.remove("cine"); if (L().finale) startStack(); else startScan(); }
  }

  // ---------- SCAN ----------
  const view = new Viewer($("vyView")), reticle = $("vyReticle");
  let cursor = null;
  $("vyView").addEventListener("pointermove", (e) => { const r = $("vyView").getBoundingClientRect(); cursor = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; reticle.style.left = cursor.x * 100 + "%"; reticle.style.top = cursor.y * 100 + "%"; });
  async function startScan() {
    phase = "card"; sound.setEngine(0.25, false); lock = 0; scanLeft = SCAN_SECONDS; assisted = false; cursor = null; probeBonus = 0;
    target = targetOf(L()); scanType = SCAN_TYPES[n % 3]; if (scanType === "probe" && !target) scanType = "lock";
    $("vyView").hidden = false; $("vyStackBox").hidden = true; reticle.hidden = false;
    $("vyLock").style.width = "0%"; reticle.classList.remove("on");
    await view.load([...L().frames, ...(target ? [target.frame] : [])], L().size); view.pair = [0, 1]; view.blinkMs = Math.max(430, 700 - n * 30); view.mark("");   // the flip gets faster each chapter
    $("vyScan").hidden = false; $("vyScan").classList.remove("done"); $("vyResult").hidden = true; $("vyLockRow").hidden = false;
    hud("vyMode", { lock: "TRACKING LOCK", probe: "TRACKING LOCK + PROBE", ghost: "SUBTRACTION SCAN" }[scanType]);
    if (scanType === "ghost") {
      // subtraction scan: one image minus the other. Stars cancel; the mover is left behind twice. Click both ghosts.
      view.setMode("diff"); ghost = { a: false, b: false }; hud("vyLockLabel", "GHOSTS");
      say("ASTRA", "Subtraction scan. I took one real image away from the other. The stars cancel out. The mover is left behind twice: click both of its ghosts. Wrong clicks cost time.");
      phase = "ghost";
    } else {
      view.setMode("blink"); hud("vyLockLabel", "LOCK");
      say("ASTRA", n === 0 ? "Scanner online. These are two real SPHEREx images, flipping. The stars hold still. Keep the reticle on the one thing that jumps until I have a lock."
        : "Scanner online. Find the jumper and stay on it. Ignore the cosmic-ray flashes.");
      phase = "scan";
    }
  }
  function scan(dt) {
    scanLeft -= dt;
    const f = L().frames[view.i === 1 ? 1 : 0], on = cursor && Math.hypot(cursor.x * L().size - f.x, cursor.y * L().size - f.y) < LOCK_RADIUS;
    lock = THREE.MathUtils.clamp(lock + (on ? dt / LOCK_SECONDS : -dt * 0.65), 0, 1);
    reticle.classList.toggle("on", !!on); $("vyLock").style.width = lock * 100 + "%"; hud("vyTime", Math.max(0, Math.ceil(scanLeft)));
    if (on && performance.now() > tickAt) { tickAt = performance.now() + 140; sound.lockTick(lock); }
    if (Math.random() < dt * (1.4 + n * 0.25)) interference();
    if (lock >= 1) return scanType === "probe" ? startProbe() : locked();
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
  // ghost scan: click both leftovers of the mover in the subtracted image
  function ghostClick(p) {
    const [a, b] = L().frames, hitA = !ghost.a && dist2(p, a) < 26, hitB = !ghost.b && dist2(p, b) < 26;
    if (hitA) ghost.a = true; else if (hitB) ghost.b = true;
    else { scanLeft -= 3; sound.fail(); root.classList.add("hurt"); setTimeout(() => root.classList.remove("hurt"), 160); return; }
    sound.lockTick(ghost.a && ghost.b ? 1 : 0.5); lock = (ghost.a + ghost.b) / 2; $("vyLock").style.width = lock * 100 + "%";
    view.mark((ghost.a ? `<circle class="ring" cx="${a.x}" cy="${a.y}" r="18"/>` : "") + (ghost.b ? `<circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/>` : ""));
    if (ghost.a && ghost.b) locked();
  }
  function ghostTick(dt) {
    scanLeft -= dt; hud("vyTime", Math.max(0, Math.ceil(scanLeft)));
    if (scanLeft <= 0) {
      sound.fail(); hull = Math.max(10, hull - 12); scanLeft = SCAN_SECONDS; assisted = true; bars();
      const [a, b] = L().frames;
      view.mark(`<circle cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="${dist2(a, b) / 2 + 55}" fill="none" stroke="#ffb547" stroke-width="2" stroke-dasharray="8 8"/>`);
      say("ASTRA", "Out of time, and the scanner overheated. Both ghosts are inside the amber circle.");
    }
  }
  // probe shot: say where the object will be in a third real image
  function startProbe() {
    phase = "probe"; probeLeft = 14; const [a, b] = L().frames, f = target.frame;
    view.stop(); view.show(1); sound.locked();
    view.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="ring was" cx="${a.x}" cy="${a.y}" r="18"/><circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/>`);
    hud("vyLockLabel", "PROBE"); $("vyLock").style.width = "100%";
    say("ASTRA", `Lock held. Now launch a probe. It was at the dashed ring on ${when(a.date)} and the solid ring on ${when(b.date)}. Click where it ${target.forward ? "will be" : "was"} on ${when(f.date)}.`);
  }
  function probeClick(p) {
    const f = target.frame, err = dist2(p, f) * L().arcsec_per_px;
    probeBonus = Math.round(Math.max(0, 160 - err * 1.6)); sound.laser(); setTimeout(() => (probeBonus > 80 ? sound.locked() : sound.boom(false)), 350);
    view.show(2); locked();
    view.svg.insertAdjacentHTML("beforeend", `<line class="path" x1="${p.x}" y1="${L().size}" x2="${p.x}" y2="${p.y}"/><circle class="dot now" cx="${p.x}" cy="${p.y}" r="6"/><circle class="ring pulse" cx="${f.x}" cy="${f.y}" r="18"/><circle class="ring" cx="${f.x}" cy="${f.y}" r="18"/>`);
    hud("vyRFact", `Probe: ${Math.round(err)} arcseconds from where it really was in the third real image (${when(f.date)}). +${probeBonus} data. ` + $("vyRFact").textContent);
  }
  function probeTick(dt) { probeLeft -= dt; hud("vyTime", Math.max(0, Math.ceil(probeLeft))); if (probeLeft <= 0) { say("ASTRA", "Launch window closed. No probe this time."); locked(); } }
  $("vyView").addEventListener("click", (e) => {
    if (phase !== "ghost" && phase !== "probe") return;
    const r = $("vyView").getBoundingClientRect(), p = { x: ((e.clientX - r.left) / r.width) * L().size, y: ((e.clientY - r.top) / r.height) * L().size };
    if (phase === "ghost") ghostClick(p); else probeClick(p);
  });

  // ---------- FINALE: shift-and-stack for a planet too faint to see ----------
  const base = levels.find((l) => l.id === "pluto" && l.track?.length >= 6) || [...levels].sort((a, b) => (b.track?.length || 0) - (a.track?.length || 0))[0];
  async function startStack() {
    phase = "card"; sound.setEngine(0.2, false);
    $("vyScan").hidden = false; $("vyScan").classList.remove("done"); $("vyResult").hidden = true; $("vyLockRow").hidden = true;
    $("vyView").hidden = true; $("vyStackBox").hidden = false; reticle.hidden = true; hud("vyMode", "DEEP SCAN  ·  SHIFT AND STACK  ·  SIMULATED TARGET");
    stack = await makeStackGame(base, $("vyStack"));
    for (const id of ["vyVx", "vyVy"]) { $(id).min = -stack.max; $(id).max = stack.max; $(id).step = 0.05; $(id).value = 0; }
    stackLeft = 110; stack.snr = stack.render(0, 0); stack.found = false; $("vyStackMark").innerHTML = "";
    hud("vyStackInfo", `${stack.count} real SPHEREx images of one patch of sky, taken over ${Math.round(stack.days)} days, with a simulated planet hidden in each.`);
    say("ASTRA", "Too faint for any single image. So we stack them. I have already subtracted everything that stays still: the stars are gone, leaving noise. Now guess how the planet drifts, and I slide every image back along your guess. Get it right and the planet lands on the same spot each time and adds up. Move the two drift controls. Watch the signal.");
    phase = "stack";
  }
  function stackMove() {
    if (phase !== "stack") return;
    stack.snr = stack.render(+$("vyVx").value, +$("vyVy").value);
    $("vySignal").style.width = Math.max(0, Math.min(100, (stack.snr / 5) * 100)) + "%";
    const ready = stack.snr >= 3.6;
    if (ready && !stack.found) { stack.found = true; sound.locked(); say("ASTRA", "There! Something is adding up. Click it before the signal fades."); }
    if (!ready) stack.found = false;
    hud("vyStackHint", ready ? "A dot has risen out of the noise. Click it." : stack.snr > 2.7 ? "Getting warmer. The stars are smearing and something is building." : "Nothing yet. Try a different drift.");
  }
  $("vyVx").oninput = stackMove; $("vyVy").oninput = stackMove;
  $("vyStack").addEventListener("click", (e) => {
    if (phase !== "stack") return;
    const r = $("vyStack").getBoundingClientRect(), p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (stack.found && Math.hypot(p.x - stack.spot.x, p.y - stack.spot.y) < 0.07) return planetFound();
    stackLeft -= 6; sound.fail();
  });
  function stackTick(dt) {
    stackLeft -= dt; hud("vyStackTime", Math.max(0, Math.ceil(stackLeft)));
    // once the drift is right, give the player a few seconds, then narrow down where to look
    stack.readyFor = stack.found ? (stack.readyFor || 0) + dt : 0;
    if (stack.readyFor > 7 && !$("vyStackMark").innerHTML) {
      const cx = stack.spot.x * 100 + (Math.random() - 0.5) * 12, cy = stack.spot.y * 100 + (Math.random() - 0.5) * 12;
      $("vyStackMark").innerHTML = `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="#ffb547" stroke-width=".6" stroke-dasharray="2 2"/>`;
      say("ASTRA", "It is somewhere inside the amber circle. The brightest speck.");
    }
    if (!stack.found && $("vyStackMark").innerHTML) $("vyStackMark").innerHTML = "";
    if (stackLeft <= 0) {      // help: set one of the two controls correctly
      stackLeft = 90; assisted = true; $("vyVx").value = stack.truth.vx; stackMove(); sound.fail();
      say("ASTRA", "Signal fading. I have fixed the east-west drift for you. Find the north-south drift.");
    }
  }
  async function planetFound() {
    phase = "card"; data += assisted ? 300 : 800; grades.push(assisted ? "A" : "S"); sound.locked(); bars();
    $("vyStackMark").innerHTML = `<circle class="ring" cx="${stack.spot.x * 100}" cy="${stack.spot.y * 100}" r="5" style="stroke-width:1"/><circle class="ring pulse" cx="${stack.spot.x * 100}" cy="${stack.spot.y * 100}" r="5" style="stroke-width:1"/>`;
    say("CONTROL", "Lock confirmed. A planet nobody could see in a single picture. Commander, that is how the real search for Planet X is done.");
    await new Promise((ok) => setTimeout(ok, 4200));
    await card("SIMULATED DISCOVERY", "PLANET X", "In this game. The real one, if it exists, is still out there.", 4600);
    ending();
  }

  function locked() {
    phase = "result"; const W = L(), [a, b] = W.frames, used = SCAN_SECONDS - scanLeft;
    const pts = Math.round(Math.max(0, 100 - Math.max(0, hullAtStart - hull) * 1.1 - Math.max(0, used - 7) * 2.2 - (assisted ? 30 : 0))), grade = pts >= 85 ? "S" : pts >= 65 ? "A" : pts >= 40 ? "B" : "C";
    const bonus = { S: 300, A: 200, B: 120, C: 60 }[grade] + probeBonus; data += bonus; grades[n] = grade; sound.locked(); bars();
    view.mark(`<line class="path" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="ring was" cx="${a.x}" cy="${a.y}" r="18"/><circle class="ring" cx="${b.x}" cy="${b.y}" r="18"/><circle class="ring pulse" cx="${b.x}" cy="${b.y}" r="18"/>`);
    $("vyLockRow").hidden = true; $("vyResult").hidden = false; $("vyScan").classList.add("done");
    hud("vyGrade", grade); $("vyGrade").className = "vy-grade g" + grade;
    hud("vyRName", W.name); hud("vyRKind", `${W.kind} · ${W.distance_au} au from the Sun`); hud("vyRBlurb", W.blurb);
    hud("vyRFact", `It moved ${W.moved_arcsec} arcseconds in ${span(W.days_between)} between these two real images. Rocks destroyed: ${kills}. Bonus: +${bonus} data.`);
    $("vyNext").textContent = n + 1 < chapters.length ? "Warp to the next signal  (Space)" : "Follow the last signal  (Space)";
    say("CONTROL", `Lock confirmed: ${W.name}. Position matches NASA JPL. ${grade === "S" ? "Flawless flying, Commander." : grade === "A" ? "Good work, Commander." : "We got it. Keep that hull together next time."}`);
  }

  // ---------- WARP ----------
  function startWarp() {
    if (phase !== "result") return;
    const from = L(); n++;
    phase = "warp"; $("vyScan").hidden = true; sound.warp(); sound.setEngine(1, true);
    const au = Math.abs(L().distance_au - from.distance_au), mins = L().distance_au * 8.317;
    say("ASTRA", L().finale ? `Long jump: ${Math.round(au)} au, past everything we know. Out there sunlight takes ${(mins / 60).toFixed(0)} hours to arrive.` : `Jumping ${au.toFixed(1)} au outward. At ${L().distance_au} au, sunlight takes ${mins < 90 ? Math.round(mins) + " minutes" : (mins / 60).toFixed(1) + " hours"} to arrive.`);
    setTimeout(() => { if (phase === "warp") startFly(); }, 2600);
  }
  function ending() {
    phase = "idle"; $("vyScan").hidden = true; $("vyHud").hidden = true; $("vyComm").hidden = true; sound.setEngine(0, false);
    const score = { S: 4, A: 3, B: 2, C: 1 }, avg = grades.reduce((t, g) => t + score[g], 0) / Math.max(1, grades.length);
    hud("vyEndRank", avg >= 3.6 ? "ACE DISCOVERER" : avg >= 2.8 ? "DEEP-SPACE PILOT" : avg >= 2 ? "SURVEY PILOT" : "CADET");
    hud("vyEndData", data);
    $("vyEndGrades").innerHTML = [...chapters, FINALE].map((c, i) => `<li><span>${c.finale ? "Planet X (simulated)" : c.name}</span><b class="vy-grade g${grades[i] || "C"}">${grades[i] || "-"}</b></li>`).join("");
    $("vyEnd").hidden = false; n = 0;
  }
  // opening: Earth orbit, the mission, then the first jump
  async function opening() {
    phase = "card"; n = 0; hull = 100; data = 0; grades.length = 0;
    zone = ZONES.giants; scene.fog.color.set(0x030a14); scene.background.set(0x000000); nebulae.forEach((nb, i) => nb.material.color.set(ZONES.giants.glow[i]));
    if (world) scene.remove(world);
    world = makeWorld("earth"); world.position.set(-62, -6, -150); world.scale.setScalar(58); scene.add(world);
    $("vyHud").hidden = true; sound.setEngine(0.4, false);
    await card("EARTH ORBIT  ·  2026", "PLANET HUNTER", "A voyage to the edge of the Solar System", 3400);
    say("CONTROL", "Commander. NASA's SPHEREx telescope has mapped the whole sky, again and again. In its pictures, ten points of light refuse to stay still. Go and find out what they are.");
    await new Promise((ok) => setTimeout(ok, 6200));
    say("ASTRA", "And there is an eleventh signal, far past the rest. Too faint to be sure. Course laid in. Jumping to the asteroid belt.");
    await new Promise((ok) => setTimeout(ok, 4600));
    phase = "warp"; sound.warp(); sound.setEngine(1, true);
    setTimeout(() => { if (phase === "warp") startFly(); }, 2400);
  }
  $("vyNext").onclick = startWarp;

  // ---------- input ----------
  addEventListener("keydown", (e) => {
    if (root.hidden) return;
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (e.key === " ") { e.preventDefault(); if (phase === "result") startWarp(); }
    if (e.key.toLowerCase() === "x" && !e.repeat) launchMissile();
  });
  addEventListener("keyup", (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  holder.addEventListener("pointermove", (e) => { const r = holder.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1); mouse.used = true; });
  // phones: tilt to steer. Left/right tilt moves the ship sideways; tipping the top of the phone away or towards you moves it up or down.
  let tilt = null, tiltZero = null;
  function onTilt(e) {
    if (e.gamma == null || e.beta == null) return;
    const ang = screen.orientation?.angle ?? window.orientation ?? 0;      // the sensor axes swap when the phone is held sideways
    const lr = ang === 90 ? e.beta : ang === 270 || ang === -90 ? -e.beta : e.gamma, fb = ang === 90 ? -e.gamma : ang === 270 || ang === -90 ? e.gamma : e.beta;
    if (!tiltZero) tiltZero = { fb };                                     // however the phone is held at the start counts as level
    tilt = { x: THREE.MathUtils.clamp(lr / 24, -1, 1), y: THREE.MathUtils.clamp(-(fb - tiltZero.fb) / 20, -1, 1) };
  }
  async function enableTilt() {      // must be called from a tap: iPhones ask the player for permission
    if (!PHONE || !window.DeviceOrientationEvent || enableTilt.on) return;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function" && (await DeviceOrientationEvent.requestPermission()) !== "granted") return;
      addEventListener("deviceorientation", onTilt); enableTilt.on = true;
    } catch { /* no sensor or permission refused: finger steering still works */ }
  }
  $("vyTouchCentre").addEventListener("pointerdown", (e) => { e.preventDefault(); tiltZero = null; });
  // mouse: left button fires, right button launches. Touch: a finger on the screen steers and fires; on-screen buttons launch and boost.
  let steerId = null;
  const steerTo = (e) => { const r = holder.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1); mouse.used = true; };
  holder.addEventListener("pointerdown", (e) => { if (e.button === 2) return launchMissile(); if (e.button === 0) { firing = true; steerId = e.pointerId; steerTo(e); } });
  addEventListener("pointerup", (e) => { if (e.pointerId === steerId) { firing = false; steerId = null; } });
  addEventListener("pointercancel", (e) => { if (e.pointerId === steerId) { firing = false; steerId = null; } });
  $("vyTouchMissile").addEventListener("pointerdown", (e) => { e.preventDefault(); launchMissile(); });
  const hold = (on) => (e) => { e.preventDefault(); if (on) keys.add(" "); else keys.delete(" "); };
  $("vyTouchBoost").addEventListener("pointerdown", hold(true)); for (const ev of ["pointerup", "pointercancel", "pointerleave"]) $("vyTouchBoost").addEventListener(ev, hold(false));
  // touch has no hover: a finger on the scanner moves the reticle
  $("vyView").addEventListener("pointerdown", (e) => $("vyView").dispatchEvent(new PointerEvent("pointermove", e)));
  root.addEventListener("contextmenu", (e) => e.preventDefault());      // right click launches a missile instead of opening the browser menu
  $("vyStart").onclick = () => { sound.start(); enableTilt(); $("vyStartBox").hidden = true; opening(); };
  $("vyAgain").onclick = () => { enableTilt(); $("vyEnd").hidden = true; opening(); };

  // ---------- draw ----------
  function resize() { const w = holder.clientWidth, h = holder.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(holder);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (root.offsetParent === null) { last = now; sound.setEngine(0, false); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (phase === "fly") fly(dt); else if (phase === "arrive") arrive(dt); else if (phase === "scan") scan(dt);
    else if (phase === "ghost") ghostTick(dt); else if (phase === "probe") probeTick(dt); else if (phase === "stack") stackTick(dt);
    const moving = phase === "fly", flow = phase === "warp" ? 950 : moving ? speed * (boost ? BOOST : 1) : phase === "arrive" ? 40 : 14, len = Math.max(0.15, flow * (phase === "warp" ? 0.07 : 0.02));      // dust streaks; long only in a jump
    for (let i = 0; i < NS; i++) { const s = stars[i]; s.z += flow * dt; if (s.z > 20) { s.z = -470; s.x = rand(-110, 110); s.y = rand(-70, 70); } sp.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6); }
    starGeo.attributes.position.needsUpdate = true;
    // engine trail, then move every particle
    if (phase !== "idle") for (const s of [-1.4, -0.45, 0.45, 1.4]) spark(ship.position.x + s, ship.position.y, 2.9, boost && moving ? 0x9fd0ff : 0x2f6fb0, [0, 0, 40 + flow * 0.4], boost && moving ? 0.22 : 0.12, 0.6);
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      if (p.life > 0) { p.life -= dt; pPos[i * 3] += p.v.x * dt; pPos[i * 3 + 1] += p.v.y * dt; pPos[i * 3 + 2] += p.v.z * dt; const f = Math.max(0, p.life / p.max); pCol.set([p.c.r * f, p.c.g * f, p.c.b * f], i * 3); }
      else pCol.set([0, 0, 0], i * 3);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    const targetFov = phase === "warp" ? 106 : boost && moving ? 82 : 70;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
    shake = Math.max(0, shake - dt * 1.7);
    const tall = camera.aspect < 1;      // on a tall phone screen, pull back so the ship does not fill the view
    camera.position.set(ship.position.x * 0.5 + rand(-1, 1) * shake, (tall ? 4.2 : 2.6) + ship.position.y * 0.5 + rand(-1, 1) * shake, tall ? 19 : 10.5);
    camera.lookAt(ship.position.x * 0.62, ship.position.y * 0.62, -30); sky.position.copy(camera.position);
    const flick = 0.8 + Math.random() * 0.2 + (boost && moving ? 0.7 : 0) + (phase === "warp" ? 1.4 : 0);
    flames.forEach((f) => f.scale.setScalar(flick));
    ship.children.forEach((c) => { if (c.userData.nav) c.material.opacity = (now % 1000) < 500 ? 1 : 0.15; });
    shield.material.opacity = shieldT > 0 ? 0.16 + 0.05 * Math.sin(now / 120) : 0;
    if (world) world.userData.body.rotation.y += dt * 0.12;
    if (!moving && phase !== "arrive") { ship.rotation.z *= 0.92; ship.rotation.x *= 0.92; ship.position.y += (Math.sin(now / 700) * 0.4 - 1.5 - ship.position.y) * dt * 1.5; ship.position.x += ((["scan", "result", "ghost", "probe", "stack"].includes(phase) ? -7 : 0) - ship.position.x) * dt * 1.2; }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  resize(); requestAnimationFrame(frame);

  // used by the browser check
  window.__voyage = { state: () => ({ phase, n, hull, data, lock, kills, fired, tilt: !!tilt, shipX: ship.position.x, shipY: ship.position.y, scanType, frames: ["scan", "result", "ghost", "probe"].includes(phase) ? L().frames : null, target: target?.frame, size: L().size, i: view.i, truth: stack?.truth, spot: stack?.spot, snr: stack?.snr }),
    arrive: () => { travelled = goal; }, safe: () => { hull = 1e6; }, skipTo: (k) => { n = k; hull = 1e6; $("vyStartBox").hidden = true; $("vyEnd").hidden = true; startFly(); } };
}
