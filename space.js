// 3D Solar System: real positions from NASA JPL Horizons (orbits.json). Each world SPHEREx photographed is a place to fly to.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { $, Viewer, fmtDate } from "./viewer.js?v=67";
import { t, tr } from "./i18n.js?v=67";
import { irTexture } from "./irtex.js?v=67";
import { composite } from "./colour.js?v=67";
import { EffectComposer } from "./vendor/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/postprocessing/OutputPass.js";

const v3 = ([x, y, z]) => new THREE.Vector3(x, z, -y);   // ecliptic x,y,z (au) → scene, with y up
const COLORS = ["#8ab4ff", "#ffb547", "#6fe3ff", "#f7e26b", "#ff9a5c", "#c79bff", "#b6ff8a", "#ff6f91", "#7dffcf", "#ffd1dc"];
const TRAIL = 30, TRAIL_STEP = 1.2;   // trail: 30 points, 1.2 timeline steps (6 days) apart
const DAY = 864e5, HOME = { cam: [0.9, 3.5, 5.6], look: [0, -0.35, 0] }, WIDE = { cam: [0, 30, 82], look: [0, 0, 0] };
// surface map for each world's globe (see the About page for which are real maps)
const SKIN = { uranus: { tex: "uranus", f: 1.25, ring: true, air: 0x9fe3e6 }, neptune: { tex: "neptune", f: 1.25, air: 0x4a7fff }, pluto: { tex: "pluto", solid: true }, ceres: { tex: "ceres", solid: true }, haumea: { tex: "haumea", stretch: [1.6, 0.85, 1], solid: true }, makemake: { tex: "makemake", solid: true },
  vesta: { tex: "rock", tint: 0xd8d2c8, solid: true, stretch: [1.12, 0.9, 1] }, pallas: { tex: "rock", tint: 0xb9bcc6, solid: true, stretch: [1.08, 0.94, 0.98] }, juno: { tex: "rock", tint: 0xd9c7ae, solid: true, stretch: [1.18, 0.88, 0.95] }, hygiea: { tex: "rock", tint: 0x8f8a86, solid: true } };
const PSTEP = { Mercury: 1, Venus: 2, Mars: 6, Jupiter: 36, Saturn: 90 };   // days between points on each planet's stored orbit, which starts on 1 Jan 2025

function dotTexture(color) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "#fff"); grad.addColorStop(0.25, color); grad.addColorStop(1, "transparent");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dot = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), sizeAttenuation: false, depthTest: false })); s.scale.setScalar(size); return s; };
const line = (pts, color, opacity = 1) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));

const PHONE = matchMedia("(max-width: 760px), (pointer: coarse)").matches;      // lighter graphics and touch layout

export async function initSpace(levels, actions) {
  const stage = $("space"), holder = stage.querySelector(".space-canvas"), labelLayer = stage.querySelector(".labels");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true }); } catch { stage.classList.add("no3d"); return false; }
  const data = await (await fetch("orbits.json")).json();
  const startMs = Date.parse(data.start + "T00:00:00Z"), N = data.earth.track.length;
  renderer.setPixelRatio(Math.min(devicePixelRatio, PHONE ? 1.5 : 2));
  holder.append(renderer.domElement);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.01, 4e6);
  camera.position.set(...HOME.cam);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 0.4; controls.maxDistance = 420000;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.22;          // the view drifts slowly when left alone
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  let composer = null;      // glow around bright things; plain rendering if it cannot start
  try {
    if (PHONE) throw new Error("no glow on phones: too slow");
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.8, 0.82));
    composer.addPass(new OutputPass());
  } catch { composer = null; }
  const loader = new THREE.TextureLoader();
  const map = (name, ext = "jpg") => { const t = loader.load(`tex/${name}.${ext}`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  // a real all-sky photograph of the Milky Way, all around
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 32), new THREE.MeshBasicMaterial({ map: map("sky"), side: THREE.BackSide, depthWrite: false, toneMapped: false, transparent: true }));
  sky.renderOrder = -10;      // always drawn first, so see-through things such as rings are never painted over by it
  sky.rotation.set(1.05, 0.4, 0); scene.add(sky);
  // sunlight from the centre: every globe gets a day side and a night side
  scene.add(new THREE.AmbientLight(0x8a9ac0, 0.1), new THREE.PointLight(0xfff2dc, 3.4, 0, 0));
  const globes = [], pickables = [];
  function globe(tex, f = 1, o = {}) {      // a textured sphere, drawn far larger than life (size follows the camera so it can always be seen)
    const geo = new THREE.SphereGeometry(1, 64, 48); if (o.stretch) geo.scale(...o.stretch);
    const tx = map(tex), m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tx, color: o.tint ?? 0xffffff, bumpMap: o.solid ? tx : null, bumpScale: o.solid ? 4 : 0, roughness: 1, metalness: 0 }));
    m.rotation.z = o.tilt || 0; scene.add(m); pickables.push(m);
    if (o.air) m.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 48, 32), new THREE.MeshBasicMaterial({ color: o.air, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));
    const g = { m, f, near: 0.04 }; globes.push(g); return g;
  }
  function ringOn(g, inner, outer, tex, tilt) {      // a ring whose texture runs outward from the planet
    const geo = new THREE.RingGeometry(inner, outer, 128, 1), p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - inner) / (outer - inner), 0.5);
    const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x9fd8e0, transparent: true, opacity: tex ? 0.95 : 0.25, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = tilt; g.m.add(r); return r;
  }

  // backdrop (decoration only, not real star positions): three layers of stars that drift at different speeds, and soft nebula glow
  const skies = [].map(([count, color, size, opacity, spin]) => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) new THREE.Vector3().randomDirection().multiplyScalar(20000).toArray(pos, i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false }));
    pts.userData.spin = spin; scene.add(pts); return pts;
  });
  for (const [color, x, y, z, s] of [["#5b2a9a", -9000, 3000, -12000, 17000], ["#12508a", 11000, -2000, -9000, 15000], ["#0f6a70", 2000, 6000, 13000, 14000], ["#8a2a5a", -12000, -4000, 8000, 13000]]) {
    const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending }));
    n.position.set(x, y, z); n.scale.setScalar(s); scene.add(n);
  }

  // labels: HTML elements pinned to 3D points
  const labels = [];
  function label(text, getPos, cls = "", onClick) {
    const el = document.createElement(onClick ? "button" : "span");
    el.className = "slabel " + cls; el.textContent = text; if (onClick) el.onclick = onClick;
    labelLayer.append(el); labels.push({ el, getPos }); return el;
  }

  // ---------- what each clickable thing is ----------
  const INFO = {
    sun: { name: "The Sun", kind: "our star", text: "Everything in the Solar System orbits it. Every world on this page shines only because it reflects the Sun's light, which is why distant ones are so faint.",
      facts: [["Diameter", "1.39 million km, 109 Earths side by side"], ["Surface temperature", "about 5,500 °C"], ["Share of the Solar System's mass", "99.8%"], ["Its light reaches Earth in", "8.3 minutes"]] },
    mercury: { name: "Mercury", kind: "rocky planet", text: "The smallest planet and the closest to the Sun.", facts: [["Diameter", "4,879 km"], ["Distance from the Sun", "0.39 au"], ["One year", "88 days"], ["Moons", "none"]] },
    venus: { name: "Venus", kind: "rocky planet", text: "Almost Earth's size, wrapped in thick cloud. The hottest planet.", facts: [["Diameter", "12,104 km"], ["Distance from the Sun", "0.72 au"], ["One year", "225 days"], ["Surface temperature", "about 465 °C"]] },
    earth: { name: "Earth", kind: "our home planet", text: "SPHEREx orbits Earth, passing over the poles about 650 km up. From there it scans a circle of sky at right angles to the Sun, shown here as a sheet of light.",
      facts: [["Diameter", "12,742 km"], ["Distance from the Sun", "1 au, by definition about 150 million km"], ["One year", "365.25 days"], ["Moons", "1"]] },
    mars: { name: "Mars", kind: "rocky planet", text: "The red planet. Beyond it lies the asteroid belt.", facts: [["Diameter", "6,779 km"], ["Distance from the Sun", "1.52 au"], ["One year", "687 days"], ["Moons", "2"]] },
    jupiter: { name: "Jupiter", kind: "gas giant planet", text: "The largest planet. Its gravity shapes the asteroid belt inside its orbit.", facts: [["Diameter", "139,820 km, 11 Earths across"], ["Distance from the Sun", "5.2 au"], ["One year", "11.9 Earth years"], ["Known moons", "more than 90"]] },
    saturn: { name: "Saturn", kind: "gas giant planet", text: "The ringed planet. Click its rings to learn about them.", facts: [["Diameter", "116,460 km"], ["Distance from the Sun", "9.5 au"], ["One year", "29.4 Earth years"], ["Known moons", "more than 270"]] },
    rings: { name: "Saturn's rings", kind: "rings of ice", text: "Countless pieces of water ice, from grains to boulders, each orbiting Saturn. They are enormously wide but astonishingly thin.",
      facts: [["Width", "about 280,000 km"], ["Typical thickness", "about 10 metres"], ["Made of", "mostly water ice"]] },
    belt: { name: "The asteroid belt", kind: "a ring of rocky bodies", text: "Vesta, Ceres, Pallas, Juno and Hygiea all live here. Asteroids are close to us, so they cross the sky quickly: that is why they are the easy targets in the hunt.",
      facts: [["Where", "between Mars and Jupiter, about 2.1 to 3.3 au"], ["How many", "more than a million larger than 1 km"], ["Total mass", "about 3% of our Moon's"]], note: "The specks drawn here are decoration, not real asteroids." },
    spherex: { name: "SPHEREx", kind: "NASA space telescope", text: "It maps the entire sky again and again in infrared light. Compare two of its maps and anything in our Solar System has moved. That is the idea behind this whole site.",
      facts: [["Launched", "March 2025"], ["Colours of infrared light", "102"], ["Whole sky mapped", "about every six months"], ["Orbit", "around Earth, over the poles"]], note: "The sheet of light is drawn far larger than life." },
    planetx: { name: "Planet X", kind: "a planet nobody has seen", text: "Some distant icy worlds have oddly lined-up orbits. In 2016 astronomers proposed that an unseen planet, several times Earth's mass, could be shepherding them. No telescope has found it. So far out it would be extremely faint and would barely move.",
      facts: [["Status", "hypothetical"], ["Suggested distance", "several hundred au"], ["Why it is hard", "sunlight there is tens of thousands of times weaker than at Earth"]], note: "The pink ring marks a rough range of distances, not a known orbit.", view: { cam: [0, 900, 1700], look: [0, 0, 0] } },
    milkyway: { name: "The Milky Way", kind: "our galaxy", text: "A vast spinning disc of stars, gas and dust with a central bar and spiral arms. Every star you can see at night belongs to it. SPHEREx also maps water ice and other frozen molecules in the Milky Way's star-forming clouds.",
      facts: [["Type", "barred spiral galaxy"], ["Width", "about 100,000 light-years"], ["Stars", "100 to 400 billion"], ["Age", "about 13.6 billion years"]], note: "This is a model. Nobody can photograph our galaxy from outside, and the Solar System is drawn enormously too large within it." },
    centre: { name: "The galactic centre", kind: "the heart of the Milky Way", text: "A crowded bulge of old stars. At its very middle sits Sagittarius A*, a black hole.", facts: [["Black hole mass", "about 4 million Suns"], ["Distance from us", "about 26,000 light-years"]], note: "This is a model, not a photograph." },
    here: { name: "Our Solar System", kind: "you are here", text: "The Sun is one ordinary star, roughly halfway out from the centre, in a small arm called the Orion Arm. Everything on this site happens inside this single dot.",
      facts: [["Distance from the centre", "about 26,000 light-years"], ["Speed around the galaxy", "about 220 km every second"], ["One trip around", "about 230 million years"]], note: "Click 'Dive to the Solar System' to fly in." },
    arms: { name: "Spiral arms", kind: "where new stars form", text: "The arms are the bright lanes of young blue stars and glowing gas. Astronomers map them from the inside, by measuring distances to stars and gas clouds.",
      facts: [["Major arms", "Perseus and Scutum-Centaurus"], ["Our neighbourhood", "the Orion Arm, between the Sagittarius and Perseus arms"]], note: "The arm shapes in this model are illustrative, not a measured map." },
  };
  let focusG = null, focusSun = false;
  function showInfo(key, g) {
    const d = INFO[key]; if (!d) return;
    actions.chime?.();
    clear(); $("infoPanel").hidden = false; stage.classList.add("picked");
    $("infoName").textContent = tr(d.name); $("infoKind").textContent = tr(d.kind); $("infoText").textContent = tr(d.text);
    $("infoFacts").innerHTML = d.facts.map(([k, v]) => `<dt>${tr(k)}</dt><dd>${tr(v)}</dd>`).join("");
    $("infoNote").textContent = d.note ? tr(d.note) : ""; $("infoDive").hidden = key !== "here";
    if (g) { focusG = g; setPlaying(false); closeUp(g.m.position); }
    else if (key === "sun") { focusSun = true; flyTo([1.5, 0.8, 2.1], [0, 0, 0], 2600); }
    else if (d.view) flyTo(d.view.cam, d.view.look, 3000);
    else if (key === "belt") flyTo([0.6, 2.6, 5.4], [0, -0.3, 0], 2400);
  }
  function closeUp(p, ms = 2600) {      // fly in near a globe, from the sunward side and a little off-axis, so it shows mostly its lit face
    const out = p.clone().normalize(), side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
    flyTo(p.clone().addScaledVector(out, -2.3).addScaledVector(side, 1.7).add(new THREE.Vector3(0, 0.9, 0)).toArray(), p.toArray(), ms);
  }

  // ---------- the Milky Way: a model built from particles (nobody can photograph it from outside) ----------
  const GR = 60000, galaxy = new THREE.Group(), GN = PHONE ? 20000 : 52000, gPos = new Float32Array(GN * 3), gCol = new Float32Array(GN * 3);
  const armAngle = (k, r) => k * Math.PI / 2 + Math.log(r / (0.1 * GR)) / Math.tan(0.23);      // four logarithmic spiral arms
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < GN; i++) {
    let x, y, z, c;
    if (i < GN * 0.2) {              // central bulge and bar: old, yellow stars
      const r = Math.abs(gauss()) * 0.13 * GR, a = Math.random() * 6.2832, bar = i % 3 === 0 ? 2.1 : 1;
      x = r * Math.cos(a) * bar; z = r * Math.sin(a) * 0.75; y = gauss() * 0.045 * GR * Math.exp(-r / (0.12 * GR)); c = [1, 0.82, 0.55];
    } else {                         // disc and arms: young, blue-white stars, a few pink gas clouds
      const r = (0.1 + 0.9 * Math.pow(Math.random(), 0.75)) * GR, k = i % 4, inArm = Math.random() < 0.78;
      const a = inArm ? armAngle(k, r) + gauss() * 0.3 * (0.35 + r / GR * 0.5) : Math.random() * 6.2832;
      x = r * Math.cos(a) + gauss() * 0.012 * GR; z = r * Math.sin(a) + gauss() * 0.012 * GR; y = gauss() * 0.012 * GR;
      const t2 = Math.random(); c = !inArm ? [0.75, 0.7, 0.62] : t2 < 0.06 ? [1, 0.45, 0.6] : t2 < 0.5 ? [0.62, 0.78, 1] : [0.92, 0.95, 1];
    }
    const lum = 0.35 + Math.random() ** 2 * 0.65;
    gPos.set([x, y, z], i * 3); gCol.set([c[0] * lum, c[1] * lum, c[2] * lum], i * 3);
  }
  const gGeo = new THREE.BufferGeometry(); gGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3)); gGeo.setAttribute("color", new THREE.BufferAttribute(gCol, 3));
  const gMat = new THREE.PointsMaterial({ map: dotTexture("#ffffff"), vertexColors: true, size: GR * 0.011, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const gPts = new THREE.Points(gGeo, gMat); gPts.renderOrder = -5; gPts.frustumCulled = false; galaxy.add(gPts);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture("#ffd9a0"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); core.scale.setScalar(GR * 0.55); core.renderOrder = -6; galaxy.add(core);
  // put the Sun's place in the model (about halfway out, between two arms) at the centre of the scene, with the disc tilted 60° to the planets' orbits, as it really is
  const sunR = 0.5 * GR, sunA = armAngle(0, sunR) + Math.PI / 4, sunLocal = new THREE.Vector3(sunR * Math.cos(sunA), 0, sunR * Math.sin(sunA));
  galaxy.rotation.set(1.05, 0, 0.35); galaxy.updateMatrixWorld(true); galaxy.position.sub(sunLocal.clone().applyMatrix4(galaxy.matrixWorld)); galaxy.updateMatrixWorld(true); galaxy.frustumCulled = false; scene.add(galaxy);
  const gW = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(galaxy.matrixWorld), GC = gW(0, 0), gUp = new THREE.Vector3(0, 1, 0).transformDirection(galaxy.matrixWorld);
  const GAL = { cam: GC.clone().addScaledVector(gUp, GR * 1.45).add(new THREE.Vector3(0, 0, GR * 1.2)).toArray(), look: GC.toArray() };
  const armAt = (k, f) => { const r = f * GR, a = armAngle(k, r); return gW(r * Math.cos(a), r * Math.sin(a)); };
  const origin0 = new THREE.Vector3(), armP = [armAt(1, 0.62), armAt(3, 0.7)], topP = GC.clone().addScaledVector(gUp, GR * 0.2).add(new THREE.Vector3(0, GR * 0.55, 0));
  label(tr("The Milky Way"), () => topP, "gal big", () => showInfo("milkyway"));
  label(tr("Galactic centre"), () => GC, "gal", () => showInfo("centre"));
  label(tr("Our Solar System: you are here"), () => origin0, "gal here", () => showInfo("here"));
  label(tr("Spiral arm"), () => armP[0], "gal", () => showInfo("arms")); label(tr("Spiral arm"), () => armP[1], "gal", () => showInfo("arms"));
  const hereDot = dot("#7dffcf", 0.014); scene.add(hereDot);

  // Sun, planets, Earth
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ map: map("sun"), toneMapped: false, color: new THREE.Color(1.45, 1.2, 0.95) })); scene.add(sun);
  const rays = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => {
    const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d"); g.translate(256, 256);
    for (let i = 0; i < 90; i++) { const a = Math.random() * 6.2832, len = 90 + Math.random() * 160, w = 0.012 + Math.random() * 0.03; const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len); gr.addColorStop(0, "rgba(255,225,170,0.5)"); gr.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - w) * len, Math.sin(a - w) * len); g.lineTo(Math.cos(a + w) * len, Math.sin(a + w) * len); g.fill(); }
    return new THREE.CanvasTexture(c); })(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); scene.add(rays); label(tr("Sun"), () => sun.position, "dim", () => showInfo("sun")); sun.userData.pick = { key: "sun" }; pickables.push(sun);
  const corona = [0.13, 0.26].map((size, k) => {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(k ? "#ff8a3c" : "#ffc65c"), sizeAttenuation: false, depthTest: false, transparent: true, opacity: k ? 0.16 : 0.3, blending: THREE.AdditiveBlending }));
    c.userData.size = size; scene.add(c); return c;
  });
  for (const p of data.planets) scene.add(line(p.path.map(v3), 0x3a4670, 0.55));
  // the planets as globes, at their real positions for the date shown
  const planetAt = (p, ms) => { const x = (ms - Date.UTC(2025, 0, 1)) / DAY / PSTEP[p.name], n = p.path.length - 1, i = ((Math.floor(x) % n) + n) % n; return v3(p.path[i]).lerp(v3(p.path[i + 1]), x - Math.floor(x)); };
  const planetGlobes = [["Mercury", "mercury", 0.7, { solid: true }], ["Venus", "venus", 0.95, { air: 0xffe2b0 }], ["Mars", "mars", 0.8, { solid: true, air: 0xffb090 }], ["Jupiter", "jupiter", 1.7, {}], ["Saturn", "saturn", 1.5, { tilt: 0.47 }]].map(([name, tex, f, o]) => {
    const p = data.planets.find((q) => q.name === name), key = name.toLowerCase(), g = globe(tex, f, { tilt: 0.05, ...o });
    g.m.userData.pick = { key, g };
    if (name === "Saturn") ringOn(g, 1.25, 2.3, map("saturn_ring", "png"), Math.PI / 2).userData.pick = { key: "rings", g };
    label(tr(name), () => g.m.position, name === "Jupiter" || name === "Saturn" ? "dim" : "dim inner", () => showInfo(key, g));
    return { p, g };
  });
  scene.add(line(data.earth.path.map(v3), 0x4d7cff));
  const earth = dot("#4d9bff", 0.022); earth.visible = false; scene.add(earth); label(tr("Earth"), () => earth.position, "earth", () => showInfo("earth", earthGlobe));
  const earthGlobe = globe("earth", 1, { tilt: 0.41, air: 0x5aa8ff }); earthGlobe.m.userData.pick = { key: "earth", g: earthGlobe };
  // the asteroid belt, where Vesta, Ceres, Pallas, Juno and Hygiea live (decoration: thousands of specks, not real asteroids)
  const BELT = PHONE ? 2500 : 7000, beltPos = new Float32Array(BELT * 3), beltCol = new Float32Array(BELT * 3);
  for (let i = 0; i < BELT; i++) {
    const r = 2.1 + Math.random() ** 0.8 * 1.25, a = Math.random() * 6.2832, lum = 0.25 + Math.random() ** 3 * 0.75;
    beltPos.set([r * Math.cos(a), (Math.random() + Math.random() - 1) * 0.11 * r, r * Math.sin(a)], i * 3);
    beltCol.set([lum, lum * 0.92, lum * 0.8], i * 3);
  }
  const beltGeo = new THREE.BufferGeometry(); beltGeo.setAttribute("position", new THREE.BufferAttribute(beltPos, 3)); beltGeo.setAttribute("color", new THREE.BufferAttribute(beltCol, 3));
  const belt = new THREE.Points(beltGeo, new THREE.PointsMaterial({ map: dotTexture("#e8d8bc"), vertexColors: true, size: 0.045, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(belt);

  // the worlds SPHEREx photographed
  const worlds = levels.map((L, k) => {
    const o = data.objects[L.id], color = COLORS[k % COLORS.length], marker = dot(color, 0.026);
    scene.add(line(o.path.map(v3), color, 0.3), marker);
    // glowing trail behind the world: bright at the head, fading to nothing
    const tg = new THREE.BufferGeometry(), tcol = new Float32Array(TRAIL * 3), c3 = new THREE.Color(color);
    for (let i = 0; i < TRAIL; i++) { const f = (i / (TRAIL - 1)) ** 2; tcol.set([c3.r * f, c3.g * f, c3.b * f], i * 3); }
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)); tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.frustumCulled = false; scene.add(trail);
    const frames = L.track?.length > 1 ? L.track : L.frames;
    marker.visible = false;
    const skin = SKIN[L.id] || { tex: "rock" }, g = globe(skin.tex, skin.f || 1, skin);
    if (skin.ring) ringOn(g, 1.7, 1.95, null, 0.2);
    const w = { L, o, color, marker, frames, trail, g, when: (Date.parse(frames[0].date + "Z") - startMs) / (data.step_days * DAY) };
    w.label = label(L.name, () => marker.position, L.distance_au < 6 ? "world inner" : "world", () => select(w));
    w.label.style.setProperty("--c", color); g.m.userData.pick = { world: w };
    return w;
  });

  // hypothetical Planet X zone, several hundred au out
  const zone = new THREE.Mesh(new THREE.RingGeometry(300, 900, 160), new THREE.MeshBasicMaterial({ color: 0xff6f91, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  zone.rotation.x = -Math.PI / 2; const zoneGroup = new THREE.Group(); zoneGroup.add(zone); scene.add(zoneGroup);
  for (const r of [300, 900]) zoneGroup.add(line(Array.from({ length: 161 }, (_, i) => new THREE.Vector3(r * Math.cos(i / 160 * 6.2832), 0, r * Math.sin(i / 160 * 6.2832))), 0xff6f91, 0.5));
  const zoneAt = new THREE.Vector3(0, 0, 600); label(tr("Planet X? Somewhere out here (hypothetical)"), () => zoneAt, "px", () => showInfo("planetx"));

  // line of sight from Earth to the chosen world, and the SPHEREx picture as a window beside it
  const beam = line([new THREE.Vector3(), new THREE.Vector3()], 0xffffff, 0.9); beam.visible = false; scene.add(beam);
  const win = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false }));
  win.scale.setScalar(0.2); win.center.set(1.7, 1.0);   // up and to the left of the world, clear of the side panel
  win.visible = false; scene.add(win);

  // SPHEREx near Earth: it sweeps a circle of sky at right angles to the Sun (drawn much larger than life so it can be seen)
  const fanGeo = new THREE.BufferGeometry(), fanPts = [0, 0, 0];
  for (let i = 0; i <= 8; i++) { const a = (i / 8 - 0.5) * 0.16; fanPts.push(Math.cos(a), Math.sin(a), 0); }
  fanGeo.setAttribute("position", new THREE.Float32BufferAttribute(fanPts, 3)); fanGeo.setIndex(Array.from({ length: 8 }, (_, i) => [0, i + 1, i + 2]).flat());
  const scan = new THREE.Group(), fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  const scanRing = line(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * 6.2832), Math.sin(i / 96 * 6.2832), 0)), 0x6fe3ff, 0.14);
  scan.add(fan, scanRing); scene.add(scan);
  const scanTip = new THREE.Vector3(); label(tr("SPHEREx scanning"), () => scanTip, "scan", () => showInfo("spherex", earthGlobe));
  const texOf = new Map();
  const tex = (src) => texOf.get(src) || (texOf.set(src, irTexture(src)), texOf.get(src));

  // time
  let tt = 0, playing = true, sel = null, fly = null;
  const at = (track, x) => { const i = Math.min(N - 2, Math.max(0, Math.floor(x))), f = Math.min(1, Math.max(0, x - i)); return v3(track[i]).lerp(v3(track[i + 1]), f); };
  const isoAt = (x) => new Date(startMs + x * data.step_days * DAY).toISOString().slice(0, 19);
  function place() {
    earth.position.copy(at(data.earth.track, tt)); earthGlobe.m.position.copy(earth.position);
    for (const pg of planetGlobes) pg.g.m.position.copy(planetAt(pg.p, startMs + tt * data.step_days * DAY));
    for (const w of worlds) {
      w.marker.position.copy(at(w.o.track, tt)); w.g.m.position.copy(w.marker.position);
      const pos = w.trail.geometry.attributes.position;
      for (let i = 0; i < TRAIL; i++) { const q = at(w.o.track, Math.max(0, tt - (TRAIL - 1 - i) * TRAIL_STEP)); pos.setXYZ(i, q.x, q.y, q.z); }
      pos.needsUpdate = true;
    }
    $("timeLabel").textContent = fmtDate(isoAt(tt)); $("timeSlider").value = Math.round(tt);
    if (sel) {
      beam.geometry.setFromPoints([earth.position, sel.marker.position]); win.position.copy(sel.marker.position);
      const toSun = earth.position.clone().negate(), toObj = sel.marker.position.clone().sub(earth.position);
      $("worldAngle").textContent = t`Right now it is ${Math.round(THREE.MathUtils.radToDeg(toSun.angleTo(toObj)))}° away from the Sun in Earth's sky.`;
      const au = toObj.length(), minutes = au * 8.317;   // light crosses 1 au in 8.317 minutes
      $("teleDist").textContent = `${au.toFixed(2)} au`;
      $("teleLight").textContent = minutes < 90 ? t`${Math.round(minutes)} minutes` : t`${(minutes / 60).toFixed(1)} hours`;
    }
  }
  $("timeSlider").max = N - 1;
  $("timeSlider").oninput = (e) => { tt = +e.target.value; setPlaying(false); place(); };
  const setPlaying = (on) => { playing = on; $("playBtn").textContent = on ? tr("Pause") : tr("Play"); };
  $("playBtn").onclick = () => setPlaying(!playing);

  function flyTo(cam, look, ms = 2200) { fly = { ms, t0: performance.now(), c0: camera.position.clone(), l0: controls.target.clone(), c1: new THREE.Vector3(...cam), l1: new THREE.Vector3(...look) }; }

  // the picture panel
  const view = new Viewer($("worldView"));
  view.onFrame = (i) => { if (sel && !sel.rgb) { win.material.map = tex(sel.frames[i].img); win.material.needsUpdate = true; } };
  function select(w) {
    actions.chime?.();
    $("infoPanel").hidden = true; focusSun = false; focusG = w.g;
    sel = w; const L = w.L;
    tt = Math.min(N - 1, Math.max(0, w.when)); setPlaying(false);
    worlds.forEach((x) => x.label.classList.toggle("on", x === w));
    document.querySelectorAll(".worldbtn").forEach((b) => b.classList.toggle("on", b.dataset.id === L.id));
    $("worldPanel").hidden = false; stage.classList.add("picked");
    $("worldName").textContent = L.name; $("worldKind").textContent = `${tr(L.kind)} · ${t`${L.distance_au} au from the Sun`}`;
    $("worldBlurb").textContent = tr(L.blurb);
    const first = w.frames[0], last = w.frames[w.frames.length - 1];
    $("worldSaw").textContent = t`The white line is where SPHEREx was looking. It took these ${w.frames.length} real pictures between ${fmtDate(first.date)} and ${fmtDate(last.date)}.`;
    beam.visible = win.visible = true; win.material.map = w.rgb || tex(first.img);
    // the floating window shows the three-colour picture once it is ready; the side panel keeps blinking the single images
    if (!w.rgb) composite(L).then((r) => {
      if (!r) return;
      w.rgb = new THREE.TextureLoader().load(r.url, () => { if (sel === w) { win.material.map = w.rgb; win.material.needsUpdate = true; } });
      w.rgb.colorSpace = THREE.SRGBColorSpace;
    }).catch(() => {});
    view.load(w.frames, L.size).then(() => { view.pair = [0, w.frames.length - 1]; view.setMode("blink"); view.mark(""); });
    place();
    closeUp(w.marker.position);
  }
  function clear() {
    sel = null; focusG = null; focusSun = false; $("infoPanel").hidden = true; beam.visible = win.visible = false; view.stop();
    $("worldPanel").hidden = true; stage.classList.remove("picked");
    worlds.forEach((x) => x.label.classList.remove("on"));
    document.querySelectorAll(".worldbtn").forEach((b) => b.classList.remove("on"));
  }
  $("worldList").innerHTML = worlds.map((w) => `<button class="worldbtn" data-id="${w.L.id}" style="--c:${w.color}"><i></i>${w.L.name}<small>${w.L.distance_au} au</small></button>`).join("");
  document.querySelectorAll(".worldbtn").forEach((b) => (b.onclick = () => select(worlds.find((w) => w.L.id === b.dataset.id))));
  $("worldBack").onclick = () => { clear(); flyTo(HOME.cam, HOME.look); setPlaying(true); };
  $("homeBtn").onclick = () => { clear(); flyTo(WIDE.cam, WIDE.look, 3200); setPlaying(true); };
  $("pxBtn").onclick = () => showInfo("planetx");
  $("worldExplore").onclick = () => actions.explore(sel.L);
  $("worldStack").onclick = () => actions.stack(sel.L);

  // draw
  function resize() { const w = holder.clientWidth, h = holder.clientHeight; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(holder); resize();
  const p = new THREE.Vector3(); let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (stage.offsetParent === null) { last = now; return; }      // home screen is hidden
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { tt += dt * 10; if (tt > N - 1) tt = 0; place(); }
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const d0 = fly.c0.distanceTo(fly.l0), d1 = fly.c1.distanceTo(fly.l1);
      if (d0 > d1 * 8 || d1 > d0 * 8) {
        const dist = d0 * Math.pow(d1 / d0, e), wT = (dist - d0) / (d1 - d0);       // the aim point travels in step with the distance, so the target stays in view
        const dir = new THREE.Vector3().subVectors(fly.c0, fly.l0).normalize().lerp(new THREE.Vector3().subVectors(fly.c1, fly.l1).normalize(), e).normalize();
        controls.target.lerpVectors(fly.l0, fly.l1, wT); camera.position.copy(controls.target).addScaledVector(dir, dist);
      } else { camera.position.lerpVectors(fly.c0, fly.c1, e); controls.target.lerpVectors(fly.l0, fly.l1, e); }
      if (k === 1) { fly = null; stage.classList.remove("intro"); }
    }
    // living scene: drifting star layers, breathing Sun, sweeping SPHEREx scan
    for (const s of skies) s.rotation.y += s.userData.spin * dt;
    const far0 = camera.position.length();
    for (const g of globes) {      // sizes follow the camera; the chosen world grows as you approach
      const d = camera.position.distanceTo(g.m.position);
      const chosen = focusG === g, cap = Math.max(0.25, g.m.position.length() * 0.11);      // never so big that neighbours on nearby orbits collide
      g.m.scale.setScalar(chosen ? Math.max(d * 0.017 * g.f, 0.32) : Math.max(Math.min(d * 0.017 * g.f, cap), g.near)); g.m.rotation.y += dt * 0.22;
    }
    sun.scale.setScalar(focusSun ? 0.5 : THREE.MathUtils.clamp(camera.position.length() * 0.03, 0.1, 0.5));
    // the galaxy model fades in as you leave the Solar System; the Milky Way photograph, seen from inside, fades out
    const gk = THREE.MathUtils.smoothstep(far0, 1500, 9000);
    gMat.opacity = 0.85 * gk; core.material.opacity = 0.5 * gk; sky.material.opacity = 1 - THREE.MathUtils.smoothstep(far0, 2500, 12000);
    corona.forEach((c) => (c.visible = far0 < 2500)); rays.visible = far0 < 2500; hereDot.visible = far0 > 6000;
    stage.classList.toggle("galaxy", far0 > 6000); sun.rotation.y += dt * 0.04; rays.scale.setScalar(sun.scale.x * 7.5); rays.material.rotation += dt * 0.015;
    zoneGroup.visible = far0 > 140;      // the Planet X ring only shows once you pull far back
    belt.rotation.y += dt * 0.012; sky.position.copy(camera.position);
    const pulse = 1 + 0.07 * Math.sin(now / 520);
    corona.forEach((c) => c.scale.setScalar(c.userData.size * pulse));
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(earth.position) * 0.13, 0.3, 26);
    scan.position.copy(earth.position); scan.lookAt(0, 0, 0); scan.scale.setScalar(reach);
    fan.rotation.z = now / 900;
    scanTip.set(Math.cos(fan.rotation.z), Math.sin(fan.rotation.z), 0).multiplyScalar(reach).applyQuaternion(scan.quaternion).add(earth.position);
    controls.update(); if (composer) composer.render(); else renderer.render(scene, camera);
    const w = holder.clientWidth, h = holder.clientHeight, far = camera.position.distanceTo(controls.target);
    stage.classList.toggle("mid", far > 14); stage.classList.toggle("wide", far > 55); stage.classList.toggle("deep", far > 400);
    for (const l of labels) {
      p.copy(l.getPos()).project(camera);
      const show = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      l.el.style.display = show ? "" : "none";
      if (show) l.el.style.transform = `translate(${(p.x + 1) / 2 * w}px, ${(1 - p.y) / 2 * h}px)`;
    }
  }
  place(); setPlaying(true); requestAnimationFrame(frame);
  stage.classList.add("ready", "intro");
  // opening shot: start far out, where a Planet X might be, and sweep in. Any click or scroll takes over.
  camera.position.set(...GAL.cam); controls.target.set(...GAL.look); controls.update();
  const cap = (a2, b2) => { $("introTop").textContent = tr(a2); $("introSub").textContent = tr(b2); };
  cap("The Milky Way", "Our galaxy: hundreds of billions of stars. One of them is the Sun.");
  let introTimer = setTimeout(() => { cap("Diving in", "26,000 light-years from the centre, to one small star"); flyTo(HOME.cam, HOME.look, 12000); }, 3800);
  const skip = () => {
    if (!stage.classList.contains("intro")) return;
    clearTimeout(introTimer); fly = null; stage.classList.remove("intro"); camera.position.set(...HOME.cam); controls.target.set(...HOME.look);
  };
  renderer.domElement.addEventListener("pointerdown", skip); renderer.domElement.addEventListener("wheel", skip, { passive: true });
  $("galaxyBtn").onclick = () => { clear(); flyTo(GAL.cam, GAL.look, 6000); };
  $("infoBack").onclick = () => { const wasGalaxy = stage.classList.contains("galaxy"); clear(); if (!wasGalaxy) flyTo(HOME.cam, HOME.look); };
  $("infoDive").onclick = () => { clear(); flyTo(HOME.cam, HOME.look, 9000); setPlaying(true); };

  // click any globe, ring, the belt or the Planet X zone
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let downAt = null;
  function pickAt(e) {
    const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const far1 = camera.position.length(); if (far1 > 6000) return null;      // in the galaxy view the labels are the buttons
    for (const hit of ray.intersectObjects(pickables, true)) { let o = hit.object; while (o && !o.userData.pick) o = o.parent; if (o) return o.userData.pick; }
    const d = ray.ray.direction, o2 = ray.ray.origin, tt2 = -o2.y / d.y;
    if (tt2 > 0) { const rr = Math.hypot(o2.x + d.x * tt2, o2.z + d.z * tt2); if (far1 < 60 && rr > 2.05 && rr < 3.4) return { key: "belt" }; if (zoneGroup.visible && rr > 300 && rr < 900) return { key: "planetx" }; }
    return null;
  }
  renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;      // a drag, not a click
    const hit = pickAt(e); if (!hit) return;
    if (hit.world) select(hit.world); else showInfo(hit.key, hit.g);
  });
  let hoverAt = 0;
  renderer.domElement.addEventListener("pointermove", (e) => { const now = performance.now(); if (now - hoverAt < 80) return; hoverAt = now; renderer.domElement.style.cursor = pickAt(e) ? "pointer" : "grab"; });
  window.__space = { select: (id) => select(worlds.find((w) => w.L.id === id)), px: () => $("pxBtn").click(), home: () => { clear(); flyTo(HOME.cam, HOME.look, 4000); setPlaying(true); }, info: (k) => showInfo(k, k === "saturn" || k === "rings" ? planetGlobes[4].g : null), galaxy: () => $("galaxyBtn").click(), far: () => camera.position.length() };   // used by the browser check
  return true;
}
