// Films the 30-second trailer of the site, frame by frame, in headless Edge. Every feature of the site gets a shot.
// The page's clock is replaced by one this script advances, so every frame is rendered fully however slow the machine is.
// usage: node trailer/make-trailer.mjs <frames-dir> <phone-screenshot.png> [more phone screenshots]
//        (needs the site on http://localhost:8765; then build the sound with make-audio.py and encode with ffmpeg)
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] || "frames"; mkdirSync(out, { recursive: true });
const phones = process.argv.slice(3).map((p) => "data:image/png;base64," + readFileSync(p).toString("base64"));
const W = 1280, H = 720, FPS = 24, DT = 1000 / FPS, SITE = "http://localhost:8765/";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${mkdtempSync(join(tmpdir(), "tr-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9335/json")).json(); } catch {} }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) waiting.get(d.id)?.(d.result);
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const cdp = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const mouse = (type, x, y, extra = {}) => cdp("Input.dispatchMouseEvent", { type, x, y, ...extra });
const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, { button: "left", clickCount: 1 }); await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 }); };
const S = (v) => JSON.stringify(v);
const press = (sel) => js(`document.querySelector(${S(sel)}).click()`);
// screen position of a point given in a picture's own pixels
const onPic = (sel, pt, size) => js(`(() => { const r = document.querySelector(${S(sel)}).getBoundingClientRect(); return [r.left + ${pt.x} * r.width / ${size}, r.top + ${pt.y} * r.height / ${size}]; })()`);

// Runs in the page before its own scripts: a clock that only moves when __step is called, and the caption overlay.
const INJECT = `(() => {
  let now = 0; const base = Date.now(), timers = new Map(); let tid = 1, rafs = [], rid = 1;
  performance.now = () => now; Date.now = () => base + now;
  window.requestAnimationFrame = (cb) => { rafs.push({ id: rid, cb }); return rid++; };
  window.cancelAnimationFrame = (i) => { rafs = rafs.filter((r) => r.id !== i); };
  window.setTimeout = (cb, ms = 0, ...a) => { timers.set(tid, { cb, at: now + ms, a }); return tid++; };
  window.setInterval = (cb, ms = 0, ...a) => { timers.set(tid, { cb, at: now + ms, every: Math.max(1, ms), a }); return tid++; };
  window.clearTimeout = window.clearInterval = (i) => timers.delete(i);
  window.__step = (dt) => {
    now += dt;
    for (let guard = 0; guard < 80; guard++) {
      let due = null; for (const e of timers) if (e[1].at <= now && (!due || e[1].at < due[1].at)) due = e;
      if (!due) break; const [i, t] = due; if (t.every) t.at += t.every; else timers.delete(i);
      try { if (typeof t.cb === "function") t.cb(...t.a); } catch (e) { console.error(e); }
    }
    const q = rafs; rafs = []; for (const r of q) try { r.cb(now); } catch (e) { console.error(e); }
  };
  window.__cap = (text, sub, alpha, dim, big, imgs) => {
    let o = document.getElementById("trailer");
    if (!o) {
      const st = document.createElement("style");
      st.textContent = ".top,.space-title,.space-worlds,.space-time,.hud-strip,.intro-cap,.frame-hud,#error,.bar{display:none!important} main{padding-top:0!important} .space,.voyage{height:100vh!important;margin-bottom:0!important} html{scrollbar-width:none} ::-webkit-scrollbar{display:none}"
        + "#trailer{position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:system-ui,'Segoe UI',sans-serif;color:#fff;text-align:center}"
        + "#trailer i{position:absolute;left:0;right:0;height:9.5%;background:#000} #trailer i.a{top:0} #trailer i.b{bottom:0} #trDim{position:absolute;inset:0;background:#000}"
        + "#trText{position:absolute;left:0;right:0;bottom:15%;font-weight:800;letter-spacing:.2em;font-size:32px;text-shadow:0 2px 24px #000,0 0 40px #000,0 0 6px #000,0 0 3px #000}"
        + "#trSub{position:absolute;left:0;right:0;bottom:10.5%;font-weight:600;letter-spacing:.14em;font-size:19px;color:#ffcf7a;text-shadow:0 2px 18px #000,0 0 30px #000,0 0 3px #000}"
        + "#trImgs{position:absolute;left:0;right:0;top:11%;height:66%;display:flex;gap:34px;justify-content:center} #trImgs img{height:100%;border-radius:22px;border:3px solid #6fe3ff;box-shadow:0 0 40px #6fe3ff55}"
        + "#trailer.big #trText{bottom:44%;font-size:92px;letter-spacing:.12em;background:linear-gradient(90deg,#ffb547,#ff6f91);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 0 30px #ff8a4788)}"
        + "#trailer.big #trSub{bottom:31%;font-size:25px;color:#fff;letter-spacing:.08em}";
      document.head.append(st);
      o = document.createElement("div"); o.id = "trailer"; o.innerHTML = '<div id="trDim"></div><div id="trImgs"></div><i class="a"></i><i class="b"></i><div id="trText"></div><div id="trSub"></div>'; document.body.append(o);
    }
    o.classList.toggle("big", !!big);
    const im = document.getElementById("trImgs"), want = imgs ? imgs.length : 0;
    if (im.childElementCount !== want) im.innerHTML = (imgs || []).map((u) => '<img src="' + u + '">').join("");
    im.style.opacity = alpha;
    document.getElementById("trDim").style.opacity = dim; const a = document.getElementById("trText"), b = document.getElementById("trSub");
    a.textContent = text; b.textContent = sub; a.style.opacity = b.style.opacity = alpha;
  };
})();`;

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
// let things that load in real time (pictures, data) arrive, while the page's clock barely moves
const settle = async (n = 5, ms = 400) => { for (let i = 0; i < n; i++) { await js(`__step(2)`); await sleep(ms); } };
const open = async (path) => { await cdp("Page.navigate", { url: SITE + path }); await sleep(6500); await settle(6, 600); };
const skip = async (ms) => { for (let t = 0; t < ms; t += 40) await js(`__step(40)`); };

let frame = 0;
// Record n frames. speed = how fast the page's clock runs. each(i) may act on the page before frame i.
async function shoot(n, { speed = 1, text = "", sub = "", dim = 0, big = false, hold = 6, imgs = null, each } = {}) {
  const parts = Math.max(1, Math.ceil(speed)), dt = (DT * speed) / parts;
  for (let i = 0; i < n; i++) {
    if (each) await each(i);
    const alpha = Math.max(0, Math.min(1, (i + 1) / hold, (n - i) / hold)), d = typeof dim === "function" ? dim(i / n) : dim;
    await js(`(() => { for (let k = 0; k < ${parts}; k++) __step(${dt}); __cap(${S(text)}, ${S(sub)}, ${alpha.toFixed(3)}, ${d}, ${big}, ${S(imgs)}); })()`);
    const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 90 });
    writeFileSync(join(out, `f${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
  }
  console.log("frames so far", frame, "|", text || "(no caption)");
}

// ---------- line 1: "From the Milky Way, dive to our Solar System."  (83 frames)
await open("index.html");
await shoot(22, { text: "FROM THE MILKY WAY", dim: (k) => Math.max(0, 1 - k * 6) });
await skip(2900);                                    // to the moment the dive begins
await shoot(61, { speed: 4.8, text: "TO OUR SOLAR SYSTEM", sub: "3D · real orbits from NASA JPL" });

// ---------- line 2: "Every world is at its real position. Click anything."  (66)
await shoot(22, { text: "EVERY WORLD AT ITS REAL POSITION" });
await js(`window.__space.info("rings")`);
await shoot(44, { speed: 1.6, text: "CLICK ANYTHING", sub: "planets · rings · asteroid belt · the galaxy" });

// ---------- line 3: "In the Hunt, detect what moves in real SPHEREx images, predict it, then classify it."  (104)
await press('.top [data-view="hunt"]'); await settle(8, 400);
const hs = () => js(`window.__hunt.state()`);
let h = await hs();
await shoot(26, { text: "THE HUNT · DETECT", sub: "real SPHEREx images" });
await click(...(await onPic("#huntView", h.frames[0], h.size)));
await shoot(18, { text: "THE HUNT", sub: "three steps, like a real astronomer" });
await press("#stepGo");
await shoot(22, { text: "PREDICT", sub: "where will it be next?" });
h = await hs(); await click(...(await onPic("#huntView", h.target, h.size)));
await shoot(14, { text: "PREDICT", sub: "checked against a third real image" });
await press(`.zone[data-z="${h.zone}"]`);
await shoot(24, { text: "CLASSIFY", sub: "how fast it moves tells you how far it is" });

// ---------- line 4: "Explore each world in three colours, as a time lapse, and as a 3D time stack."  (95)
await press('.top [data-view="explore"]'); await settle(3, 300);
await js(`[...document.querySelectorAll(".cardlink")].find((b) => b.textContent.includes("Pluto")).click()`); await settle(8, 500);
await js(`scrollTo(0, 80)`);
await shoot(30, { text: "EXPLORE · THREE COLOURS", sub: "three real images as red, green and blue" });
await press('[data-exmode="play"]'); await settle(6, 400);
await shoot(30, { speed: 1.6, text: "TIME-LAPSE", sub: "its real path, date by date" });
await press('[data-exmode="stack"]'); await settle(8, 500);
await shoot(35, { speed: 2, text: "3D TIME STACK", sub: "stars stand still · the world cuts across" });

// ---------- line 5: "Run a computer scan, compare six months apart, and measure it yourself."  (85)
await press('[data-exmode="scan"]'); await settle(7, 400);
await shoot(30, { text: "COMPUTER SCAN", sub: "an automatic detector tries the same job" });
await press("#passBtn"); await settle(7, 400);
await shoot(27, { text: "SIX MONTHS APART", sub: "same stars · the world has gone" });
await press("#measureBtn"); await settle(8, 400);
const track = await js(`fetch("levels.json").then((r) => r.json()).then((L) => { const p = L.find((l) => l.id === "pluto"); return { a: p.track[0], b: p.track[p.track.length - 1], size: p.size }; })`);
await click(...(await onPic("#exView", track.a, track.size))); await settle(2, 200);
await shoot(28, { text: "MEASURE IT YOURSELF", sub: "then compare with NASA JPL", each: async (i) => { if (i === 8) await click(...(await onPic("#exView", track.b, track.size))); } });

// ---------- line 6: "The Planet X lab shows why it hides."  (42)
await press('.top [data-view="lab"]'); await settle(8, 500); await js(`scrollTo(0, 150)`);
await shoot(18, { text: "PLANET X LAB", sub: "farther means slower" });
await js(`document.querySelector("#labView").scrollIntoView({ block: "center" })`);
await shoot(24, { text: "PLANET X LAB", sub: "hide a simulated planet · try to find it", each: async (i) => { if (i % 6 === 0) { await js(`(() => { const s = document.getElementById("distSlider"); s.value = ${20 + i * 3}; s.dispatchEvent(new Event("input")); })()`); await sleep(300); } } });

// ---------- line 7: "Then fly the Voyage. Dodge, shoot, scan ten real worlds, and stack images to find Planet X."  (129)
const key = (type, k) => js(`dispatchEvent(new KeyboardEvent(${S(type)}, { key: ${S(k)} }))`);
const vs = () => js(`window.__voyage.state()`);
await press('.top [data-view="voyage"]'); await js(`window.__voyage.skipTo(0)`); await settle(8, 500);
await skip(2700); await js(`window.__voyage.safe()`);
await shoot(60, {
  text: "THE VOYAGE", sub: "dodge · shoot · missiles · boost", each: async (i) => {
    await mouse("mouseMoved", 640 + 300 * Math.sin(i / 12), 390 + 120 * Math.sin(i / 8 + 1));
    if (i === 8 || i === 26 || i === 44) await key("keydown", "x");
    if (i === 30) await key("keydown", " "); if (i === 55) await key("keyup", " ");
  },
});
await js(`window.__voyage.arrive()`); await skip(3300); await settle(8, 500);
await shoot(32, {
  speed: 2, text: "SCAN TEN REAL WORLDS", sub: "lock on with real SPHEREx images", each: async () => {
    const s = await vs(); if (s.phase !== "scan") return;
    const p = await onPic("#vyView", s.frames[s.i === 1 ? 1 : 0], s.size); await mouse("mouseMoved", p[0], p[1]);
  },
});
await js(`window.__voyage.skipTo(10)`); await settle(6, 500); await skip(2700); await js(`window.__voyage.arrive()`); await skip(3300); await settle(10, 700);
const truth = (await vs()).truth;
await shoot(37, {
  text: "STACK IMAGES · FIND PLANET X", sub: "the real method astronomers use (simulated planet)", each: async (i) => {
    const k = Math.min(1, i / 20);
    await js(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input")); }; set("vyVx", ${truth.vx * k}); set("vyVy", ${truth.vy * k}); })()`);
  },
});

// ---------- line 8: "In English and Malay, on computer or phone, with a classroom sheet."  (116)
await js(`localStorage.setItem("lang", "ms")`);
await open("index.html?lang=ms#explore");      // the query makes this a fresh page load; a change of #hash alone would not reload it
await shoot(26, { text: "ENGLISH · BAHASA MALAYSIA" });
await shoot(22, { text: "ON COMPUTER OR PHONE", sub: "tilt your phone to fly", dim: 1, imgs: phones });
await js(`localStorage.setItem("lang", "en")`);
await open("classroom.html");
await shoot(22, { text: "CLASSROOM SHEET", sub: "a ready-made lesson for teachers" });
await open("index.html");
await shoot(46, { speed: 0.5, text: "PLANET HUNTER", sub: "Play free in your browser  ·  slashsly5-rgb.github.io/planet-hunter", big: true, hold: 10, dim: 0.45 });

console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, errors }));
ws.close(); proc.kill();
