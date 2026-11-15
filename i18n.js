// English / Bahasa Malaysia. English text is the key; ms.js holds the Malay for each key.
// Switching language reloads the page, so every screen is drawn again in the chosen language.
import { MS } from "./ms.js?v=58";

export const lang = localStorage.getItem("lang") === "ms" ? "ms" : "en";
export const locale = lang === "ms" ? "ms-MY" : "en-GB";
export const missing = new Set();   // English strings with no Malay yet; the browser check reads this
const look = (key) => (lang === "en" ? key : MS[key] ?? (missing.add(key), key));

// Plain string:  tr("Pause")
export const tr = (s) => look(s);
// Template:      t`Level ${n} of ${m}`   → key "Level {0} of {1}"
export const t = (parts, ...vals) => look(parts.reduce((a, p, i) => a + p + (i < vals.length ? `{${i}}` : ""), "")).replace(/\{(\d+)\}/g, (_, i) => vals[i]);

// Static text in index.html: each element's own English HTML is its key.
const squash = (s) => s.replace(/\s+/g, " ").trim();
const SEL = "h1, h2, h3, p, li, figcaption, label, button, dt, .crit li > span, a.btnlink, dl.numbers dd, span.note";
document.documentElement.lang = lang;
if (lang === "ms") {
  document.querySelectorAll(SEL).forEach((el) => {
    if (el.querySelector(SEL) || !el.textContent.trim()) return;   // containers and empty placeholders
    const key = squash(el.innerHTML);
    if (MS[key] != null) el.innerHTML = MS[key]; else missing.add(key);
  });
}
const b = document.getElementById("langBtn");
b.textContent = lang === "ms" ? "EN" : "BM";   // short, so the header fits on a phone
b.title = lang === "ms" ? "English" : "Bahasa Malaysia";
b.onclick = () => { localStorage.setItem("lang", lang === "ms" ? "en" : "ms"); location.reload(); };
window.__missing = missing;
