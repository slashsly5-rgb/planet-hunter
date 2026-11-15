// Plays the Voyage in headless Edge: opening, three chapters (one of each scanner type), then the Planet X finale. Saves screenshots.
// usage: node tests/voyage-check.mjs <outdir> [width height]     PH_URL=<site> to test the live site (default http://localhost:8765)
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = ".", W = "1440", H = "900"] = process.argv.slice(2);
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${mkdtempSync(join(tmpdir(), "vy-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9334/json")).json(); } catch {} }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) waiting.get(d.id)?.(d.result);
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value).join(" "));
};
const cdp = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
const move = (x, y) => cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const click = async (x, y) => { await move(x, y); for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const st = () => js(`window.__voyage.state()`);
const until = async (phases, ms = 20000) => { for (let t = 0; t < ms; t += 200) { if (phases.includes((await st()).phase)) return true; await sleep(200); } return false; };
const rect = (sel) => js(`(() => { const r = document.querySelector("${sel}").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const at = async (pt, size) => { const r = await rect("#vyView"); return [r[0] + pt.x * r[2] / size, r[1] + pt.y * r[2] / size]; };

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html#voyage" });
await sleep(+process.env.PH_WAIT || 5000);
await shot("v1-start.png");
if (+W < 600) await cdp("DeviceOrientation.setDeviceOrientationOverride", { alpha: 0, beta: 45, gamma: 0 });
await js(`document.querySelector("#vyStart").click()`); await sleep(2500);
await shot("v2-opening.png");
const log = [];
for (let chapter = 0; chapter < 3; chapter++) {
  log.push(`chapter ${chapter + 1}: reached fly = ${await until(["fly"], 40000)}`);
  await js(`window.__voyage.safe()`);
  await move(900, 300); await sleep(1400); await move(500, 600); await sleep(1400);
  if (chapter === 0 && +W < 600) {      // phone: tilting steers
    const tiltTo = async (gamma, beta) => { await cdp("DeviceOrientation.setDeviceOrientationOverride", { alpha: 0, beta, gamma }); await sleep(1300); return await st(); };
    const level = await tiltTo(0, 45), right = await tiltTo(24, 45), left = await tiltTo(-24, 45), up = await tiltTo(0, 25);
    log.push(`tilt active = ${right.tilt}; level x ${level.shipX.toFixed(1)}; tilt right x ${right.shipX.toFixed(1)}; tilt left x ${left.shipX.toFixed(1)}; tip away y ${up.shipY.toFixed(1)}; auto-fire rocks destroyed ${up.kills}`);
    await tiltTo(0, 45);
  }
  if (chapter === 0) {      // right click launches a missile
    const before = await st();
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: 600, y: 500, button: "right", buttons: 2, clickCount: 1 });
    await sleep(350); await shot("v3b-missile.png"); await sleep(1300);
    const after = await st();
    log.push(`right click: missiles fired ${before.fired} -> ${after.fired}, rocks destroyed ${before.kills} -> ${after.kills}`);
  }
  await shot(`v3-fly-${chapter}.png`);
  await js(`window.__voyage.arrive()`);
  await until(["scan", "ghost"]);
  let s = await st(); await sleep(500); await shot(`v4-scan-${chapter}.png`);
  if (s.phase === "ghost") {
    await click(...(await at(s.frames[0], s.size))); await sleep(300); await click(...(await at(s.frames[1], s.size)));
  } else {
    for (let i = 0; i < 90; i++) {                     // follow the object with the pointer, as a player would
      s = await st(); if (s.phase !== "scan") break;
      await move(...(await at(s.frames[s.i === 1 ? 1 : 0], s.size))); await sleep(90);
    }
    s = await st();
    if (s.phase === "probe") { await sleep(400); await shot(`v4b-probe-${chapter}.png`); await click(...(await at(s.target, s.size))); }
  }
  await sleep(700); s = await st();
  log.push(`chapter ${chapter + 1} (${s.scanType}): result = ${s.phase === "result"}, ${await js(`document.querySelector("#vyRFact").textContent.slice(0, 70)`)}`);
  await shot(`v5-result-${chapter}.png`);
  await js(`document.querySelector("#vyNext").click()`); await sleep(900);
}
// the finale
await js(`window.__voyage.skipTo(10)`);
log.push(`finale: reached fly = ${await until(["fly"], 15000)}`);
await sleep(1500); await shot("v7-finale-fly.png");
await js(`window.__voyage.arrive()`);
log.push(`finale: reached stack = ${await until(["stack"], 20000)}`);
await sleep(600); await shot("v8-stack-start.png");
let s = await st();
log.push(`stack signal with no drift: ${s.snr?.toFixed(1)}`);
await js(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input")); }; const t = window.__voyage.state().truth; set("vyVx", t.vx); set("vyVy", t.vy); })()`);
await sleep(500); s = await st();
log.push(`stack signal with the right drift: ${s.snr?.toFixed(1)}`);
await shot("v9-stack-found.png");
const r = await rect("#vyStack");
await click(r[0] + s.spot.x * r[2], r[1] + s.spot.y * r[3]);
await sleep(11000);
log.push(`ending shown = ${await js(`!document.querySelector("#vyEnd").hidden`)}, rank = ${await js(`document.querySelector("#vyEndRank").textContent`)}`);
await shot("v10-ending.png");
console.log(JSON.stringify({ log, errors }, null, 1));
ws.close(); proc.kill();
