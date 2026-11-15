// Checks the front-page extras (music, shooting stars, haze).
// usage: node tests/extras-check.mjs <outdir> [width height]      PH_URL=<site> to test the live site
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = ".", W = "1440", H = "900"] = process.argv.slice(2);
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9337", `--user-data-dir=${mkdtempSync(join(tmpdir(), "xc-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9337/json")).json(); } catch {} }
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
const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
const view = () => js(`[...document.querySelectorAll(".view")].find((s) => !s.hidden)?.id + (document.querySelector("#exploreDetail") && !document.querySelector("#exploreDetail").hidden && !document.querySelector("#explore").hidden ? ":" + document.querySelector("#exName").textContent + ":" + (document.querySelector(".exmode.on")?.dataset.exmode || "") : "") + (document.querySelector("#infoPanel") && !document.querySelector("#infoPanel").hidden ? ":" + document.querySelector("#infoName").textContent : "")`);

// Checks the front-page extras: music starts on the first click and the ♪ button mutes it; shooting stars get drawn; the haze layer is there.
await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html" });
await sleep(+process.env.PH_WAIT || 14000);
const before = await js(`window.__music.paused`);
let welcomeShown = false; for (let i = 0; i < 40 && !welcomeShown; i++) { welcomeShown = await js(`!document.querySelector("#welcome").hidden`); if (!welcomeShown) await sleep(500); }
await shot("x0-welcome.png");
const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const br = await js(`(() => { const r = document.querySelector(".brand").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await click(br[0], br[1]); await sleep(2500);
const afterClick = await js(`[window.__music.paused, Math.round(window.__music.volume * 100) / 100, window.__music.currentTime > 0.5]`);
let meteor = false;
for (let i = 0; i < 24 && !meteor; i++) { await sleep(500); meteor = await js(`(() => { const c = document.querySelector(".space .meteors"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) return true; return false; })()`); }
await shot("x1-home.png");
const welcomeClosed = await js(`document.querySelector("#welcome").hidden && localStorage.getItem("welcomed") === "1"`);
const haze = await js(`getComputedStyle(document.querySelector(".space .nebula"), "::before").animationName`);
const mb = await js(`(() => { const r = document.querySelector("#musicBtn").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width > 0]; })()`);
await click(mb[0], mb[1]); await sleep(2000);
const muted = await js(`[window.__music.paused, document.querySelector("#musicBtn").className, localStorage.getItem("music")]`);
console.log(JSON.stringify({ welcomeShown, welcomeClosed, before, afterClick, meteor, haze, musicBtnVisible: mb[2], muted, errors }, null, 1));
ws.close(); proc.kill();
