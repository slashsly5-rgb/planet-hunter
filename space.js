// 3D Solar System: real positions from NASA JPL Horizons (orbits.json). Each world SPHEREx photographed is a place to fly to.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { $, Viewer, fmtDate } from "./viewer.js";
import { t, tr } from "./i18n.js";
import { irTexture } from "./irtex.js";

const v3 = ([x, y, z]) => new THREE.Vector3(x, z, -y);   // ecliptic x,y,z (au) → scene, with y up
const COLORS = ["#8ab4ff", "#ffb547", "#6fe3ff", "#f7e26b", "#ff9a5c", "#c79bff", "#b6ff8a", "#ff6f91", "#7dffcf", "#ffd1dc"];
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

  // background stars (decoration only, not real star positions)
  const far = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) new THREE.Vector3().randomDirection().multiplyScalar(20000).toArray(far, i * 3);
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(far, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  // labels: HTML elements pinned to 3D points
  const labels = [];
  function label(text, getPos, cls = "", onClick) {
    const el = document.createElement(onClick ? "button" : "span");
    el.className = "slabel " + cls; el.textContent = text; if (onClick) el.onclick = onClick;
    labelLayer.append(el); labels.push({ el, getPos }); return el;
  }

  // Sun, planets, Earth
  const sun = dot("#ffd66b", 0.05); scene.add(sun); label(tr("Sun"), () => sun.position, "dim");
  for (const p of data.planets) scene.add(line(p.path.map(v3), 0x3a4670, 0.8));
  for (const name of ["Jupiter", "Saturn"]) { const p = data.planets.find((q) => q.name === name), at = v3(p.path[0]); label(tr(name), () => at, "dim"); }
  scene.add(line(data.earth.path.map(v3), 0x4d7cff));
  const earth = dot("#4d9bff", 0.022); scene.add(earth); label(tr("Earth"), () => earth.position, "earth");

  // the worlds SPHEREx photographed
  const worlds = levels.map((L, k) => {
    const o = data.objects[L.id], color = COLORS[k % COLORS.length], marker = dot(color, 0.026);
    scene.add(line(o.path.map(v3), color, 0.75), marker);
    const frames = L.track?.length > 1 ? L.track : L.frames;
    const w = { L, o, color, marker, frames, when: (Date.parse(frames[0].date + "Z") - startMs) / (data.step_days * DAY) };
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
  win.scale.setScalar(0.17); win.center.set(1.12, -0.12);   // up and to the left of the world, clear of the side panel win.visible = false; scene.add(win);
  const texOf = new Map();
  const tex = (src) => texOf.get(src) || (texOf.set(src, irTexture(src)), texOf.get(src));

  // time
  let tt = 0, playing = true, sel = null, fly = null;
  const at = (track, x) => { const i = Math.min(N - 2, Math.max(0, Math.floor(x))), f = Math.min(1, Math.max(0, x - i)); return v3(track[i]).lerp(v3(track[i + 1]), f); };
  const isoAt = (x) => new Date(startMs + x * data.step_days * DAY).toISOString().slice(0, 19);
  function place() {
    earth.position.copy(at(data.earth.track, tt));
    for (const w of worlds) w.marker.position.copy(at(w.o.track, tt));
    $("timeLabel").textContent = fmtDate(isoAt(tt)); $("timeSlider").value = Math.round(tt);
    if (sel) {
      beam.geometry.setFromPoints([earth.position, sel.marker.position]); win.position.copy(sel.marker.position);
      const toSun = earth.position.clone().negate(), toObj = sel.marker.position.clone().sub(earth.position);
      $("worldAngle").textContent = t`Right now it is ${Math.round(THREE.MathUtils.radToDeg(toSun.angleTo(toObj)))}° away from the Sun in Earth's sky.`;
    }
  }
  $("timeSlider").max = N - 1;
  $("timeSlider").oninput = (e) => { tt = +e.target.value; setPlaying(false); place(); };
  const setPlaying = (on) => { playing = on; $("playBtn").textContent = on ? tr("Pause") : tr("Play"); };
  $("playBtn").onclick = () => setPlaying(!playing);

  function flyTo(cam, look) { fly = { t0: performance.now(), c0: camera.position.clone(), l0: controls.target.clone(), c1: new THREE.Vector3(...cam), l1: new THREE.Vector3(...look) }; }

  // the picture panel
  const view = new Viewer($("worldView"));
  view.onFrame = (i) => { if (sel) { win.material.map = tex(sel.frames[i].img); win.material.needsUpdate = true; } };
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
    beam.visible = win.visible = true; win.material.map = tex(first.img);
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
      const k = Math.min(1, (now - fly.t0) / 1500), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      camera.position.lerpVectors(fly.c0, fly.c1, e); controls.target.lerpVectors(fly.l0, fly.l1, e);
      if (k === 1) fly = null;
    }
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
  window.__space = { select: (id) => select(worlds.find((w) => w.L.id === id)), px: () => $("pxBtn").click() };   // used by the browser check
  return true;
}
