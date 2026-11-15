// 3D Solar System: real positions from NASA JPL Horizons (orbits.json). Each world SPHEREx photographed is a place to fly to.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { $, Viewer, fmtDate } from "./viewer.js?v=24";
import { t, tr } from "./i18n.js?v=24";
import { irTexture } from "./irtex.js?v=24";
import { composite } from "./colour.js?v=24";

const v3 = ([x, y, z]) => new THREE.Vector3(x, z, -y);   // ecliptic x,y,z (au) → scene, with y up
const COLORS = ["#8ab4ff", "#ffb547", "#6fe3ff", "#f7e26b", "#ff9a5c", "#c79bff", "#b6ff8a", "#ff6f91", "#7dffcf", "#ffd1dc"];
const TRAIL = 30, TRAIL_STEP = 1.2;   // trail: 30 points, 1.2 timeline steps (6 days) apart
const DAY = 864e5, HOME = { cam: [0, 46, 74], look: [0, 0, 0] };

function dotTexture(color) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "#fff"); grad.addColorStop(0.25, color); grad.addColorStop(1, "transparent");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dot = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), sizeAttenuation: false, depthTest: false })); s.scale.setScalar(size); return s; };
const line = (pts, color, opacity = 1) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));

export async function initSpace(levels, actions) {
  const stage = $("space"), holder = stage.querySelector(".space-canvas"), labelLayer = stage.querySelector(".labels");
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { stage.classList.add("no3d"); return false; }
  const data = await (await fetch("orbits.json")).json();
  const startMs = Date.parse(data.start + "T00:00:00Z"), N = data.earth.track.length;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  holder.append(renderer.domElement);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.01, 40000);
  camera.position.set(...HOME.cam);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 0.4; controls.maxDistance = 9000;

  // backdrop (decoration only, not real star positions): three layers of stars that drift at different speeds, and soft nebula glow
  const skies = [[2600, 0x8d9fe8, 1.1, 0.55, 0.004], [700, 0xcfe0ff, 1.9, 0.8, 0.007], [90, 0xffe2b8, 3.2, 1, 0.011]].map(([count, color, size, opacity, spin]) => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) new THREE.Vector3().randomDirection().multiplyScalar(20000).toArray(pos, i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false }));
    pts.userData.spin = spin; scene.add(pts); return pts;
  });
  for (const [color, x, y, z, s] of [["#5b2a9a", -9000, 3000, -12000, 17000], ["#12508a", 11000, -2000, -9000, 15000], ["#0f6a70", 2000, 6000, 13000, 14000], ["#8a2a5a", -12000, -4000, 8000, 13000]]) {
    const n = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
    n.position.set(x, y, z); n.scale.setScalar(s); scene.add(n);
  }

  // labels: HTML elements pinned to 3D points
  const labels = [];
  function label(text, getPos, cls = "", onClick) {
    const el = document.createElement(onClick ? "button" : "span");
    el.className = "slabel " + cls; el.textContent = text; if (onClick) el.onclick = onClick;
    labelLayer.append(el); labels.push({ el, getPos }); return el;
  }

  // Sun, planets, Earth
  const sun = dot("#ffd66b", 0.05); scene.add(sun); label(tr("Sun"), () => sun.position, "dim");
  const corona = [0.07, 0.12].map((size, k) => {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(k ? "#ff8a3c" : "#ffc65c"), sizeAttenuation: false, depthTest: false, transparent: true, opacity: k ? 0.25 : 0.45, blending: THREE.AdditiveBlending }));
    c.userData.size = size; scene.add(c); return c;
  });
  for (const p of data.planets) scene.add(line(p.path.map(v3), 0x3a4670, 0.55));
  for (const name of ["Jupiter", "Saturn"]) { const p = data.planets.find((q) => q.name === name), at = v3(p.path[0]); label(tr(name), () => at, "dim"); }
  scene.add(line(data.earth.path.map(v3), 0x4d7cff));
  const earth = dot("#4d9bff", 0.022); scene.add(earth); label(tr("Earth"), () => earth.position, "earth");

  // the worlds SPHEREx photographed
  const worlds = levels.map((L, k) => {
    const o = data.objects[L.id], color = COLORS[k % COLORS.length], marker = dot(color, 0.026);
    scene.add(line(o.path.map(v3), color, 0.38), marker);
    // glowing trail behind the world: bright at the head, fading to nothing
    const tg = new THREE.BufferGeometry(), tcol = new Float32Array(TRAIL * 3), c3 = new THREE.Color(color);
    for (let i = 0; i < TRAIL; i++) { const f = (i / (TRAIL - 1)) ** 2; tcol.set([c3.r * f, c3.g * f, c3.b * f], i * 3); }
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)); tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.frustumCulled = false; scene.add(trail);
    const frames = L.track?.length > 1 ? L.track : L.frames;
    const w = { L, o, color, marker, frames, trail, when: (Date.parse(frames[0].date + "Z") - startMs) / (data.step_days * DAY) };
    w.label = label(L.name, () => marker.position, L.distance_au < 6 ? "world inner" : "world", () => select(w));
    w.label.style.setProperty("--c", color);
    return w;
  });

  // hypothetical Planet X zone, several hundred au out
  const zone = new THREE.Mesh(new THREE.RingGeometry(300, 900, 160), new THREE.MeshBasicMaterial({ color: 0xff6f91, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  zone.rotation.x = -Math.PI / 2; scene.add(zone);
  for (const r of [300, 900]) scene.add(line(Array.from({ length: 161 }, (_, i) => new THREE.Vector3(r * Math.cos(i / 160 * 6.2832), 0, r * Math.sin(i / 160 * 6.2832))), 0xff6f91, 0.5));
  const zoneAt = new THREE.Vector3(0, 0, 600); label(tr("Planet X? Somewhere out here (hypothetical)"), () => zoneAt, "px");

  // line of sight from Earth to the chosen world, and the SPHEREx picture as a window beside it
  const beam = line([new THREE.Vector3(), new THREE.Vector3()], 0xffffff, 0.9); beam.visible = false; scene.add(beam);
  const win = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false }));
  win.scale.setScalar(0.17); win.center.set(1.12, -0.12);   // up and to the left of the world, clear of the side panel
  win.visible = false; scene.add(win);

  // SPHEREx near Earth: it sweeps a circle of sky at right angles to the Sun (drawn much larger than life so it can be seen)
  const fanGeo = new THREE.BufferGeometry(), fanPts = [0, 0, 0];
  for (let i = 0; i <= 8; i++) { const a = (i / 8 - 0.5) * 0.16; fanPts.push(Math.cos(a), Math.sin(a), 0); }
  fanGeo.setAttribute("position", new THREE.Float32BufferAttribute(fanPts, 3)); fanGeo.setIndex(Array.from({ length: 8 }, (_, i) => [0, i + 1, i + 2]).flat());
  const scan = new THREE.Group(), fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  const scanRing = line(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * 6.2832), Math.sin(i / 96 * 6.2832), 0)), 0x6fe3ff, 0.28);
  scan.add(fan, scanRing); scene.add(scan);
  const scanTip = new THREE.Vector3(); label(tr("SPHEREx scanning"), () => scanTip, "scan");
  const texOf = new Map();
  const tex = (src) => texOf.get(src) || (texOf.set(src, irTexture(src)), texOf.get(src));

  // time
  let tt = 0, playing = true, sel = null, fly = null;
  const at = (track, x) => { const i = Math.min(N - 2, Math.max(0, Math.floor(x))), f = Math.min(1, Math.max(0, x - i)); return v3(track[i]).lerp(v3(track[i + 1]), f); };
  const isoAt = (x) => new Date(startMs + x * data.step_days * DAY).toISOString().slice(0, 19);
  function place() {
    earth.position.copy(at(data.earth.track, tt));
    for (const w of worlds) {
      w.marker.position.copy(at(w.o.track, tt));
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

  function flyTo(cam, look, ms = 1500) { fly = { ms, t0: performance.now(), c0: camera.position.clone(), l0: controls.target.clone(), c1: new THREE.Vector3(...cam), l1: new THREE.Vector3(...look) }; }

  // the picture panel
  const view = new Viewer($("worldView"));
  view.onFrame = (i) => { if (sel && !sel.rgb) { win.material.map = tex(sel.frames[i].img); win.material.needsUpdate = true; } };
  function select(w) {
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
    const p = w.marker.position, r = Math.max(4, p.length());
    flyTo([p.x * 0.5 + r * 0.25, r * 1.05, p.z * 0.5 + r * 1.05], [p.x * 0.5, 0, p.z * 0.5]);
  }
  function clear() {
    sel = null; beam.visible = win.visible = false; view.stop();
    $("worldPanel").hidden = true; stage.classList.remove("picked");
    worlds.forEach((x) => x.label.classList.remove("on"));
    document.querySelectorAll(".worldbtn").forEach((b) => b.classList.remove("on"));
  }
  $("worldList").innerHTML = worlds.map((w) => `<button class="worldbtn" data-id="${w.L.id}" style="--c:${w.color}"><i></i>${w.L.name}<small>${w.L.distance_au} au</small></button>`).join("");
  document.querySelectorAll(".worldbtn").forEach((b) => (b.onclick = () => select(worlds.find((w) => w.L.id === b.dataset.id))));
  $("worldBack").onclick = () => { clear(); flyTo(HOME.cam, HOME.look); setPlaying(true); };
  $("homeBtn").onclick = () => { clear(); flyTo(HOME.cam, HOME.look); setPlaying(true); };
  $("pxBtn").onclick = () => { clear(); flyTo([0, 900, 1700], [0, 0, 0]); };
  $("worldExplore").onclick = () => actions.explore(sel.L);
  $("worldStack").onclick = () => actions.stack(sel.L);

  // draw
  function resize() { const w = holder.clientWidth, h = holder.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(holder); resize();
  const p = new THREE.Vector3(); let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (stage.offsetParent === null) { last = now; return; }      // home screen is hidden
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { tt += dt * 10; if (tt > N - 1) tt = 0; place(); }
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      camera.position.lerpVectors(fly.c0, fly.c1, e); controls.target.lerpVectors(fly.l0, fly.l1, e);
      if (k === 1) { fly = null; stage.classList.remove("intro"); }
    }
    // living scene: drifting star layers, breathing Sun, sweeping SPHEREx scan
    for (const s of skies) s.rotation.y += s.userData.spin * dt;
    const pulse = 1 + 0.07 * Math.sin(now / 520);
    corona.forEach((c) => c.scale.setScalar(c.userData.size * pulse));
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(earth.position) * 0.13, 0.3, 26);
    scan.position.copy(earth.position); scan.lookAt(0, 0, 0); scan.scale.setScalar(reach);
    fan.rotation.z = now / 900;
    scanTip.set(Math.cos(fan.rotation.z), Math.sin(fan.rotation.z), 0).multiplyScalar(reach).applyQuaternion(scan.quaternion).add(earth.position);
    controls.update(); renderer.render(scene, camera);
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
  camera.position.set(-500, 1100, 1900); flyTo(HOME.cam, HOME.look, 7000);
  const skip = () => { if (stage.classList.contains("intro")) { fly = null; stage.classList.remove("intro"); } };
  renderer.domElement.addEventListener("pointerdown", skip); renderer.domElement.addEventListener("wheel", skip, { passive: true });
  window.__space = { select: (id) => select(worlds.find((w) => w.L.id === id)), px: () => $("pxBtn").click() };   // used by the browser check
  return true;
}
