// Checks the For-judges page (every proof button lands somewhere sensible), the guided tour, and the plain-word explanations.
// usage: node tests/judges-check.mjs <outdir> [width height]      PH_URL=<site> to test the live site
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = ".", W = "1440", H = "900"] = process.argv.slice(2);
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9336", `--user-data-dir=${mkdtempSync(join(tmpdir(), "jc-"))}`,
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await (await fetch("http://localhost:9336/json")).json(); } catch {} }
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

await cdp("Runtime.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
await cdp("Page.navigate", { url: (process.env.PH_URL || "http://localhost:8765") + "/index.html#judges" });
await sleep(+process.env.PH_WAIT || 14000);
if (process.env.PH_LANG) { await js(`localStorage.setItem("lang", ${JSON.stringify(process.env.PH_LANG)})`); await cdp("Page.reload"); await sleep(+process.env.PH_WAIT || 14000); }
await shot("j1-judges.png");
const proofs = await js(`[...document.querySelectorAll("#judges [data-proof]")].map((b) => b.dataset.proof)`);
const landed = [];
for (const p of proofs) {
  await js(`document.querySelector('.top [data-view="judges"]').click()`); await sleep(300);
  await js(`document.querySelector('#judges [data-proof="${p}"]').click()`); await sleep(2600);
  landed.push(`${p} -> ${await view()}`);
}
await js(`document.querySelector('.top [data-view="about"]').click()`); await sleep(300);
const terms = await js(`(() => { const t = [...document.querySelectorAll("abbr.term")].map((a) => a.textContent); return t.slice(0, 12).join(", ") + " (" + t.length + " on the page)"; })()`);
await js(`document.querySelector("abbr.term").scrollIntoView({ block: "center" })`); await sleep(300);
await js(`document.querySelector("abbr.term").click()`); await sleep(300);
const pop = await js(`document.querySelector("#glossPop").hidden ? "" : document.querySelector("#glossPop").textContent`);
await shot("j2-gloss.png");
const tour = [];
await js(`document.querySelector('.top [data-view="home"], .brand').click()`); await sleep(500);
await js(`document.querySelector("[data-tour]").click()`); await sleep(3500);
for (let i = 0; i < 8; i++) {
  tour.push(`${await js(`document.querySelector("#tourStep").textContent`)}: ${await view()}`);
  if (i === 2) await shot("j3-tour.png");
  await js(`document.querySelector("#tourNext").click()`); await sleep(3500);
}
const tourClosed = await js(`document.querySelector("#tour").hidden`);
console.log(JSON.stringify({ proofs: proofs.length, landed, terms, pop, tour, tourClosed, missing: await js(`[...(window.__missing || [])]`), errors }, null, 1));
ws.close(); proc.kill();
