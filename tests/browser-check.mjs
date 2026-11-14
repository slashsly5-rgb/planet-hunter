// Plays the game in headless Microsoft Edge and saves screenshots.  usage: node tests/browser-check.mjs <outdir> [width height]
// Needs a local server on http://localhost:8765 (python -m http.server 8765) and Edge installed.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = ".", W = "390", H = "844"] = process.argv.slice(2);
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${mkdtempSync(join(tmpdir(), "ph-"))}`,
  `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9333/json")).json(); } catch {} }
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
const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const centre = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
await cdp("Page.navigate", { url: "http://localhost:8765/index.html" });
await sleep(1500);
await shot("1-start.png");
const levels = await js(`fetch("levels.json").then(r => r.json())`);
await click(...(await centre("#startBtn")));
await sleep(1200);
await shot("2-level.png");

const results = [];
for (let i = 0; i < levels.length; i++) {
  const L = levels[i], hit = i % 2 === 0;           // alternate: tap the object, then tap a wrong place
  const r = await js(`(() => { const r = document.querySelector("#huntView").getBoundingClientRect(); return [r.left, r.top, r.width]; })()`);
  const f = L.frames[0], k = r[2] / L.size;
  const [tx, ty] = hit ? [f.x, f.y] : [(f.x + L.size / 2) % L.size, (f.y + L.size / 2) % L.size];
  await click(r[0] + tx * k, r[1] + ty * k);
  await sleep(600);
  results.push({ level: L.id, tapped: hit ? "object" : "wrong place", verdict: await js(`document.querySelector("#verdict").textContent`) });
  if (i < 2) await shot(`3-reveal-${i}.png`);
  await js(`document.querySelector("#nextBtn").click()`);
  await sleep(700);
}
await shot("4-end.png");
await js(`document.querySelector('.top [data-view="explore"]').click()`); await sleep(500);
await shot("5-explore.png");
await js(`document.querySelector(".cardlink").click()`); await sleep(1800);
await shot("6-object.png");
await js(`window.scrollTo(0, 600)`); await sleep(300);
await shot("7-object-info.png");
const overflow = await js(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
console.log(JSON.stringify({ results, score: await js(`document.querySelector("#scoreLine").textContent`), horizontalOverflow: overflow, errors }, null, 1));
ws.close(); proc.kill();
