// Plays the first chapters of the Voyage in headless Edge and saves screenshots.
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
const st = () => js(`window.__voyage.state()`);
const until = async (phase, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if ((await st()).phase === phase) return true; await sleep(200); } return false; };

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html" });
await sleep(+process.env.PH_WAIT || 5000);
await js(`document.querySelector('.top [data-view="voyage"]').click()`); await sleep(800);
await shot("v1-start.png");
await js(`document.querySelector("#vyStart").click()`); await sleep(1200);
await shot("v2-title.png");
const log = [];
for (let chapter = 0; chapter < 2; chapter++) {
  log.push(`chapter ${chapter + 1}: reached fly = ${await until("fly")}`);
  await js(`window.__voyage.safe()`);
  await move(900, 300); await sleep(1500); await move(500, 600); await sleep(1500);
  await shot(`v3-fly-${chapter}.png`);
  await js(`window.__voyage.arrive()`);
  log.push(`chapter ${chapter + 1}: reached scan = ${await until("scan")}`);
  await sleep(600); await shot(`v4-scan-${chapter}.png`);
  // follow the object with the pointer, as a player would
  for (let i = 0; i < 80; i++) {
    const s = await st(); if (s.phase !== "scan") break;
    const r = await js(`(() => { const r = document.querySelector("#vyView").getBoundingClientRect(); return [r.left, r.top, r.width]; })()`);
    const f = s.frames[s.i === 1 ? 1 : 0];
    await move(r[0] + f.x * r[2] / s.size, r[1] + f.y * r[2] / s.size); await sleep(90);
  }
  log.push(`chapter ${chapter + 1}: locked = ${(await st()).phase === "result"}`);
  await sleep(500); await shot(`v5-result-${chapter}.png`);
  await js(`document.querySelector("#vyNext").click()`); await sleep(900);
  await shot(`v6-warp-${chapter}.png`);
}
log.push(`after two chapters: ${JSON.stringify(await st()).slice(0, 80)}`);
console.log(JSON.stringify({ log, errors }, null, 1));
ws.close(); proc.kill();
