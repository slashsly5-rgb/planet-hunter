// Three-colour pictures: three real SPHEREx images of the same patch, shown as red, green and blue.
// Stars are in all three, so they take a colour from how bright they are at each wavelength.
// A moving world is in a different place in each image, so it appears three times, once per colour.
const ORDER = { D1: 1, D2: 2, D3: 3 };          // shorter wavelength → bluer channel
const cache = new Map();
const load = (src) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });

// Choose three images: as many different wavelength bands as possible, with the object well separated between them.
function pick(frames) {
  let best = null;
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) for (let k = j + 1; k < frames.length; k++) {
    const trio = [frames[i], frames[j], frames[k]], bands = new Set(trio.map((f) => f.band)).size;
    const gap = Math.min(...[[0, 1], [0, 2], [1, 2]].map(([a, b]) => Math.hypot(trio[a].x - trio[b].x, trio[a].y - trio[b].y)));
    const score = bands * 1000 + Math.min(gap, 70);
    if (!best || score > best.score) best = { trio, score };
  }
  if (!best) return null;
  // blue = shortest wavelength, red = longest; equal bands fall back to time order
  return [...best.trio].sort((a, b) => ORDER[a.band] - ORDER[b.band] || a.date.localeCompare(b.date));   // [blue, green, red]
}

export async function composite(level) {
  if (cache.has(level.id)) return cache.get(level.id);
  const frames = level.track?.length > 2 ? level.track : null, chosen = frames && pick(frames);
  if (!chosen) { cache.set(level.id, null); return null; }
  const [blue, green, red] = chosen, imgs = await Promise.all([red, green, blue].map((f) => load(f.img)));
  const n = imgs[0].naturalWidth, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d"), data = imgs.map((im) => { g.drawImage(im, 0, 0, n, n); return g.getImageData(0, 0, n, n).data; });
  const out = g.createImageData(n, n), tone = (v) => 255 * Math.min(1, 1.2 * Math.max(0, (v - 26) / 229) ** 0.85);   // sky to black, a little extra contrast
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = tone(data[0][i]); out.data[i + 1] = tone(data[1][i]); out.data[i + 2] = tone(data[2][i]); out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const result = { url: c.toDataURL("image/png"), channels: [{ name: "red", css: "#ff5a5a", frame: red }, { name: "green", css: "#5dff7a", frame: green }, { name: "blue", css: "#6f9bff", frame: blue }],
    bands: new Set(chosen.map((f) => f.band)).size };
  cache.set(level.id, result);
  return result;
}

// rings in each channel's colour around the object's position in that image
export const colourMarks = (result) => result.channels.map((ch) => `<circle cx="${ch.frame.x}" cy="${ch.frame.y}" r="17" fill="none" stroke="${ch.css}" stroke-width="2.5" stroke-dasharray="5 4"/>`).join("");
