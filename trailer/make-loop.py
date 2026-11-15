"""Builds the site's background music: the trailer's space-ambient bed (pad, deep sub, starlight notes, solar wind) as a seamless 48-second loop.
usage: python make-loop.py out.wav      (needs numpy; no music files are used)"""
import sys, wave
import numpy as np

SR, L, X = 44100, 48.0, 4.0           # loop length, plus X seconds rendered past the end and cross-faded into the start
t = np.arange(int(SR * (L + X))) / SR
rng = np.random.default_rng(7)
note = lambda semis: 110.0 * 2 ** (semis / 12)

def swell(t0, t1, fade=4.0):
    """Rise and fall for a chord from t0 to t1, wrapped around the loop so the last chord fades into the first."""
    return np.max([np.clip((t - a + fade / 2) / fade, 0, 1) * np.clip((b + fade / 2 - t) / fade, 0, 1) for a, b in [(t0 - L, t1 - L), (t0, t1), (t0 + L, t1 + L)]], axis=0)

def echo(x, delay, gain, repeats=7):
    out = x.copy(); d = int(delay * SR)
    for k in range(1, repeats + 1):
        out[k * d:] += gain ** k * x[:-k * d]
    return out

def space(x):
    return (x + 0.6 * echo(x, 0.113, 0.62) + 0.5 * echo(x, 0.187, 0.58) + 0.45 * echo(x, 0.271, 0.55) + 0.4 * echo(x, 0.397, 0.5)) / 2.2

# A minor · F · C · G, 12 seconds each
CHORDS = [(0, 12, [0, 7, 12, 15, 19]), (12, 24, [-4, 3, 8, 12, 15]), (24, 36, [3, 10, 15, 19, 22]), (36, 48, [-2, 5, 10, 14, 17])]
pad = np.zeros_like(t)
for t0, t1, semis in CHORDS:
    chord = np.zeros_like(t)
    for s in semis:
        for det in (-0.25, 0.0, 0.31):
            ph = 2 * np.pi * (note(s) + det) * t + rng.uniform(0, 6.28)
            chord += (np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph)) / (1 + s / 14)
    pad += chord * swell(t0, t1)
pad = space(pad / np.max(np.abs(pad)))
sub = sum(np.sin(2 * np.pi * note(s[0] - 12) * t) * swell(a, b, 3.0) for a, b, s in CHORDS)
stars = np.zeros_like(t)
for when in np.arange(0.8, L - 3, 1.1):
    if rng.random() < 0.45: continue
    semis = next(c[2] for c in CHORDS if c[0] <= when < c[1])
    f = note(rng.choice(semis) + 24); x = np.maximum(0, t - when)
    stars += rng.uniform(0.4, 1) * np.sin(2 * np.pi * f * x) * np.exp(-x * 3.2) * (t >= when)
stars = space(echo(stars, 0.375, 0.55, 6)); stars /= np.max(np.abs(stars))
wind = np.convolve(rng.standard_normal(len(t)), np.ones(40) / 40, mode="same") * (0.5 + 0.5 * np.sin(2 * np.pi * (1 / 24) * t)) ** 2
mix = 0.55 * pad + 0.3 * sub + 0.16 * stars + 0.5 * wind / np.max(np.abs(wind))
n, k = int(SR * L), int(SR * X)
out = mix[:n].copy(); fade = np.linspace(0, 1, k)
out[:k] = out[:k] * fade + mix[n:n + k] * (1 - fade)        # the tail beyond the end blends into the start: no click at the loop point
out = out / np.max(np.abs(out)) * 0.8
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", sys.argv[1], round(L), "s")
