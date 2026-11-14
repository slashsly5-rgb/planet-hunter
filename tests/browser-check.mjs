// Plays the game in headless Microsoft Edge and saves screenshots.  usage: node tests/browser-check.mjs <outdir> [width height]
// Needs a local server on http://localhost:8765 (python -m http.server 8765) and Edge installed.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = ".", W = "390", H = "844"] = process.argv.slice(2);
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${mkdtempSync(join(tmpdir(), "ph-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
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
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html" });
await sleep(+process.env.PH_WAIT || 1500);   // a slow connection needs longer for the 3D library
if (process.env.PH_LANG) { await js(`localStorage.setItem("lang", ${JSON.stringify(process.env.PH_LANG)})`); await cdp("Page.reload"); await sleep(1500); }
await shot("1-start.png");
// 3D Solar System: fly to a world, then out to the Planet X zone, then back
const has3d = await js(`!!window.__space`);
if (has3d) {
  await js(`window.__space.select("pluto")`); await sleep(3000); await shot("1b-world.png");
  await js(`window.__space.px()`); await sleep(2500); await shot("1c-planetx.png");
  await js(`document.querySelector("#homeBtn").click()`); await sleep(1800);
}
const levels = await js(`fetch("levels.json").then(r => r.json())`);
await click(...(await centre("#startBtn")));
await sleep(1200);
await shot("2-level.png");

const results = [];
const tapHunt = async (pt, size) => { const r = await js(`(() => { const r = document.querySelector("#huntView").getBoundingClientRect(); return [r.left, r.top, r.width]; })()`); await click(r[0] + pt.x * r[2] / size, r[1] + pt.y * r[2] / size); await sleep(600); };
const hs = () => js(`window.__hunt.state()`);
for (let i = 0; i < 40; i++) {                       // each mission: detect, (predict), classify. Odd missions get wrong answers on purpose.
  if (await js(`!document.querySelector("#huntEnd").hidden`)) break;
  for (let w = 0; w < 30 && (await hs()).step !== "detect"; w++) await sleep(300);
  let st = await hs(); const good = i % 2 === 0, far = (f) => ({ x: (f.x + st.size / 2) % st.size, y: (f.y + st.size / 2) % st.size });
  await tapHunt(good ? st.frames[0] : far(st.frames[0]), st.size);
  if (!good) await tapHunt(far(st.frames[0]), st.size);          // second try, also wrong
  if (i < 2) await shot(`3-detect-${i}.png`);
  st = await hs();
  if (st.step === "predict") { await tapHunt(good ? st.target : far(st.target), st.size); if (i < 2) await shot(`3-predict-${i}.png`); }
  st = await hs();
  await js(`document.querySelector('.zone[data-z="${good ? st.zone : (st.zone === "belt" ? "outer" : "belt")}"]').click()`); await sleep(500);
  if (i < 2) await shot(`3-reveal-${i}.png`);
  results.push({ mission: i + 1, played: good ? "well" : "badly", result: await js(`document.querySelector("#prompt").textContent`) });
  await js(`document.querySelector("#nextBtn").click()`);
  await sleep(900);
}
await shot("4-end.png");
await js(`document.querySelector('.top [data-view="explore"]').click()`); await sleep(500);
await shot("5-explore.png");
await js(`document.querySelector(".cardlink").click()`); await sleep(1800);
await shot("6-object.png");
await js(`window.scrollTo(0, 600)`); await sleep(300);
await shot("7-object-info.png");
// 3D time stack
await js(`window.scrollTo(0, 0)`); await js(`document.querySelector('[data-exmode="stack"]').click()`); await sleep(3000);
await shot("7b-stack.png");
await js(`document.querySelector('[data-exmode="play"]').click()`); await sleep(1500);
// six months apart
await js(`window.scrollTo(0, 0)`); await js(`document.querySelector("#passBtn").click()`); await sleep(2500);
await shot("8-six-months.png");
// measure it yourself: tap the object in the first and last images
await js(`document.querySelector("#measureBtn").click()`); await sleep(2000);
const T = levels[0].track, tapEx = async (f) => { const r = await js(`(() => { const r = document.querySelector("#exView").getBoundingClientRect(); return [r.left, r.top, r.width]; })()`); await click(r[0] + f.x * r[2] / levels[0].size, r[1] + f.y * r[2] / levels[0].size); await sleep(500); };
await tapEx(T[0]); await tapEx(T[T.length - 1]);
const measured = await js(`document.querySelector("#exTip").textContent`);
await shot("9-measure.png");
// Planet X lab
await js(`document.querySelector('.top [data-view="lab"]').click()`); await sleep(2500);
await shot("10-lab-chart.png");
await js(`document.querySelector("#labView").scrollIntoView()`); await sleep(400);
await shot("11-lab-sim.png");
await js(`document.querySelector("#labReveal").click()`); await sleep(400);
await js(`document.querySelector("#labOut").scrollIntoView({block:"center"})`); await sleep(300);
await shot("12-lab-readout.png");
const lab = await js(`document.querySelector("#labOut").textContent + " | " + document.querySelector("#labVerdict").textContent`);
const overflow = await js(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
console.log(JSON.stringify({ results, score: await js(`document.querySelector("#scoreLine").textContent`), horizontalOverflow: overflow, has3d, measured, lab, missing: await js(`[...window.__missing]`), errors }, null, 1));
ws.close(); proc.kill();
