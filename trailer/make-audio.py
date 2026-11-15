"""Builds the trailer's sound: the spoken lines over a synthesised space-ambient music bed that drops in level while someone is speaking.
usage: python make-audio.py <dir with vo0.wav ...> out.wav [timing.json]      (needs numpy; no music files are used)"""
import sys, wave
import numpy as np

SR, DUR = 44100, 30.0
SCENES = [0, 83, 149, 253, 348, 433, 475, 604]      # frame where each spoken line's scene starts (24 frames a second), as in make-trailer.mjs
STARTS = [f / 24 for f in SCENES]
FLIGHT = (475 / 24, (475 + 60) / 24)                # the game's flying shot
TITLE = (604 + 26 + 22 + 22) / 24                   # the final title card
if len(sys.argv) > 3:                                # a timing.json from req_voice.py replaces the scene times above
    import json
    T = json.load(open(sys.argv[3])); STARTS, FLIGHT, TITLE = T["starts"], tuple(T["flight"]), T["title"]
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(11)
A2 = 110.0
note = lambda semis: A2 * 2 ** (semis / 12)

def swell(t0, t1, fade=2.2):
    """Smooth rise and fall for a pad chord that lasts from t0 to t1, overlapping its neighbours."""
    return np.clip((t - t0 + fade / 2) / fade, 0, 1) * np.clip((t1 + fade / 2 - t) / fade, 0, 1)

def echo(x, delay, gain, repeats=7):
    """Repeating echoes: makes short sounds trail off into the distance."""
    out = x.copy(); d = int(delay * SR)
    for k in range(1, repeats + 1):
        out[k * d:] += gain ** k * x[:-k * d]
    return out

def space(x):
    """A rough hall: several echo trains at unrelated spacings, blurring into a wash."""
    return (x + 0.6 * echo(x, 0.113, 0.62) + 0.5 * echo(x, 0.187, 0.58) + 0.45 * echo(x, 0.271, 0.55) + 0.4 * echo(x, 0.397, 0.5)) / 2.2

# ---------- pad: slow chords, A minor · F · C · G, then back to A minor for the title ----------
CHORDS = [(0, 7.2, [0, 7, 12, 15, 19]), (7.2, 14.4, [-4, 3, 8, 12, 15]), (14.4, 21.2, [3, 10, 15, 19, 22]), (21.2, 26.2, [-2, 5, 10, 14, 17]), (26.2, 30.5, [0, 7, 12, 15, 19, 24])]
pad = np.zeros_like(t)
for t0, t1, semis in CHORDS:
    chord = np.zeros_like(t)
    for s in semis:
        f = note(s)
        for det, pan in [(-0.25, 0.9), (0.0, 1.0), (0.31, 0.9)]:          # three slightly detuned voices: a slow shimmer
            ph = 2 * np.pi * (f + det) * t + rng.uniform(0, 6.28)
            chord += pan * (np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)) / (1 + s / 14)
    pad += chord * swell(t0, t1) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.13 * t + t0))
pad = space(pad / np.max(np.abs(pad)))

# ---------- deep sub under each chord ----------
sub = np.zeros_like(t)
for t0, t1, semis in CHORDS:
    sub += np.sin(2 * np.pi * note(semis[0] - 12) * t) * swell(t0, t1, 1.5)

# ---------- sparse high 'starlight' notes, drifting off in echoes ----------
stars = np.zeros_like(t)
for when in np.arange(0.6, 29, 0.75):
    t0, t1, semis = next(c for c in CHORDS if c[0] <= when < c[1])
    if rng.random() < 0.3: continue
    f = note(rng.choice(semis) + 24); x = np.maximum(0, t - when)
    stars += rng.uniform(0.5, 1) * np.sin(2 * np.pi * f * x) * np.exp(-x * 3.2) * (t >= when) * (1 + 0.3 * np.sin(2 * np.pi * 2 * f * x))
stars = space(echo(stars, 0.375, 0.55, 6)); stars /= np.max(np.abs(stars))

# ---------- a breath of 'solar wind', and soft swells into the cuts ----------
wind = np.convolve(rng.standard_normal(len(t)), np.ones(40) / 40, mode="same") * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t)) ** 2
def swoosh(t1, length=1.6):
    k = np.clip((t - (t1 - length)) / length, 0, 1)
    return np.convolve(rng.standard_normal(len(t)), np.ones(12) / 12, mode="same") * k ** 3 * (t < t1)
def boom(t0, amp=1.0):
    x = np.maximum(0, t - t0)
    return amp * np.sin(2 * np.pi * (44 * x + 18 * (1 - np.exp(-x * 4)) / 4)) * np.exp(-x / 1.4) * (t >= t0) * np.minimum(1, x / 0.01)

music = 0.9 * pad + 0.32 * sub / np.max(np.abs(sub)) + 0.28 * stars + 0.05 * wind / np.max(np.abs(wind))
for s in STARTS[1:]: music += 0.07 * swoosh(s) + boom(s, 0.22)
music += 0.16 * swoosh(TITLE, 2.4) + boom(TITLE, 0.6) + boom(0.1, 0.35)
# a soft heartbeat under the flight, so the game footage has some drive
beat = 60 / 120
for i in range(int((FLIGHT[1] - FLIGHT[0]) / beat) + 1):
    x = np.maximum(0, t - (FLIGHT[0] + i * beat)); music += 0.3 * np.sin(2 * np.pi * 55 * x) * np.exp(-x * 9) * (x > 0)
music = np.tanh(music * 0.9); music /= np.max(np.abs(music))

# ---------- voice ----------
voice = np.zeros_like(t); speaking = np.zeros_like(t)
for i, s in enumerate(STARTS):
    w = wave.open(f"{sys.argv[1]}/vo{i}.wav"); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768; sr = w.getframerate()
    loud = np.where(np.abs(a) > 0.01)[0]; a = a[max(0, loud[0] - 300): loud[-1] + 3000]          # trim the silence at both ends
    a = np.interp(np.arange(int(len(a) * SR / sr)) * sr / SR, np.arange(len(a)), a)
    a /= np.max(np.abs(a))                                                                        # every line equally loud
    i0 = int((s + 0.12) * SR); n = min(len(a), len(t) - i0)
    voice[i0:i0 + n] += a[:n]; speaking[i0:i0 + n] = 1
    print(f"line {i}: starts {s + 0.12:5.2f} s, lasts {len(a) / SR:4.2f} s, next scene at {STARTS[i + 1] if i + 1 < len(STARTS) else DUR:5.2f} s")
# the music sits under the voice and rises in the gaps and at the end
duck = np.convolve(speaking, np.ones(int(SR * 0.3)) / int(SR * 0.3), mode="same")
out = voice * 0.9 + music * (0.5 - 0.41 * duck)
out *= np.clip(t / 0.4, 0, 1) * np.clip((DUR - t) / 1.6, 0, 1)
out = out / np.max(np.abs(out)) * 0.95
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", sys.argv[2], "| music level without voice vs with:", round(float(np.sqrt(np.mean((music * 0.5) ** 2))), 3), round(float(np.sqrt(np.mean((music * 0.09) ** 2))), 3), "| voice:", round(float(np.sqrt(np.mean(voice[speaking > 0] ** 2)) * 0.9), 3))
