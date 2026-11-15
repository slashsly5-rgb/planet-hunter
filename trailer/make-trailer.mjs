// Films a 30-second trailer of the site, frame by frame, in headless Edge.
// The page's clock is replaced by one this script advances, so every frame is rendered fully however slow the machine is.
// usage: node trailer/make-trailer.mjs <frames-dir>      (needs the site on http://localhost:8765; then encode with ffmpeg, see README)
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] || "frames"; mkdirSync(out, { recursive: true });
const W = 1280, H = 720, FPS = 24, DT = 1000 / FPS;
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
  window.__cap = (text, sub, alpha, dim, big) => {
    let o = document.getElementById("trailer");
    if (!o) {
      const st = document.createElement("style");
      st.textContent = ".top,.space-title,.space-worlds,.space-time,.hud-strip,.intro-cap,.frame-hud,#error{display:none!important} main{padding-top:0!important} .space,.voyage{height:100vh!important;margin-bottom:0!important}"
        + "#trailer{position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:system-ui,'Segoe UI',sans-serif;color:#fff;text-align:center}"
        + "#trailer i{position:absolute;left:0;right:0;height:9.5%;background:#000} #trailer i.a{top:0} #trailer i.b{bottom:0} #trDim{position:absolute;inset:0;background:#000}"
        + "#trText{position:absolute;left:0;right:0;bottom:15%;font-weight:800;letter-spacing:.2em;font-size:32px;text-shadow:0 2px 24px #000,0 0 40px #000,0 0 6px #000}"
        + "#trSub{position:absolute;left:0;right:0;bottom:10.5%;font-weight:600;letter-spacing:.14em;font-size:19px;color:#ffcf7a;text-shadow:0 2px 18px #000,0 0 30px #000}"
        + "#trailer.big #trText{bottom:44%;font-size:92px;letter-spacing:.12em;background:linear-gradient(90deg,#ffb547,#ff6f91);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 0 30px #ff8a4788)}"
        + "#trailer.big #trSub{bottom:31%;font-size:25px;color:#fff;letter-spacing:.08em}";
      document.head.append(st);
      o = document.createElement("div"); o.id = "trailer"; o.innerHTML = '<div id="trDim"></div><i class="a"></i><i class="b"></i><div id="trText"></div><div id="trSub"></div>'; document.body.append(o);
    }
    o.classList.toggle("big", !!big);
    document.getElementById("trDim").style.opacity = dim; const a = document.getElementById("trText"), b = document.getElementById("trSub");
    a.textContent = text; b.textContent = sub; a.style.opacity = b.style.opacity = alpha;
  };
})();`;

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
await cdp("Page.navigate", { url: "http://localhost:8765/index.html" });
await sleep(7000);                                   // real time: scripts, data and textures download
for (let i = 0; i < 6; i++) { await js(`__step(1)`); await sleep(700); }      // let the first frames draw without moving the clock much

let frame = 0;
const S = (v) => JSON.stringify(v);
// Record n frames. speed = how fast the page's clock runs. each(i) may act on the page before frame i.
async function shoot(n, { speed = 1, text = "", sub = "", dim = 0, big = false, hold = 8, each } = {}) {
  const sub2 = Math.max(1, Math.ceil(speed)), dt = (DT * speed) / sub2;
  for (let i = 0; i < n; i++) {
    if (each) await each(i);
    const alpha = Math.max(0, Math.min(1, (i + 1) / hold, (n - i) / hold)), d = typeof dim === "function" ? dim(i / n) : dim;
    await js(`(() => { for (let k = 0; k < ${sub2}; k++) __step(${dt}); __cap(${S(text)}, ${S(sub)}, ${alpha.toFixed(3)}, ${d}, ${big}); })()`);
    const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 90 });
    writeFileSync(join(out, `f${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
  }
  console.log("frames so far", frame, text || "(no caption)");
}
const skip = async (ms) => { for (let t = 0; t < ms; t += 40) await js(`__step(40)`); };

// 1. the galaxy, then the dive to the Sun
await shoot(54, { text: "OUR GALAXY", sub: "hundreds of billions of stars", dim: (k) => Math.max(0, 1 - k * 5) });
await skip(1500);                                    // to the moment the dive begins
await shoot(96, { speed: 3, text: "ONE OF THEM IS OURS" });
await shoot(30, { text: "NASA'S SPHEREx TELESCOPE", sub: "maps the whole sky, again and again" });
// 2. a world up close
await js(`window.__space.info("rings")`);
await shoot(54, { speed: 1.4, text: "EVERY WORLD", sub: "where NASA says it really is" });
// 3. the hunt
await js(`document.querySelector('.top [data-view="hunt"]').click()`);
for (let i = 0; i < 8; i++) { await js(`__step(5)`); await sleep(400); }
await shoot(36, { text: "REAL IMAGES FROM SPACE", sub: "the stars stay still" });
const h = await js(`(() => { const s = window.__hunt.state(), r = document.querySelector("#huntView").getBoundingClientRect(), f = s.frames[0]; return [r.left + f.x * r.width / s.size, r.top + f.y * r.height / s.size]; })()`);
await click(h[0], h[1]);
await shoot(30, { text: "ONE THING MOVES", sub: "find it" });
// 4. the Voyage
await js(`document.querySelector('.top [data-view="voyage"]').click()`); await js(`window.__voyage.skipTo(0)`);
for (let i = 0; i < 8; i++) { await js(`__step(5)`); await sleep(500); }
await shoot(30, { speed: 2 });                       // the game's own chapter title card
const key = (type, k) => js(`dispatchEvent(new KeyboardEvent(${S(type)}, { key: ${S(k)} }))`);
await shoot(156, {
  text: "", each: async (i) => {
    await mouse("mouseMoved", 640 + 300 * Math.sin(i / 15), 390 + 120 * Math.sin(i / 10 + 1));
    if (i === 24 || i === 62 || i === 104 || i === 132) await key("keydown", "x");
    if (i === 84) await key("keydown", " "); if (i === 128) await key("keyup", " ");
    if (i === 6) await js(`window.__voyage.safe()`);
  },
});
await js(`window.__voyage.arrive()`);
await shoot(60, { speed: 1.25, text: "FLY THE VOYAGE", sub: "ten real worlds · one ship" });
// 5. Planet X, then the title
await js(`document.querySelector('.brand').click()`); await js(`window.__space.info("planetx")`);
for (let i = 0; i < 4; i++) { await js(`__step(5)`); await sleep(300); }
await shoot(66, { speed: 1.2, text: "AND SOMEWHERE OUT THERE", sub: "Planet X?" });
await js(`window.__space.galaxy()`);
await shoot(108, { speed: 1.5, text: "PLANET HUNTER", sub: "Play free in your browser  ·  slashsly5-rgb.github.io/planet-hunter", big: true, hold: 14, dim: (k) => Math.min(0.45, k * 0.9) });

console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, errors }));
ws.close(); proc.kill();
