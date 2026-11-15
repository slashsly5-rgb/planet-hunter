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
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html" + (process.env.PH_HASH || "") });
await sleep(+process.env.PH_WAIT || 1500);   // a slow connection needs longer for the 3D library
if (process.env.PH_HASH) {     // check a direct link such as #hunt: report what the visitor lands on, then stop
  await sleep(2500); await shot("hash.png");
  console.log(JSON.stringify({ hash: process.env.PH_HASH, hunt: await js(`window.__hunt?.state().step`), prompt: await js(`document.querySelector("#prompt").textContent.slice(0, 60)`), voyageStart: await js(`!document.querySelector("#voyage").hidden`), errors }));
  ws.close(); proc.kill(); process.exit(0);
}
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

const results = [], blocked = [];
const tapHunt = async (pt, size) => { const r = await js(`(() => { const r = document.querySelector("#huntView").getBoundingClientRect(); return [r.left, r.top, r.width]; })()`); await click(r[0] + pt.x * r[2] / size, r[1] + pt.y * r[2] / size); await sleep(600); };
const hs = () => js(`window.__hunt.state()`);
for (let i = 0; i < 40; i++) {                       // each mission: detect, (predict), classify. Odd missions get wrong answers on purpose.
  if (await js(`!document.querySelector("#huntEnd").hidden`)) break;
  // PH_REAL=1: press buttons with a real mouse click at their position, as a person would, instead of calling click() on them
  const press = async (sel) => { if (!process.env.PH_REAL) return js(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await js(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: "center" })`); await sleep(350);
    const hit = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y); return [x, y, top === b || b.contains(top), top ? (top.id || top.className || top.tagName) : "nothing"]; })()`);
    if (!hit[2]) blocked.push(`${sel} is covered by: ${hit[3]}`);
    await click(hit[0], hit[1]); };
  for (let w = 0; w < 30 && (await hs()).step !== "detect"; w++) await sleep(300);
  let st = await hs(); const good = i % 2 === 0, far = (f) => ({ x: (f.x + st.size / 2) % st.size, y: (f.y + st.size / 2) % st.size });
  if (process.env.PH_SECOND && good) await tapHunt(far(st.frames[0]), st.size);   // optional: miss once, then find it on the second try
  await tapHunt(good ? st.frames[0] : far(st.frames[0]), st.size);
  if (!good) await tapHunt(far(st.frames[0]), st.size);          // second try, also wrong
  if (i < 2) await shot(`3-detect-${i}.png`);
  st = await hs();
  if (st.step === "predict" && process.env.PH_SKIP) { await press("#skipBtn"); await sleep(500); }
  else if (st.step === "predict") { await tapHunt(good ? st.target : far(st.target), st.size); if (i < 2) await shot(`3-predict-${i}.png`); }
  st = await hs();
  const zsel = `.zone[data-z="${good ? st.zone : (st.zone === "belt" ? "outer" : "belt")}"]`;
  await press(zsel); await sleep(500);
  if (i < 2) await shot(`3-reveal-${i}.png`);
  results.push({ mission: i + 1, played: good ? "well" : "badly", result: await js(`document.querySelector("#prompt").textContent`) });
  await press("#nextBtn");
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
// computer scan
await js(`document.querySelector('[data-exmode="scan"]').click()`); await sleep(2500);
await shot("7c-scan.png");
const scanTip = await js(`document.querySelector("#exTip").textContent`);
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
// automatic detector: run it on every level's image pair and compare with the real positions
const detector = await js(`(async () => { const { detect, judge } = await import("./detect.js"); const L = await (await fetch("levels.json")).json();
  const load = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = src; }); const out = [];
  for (const l of L) { const [a, b] = await Promise.all(l.frames.map((f) => load(f.img))); const r = detect(a, b, l.size), j = judge(r, l.frames);
    out.push(l.id + ": " + (j.found ? "FOUND" : j.listed ? "listed, not top" : "missed") + " (movers " + r.movers.length + ", single " + r.singles.length + ", changed " + r.changed.length + (j.top ? ", top " + j.top.confidence + "%" : "") + ")"); }
  return out; })()`);
const colours = await js(`(async () => { const { composite } = await import("./colour.js"); const L = await (await fetch("levels.json")).json(); const out = [];
  for (const l of L) { const r = await composite(l); out.push(l.id + ": " + (r ? r.channels.map((c) => c.name[0] + "=" + c.frame.band).join(" ") + ", " + r.bands + " band(s)" : "none")); } return out; })()`);
const overflow = await js(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
console.log(JSON.stringify({ results, score: await js(`document.querySelector("#scoreLine").textContent`), horizontalOverflow: overflow, has3d, blocked, colours, detector, scanTip, vs: await js(`document.querySelector('#vsLine').textContent`), measured, lab, missing: await js(`[...window.__missing]`), errors }, null, 1));
ws.close(); proc.kill();
