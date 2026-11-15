// Films the cinematic trailer (v4): calm narration, few words, a visible AI-voice label, no NASA logos. Same method as make-trailer.mjs.
// usage: node trailer/make-cinematic.mjs <frames-dir> <timing.json from cine_voice.py> <phone screenshots...>
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] || "frames"; mkdirSync(out, { recursive: true });
const T = JSON.parse(readFileSync(process.argv[3], "utf8")), F = T.frames;      // frames for each scene, from cine_voice.py
const phones = process.argv.slice(4).map((p) => "data:image/png;base64," + readFileSync(p).toString("base64"));
const W = 1280, H = 720, FPS = 24, DT = 1000 / FPS, SITE = "http://localhost:8765/";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9342", `--user-data-dir=${mkdtempSync(join(tmpdir(), "tr-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9342/json")).json(); } catch {} }
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
  try { localStorage.setItem("welcomed", "1"); } catch {}
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
      const st = document.createElement("style"); st.id = "trStyle";
      st.textContent = ".top,.space-title,.space-worlds,.space-time,.hud-strip,.intro-cap,.frame-hud,#error,.bar{display:none!important} main{padding-top:0!important} .space,.voyage{height:100vh!important;margin-bottom:0!important} html{scrollbar-width:none} ::-webkit-scrollbar{display:none}"
        + "#trailer{position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:system-ui,'Segoe UI',sans-serif;color:#fff;text-align:center}"
        + "#trailer i{position:absolute;left:0;right:0;height:9.5%;background:#000} #trailer i.a{top:0} #trailer i.b{bottom:0} #trDim{position:absolute;inset:0;background:#000}"
        + "#trText{position:absolute;left:0;right:0;bottom:15%;font-weight:800;letter-spacing:.2em;font-size:32px;text-shadow:0 2px 24px #000,0 0 40px #000,0 0 6px #000,0 0 3px #000}"
        + "#trSub{position:absolute;left:0;right:0;bottom:10.5%;font-weight:600;letter-spacing:.14em;font-size:19px;color:#ffcf7a;text-shadow:0 2px 18px #000,0 0 30px #000,0 0 3px #000}"
        + "#trImgs{position:absolute;left:0;right:0;top:11%;height:66%;display:flex;gap:34px;justify-content:center} #trImgs img{height:100%;border-radius:22px;border:3px solid #6fe3ff;box-shadow:0 0 40px #6fe3ff55}"
        + "#trailer.big #trText{bottom:44%;font-size:92px;letter-spacing:.12em;background:linear-gradient(90deg,#ffb547,#ff6f91);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 0 30px #ff8a4788)}"
        + "#trailer.big #trSub{bottom:31%;font-size:25px;color:#fff;letter-spacing:.08em}"
        + ".vy-comm{display:none!important} #trGrad{position:absolute;left:0;right:0;bottom:9.5%;height:24%;background:linear-gradient(transparent,#000d)}"
        + "#trMark{position:absolute;right:18px;bottom:2.6%;font-size:13px;letter-spacing:.04em;color:#ffffffb3;text-shadow:none}";
      document.head.append(st);
      o = document.createElement("div"); o.id = "trailer"; o.innerHTML = '<div id="trDim"></div><div id="trImgs"></div><div id="trGrad"></div><i class="a"></i><i class="b"></i><div id="trText"></div><div id="trSub"></div><div id="trMark">AI voice-over (text-to-speech)  ·  real website footage  ·  music generated by code</div>'; document.body.append(o);
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

const part = (i, fractions) => { const n = fractions.map((f) => Math.round(F[i] * f)); n[n.length - 1] = F[i] - n.slice(0, -1).reduce((a, b) => a + b, 0); return n; };
const key = (type, k) => js(`dispatchEvent(new KeyboardEvent(${S(type)}, { key: ${S(k)} }))`);
const TICK = "\u2714 ";

// ---------- 0: the whole sky (the galaxy, then the dive into the Solar System)
await open("index.html");
await shoot(F[0], { speed: 2.4, hold: 14, dim: (p) => 0.35 * (1 - p), text: "THE WHOLE SKY", sub: "photographed again and again by NASA's SPHEREx telescope" });

// ---------- 1: worlds are moving
await skip(9000);
await shoot(F[1], { speed: 3, hold: 10, text: "THE STARS STAY STILL", sub: "the worlds move" });

// ---------- 2: Planet Hunter lets anyone see them
await js(`window.__space.select("pluto")`);
await shoot(F[2], { speed: 1.3, hold: 8, text: "PLANET HUNTER", sub: "real SPHEREx pictures of ten worlds" });

// ---------- 3: blink, time-lapse, 3D time stack
await press('.top [data-view="explore"]'); await settle(3, 300);
await js(`[...document.querySelectorAll(".cardlink")].find((b) => b.textContent.includes("Pluto")).click()`); await settle(8, 500);
let n = part(3, [0.3, 0.3, 0.4]);
await press('[data-exmode="blink"]'); await settle(5, 400); await js(`scrollTo(0, 80)`);
await shoot(n[0], { hold: 5, text: "BLINK", sub: "two dates: the stars stay, Pluto jumps" });
await press('[data-exmode="play"]'); await settle(5, 400);
await shoot(n[1], { speed: 1.8, hold: 5, text: "TIME-LAPSE", sub: "its real path, picture by picture" });
await press('[data-exmode="stack"]'); await settle(8, 500);
await shoot(n[2], { speed: 2, hold: 5, text: "3D TIME STACK", sub: "stars stand straight · the world cuts across" });

// ---------- 4: hunt them
await press('.top [data-view="hunt"]'); await settle(8, 400);
const h = await js(`window.__hunt.state()`);
await shoot(F[4], { hold: 6, text: "THE HUNT", sub: "detect · predict · classify, like an astronomer", each: async (i) => { if (i === Math.floor(F[4] * 0.4)) await click(...(await onPic("#huntView", h.frames[0], h.size))); } });

// ---------- 5: fly to the edge of the Solar System
await press('.top [data-view="voyage"]'); await js(`window.__voyage.skipTo(0)`); await settle(8, 500); await skip(2700); await js(`window.__voyage.safe()`);
await shoot(F[5], { hold: 6, text: "THE VOYAGE", sub: "ten real worlds · one hidden planet", each: async (i) => { await mouse("mouseMoved", 640 + 300 * Math.sin(i / 12), 390 + 120 * Math.sin(i / 8 + 1)); if (i === 6 || i === 30) await key("keydown", "x"); } });

// ---------- 6: real NASA data, free for everyone
await open("index.html?live=1"); await skip(16500);
await js(`__cap("", "", 0, 0, false, null); trStyle.textContent = trStyle.textContent.replace(".space-title,", "")`); await settle(8, 500);     // show the intro panel with its live NASA check
n = part(6, [0.5, 0.5]);
await shoot(n[0], { speed: 1, hold: 6, text: "REAL NASA DATA", sub: "checked live against NASA's servers on every visit" });
await shoot(n[1], { hold: 6, dim: 1, imgs: phones, text: "FREE, FOR EVERYONE", sub: "computer · phone · English · Bahasa Malaysia" });

// ---------- 7: title
await open("index.html?title=1");
await shoot(F[7], { speed: 0.5, text: "PLANET HUNTER", sub: "Find what moves  ·  slashsly5-rgb.github.io/planet-hunter", big: true, hold: 10, dim: 0.45 });

console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, errors, status: await js(`document.querySelector("#dataStatus")?.textContent`) }));
ws.close(); proc.kill();
