"""Builds the trailer's sound: the spoken lines (made by voice.ps1) over a synthesised music bed that drops in level while someone is speaking.
usage: python make-audio.py <dir with vo0.wav .. vo7.wav> out.wav      (needs numpy; no music files are used)"""
import sys, wave
import numpy as np

SR, DUR = 44100, 30.0
# where each spoken line's scene starts, in seconds (the same frame counts as make-trailer.mjs, at 24 frames a second)
SCENES = [0, 83, 149, 253, 348, 433, 475, 604]
STARTS = [f / 24 for f in SCENES]
FLIGHT = (475 / 24, (475 + 60) / 24)          # the game's flying shot: driving pulse here
TITLE = (604 + 26 + 22 + 22) / 24             # the final title card
t = np.arange(int(SR * DUR)) / SR
rng = np.random.default_rng(7)

def env(t0, attack, decay):
    x = t - t0
    return np.where(x < 0, 0, np.minimum(1, x / attack) * np.exp(-np.maximum(0, x - attack) / decay))

def hit(t0, amp=1.0, f0=46, decay=1.3):
    """Trailer 'boom': a sub tone that drops in pitch, plus a burst of filtered noise."""
    x = np.maximum(0, t - t0)
    sub = np.sin(2 * np.pi * (f0 * x + 22 * (1 - np.exp(-x * 5)) / 5))
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(60) / 60, mode="same") * 6
    return amp * (sub * env(t0, 0.004, decay) + 0.5 * noise * env(t0, 0.002, 0.18))

def riser(t0, t1, amp=0.5):
    k = np.clip((t - t0) / (t1 - t0), 0, 1)
    tone = np.sin(2 * np.pi * np.cumsum(120 + 900 * k ** 2) / SR)
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(8) / 8, mode="same")
    return amp * ((t >= t0) & (t < t1)) * k ** 2.2 * (0.6 * tone + 0.9 * noise)

# ---------- music ----------
music = 0.22 * np.minimum(1, t / 1.5) * (0.5 * np.sin(2 * np.pi * 55 * t) + 0.4 * np.sin(2 * np.pi * 55.6 * t) + 0.25 * np.sin(2 * np.pi * 82.4 * t + np.sin(t * 0.7))
                                         + 0.5 * np.sin(2 * np.pi * 110 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.21 * t)))
for i, s in enumerate(STARTS):
    music += hit(max(0.1, s), 0.75 if i else 0.8)
music += hit(TITLE, 1.2) + riser(STARTS[0] + 0.9, STARTS[1], 0.4) + riser(TITLE - 2.2, TITLE, 0.5)
beat = 60 / 132 / 2
for i in range(int((FLIGHT[1] - FLIGHT[0]) / beat)):
    t0 = FLIGHT[0] + i * beat; x = np.maximum(0, t - t0)
    music += (0.34 if i % 2 == 0 else 0.2) * np.sin(2 * np.pi * 55 * x) ** 3 * env(t0, 0.004, 0.09)
for f, a in [(55, 0.3), (110, 0.22), (164.8, 0.16), (220, 0.12)]:
    music += a * np.sin(2 * np.pi * f * t) * env(TITLE, 0.02, 2.2)
music = np.tanh(music * 1.2); music /= np.max(np.abs(music))

# ---------- voice ----------
voice = np.zeros_like(t); speaking = np.zeros_like(t)
for i, s in enumerate(STARTS):
    w = wave.open(f"{sys.argv[1]}/vo{i}.wav"); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768; sr = w.getframerate()
    loud = np.where(np.abs(a) > 0.01)[0]; a = a[max(0, loud[0] - 200): loud[-1] + 2000]          # trim the silence at both ends
    a = np.interp(np.arange(int(len(a) * SR / sr)) * sr / SR, np.arange(len(a)), a)                # to 44.1 kHz
    i0 = int((s + 0.12) * SR); n = min(len(a), len(t) - i0)
    voice[i0:i0 + n] += a[:n]; speaking[i0:i0 + n] = 1
    print(f"line {i}: starts {s + 0.12:5.2f} s, lasts {len(a) / SR:4.2f} s, next scene at {STARTS[i + 1] if i + 1 < len(STARTS) else DUR:5.2f} s")
voice /= np.max(np.abs(voice))
# the music drops while a line is spoken and comes back up in the gaps
duck = np.convolve(speaking, np.ones(int(SR * 0.25)) / int(SR * 0.25), mode="same")
out = voice * 0.95 + music * (0.5 - 0.3 * duck)
out *= np.clip((DUR - t) / 1.5, 0, 1)
out = out / np.max(np.abs(out)) * 0.95
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", sys.argv[2])
