// 3D time stack: an object's real SPHEREx images stacked like glass plates, with time running upward.
// Stars do not move, so they line up into straight pillars. The object moves, so it cuts a slanted line.
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { fmtDate, fmtTime } from "./viewer.js";
import { irTexture } from "./irtex.js";

const S = 10;   // width of each plate in scene units
let renderer, camera, controls, scene, holder, labelLayer, labels = [], running = false;

function plate(texture, y) {
  const g = new THREE.BufferGeometry();
  // image x → scene X, image y (down) → scene Z; uv v = 1 is the top row of the image
  g.setAttribute("position", new THREE.Float32BufferAttribute([-S / 2, y, -S / 2, S / 2, y, -S / 2, S / 2, y, S / 2, -S / 2, y, S / 2], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
}

// Brightest stars in the first image, so their pillars can be drawn. Skips the area around the moving object.
function brightStars(img, size, avoid) {
  const n = 121, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data, v = (x, y) => d[(y * n + x) * 4], out = [];
  for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) {
    const b = v(x, y); if (b < 150) continue;
    let peak = true;
    for (let j = -2; j <= 2 && peak; j++) for (let i = -2; i <= 2; i++) if ((i || j) && v(x + i, y + j) > b) { peak = false; break; }
    const X = (x + 0.5) * size / n, Y = (y + 0.5) * size / n;
    if (peak && !avoid.some((f) => Math.hypot(f.x - X, f.y - Y) < 26) && !out.some((s) => Math.hypot(s.x - X, s.y - Y) < 14)) out.push({ x: X, y: Y, b });
  }
  return out.sort((a, b) => b.b - a.b).slice(0, 40);
}

export function showStack(el, level, frames) {
  holder = el; holder.hidden = false;
  if (!renderer) {
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { holder.textContent = "3D is not available in this browser."; return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    labelLayer = document.createElement("div"); labelLayer.className = "labels";
    holder.append(renderer.domElement, labelLayer);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.9; controls.minDistance = 6; controls.maxDistance = 60;
    new ResizeObserver(() => { const w = holder.clientWidth, h = holder.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }).observe(holder);
  }
  scene = new THREE.Scene(); labelLayer.replaceChildren(); labels = [];
  const n = frames.length, gap = Math.min(2.2, 10 / Math.max(1, n - 1)), top = (n - 1) * gap / 2, yOf = (k) => k * gap - top;
  const X = (x) => (x / level.size - 0.5) * S, Z = (y) => (y / level.size - 0.5) * S;
  frames.forEach((f, k) => {
    const tex = irTexture(f.img, 0.2, k === 0 ? (image) => {
      for (const s of brightStars(image, level.size, frames))   // pillars for the brightest stars
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(X(s.x), -top, Z(s.y)), new THREE.Vector3(X(s.x), top, Z(s.y))]),
          new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.35 })));
    } : undefined);
    scene.add(plate(tex, yOf(k)));
    const y = yOf(k), edge = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new THREE.Vector3(a * S / 2, y, b * S / 2));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge), new THREE.LineBasicMaterial({ color: 0x4a5a94, transparent: true, opacity: 0.7 })));
    const tag = document.createElement("span"); tag.className = "slabel dim"; tag.textContent = `${fmtDate(f.date)}, ${fmtTime(f.date)}`;
    labelLayer.append(tag); labels.push({ el: tag, pos: new THREE.Vector3(-S / 2, y, S / 2) });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7dffcf }));
    ball.position.set(X(f.x), y, Z(f.y)); scene.add(ball);
  });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(frames.map((f, k) => new THREE.Vector3(X(f.x), yOf(k), Z(f.y)))), new THREE.LineBasicMaterial({ color: 0x7dffcf })));
  const name = document.createElement("span"); name.className = "slabel world on"; name.textContent = level.name; name.style.setProperty("--c", "#7dffcf");
  labelLayer.append(name); labels.push({ el: name, pos: new THREE.Vector3(X(frames[n - 1].x), top, Z(frames[n - 1].y)) });
  camera.position.set(13, 7 + top * 0.4, 15); controls.target.set(0, 0, 0);
  holder.dispatchEvent(new Event("resize"));
  const w = holder.clientWidth, h = holder.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!running) { running = true; requestAnimationFrame(draw); }
}

export function hideStack() { if (holder) holder.hidden = true; running = false; }

const p = new THREE.Vector3();
function draw() {
  if (!running) return;
  requestAnimationFrame(draw);
  controls.update(); renderer.render(scene, camera);
  const w = holder.clientWidth, h = holder.clientHeight;
  for (const l of labels) {
    p.copy(l.pos).project(camera);
    l.el.style.transform = `translate(${(p.x + 1) / 2 * w}px, ${(1 - p.y) / 2 * h}px)`;
  }
}
